import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { generateAll, generateAsset, QWEN_REMOVE_BG_PROMPT, type GenerateContext } from '../src/engine/assets/generate'
import { assetDir, getEntry, loadManifest, resolveFile, saveManifest, setCustom } from '../src/engine/assets/manifest'
import { importPackBook } from '../src/engine/vn/pack'
import type { ComfyClient, ComfyRequest, ComfyResult } from '../src/engine/comfy/client'
import type { AssetEntry } from '../src/shared/vn'
import { book, mediaBook, settings } from './assets-fixtures'

sharp.cache(false)

const SEED_PALETTES = path.resolve(__dirname, '..', 'seed', 'palettes')

async function figure(): Promise<Buffer> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><rect width="100%" height="100%" fill="#fff"/><ellipse cx="200" cy="350" rx="90" ry="250" fill="#2060c0"/></svg>'
  return sharp(Buffer.from(svg)).png().toBuffer()
}
async function cutFigure(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 100, height: 300, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 150, top: 200 }])
    .png()
    .toBuffer()
}
async function landscape(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer()
}

class FakeComfy implements ComfyClient {
  requests: ComfyRequest[] = []
  removalCalls = 0
  fail = new Set<string>()
  /** null: no removal model installed. */
  removal: 'none' | 'ok' | 'throws' = 'none'
  /** What the Qwen background-removal edit returns: a PNG with alpha, a flat-background PNG, or an error. */
  qwen: 'alpha' | 'flat' | 'throws' = 'flat'
  removalInputs: Buffer[] = []
  async generate(req: ComfyRequest): Promise<ComfyResult> {
    this.requests.push(req)
    if (req.prompt === QWEN_REMOVE_BG_PROMPT) {
      if (this.qwen === 'throws') throw new Error('qwen exploded')
      const bytes = this.qwen === 'alpha' ? await cutFigure() : await figure()
      return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 0, engine: req.engine, lane: 'l', promptId: 'p' }
    }
    if (req.prompt && this.fail.has(req.prompt)) throw new Error('ComfyUI exploded')
    // audio engines (ACE-Step, a custom audio workflow) answer with sound; everything else with a picture
    const audio = req.engine.startsWith('ace-step') || req.engine.startsWith('custom:')
    if (audio) return { bytes: Buffer.from('MP3DATA'), ext: req.engine.startsWith('custom:') ? 'flac' : 'mp3', kind: 'audio', seed: req.seed ?? 0, engine: req.engine, lane: 'l', promptId: 'p' }
    const bytes = req.references?.length ? await figure() : await landscape()
    return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 0, engine: req.engine, lane: 'l', promptId: 'p' }
  }
  async removeBackground(image: Buffer): Promise<Buffer | null> {
    this.removalCalls++
    this.removalInputs.push(image)
    if (this.removal === 'none') return null
    if (this.removal === 'throws') throw new Error('rmbg failed')
    // pretend the model cut out the figure: a fully transparent canvas with an opaque block
    return sharp({ create: { width: 400, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 300, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 150, top: 200 }])
      .png()
      .toBuffer()
      .then((b) => (image.length > 0 ? b : b))
  }
}

