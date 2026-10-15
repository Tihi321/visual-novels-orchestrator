import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { generateAsset } from '../src/engine/assets/generate'
import type { GenerateContext } from '../src/engine/assets/generate'
import { resolveFile } from '../src/engine/assets/manifest'
import { emitScripts, musicFile } from '../src/engine/renpy/emit'
import { defaultCues } from '../src/engine/renpy/stage'
import { barsFor, fallbackChipPlan, mergeChipPlan } from '../src/engine/studios/chip-plan'
import { drawSpriteWithStudio } from '../src/engine/studios/draw'
import { validateMusicPlan } from '../src/engine/vn/agents/composer'
import type { AssetEntry } from '../src/shared/vn'
import { book, settings } from './assets-fixtures'
import { FakeComfy } from './vn-helpers'
import { FakeChiptune, FakePixel } from './studio-fakes'

sharp.cache(false)
const PALETTES = path.resolve(__dirname, '..', 'seed', 'palettes')

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vno-studio-gen-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const stub = (id: string, over: Partial<AssetEntry> = {}): AssetEntry => ({ ...deriveAssets(book, settings()).find((a) => a.id === id)!, ...over })
const ctx = (over: Partial<GenerateContext> = {}): GenerateContext => ({ book, settings: settings(), projectDir: dir, comfy: new FakeComfy(), palettesDir: PALETTES, sizes: { background: { w: 1920, h: 1080 }, spriteHeight: 600 }, ...over })
const pixelSettings = (art: Record<string, unknown> = {}, music: Record<string, unknown> = {}) =>
  settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', palette: 'gameboy', review: false, bgRemoval: 'birefnet', ...art }, music: { engine: 'ace-step-v1-instrumental', tracks: 2, ...music } } as never)

