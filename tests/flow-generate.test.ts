import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { flowAspect, flowReferences, flowSpritePrompt } from '../src/engine/assets/flow-image'
import { generateAsset } from '../src/engine/assets/generate'
import type { GenerateContext } from '../src/engine/assets/generate'
import { resolveFile } from '../src/engine/assets/manifest'
import { FlowError } from '../src/engine/studios/flow'
import { engineFor } from '../src/engine/vn/service'
import type { AssetEntry } from '../src/shared/vn'
import { mediaBook, settings } from './assets-fixtures'
import { FakeFlow } from './flow-fakes'
import { book as pipelineBook, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { FakeComfy } from './vn-helpers'

sharp.cache(false)
const PALETTES = path.resolve(__dirname, '..', 'seed', 'palettes')

let dir: string
let env: VnEnv | undefined
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vno-flow-gen-'))
})
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const flowSettings = (art: Record<string, unknown> = {}) => settings({ art: { style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'key', provider: 'flow', ...art } } as never)
const stub = (id: string, s = flowSettings()): AssetEntry => deriveAssets(mediaBook(), s).find((a) => a.id === id)!
const mk = (flow: FakeFlow, comfy: FakeComfy, over: Partial<GenerateContext> = {}): GenerateContext => ({
  book: mediaBook(),
  settings: flowSettings(),
  projectDir: dir,
  comfy,
  flow,
  palettesDir: PALETTES,
  sizes: { background: { w: 1920, h: 1080 }, cover: { w: 1920, h: 1080 }, spriteHeight: 600 },
  ...over
})
const made = (r: Awaited<ReturnType<typeof generateAsset>>) => {
  if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
  return r
}
const sizeOf = async (e: AssetEntry) => {
  const m = await sharp(resolveFile(dir, e)!).metadata()
  return [m.width, m.height]
}

describe('pure helpers', () => {
  it('aspects: wide for backgrounds, full CGs and the cover; tall for sheets and sprites; square for an insert', () => {
    expect([flowAspect('background'), flowAspect('cover'), flowAspect('cg', 'full'), flowAspect('cg', 'insert'), flowAspect('sheet'), flowAspect('sprite')]).toEqual(['16:9', '16:9', '16:9', '1:1', '9:16', '9:16'])
  })

  it('a sprite prompt asks for the same character, full body, on a plain flat background, once', () => {
    const p = flowSpritePrompt('Same character as the reference image. Worried expression. A small girl with red braids')
    expect(p).toContain('Same character as the reference image.')
    expect(p.match(/reference image/g)).toHaveLength(1)
    expect(p).toMatch(/Full body, standing/)
    expect(p).toMatch(/Plain flat light grey background/)
    expect(flowSpritePrompt('A girl on a plain flat light grey background')).not.toMatch(/Plain flat light grey background, nothing/)
  })

  it('engine for a flow project is flow for every image kind and unchanged for the rest', () => {
    const s = flowSettings()
    for (const k of ['background', 'sheet', 'sprite', 'cover', 'cg'] as const) expect(engineFor(k, s, k === 'cg' ? ['sheet_petra'] : undefined)).toBe('flow')
    expect(engineFor('sfx', s)).toBe('ace-step-v1-instrumental')
    expect(engineFor('ambience', s)).toBe('ace-step-v1-instrumental')
    expect(engineFor('background', settings())).toBe('qwen-image-2.1')
    expect(deriveAssets(mediaBook(), s).filter((a) => ['background', 'sheet', 'sprite', 'cover', 'cg'].includes(a.kind)).every((a) => a.engine === 'flow')).toBe(true)
  })

  it('flowReferences: a Flow sheet is sent as asset:<media id>, any other as its file, at most 3, and a missing sheet is an error', () => {
    const sheet = (id: string, remote?: string): AssetEntry => ({ ...stub(id), engine: remote ? 'flow' : 'qwen-image-2.1', selected: 1, versions: [{ n: 1, file: 'v1.png', createdAt: 'x', seed: 1, engine: 'x', prompt: 'p', ...(remote ? { remote: { provider: 'flow' as const, id: remote } } : {}) }] })
    const entries = new Map([['sheet_petra', sheet('sheet_petra', 'media-9')], ['sheet_wizard', sheet('sheet_wizard')]])
    const files = new Map([['sheet_petra', 'C:\\p\\petra.jpeg'], ['sheet_wizard', 'C:\\p\\wizard.png']])
    const cg = stub('cg_farewell')
    const r = flowReferences(cg, { entryOf: (id) => entries.get(id) ?? null, fileOf: (id) => files.get(id) ?? null })
    expect(r.refs).toEqual(['asset:media-9', 'C:\\p\\wizard.png'])
    expect(r.files).toEqual(['C:\\p\\petra.jpeg', 'C:\\p\\wizard.png'])
    const four = { ...cg, refs: ['a', 'b', 'c', 'd'] }
    const many = flowReferences(four, { entryOf: () => null, fileOf: (id) => `C:\\${id}.png` })
    expect(many.refs).toHaveLength(3)
    expect(many.warnings.join(' ')).toMatch(/3 references; d left out/)
    expect(() => flowReferences(cg, { fileOf: () => null })).toThrow(/have no file yet/)
  })
})