describe('generateAsset', () => {
  let dir: string
  let comfy: FakeComfy
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vno-gen-'))
    comfy = new FakeComfy()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const ctx = (over: Partial<GenerateContext> = {}): GenerateContext => ({ book, settings: settings(), projectDir: dir, comfy, now: () => new Date('2026-02-03T04:05:06.000Z'), ...over })
  const stub = (id: string) => deriveAssets(book, settings()).find((a) => a.id === id)!

  it('generates a background: t2i at the entry size, cover-cropped to 1920x1080 webp, recorded and selected', async () => {
    const r = await generateAsset(ctx(), stub('bg_harbour_dusk'), { seed: 11 })
    expect(r.ok && !r.skipped).toBe(true)
    if (!r.ok || r.skipped) return
    expect(r.version).toMatchObject({ n: 1, file: 'v1.webp', seed: 11, engine: 'qwen-image-2.1', createdAt: '2026-02-03T04:05:06.000Z' })
    expect(r.version.prompt).toContain('wooden pier, gulls') // fallback prompt, the stub's was empty
    expect(r.entry).toMatchObject({ selected: 1, source: 'generated', seed: 11 })
    const file = resolveFile(dir, r.entry)!
    expect(file).toBe(path.join(assetDir(dir, 'bg_harbour_dusk'), 'v1.webp'))
    expect(await sharp(await readFile(file)).metadata()).toMatchObject({ format: 'webp', width: 1920, height: 1080 })
    expect(comfy.requests[0]).toMatchObject({ engine: 'qwen-image-2.1', width: 1664, height: 928, seed: 11 })
    expect(comfy.requests[0]!.negative).toContain('watermark')
  })

  it('uses the entry prompt when there is one, and numbers new versions', async () => {
    const e = { ...stub('bg_attic_any'), prompt: 'a dusty attic' }
    const first = await generateAsset(ctx(), e)
    if (!first.ok || first.skipped) throw new Error('expected a version')
    const second = await generateAsset(ctx(), first.entry, { force: true, prompt: 'a tidy attic' })
    if (!second.ok || second.skipped) throw new Error('expected a version')
    expect(comfy.requests.map((r) => r.prompt)).toEqual(['a dusty attic', 'a tidy attic'])
    expect(second.entry.versions.map((v) => v.n)).toEqual([1, 2])
    expect(second.entry).toMatchObject({ selected: 2, prompt: 'a tidy attic' })
  })

  it('generates a sheet as the raw portrait image', async () => {
    const r = await generateAsset(ctx(), stub('sheet_petra'))
    if (!r.ok || r.skipped) throw new Error('expected a version')
    expect(r.version.file).toBe('v1.png')
    expect(comfy.requests[0]).toMatchObject({ width: 928, height: 1664 })
  })

  it('generates a sprite from the sheet with the edit engine and the flat-colour key when ComfyUI cannot remove backgrounds', async () => {
    const sheet = path.join(dir, 'sheet.png')
    await writeFile(sheet, await figure())
    const r = await generateAsset(ctx({ resolveRef: (id) => (id === 'sheet_petra' ? sheet : null) }), stub('sprite_petra_worried'))
    if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
    expect(comfy.requests[0]).toMatchObject({ engine: 'qwen-image-2.1-edit', references: [sheet] })
    expect(comfy.requests[0]!.prompt).toContain('worried facial expression')
    expect(comfy.removalCalls).toBe(1)
    const meta = await sharp(await readFile(resolveFile(dir, r.entry)!)).metadata()
    expect(meta).toMatchObject({ format: 'webp', hasAlpha: true, height: 972 })
    const corner = await sharp(await readFile(resolveFile(dir, r.entry)!)).ensureAlpha().raw().toBuffer()
    expect(corner[3]).toBe(0)
  })

  it('makes a picture-book page from the sheets of its cast (the edit engine), and a page without cast with the generator', async () => {
    const { book: pb } = await importPackBook(path.resolve(__dirname, 'fixtures', 'books', 'picture-book'))
    const assets = deriveAssets(pb, settings())
    const page1 = assets.find((a) => a.id === 'bg_ch01_s01')!
    const page3 = assets.find((a) => a.id === 'bg_ch01_s03')!
    const sheet = path.join(dir, 'sheet.png')
    await writeFile(sheet, await figure())
    const pbCtx = ctx({ book: pb, resolveRef: (id) => (id.startsWith('sheet_') ? sheet : null) })
    const withCast = await generateAsset(pbCtx, page1)
    if (!withCast.ok || withCast.skipped) throw new Error(`expected a version: ${JSON.stringify(withCast)}`)
    expect(comfy.requests[0]).toMatchObject({ engine: 'qwen-image-2.1-edit', references: [sheet, sheet], width: 1664, height: 928 })
    expect(comfy.requests[0]!.prompt).toContain('different people')
    expect(comfy.requests[0]!.negative).not.toMatch(/\b(person|people|characters?|animals?)\b/i)
    const withoutCast = await generateAsset(pbCtx, page3)
    if (!withoutCast.ok || withoutCast.skipped) throw new Error('expected a version')
    expect(comfy.requests[1]).toMatchObject({ engine: 'qwen-image-2.1' })
    expect(comfy.requests[1]!.references).toBeUndefined()
    expect(comfy.requests[1]!.prompt).toContain("children's picture book illustration")
  })

  it('uses the ComfyUI removal result when available, and falls back when it throws', async () => {
    const sheet = path.join(dir, 'sheet.png')
    await writeFile(sheet, await figure())
    const base = ctx({ resolveRef: () => sheet })
    comfy.removal = 'ok'
    const ok = await generateAsset(base, stub('sprite_petra_worried'))
    if (!ok.ok || ok.skipped) throw new Error('expected a version')
    const meta = await sharp(await readFile(resolveFile(dir, ok.entry)!)).metadata()
    expect(meta.height).toBe(972)
    expect(meta.width).toBeLessThan(400) // trimmed to the 100x300 block (ratio 1:3)
    comfy.removal = 'throws'
    const messages: string[] = []
    const fallback = await generateAsset({ ...base, onProgress: (e) => messages.push(e.message) }, stub('sprite_petra_neutral'))
    expect(fallback.ok && !fallback.skipped).toBe(true)
    expect(messages.some((m) => /flat-colour key/.test(m))).toBe(true)
  })

  describe('art.bgRemoval', () => {
    const withMethod = (m: 'birefnet' | 'qwen-edit' | 'key', over: Partial<GenerateContext> = {}) => {
      const st = settings()
      return ctx({ settings: { ...st, art: { ...st.art, bgRemoval: m } }, ...over })
    }
    const sheetCtx = async (m: 'birefnet' | 'qwen-edit' | 'key') => {
      const sheet = path.join(dir, 'sheet.png')
      await writeFile(sheet, await figure())
      return withMethod(m, { resolveRef: () => sheet })
    }
    const edits = () => comfy.requests.filter((r) => r.prompt === QWEN_REMOVE_BG_PROMPT)

    it('birefnet (default): removal runs on the raw edit and the raw output is kept next to the version', async () => {
      comfy.removal = 'ok'
      const r = await generateAsset(await sheetCtx('birefnet'), stub('sprite_petra_worried'))
      if (!r.ok || r.skipped) throw new Error('expected a version')
      expect(r.warnings).toBeUndefined()
      expect(comfy.removalCalls).toBe(1)
      expect(edits()).toHaveLength(0)
      const raw = await readFile(path.join(assetDir(dir, 'sprite_petra_worried'), 'v1.raw.png'))
      expect(raw.equals(comfy.removalInputs[0]!)).toBe(true)
    })

    it('birefnet without a model falls back to the flat key and reports a warning', async () => {
      comfy.removal = 'none'
      const r = await generateAsset(await sheetCtx('birefnet'), stub('sprite_petra_worried'))
      if (!r.ok || r.skipped) throw new Error('expected a version')
      expect(r.warnings?.[0]).toMatch(/no BiRefNet/)
      const px = await sharp(await readFile(resolveFile(dir, r.entry)!)).ensureAlpha().raw().toBuffer()
      expect(px[3]).toBe(0)
    })

    it('key never asks ComfyUI to remove anything', async () => {
      comfy.removal = 'ok'
      const r = await generateAsset(await sheetCtx('key'), stub('sprite_petra_worried'))
      expect(r.ok && !r.skipped).toBe(true)
      expect(comfy.removalCalls).toBe(0)
      expect(edits()).toHaveLength(0)
    })

    it('qwen-edit uses the edit output directly when it has real alpha', async () => {
      comfy.qwen = 'alpha'
      comfy.removal = 'ok'
      const r = await generateAsset(await sheetCtx('qwen-edit'), stub('sprite_petra_worried'))
      expect(r.ok && !r.skipped).toBe(true)
      expect(edits()).toHaveLength(1)
      expect(edits()[0]).toMatchObject({ engine: 'qwen-image-2.1-edit' })
      expect(comfy.removalCalls).toBe(0)
    })

    it('qwen-edit follows an opaque result with BiRefNet, and falls back to BiRefNet on the original when the edit fails', async () => {
      comfy.qwen = 'flat'
      comfy.removal = 'ok'
      const a = await generateAsset(await sheetCtx('qwen-edit'), stub('sprite_petra_worried'))
      expect(a.ok && !a.skipped).toBe(true)
      expect(edits()).toHaveLength(1)
      expect(comfy.removalCalls).toBe(1)
      comfy.qwen = 'throws'
      const b = await generateAsset(await sheetCtx('qwen-edit'), stub('sprite_petra_neutral'))
      if (!b.ok || b.skipped) throw new Error('expected a version')
      expect(b.warnings?.[0]).toMatch(/Qwen background-removal edit failed/)
      expect(comfy.removalCalls).toBe(2)
    })

    it('reprocess redoes the removal on the kept raw output without a new edit', async () => {
      comfy.removal = 'ok'
      const c = await sheetCtx('birefnet')
      const first = await generateAsset(c, stub('sprite_petra_worried'))
      if (!first.ok || first.skipped) throw new Error('expected a version')
      const editsBefore = comfy.requests.length
      const again = await generateAsset(await sheetCtx('key'), first.entry, { reprocess: true, force: true })
      if (!again.ok || again.skipped) throw new Error(`expected a version: ${JSON.stringify(again)}`)
      expect(comfy.requests).toHaveLength(editsBefore)
      expect(again.version.n).toBe(2)
      const missing = await generateAsset(c, stub('sprite_petra_neutral'), { reprocess: true })
      expect(missing).toMatchObject({ ok: false })
    })
  })

  it('fails a sprite whose sheet has no file, without throwing', async () => {
    const r = await generateAsset(ctx({ resolveRef: () => null }), stub('sprite_petra_worried'))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/sheet_petra has no file/)
    expect(comfy.requests).toHaveLength(0)
  })

  it('returns an error result instead of throwing when ComfyUI fails', async () => {
    comfy.fail.add('boom')
    const e = { ...stub('cover'), prompt: 'boom' }
    const r = await generateAsset(ctx(), e)
    expect(r).toMatchObject({ ok: false, error: 'ComfyUI exploded' })
    if (!r.ok) expect(r.entry).toBe(e)
  })

  it('generates a landscape cover (the screen size) and music (raw audio, seconds, format)', async () => {
    const cover = await generateAsset(ctx(), stub('cover'))
    if (!cover.ok || cover.skipped) throw new Error('expected a version')
    expect(await sharp(await readFile(resolveFile(dir, cover.entry)!)).metadata()).toMatchObject({ width: 1920, height: 1080 })
    const music = await generateAsset(ctx({ sizes: { musicSeconds: 95, musicFormat: 'opus' } }), stub('music_01'))
    if (!music.ok || music.skipped) throw new Error('expected a version')
    expect(music.version.file).toBe('v1.mp3')
    expect(await readFile(resolveFile(dir, music.entry)!, 'utf8')).toBe('MP3DATA')
    const req = comfy.requests.at(-1)!
    expect(req).toMatchObject({ engine: 'ace-step-v1-instrumental', seconds: 95, format: 'opus' })
    expect(req.prompt).toContain('instrumental, no vocals')
  })

  it('skips locked and custom assets unless forced, and never generates voice references', async () => {
    const locked = { ...stub('bg_harbour_dusk'), locked: true }
    expect(await generateAsset(ctx(), locked)).toMatchObject({ ok: true, skipped: true, reason: 'locked' })
    const src = path.join(dir, 'mine.png')
    await writeFile(src, 'x')
    const custom = await setCustom(dir, stub('bg_harbour_dusk'), src)
    expect(await generateAsset(ctx(), custom)).toMatchObject({ skipped: true })
    const forced = await generateAsset(ctx(), custom, { force: true })
    expect(forced).toMatchObject({ ok: true, skipped: false })
    if (forced.ok && !forced.skipped) expect(forced.entry).toMatchObject({ source: 'generated', selected: 1 })
    const voice = deriveAssets(book, settings({ voice: { enabled: true, langs: ['en'], provider: 'comfy', voices: {}, engines: {} } })).find((a) => a.kind === 'voiceRef')!
    expect(await generateAsset(ctx(), voice)).toMatchObject({ ok: true, skipped: true })
    expect(comfy.requests).toHaveLength(1)
  })

  it('pixel mode quantises to the palette and writes lossless webp', async () => {
    const pixel = settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', palette: 'gameboy', review: false, bgRemoval: 'birefnet' } })
    const r = await generateAsset(ctx({ settings: pixel, palettesDir: SEED_PALETTES, sizes: { background: { w: 320, h: 180 } } }), { ...stub('bg_harbour_dusk'), engine: 'z-image-turbo' })
    if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
    const { data } = await sharp(await readFile(resolveFile(dir, r.entry)!)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const seen = new Set<string>()
    for (let i = 0; i < data.length; i += 3) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    const gameboy = new Set(['15,56,15', '48,98,48', '139,172,15', '155,188,15'])
    for (const c of seen) expect(gameboy.has(c)).toBe(true)
    expect(comfy.requests[0]!.prompt).toContain('pixel art')
  })

  it('needs palettesDir for a palette', async () => {
    const pixel = settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', palette: 'gameboy', review: false, bgRemoval: 'birefnet' } })
    const r = await generateAsset(ctx({ settings: pixel }), stub('cover'))
    expect(r).toMatchObject({ ok: false })
  })

  describe('media cues', () => {
    const mctx = (over: Partial<GenerateContext> = {}) => ctx({ book: mediaBook(), ...over })
    const mstub = (id: string, s = settings()) => deriveAssets(mediaBook(), s).find((a) => a.id === id)!

    it('a cg with characters is edited from their sheet files and fitted to the screen; an insert is asked for square and kept at its size', async () => {
      const petra = path.join(dir, 'petra.png')
      const wizard = path.join(dir, 'wizard.png')
      await writeFile(petra, await figure())
      await writeFile(wizard, await figure())
      const files: Record<string, string> = { sheet_petra: petra, sheet_wizard: wizard }
      const r = await generateAsset(mctx({ resolveRef: (id) => files[id] ?? null }), mstub('cg_farewell'))
      if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
      expect(comfy.requests[0]).toMatchObject({ engine: 'qwen-image-2.1-edit', references: [petra, wizard] })
      expect(await sharp(await readFile(resolveFile(dir, r.entry)!)).metadata()).toMatchObject({ width: 1920, height: 1080 })

      const insert = await generateAsset(mctx(), mstub('cg_letter'))
      if (!insert.ok || insert.skipped) throw new Error('expected a version')
      expect(comfy.requests[1]).toMatchObject({ engine: 'qwen-image-2.1' })
      expect(comfy.requests[1]!.references).toBeUndefined()
      expect(comfy.requests[1]!.width).toBe(comfy.requests[1]!.height) // asked for a square
      expect(await sharp(await readFile(resolveFile(dir, insert.entry)!)).metadata()).toMatchObject({ format: 'webp', width: 800, height: 400 }) // kept at the size it came in, not fitted
    })

    it('a cg whose sheets have no file yet fails without calling ComfyUI', async () => {
      const r = await generateAsset(mctx({ resolveRef: () => null }), mstub('cg_farewell'))
      expect(r).toMatchObject({ ok: false })
      expect(JSON.stringify(r)).toMatch(/sheet_petra, sheet_wizard\) have no file yet/)
      expect(comfy.requests).toHaveLength(0)
    })

    it('a default sfx is made by the audio engine for five seconds; a custom engine still makes it', async () => {
      const r = await generateAsset(mctx(), mstub('sfx_bell'))
      if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
      expect(comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', prompt: 'a ship bell', seconds: 5 })
      expect(r.version).toMatchObject({ file: 'v1.mp3', engine: 'ace-step-v1-instrumental' })
      expect(await readFile(resolveFile(dir, r.entry)!, 'utf8')).toBe('MP3DATA')

      const custom = settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'custom:foley' } })
      const made = await generateAsset(mctx({ settings: custom }), mstub('sfx_bell', custom))
      if (!made.ok || made.skipped) throw new Error(`expected a version: ${JSON.stringify(made)}`)
      expect(comfy.requests[1]).toMatchObject({ engine: 'custom:foley', prompt: 'a ship bell', seconds: 5 })
      expect(made.version).toMatchObject({ file: 'v1.flac', engine: 'custom:foley' })
    })

    it('sound.sfxEngine "none" skips with an import reason', async () => {
      const importOnly = settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'none' } })
      const r = await generateAsset(mctx({ settings: importOnly }), mstub('sfx_bell', importOnly))
      expect(r).toMatchObject({ ok: true, skipped: true })
      if (r.ok && r.skipped) expect(r.reason).toMatch(/import a file/)
      expect(comfy.requests).toHaveLength(0)
    })

    it('an old sfx entry with an empty engine falls back to the audio engine and generates', async () => {
      const old: AssetEntry = { ...mstub('sfx_bell'), engine: '' }
      const r = await generateAsset(mctx(), old)
      if (!r.ok || r.skipped) throw new Error(`expected a version: ${JSON.stringify(r)}`)
      expect(comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', seconds: 5 })
      expect(r.version).toMatchObject({ engine: 'ace-step-v1-instrumental' })
      expect(r.entry.engine).toBe('ace-step-v1-instrumental')
    })

    it('an ambience calls the audio engine for a minute of sound', async () => {
      const r = await generateAsset(mctx(), mstub('amb_waves'))
      if (!r.ok || r.skipped) throw new Error('expected a version')
      expect(r.version.file).toBe('v1.mp3')
      expect(comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', seconds: 60 })
      expect(comfy.requests[0]!.prompt).toMatch(/^ambient soundscape, waves on the pier/)
    })
  })
})