describe('chiptune music', () => {
  it('composes, renders ogg, saves the song, and stores the loop points and the song file on the version', async () => {
    const chip = new FakeChiptune()
    const music = { ...stub('music_01'), engine: 'chiptune' }
    const r = await generateAsset(ctx({ settings: pixelSettings({ palette: undefined }), chiptune: chip, comfy: new FakeComfy() }), music)
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(r.version).toMatchObject({ n: 1, file: 'v1.ogg', songFile: 'v1.song', loopStartSec: 2, loopEndSec: 41.5, engine: 'chiptune', seed: 4242 })
    expect(existsSync(path.join(dir, 'assets', 'music_01', 'v1.ogg'))).toBe(true)
    expect(existsSync(path.join(dir, 'assets', 'music_01', 'v1.song'))).toBe(true)
    expect(r.entry.seed).toBeNull() // the next regenerate is a new random track
    const tools = chip.calls.map((c) => c.tool)
    expect(tools).toEqual(['compose_track', 'render_audio', 'save_song', 'delete_song'])
    const compose = chip.calls[0]!.args as Record<string, unknown>
    expect(compose).toMatchObject({ loop: true, chip: 'snes' })
    expect(Number(compose.bpm)).toBeGreaterThanOrEqual(50)
    const render = chip.calls[1]!.args as { path: string; format: string }
    expect(path.isAbsolute(render.path)).toBe(true)
    expect(render.format).toBe('ogg')
    expect(resolveFile(dir, r.entry)).toBe(path.join(dir, 'assets', 'music_01', 'v1.ogg'))
  })

  it('uses the composer plan, a wav fallback gets a warning, and a down studio fails with the start hint', async () => {
    const chip = new FakeChiptune()
    chip.noFfmpeg = true
    chip.failSave = true
    const plan = { mood: 'lullaby', chip: 'gb' as const, bpm: 64, key: 'F', bars: 24 }
    const r = await generateAsset(ctx({ settings: pixelSettings(), chiptune: chip, chipPlan: plan }), { ...stub('music_02'), engine: 'chiptune' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(chip.calls[0]!.args).toMatchObject({ mood: 'lullaby', chip: 'gb', bpm: 64, key: 'F', bars: 24 })
    expect(r.version.file).toBe('v1.wav')
    expect(r.version.songFile).toBeUndefined()
    expect(r.version.warnings?.join(' ')).toMatch(/ffmpeg/)
    expect(r.version.warnings?.join(' ')).toMatch(/song file could not be saved/)

    chip.down = true
    const bad = await generateAsset(ctx({ settings: pixelSettings(), chiptune: chip }), { ...stub('music_01'), engine: 'chiptune' })
    expect(bad).toMatchObject({ ok: false })
    if (!bad.ok) expect(bad.error).toContain('yarn build && yarn mcp')
  })

  it('follows the provider: an existing ComfyUI track is made by chiptune, and back; locked, custom and an explicit engine keep theirs', async () => {
    const withComfyVersion: AssetEntry = { ...stub('music_01'), engine: 'ace-step-v1-instrumental', versions: [{ n: 1, file: 'v1.mp3', createdAt: 'x', seed: 1, engine: 'ace-step-v1-instrumental', prompt: 'p' }], selected: 1 }
    const chip = new FakeChiptune()
    const comfy = new FakeComfy()
    const toChip = await generateAsset(ctx({ settings: pixelSettings(), chiptune: chip, comfy }), withComfyVersion, { force: true })
    if (!toChip.ok || toChip.skipped) throw new Error(JSON.stringify(toChip))
    expect(toChip.version).toMatchObject({ n: 2, file: 'v2.ogg', engine: 'chiptune', loopStartSec: 2 })
    expect(toChip.entry.engine).toBe('chiptune')
    expect(comfy.requests).toHaveLength(0)
    expect(chip.calls[0]!.args).toMatchObject({ chip: 'gb' }) // no composer plan: the deterministic one

    const toComfy = await generateAsset(ctx({ settings: pixelSettings({}, { provider: 'comfy' }), chiptune: chip, comfy }), toChip.entry, { force: true })
    if (!toComfy.ok || toComfy.skipped) throw new Error(JSON.stringify(toComfy))
    expect(toComfy.version).toMatchObject({ n: 3, engine: 'ace-step-v1-instrumental', file: 'v3.mp3' })
    expect(comfy.requests).toHaveLength(1)

    // locked (forced by hand), explicit engine: unchanged
    const locked = await generateAsset(ctx({ settings: pixelSettings(), chiptune: chip, comfy }), { ...withComfyVersion, locked: true }, { force: true })
    expect(locked).toMatchObject({ ok: true, version: { engine: 'ace-step-v1-instrumental' } })
    const explicit = await generateAsset(ctx({ settings: pixelSettings(), chiptune: chip, comfy }), withComfyVersion, { force: true, engine: 'yue2' })
    expect(explicit).toMatchObject({ ok: true, version: { engine: 'yue2' } })
  })

  it('the comfy engine still goes to ComfyUI', async () => {
    const comfy = new FakeComfy()
    const r = await generateAsset(ctx({ comfy, chiptune: new FakeChiptune() }), stub('music_01'))
    expect(r).toMatchObject({ ok: true })
    expect(comfy.requests).toHaveLength(1)
  })
})

describe('loop emit', () => {
  it('prefixes <loop S> only where loop points exist', () => {
    expect(musicFile('audio/music_01.ogg', 2)).toBe('<loop 2>audio/music_01.ogg')
    expect(musicFile('audio/music_01.ogg', 12.34567)).toBe('<loop 12.3457>audio/music_01.ogg')
    expect(musicFile('audio/music_01.ogg', null)).toBe('audio/music_01.ogg')
    expect(musicFile('audio/music_01.ogg')).toBe('audio/music_01.ogg')
  })

  it('play music and the menu music use the loop prefix', () => {
    const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
    const r = emitScripts({ book, cues, music: { music_01: 'audio/music_01.ogg', music_02: 'audio/music_02.ogg' }, musicLoops: { music_01: 3.25 } })
    const all = Object.values(r.files).join('\n')
    expect(all).toContain('"<loop 3.25>audio/music_01.ogg"')
    expect(all).toMatch(/play music "audio\/music_02\.ogg"/)
    expect(all).not.toContain('<loop undefined')
  })
})

describe('chiptune plan', () => {
  it('is deterministic, calm and slow, and the composer draft is clamped', () => {
    const a = fallbackChipPlan('music_01', { genreText: 'bedtime kids', seconds: 100 })
    expect(a).toEqual(fallbackChipPlan('music_01', { genreText: 'bedtime kids', seconds: 100 }))
    expect(a.mood).toBe('lullaby')
    expect(a.bpm).toBeLessThanOrEqual(90)
    expect(a.bars % 4).toBe(0)
    expect(fallbackChipPlan('music_01', { palette: 'gameboy' }).chip).toBe('gb')
    expect(barsFor(100, 72)).toBe(32)
    const m = mergeChipPlan({ mood: 'heavy-metal', chip: 'amiga', bpm: 300, key: 'H', bars: 999 }, a)
    expect(m).toEqual({ ...a, bpm: 100, bars: 48 })
    expect(mergeChipPlan({ chip: 'nes' }, a, 'pce').chip).toBe('pce')
  })

  it('validateMusicPlan adds a plan per track for chiptune, from the draft over the deterministic one', () => {
    const r = validateMusicPlan(
      { tracks: [{ id: 'music_01', prompt: '', seconds: 90, mood: 'ambient', bpm: 60 }], menuTrack: 'music_01', chapters: [{ n: 1, trackId: 'music_02' }] },
      ['music_01', 'music_02'],
      { chiptune: true, chip: 'nes' }
    )
    expect(r.plan.tracks!.music_01).toMatchObject({ mood: 'ambient', bpm: 60, chip: 'nes' })
    expect(r.plan.tracks!.music_02!.chip).toBe('nes')
    expect(r.prompts.get('music_01')).toMatch(/^chiptune: ambient, nes, 60 bpm/)
    expect(validateMusicPlan({ tracks: [], menuTrack: 'x', chapters: [] }, ['music_01'], { chiptune: false }).plan.tracks).toBeUndefined()
  })
})

describe('pixel art with Pixel Studio', () => {
  it('converts a background with import_image and export_many: exact size, native copy kept', async () => {
    const px = new FakePixel()
    const s = pixelSettings({ pixelProvider: 'pixel-studio', pixel: { width: 320, height: 180, dither: 'floyd', outline: true } })
    const r = await generateAsset(ctx({ settings: s, pixel: px }), { ...stub('bg_harbour_dusk'), engine: 'z-image-turbo' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    const imp = px.calls.find((c) => c.tool === 'import_image')!.args as Record<string, unknown>
    expect(imp).toMatchObject({ width: 320, height: 180, dither: 'floyd', outline: true, cleanup: true })
    expect(path.isAbsolute(imp.path as string)).toBe(true)
    expect(imp.palette).toEqual(['#0f380f', '#306230', '#8bac0f', '#9bbc0f'])
    const meta = await sharp(await readFile(resolveFile(dir, r.entry)!)).metadata()
    expect([meta.width, meta.height]).toEqual([1920, 1080])
    expect(r.version.nativeFile).toBe('v1.px.png')
    const native = await sharp(await readFile(path.join(dir, 'assets', 'bg_harbour_dusk', 'v1.px.png'))).metadata()
    expect([native.width, native.height]).toEqual([320, 180])
    expect(r.version.warnings).toBeUndefined()
  })

  it('sprites keep their proportions: the grid is the background grid factor', async () => {
    const px = new FakePixel()
    const s = pixelSettings({ pixelProvider: 'pixel-studio' })
    const sheet = path.join(dir, 'sheet.png')
    await writeFile(sheet, await new FakeComfy().generate({ engine: 'x', prompt: 'p', references: [] }).then((r) => r.bytes))
    const r = await generateAsset(ctx({ settings: s, pixel: px, resolveRef: () => sheet }), { ...stub('sprite_petra_worried'), engine: 'qwen-image-2.1-edit' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    const imp = px.calls.find((c) => c.tool === 'import_image')!.args as { width: number; height: number }
    const out = await sharp(await readFile(resolveFile(dir, r.entry)!)).metadata()
    expect(imp.height * 6).toBe(out.height)
    expect(imp.width * 6).toBe(out.width)
  })

  it('sprites and the cover are the grid times a whole factor (6), with Pixel Studio and with the built-in fallback', async () => {
    const sheet = path.join(dir, 'sheet.png')
    await writeFile(sheet, (await new FakeComfy().generate({ engine: 'x', prompt: 'p', references: [] })).bytes)
    for (const down of [false, true]) {
      const px = new FakePixel()
      px.down = down
      const s = pixelSettings({ pixelProvider: 'pixel-studio' })
      const r = await generateAsset(ctx({ settings: s, pixel: px, resolveRef: () => sheet }), { ...stub('sprite_petra_worried'), engine: 'qwen-image-2.1-edit' })
      if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
      const out = await sharp(await readFile(resolveFile(dir, r.entry)!)).metadata()
      expect(out.width! % 6).toBe(0)
      expect(out.height! % 6).toBe(0)
      if (!down) {
        const native = await sharp(await readFile(path.join(dir, 'assets', 'sprite_petra_worried', 'v1.px.png'))).metadata()
        expect([native.width! * 6, native.height! * 6]).toEqual([out.width, out.height])
      }
    }
  })

  it('falls back to the built-in pixelate with a warning on the version when Pixel Studio is down', async () => {
    const px = new FakePixel()
    px.down = true
    const s = pixelSettings({ pixelProvider: 'pixel-studio' })
    const r = await generateAsset(ctx({ settings: s, pixel: px }), { ...stub('bg_harbour_dusk'), engine: 'z-image-turbo' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(r.version.warnings?.[0]).toMatch(/Pixel Studio could not convert the image .*yarn build && yarn mcp.*built-in pixelate/)
    expect(r.warnings).toHaveLength(1)
    expect(r.version.nativeFile).toBeUndefined()
    // the sharp path ran: palette colours only
    const { data } = await sharp(await readFile(resolveFile(dir, r.entry)!)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const seen = new Set<string>()
    for (let i = 0; i < data.length; i += 3) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    const gb = new Set(['15,56,15', '48,98,48', '139,172,15', '155,188,15'])
    for (const c of seen) expect(gb.has(c)).toBe(true)
  })

  it('the default provider is the built-in one: Pixel Studio is not called', async () => {
    const px = new FakePixel()
    const r = await generateAsset(ctx({ settings: pixelSettings(), pixel: px }), { ...stub('bg_harbour_dusk'), engine: 'z-image-turbo' })
    expect(r).toMatchObject({ ok: true })
    expect(px.calls).toHaveLength(0)
  })
})

describe('pixel-studio-draw', () => {
  const sheetFile = async () => {
    const f = path.join(dir, 'sheet.png')
    await writeFile(f, (await new FakeComfy().generate({ engine: 'x', prompt: 'p', references: [] })).bytes)
    return f
  }

  it('the agent loop draws with draw_grid, the result is exported at the sprite size', async () => {
    const px = new FakePixel()
    const sheet = await sheetFile()
    const replies = ['not json at all', JSON.stringify({ calls: [{ tool: 'draw_grid', arguments: { x: 0 } }, { tool: 'export_png', arguments: {} }] }), JSON.stringify({ calls: [], done: true })]
    const asked: number[] = []
    const s = pixelSettings({ provider: 'pixel-studio-draw' })
    const r = await generateAsset(ctx({ settings: s, pixel: px, resolveRef: () => sheet, ask: async (m) => (asked.push(m.length), replies.shift() ?? '{"done":true}'), draw: { steps: 6, ms: 60_000 } }), { ...stub('sprite_petra_worried'), engine: 'qwen-image-2.1-edit' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(px.drawCalls).toBe(1)
    expect(px.calls.some((c) => c.tool === 'export_png')).toBe(false) // not allowed in the loop
    expect(px.calls.some((c) => c.tool === 'draw_sprite_from_reference')).toBe(true)
    expect(r.version.nativeFile).toBe('v1.px.png')
    expect(r.version.warnings?.filter((w) => /Pixel Studio/.test(w)) ?? []).toEqual([])
    const ref = px.calls.find((c) => c.tool === 'draw_sprite_from_reference')!.args as { width: number; height: number; palette: string[] }
    expect(ref.height).toBeLessThanOrEqual(128)
    expect(ref.palette[0]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('falls back to the import path when no model answers', async () => {
    const px = new FakePixel()
    const sheet = await sheetFile()
    const s = pixelSettings({ provider: 'pixel-studio-draw' })
    const r = await generateAsset(ctx({ settings: s, pixel: px, resolveRef: () => sheet, ask: async () => Promise.reject(new Error('no model answered')) }), { ...stub('sprite_petra_worried'), engine: 'qwen-image-2.1-edit' })
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(r.version.warnings?.find((w) => /Pixel Studio/.test(w))).toMatch(/drawing failed \(no model answered\); used the import path/)
    expect(px.calls.some((c) => c.tool === 'import_image')).toBe(true)
  })

  it('the loop stops at the step cap and at the time cap', async () => {
    const px = new FakePixel()
    const sheet = await sheetFile()
    let asks = 0
    const draw = { calls: [{ tool: 'draw_grid', arguments: {} }] }
    const base = { client: px, reference: sheet, grid: { w: 16, h: 24 }, palette: [[0, 0, 0]] as [number, number, number][], out: { w: 32, h: 48 }, tmpRoot: path.join(dir, 'tmp') }
    await drawSpriteWithStudio({ ...base, ask: async () => (asks++, JSON.stringify(draw)), maxSteps: 3, maxMs: 60_000 })
    expect(asks).toBe(3)
    asks = 0
    let t = 0
    await drawSpriteWithStudio({ ...base, ask: async () => (asks++, JSON.stringify(draw)), maxSteps: 50, maxMs: 1000, now: () => (t += 400) })
    expect(asks).toBeLessThan(4)
    await expect(drawSpriteWithStudio({ ...base, ask: async () => '{"calls":[],"done":true}', maxSteps: 3, maxMs: 1000 })).rejects.toThrow(/drew nothing/)
  })

  it('a down Pixel Studio ends in the built-in pixelate with warnings, not a failed asset', async () => {
    const px = new FakePixel()
    px.down = true
    const sheet = await sheetFile()
    const s = pixelSettings({ provider: 'pixel-studio-draw' })
    const r = await generateAsset(ctx({ settings: s, pixel: px, resolveRef: () => sheet, ask: async () => '{"done":true}' }), { ...stub('sprite_petra_worried'), engine: 'qwen-image-2.1-edit' })
    expect(r).toMatchObject({ ok: true })
    if (r.ok && !r.skipped) {
      expect(r.version.warnings?.filter((w) => /Pixel Studio/.test(w))).toHaveLength(2)
    }
  })
})