describe('generating images with Google Flow', () => {
  it('each kind sends the right aspect and quality and a project; ComfyUI is never called for an image', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const kinds: [string, string, string][] = [
      ['bg_harbour_dusk', '16:9', 'upscaled'],
      ['sheet_petra', '9:16', 'original'],
      ['cover', '16:9', 'upscaled'],
      ['cg_letter', '1:1', 'original']
    ]
    for (const [id, aspect, quality] of kinds) {
      const r = made(await generateAsset(mk(flow, comfy), stub(id)))
      expect(r.version).toMatchObject({ engine: 'flow', seed: null, n: 1 })
      const c = flow.calls.at(-1)!.args
      expect(c).toMatchObject({ aspect, quality, project: 'vno-soother' })
      expect(r.version.remote).toMatchObject({ provider: 'flow', project: 'vno-soother' })
      expect(r.version.remote!.id).toMatch(/^media-/)
      expect(existsSync(path.join(dir, '.vno-tmp', 'flow', id))).toBe(false) // the temporary folder is gone
    }
    expect(comfy.requests).toHaveLength(0)
    // the background is fitted to the screen, the sheet is kept as it came
    const bg = made(await generateAsset(mk(flow, comfy), stub('bg_harbour_dusk')))
    expect(await sizeOf(bg.entry)).toEqual([1920, 1080])
    const sheet = made(await generateAsset(mk(flow, comfy), stub('sheet_petra')))
    expect(sheet.version.file).toBe('v1.jpeg')
    expect(await sizeOf(sheet.entry)).toEqual([768, 1376])
  })

  it('a project can name the model and the Flow project', async () => {
    const flow = new FakeFlow()
    const s = flowSettings({ flowModel: 'Nano Banana Pro', flowProject: 'My Flow Project' })
    made(await generateAsset(mk(flow, new FakeComfy(), { settings: s }), stub('bg_harbour_dusk', s)))
    expect(flow.calls[0]!.args).toMatchObject({ model: 'Nano Banana Pro', project: 'My Flow Project' })
  })

  it('a sprite references the sheet by media id, is cut out, keeps its raw image, and reprocess uses the raw without a Flow call', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const sheet = made(await generateAsset(mk(flow, comfy), stub('sheet_petra')))
    const spriteId = deriveAssets(mediaBook(), flowSettings()).find((a) => a.kind === 'sprite')!.id
    const c = mk(flow, comfy, {
      resolveRef: (id) => (id === 'sheet_petra' ? resolveFile(dir, sheet.entry) : null),
      resolveRefEntry: (id) => (id === 'sheet_petra' ? sheet.entry : null)
    })
    const r = made(await generateAsset(c, stub(spriteId)))
    const call = flow.calls.at(-1)!.args as { prompt: string; references: string[]; aspect: string }
    expect(call.references).toEqual([`asset:${sheet.version.remote!.id}`])
    expect(call.aspect).toBe('9:16')
    expect(call.prompt).toMatch(/Plain flat light grey background/)
    expect(r.version.file).toMatch(/\.webp$/)
    const meta = await sharp(resolveFile(dir, r.entry)!).metadata()
    expect(meta.hasAlpha).toBe(true)
    expect(existsSync(path.join(dir, 'assets', spriteId, 'v1.raw.jpeg'))).toBe(true)
    const before = flow.calls.length
    const again = made(await generateAsset(c, r.entry, { force: true, reprocess: true }))
    expect(again.version.n).toBe(2)
    expect(flow.calls.length).toBe(before)
  })

  it('a sprite whose sheet has no Flow id gets the sheet file; a stale media id falls back to the file once; no sheet file is an error before any Flow call', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const spriteId = deriveAssets(mediaBook(), flowSettings()).find((a) => a.kind === 'sprite')!.id
    const comfySheet: AssetEntry = { ...stub('sheet_petra'), engine: 'qwen-image-2.1', selected: 1, versions: [{ n: 1, file: 'v1.png', createdAt: 'x', seed: 1, engine: 'qwen-image-2.1', prompt: 'p' }] }
    const withFile = mk(flow, comfy, { resolveRef: () => 'C:\\p\\sheet.png', resolveRefEntry: () => comfySheet })
    made(await generateAsset(withFile, stub(spriteId)))
    expect((flow.calls.at(-1)!.args as { references: string[] }).references).toEqual(['C:\\p\\sheet.png'])

    const flowSheet: AssetEntry = { ...comfySheet, versions: [{ ...comfySheet.versions[0]!, remote: { provider: 'flow', id: 'gone' } }] }
    flow.staleAssetRefs = true
    const n = flow.calls.length
    const r = made(await generateAsset(mk(flow, comfy, { resolveRef: () => 'C:\\p\\sheet.png', resolveRefEntry: () => flowSheet }), stub(spriteId)))
    expect(flow.calls.slice(n).map((c) => (c.args as { references: string[] }).references)).toEqual([['asset:gone'], ['C:\\p\\sheet.png']])
    expect(r.warnings?.join(' ')).toMatch(/media id was not found/)

    const before = flow.calls.length
    const none = await generateAsset(mk(flow, comfy, { resolveRef: () => null }), stub(spriteId))
    expect(none).toMatchObject({ ok: false })
    expect(JSON.stringify(none)).toMatch(/have no file yet/)
    expect(flow.calls.length).toBe(before)
  })

  it('a CG sends the sheets of its characters', async () => {
    const flow = new FakeFlow()
    const r = made(
      await generateAsset(mk(flow, new FakeComfy(), { resolveRef: (id) => `C:\\p\\${id}.png`, resolveRefEntry: () => null }), stub('cg_farewell'))
    )
    expect((flow.calls[0]!.args as { references: string[] }).references).toEqual(['C:\\p\\sheet_petra.png', 'C:\\p\\sheet_wizard.png'])
    expect(r.version.engine).toBe('flow')
  })

  it('an engine given for one run uses ComfyUI; a project that is not flow turns a flow asset back; a locked asset keeps its engine', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const r = made(await generateAsset(mk(flow, comfy), stub('bg_harbour_dusk'), { engine: 'qwen-image-2.1' }))
    expect(r.version.engine).toBe('qwen-image-2.1')
    expect(flow.calls).toHaveLength(0)
    expect(comfy.requests).toHaveLength(1)

    const plain = settings()
    const flowEntry: AssetEntry = { ...stub('bg_harbour_dusk'), engine: 'flow' }
    const back = made(await generateAsset(mk(flow, comfy, { settings: plain }), flowEntry))
    expect(back.version.engine).toBe('qwen-image-2.1')
    expect(flow.calls).toHaveLength(0)
  })

  it('a pixel project with Flow art goes through the pixel finishing', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const s = flowSettings({ style: 'pixel', palette: 'gameboy' })
    const r = made(await generateAsset(mk(flow, comfy, { settings: s }), stub('bg_harbour_dusk', s)))
    expect(comfy.requests).toHaveLength(0)
    const { data } = await sharp(resolveFile(dir, r.entry)!).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const seen = new Set<string>()
    for (let i = 0; i < data.length; i += 3) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    const gameboy = new Set(['15,56,15', '48,98,48', '139,172,15', '155,188,15'])
    for (const c of seen) expect(gameboy.has(c)).toBe(true)
  })

  it('Flow errors fail the asset with the message and leave the entry unchanged', async () => {
    const flow = new FakeFlow()
    flow.imageError = new FlowError('refused by the credit cap, nothing was spent: model needs 5 credits', 'credits')
    const entry = stub('bg_harbour_dusk')
    const r = await generateAsset(mk(flow, new FakeComfy()), entry)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('credit cap') })
    flow.imageError = null
    flow.up = false
    const down = await generateAsset(mk(flow, new FakeComfy()), entry)
    expect(down).toMatchObject({ ok: false, error: expect.stringContaining('hub.ps1 start flow-music-mcp') })
  })
})

