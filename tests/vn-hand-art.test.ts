import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCliArgs, settingsPatchFromFlags } from '../src/engine/vncli'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import type { ToolResult } from '../src/engine/mcp/tools'
import { TASKS } from '../src/engine/vn/pipeline'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv
let slug = ''
const svc = () => env.engine.vn

/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are free-form JSON, read by path in the assertions */
const data = (r: ToolResult): Record<string, any> => {
  if (r.isError) throw new Error(r.content[0]?.text)
  return r.structuredContent as Record<string, any>
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const call = (name: string, args: object) => callTool(buildTools(svc()), name, args)
const ok = async (name: string, args: object) => data(await call(name, args))
const error = async (name: string, args: object) => {
  const r = await call(name, args)
  expect(r.isError).toBe(true)
  return r.content[0]!.text
}
const IMAGES = new Set(['background', 'sheet', 'sprite', 'cover'])
const artCalls = () => env.mock.calls.filter((c) => c.meta?.task === TASKS.artPlan)

beforeEach(async () => {
  env = await makeVnEnv({ sdk: false })
  slug = (await svc().importProject(book('linear-en'))).slug
  await svc().updateSettings(slug, { art: { provider: 'hand' }, music: { tracks: 2, provider: 'comfy' } })
  await svc().reconcileAssets(slug)
})
afterEach(async () => {
  await env.cleanup()
})

describe('hand-made art (art.provider: hand)', () => {
  for (const style of ['illustrated', 'pixel'] as const) {
    it(`the pipeline never calls ComfyUI for an image (${style}), still makes the music, and counts the images that wait`, async () => {
      await svc().updateSettings(slug, { art: { style } })
      await svc().runPipeline(slug, 'art')
      const { failed } = await waitIdle(env, slug, 120_000)
      expect(failed, (await failures(env)).join(' | ')).toEqual([])

      expect(env.comfy.requests.length).toBeGreaterThan(0)
      expect(env.comfy.requests.every((r) => r.engine.startsWith('ace-step'))).toBe(true) // music only
      const assets = (await svc().store.loadAssets(slug)).assets
      expect(assets.filter((a) => a.kind === 'music').every((a) => a.versions.length === 1)).toBe(true)
      expect(assets.filter((a) => IMAGES.has(a.kind)).every((a) => a.versions.length === 0)).toBe(true)

      const pipeline = (await svc().pipelineStatus(slug))!
      expect(pipeline.steps.art).toMatchObject({ status: 'done', message: 'hand-made art: no prompts planned' })
      const waiting = assets.filter((a) => IMAGES.has(a.kind) && a.kind !== 'sheet').length // sheets are only a reference
      expect(pipeline.steps.generate!.message).toContain(`; ${waiting} image(s) wait for a hand-made file (vno_asset_replace)`)
      expect(pipeline.steps.generate!.status).toBe('done')
      expect(artCalls()).toHaveLength(0)
      // the music was planned
      expect(await readFile(svc().store.file(slug, 'music.json'), 'utf8')).toContain('music_01')
    }, 150_000)
  }

  it('vno_asset_regen and vno_asset_generate refuse an image and work on music', async () => {
    const assets = (await svc().listAssets(slug)).filter((a) => !a.orphaned)
    const bg = assets.find((a) => a.kind === 'background')!
    const sprite = assets.find((a) => a.kind === 'sprite')!
    expect(await error('vno_asset_regen', { slug, id: bg.id })).toMatch(/vno_asset_replace/)
    expect(await error('vno_asset_regen', { slug, id: sprite.id })).toMatch(/hand-made art/)
    expect(await error('vno_asset_generate', { slug, kind: 'background' })).toMatch(/vno_asset_replace/)
    expect(await error('vno_asset_generate', { slug, only: [bg.id] })).toMatch(/vno_asset_replace/)
    expect(env.comfy.requests).toHaveLength(0)
    expect(await env.engine.jobs.list('queued')).toEqual([])

    await ok('vno_asset_regen', { slug, id: 'music_01', wait: true })
    await ok('vno_asset_generate', { slug, kind: 'music', wait: true })
    expect(env.comfy.requests.length).toBeGreaterThan(0)
    expect(env.comfy.requests.every((r) => r.engine.startsWith('ace-step'))).toBe(true)
    expect((await svc().store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!.versions.length).toBeGreaterThan(0)
  }, 60_000)

  it('the art step asks no model, vno_plan still plans the prompts and the music', async () => {
    await svc().enqueue(slug, TASKS.artPlan, 'all', await svc().nextRun(slug))
    expect((await waitIdle(env, slug)).failed).toEqual([])
    expect(artCalls()).toHaveLength(0)
    expect((await svc().store.loadAssets(slug)).assets.filter((a) => IMAGES.has(a.kind)).every((a) => a.prompt === '')).toBe(true)

    await ok('vno_plan', { slug, wait: true })
    expect(artCalls().length).toBeGreaterThan(0)
    const planned = (await svc().store.loadAssets(slug)).assets
    expect(planned.filter((a) => IMAGES.has(a.kind)).every((a) => a.prompt !== '')).toBe(true)
    expect(planned.filter((a) => a.kind === 'music').every((a) => a.prompt !== '')).toBe(true)
  }, 60_000)

  it('a build with missing hand-made sheets does not count them as placeholders or as missing', async () => {
    const assets = (await svc().listAssets(slug)).filter((a) => !a.orphaned)
    const sheets = assets.filter((a) => a.kind === 'sheet').map((a) => a.id)
    expect(sheets.length).toBeGreaterThan(0)
    const out = await ok('vno_build', { slug, wait: true })
    expect(out.build.ok).toBe(true)
    expect(out.build.placeholders.length).toBeGreaterThan(0) // backgrounds, sprites and the cover still get one
    for (const id of sheets) expect(out.build.placeholders).not.toContain(id)
    const summary = await svc().summary(slug)
    expect(summary.assets.total).toBe(assets.length - sheets.length)
  }, 60_000)

  it('settings round trip: provider hand is saved in project.md and null clears it', async () => {
    await svc().updateSettings(slug, { art: { provider: null } })
    expect((await svc().store.loadSettings(slug)).settings.art.provider).toBeUndefined()
    expect(await readFile(svc().store.file(slug, 'project.md'), 'utf8')).not.toMatch(/provider: hand/)
    await ok('vno_update_settings', { slug, art: { provider: 'hand' } })
    expect((await svc().store.loadSettings(slug)).settings.art.provider).toBe('hand')
    expect(await readFile(svc().store.file(slug, 'project.md'), 'utf8')).toMatch(/provider: hand/)
    await ok('vno_update_settings', { slug, art: { provider: null } })
    expect((await svc().store.loadSettings(slug)).settings.art.provider).toBeUndefined()
    expect(await readFile(svc().store.file(slug, 'project.md'), 'utf8')).not.toMatch(/provider: hand/)
  })

  it('the CLI flag --art-provider hand makes the patch', () => {
    expect(settingsPatchFromFlags(parseCliArgs(['settings', 's', '--art-provider', 'hand']))).toEqual({ art: { provider: 'hand' } })
  })
})