describe('generateAll', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vno-genall-'))
    await mkdir(dir, { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('generates sheets before sprites, continues after a failure, saves after each asset and resumes', async () => {
    const comfy = new FakeComfy()
    comfy.fail.add('FAIL ME')
    const assets: AssetEntry[] = deriveAssets(book, settings({ music: { engine: 'ace-step-v1-instrumental', tracks: 1 } }))
    assets.find((a) => a.id === 'cover')!.prompt = 'FAIL ME'
    await saveManifest(dir, { assets })
    const base = { book, settings: settings(), projectDir: dir, comfy }
    const first = await generateAll(base, await loadManifest(dir))
    expect(first.failed).toEqual([{ id: 'cover', error: 'ComfyUI exploded' }])
    expect(first.generated).toHaveLength(assets.length - 1)
    const idx = (pred: (r: ComfyRequest) => boolean) => comfy.requests.map(pred).lastIndexOf(true)
    const firstEdit = comfy.requests.findIndex((r) => r.engine === 'qwen-image-2.1-edit')
    expect(firstEdit).toBeGreaterThan(idx((r) => !!r.prompt?.includes('character design sheet'))) // sprites come after the sheets
    const saved = await loadManifest(dir)
    expect(getEntry(saved, 'sprite_petra_worried')!.selected).toBe(1)
    expect(getEntry(saved, 'cover')!.selected).toBeNull()

    // resume: only the failed one is retried
    comfy.fail.clear()
    const before = comfy.requests.length
    const second = await generateAll(base, saved)
    expect(second.generated).toEqual(['cover'])
    expect(second.skipped).toHaveLength(assets.length - 1)
    expect(comfy.requests.length).toBe(before + 1)
  })

  it('honours ids, exclude and force', async () => {
    const comfy = new FakeComfy()
    const assets = deriveAssets(book, settings())
    await saveManifest(dir, { assets })
    const base = { book, settings: settings(), projectDir: dir, comfy }
    const r = await generateAll(base, await loadManifest(dir), { ids: ['bg_attic_any', 'bg_harbour_dusk'], exclude: ['bg_harbour_dusk'] })
    expect(r.generated).toEqual(['bg_attic_any'])
    const again = await generateAll(base, r.manifest, { ids: ['bg_attic_any'], force: true })
    expect(again.generated).toEqual(['bg_attic_any'])
    expect(getEntry(again.manifest, 'bg_attic_any')!.versions).toHaveLength(2)
  })
})