describe('the pipeline with Google Flow art', () => {
  const setup = async (flow: FakeFlow) => {
    env = await makeVnEnv({ sdk: false, engine: { flow } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(pipelineBook('linear-en'))
    await svc.updateSettings(slug, { art: { provider: 'flow', bgRemoval: 'key' } })
    return { svc, slug }
  }

  it('makes every image with Flow, one at a time, with no ComfyUI image call', async () => {
    const flow = new FakeFlow()
    const { svc, slug } = await setup(flow)
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env!, slug, 120_000)
    expect(failed, (await failures(env!)).join(' | ')).toEqual([])
    const assets = (await svc.store.loadAssets(slug)).assets.filter((a) => ['background', 'sheet', 'sprite', 'cover', 'cg'].includes(a.kind))
    expect(assets.length).toBeGreaterThan(3)
    for (const a of assets) expect(a.versions[0], a.id).toMatchObject({ engine: 'flow', seed: null })
    expect(env!.comfy.requests.filter((r) => !/ace-step/.test(r.engine))).toHaveLength(0)
    const sprite = assets.find((a) => a.kind === 'sprite')!
    const sheetId = sprite.refs![0]!
    const sheet = assets.find((a) => a.id === sheetId)!
    const call = flow.calls.find((c) => c.tool === 'flow_generate' && String(c.args.name) === sprite.id)!
    expect((call.args as { references: string[] }).references).toEqual([`asset:${sheet.versions[0]!.remote!.id}`])
    expect(flow.calls.filter((c) => c.tool === 'flow_status').length).toBe(1) // checked once, before the fan-out
  }, 180_000)

  it('an unknown sign-in state (Chrome not open yet) does not block the generate step', async () => {
    const flow = new FakeFlow()
    flow.signedIn = null
    const { svc, slug } = await setup(flow)
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env!, slug, 120_000)
    expect(failed, (await failures(env!)).join(' | ')).toEqual([])
    expect(flow.calls.filter((c) => c.tool === 'flow_generate').length).toBeGreaterThan(0)
  }, 180_000)

  it('not signed in or not running fails the generate step once, with the hint', async () => {
    const flow = new FakeFlow()
    flow.signedIn = false
    const { svc, slug } = await setup(flow)
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env!, slug, 60_000)
    expect(failed.length).toBeGreaterThan(0)
    expect((await failures(env!)).join(' | ')).toMatch(/Google Flow is not ready: Google Flow is not signed in: run yarn login/)
    expect(flow.calls.filter((c) => c.tool === 'flow_generate')).toHaveLength(0)
  }, 90_000)
})
