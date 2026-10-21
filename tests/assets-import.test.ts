import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveFile } from '../src/engine/assets/manifest'
import { loadPalette } from '../src/engine/assets/palettes'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import { book, makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv
let slug = ''
let removeCalls = 0
const svc = () => env.engine.vn
const file = (name: string) => path.join(env.dir, name)

beforeEach(async () => {
  env = await makeVnEnv({ sdk: false })
  removeCalls = 0
  env.comfy.removeBackground = async () => {
    removeCalls++
    return null
  }
  slug = (await svc().importProject(book('linear-en'))).slug
  await svc().reconcileAssets(slug)
})
afterEach(async () => {
  await env.cleanup()
})

const assets = async () => (await svc().store.loadAssets(slug)).assets
const asset = async (id: string) => (await assets()).find((a) => a.id === id)!
const spriteId = async () => (await assets()).find((a) => a.kind === 'sprite')!.id
const pngFile = async (name: string, buf: Buffer): Promise<string> => {
  const f = file(name)
  await writeFile(f, buf)
  return f
}
/** A figure (a blue ellipse, 100x300) on a plain white background, 400x600, no alpha. */
const opaqueSprite = () =>
  sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#ffffff"/><ellipse cx="200" cy="300" rx="50" ry="150" fill="#2a5db0"/></svg>'))
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()
/** The same figure with a real transparent background. */
const clearSprite = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><ellipse cx="200" cy="300" rx="50" ry="150" fill="#2a5db0"/></svg>')).png().toBuffer()
const rawOf = async (f: string) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

describe('assets: import an outside image', () => {
  it('an opaque sprite on a plain background comes out transparent, trimmed and at the sprite height, as a locked custom:import version', async () => {
    const id = await spriteId()
    const src = await pngFile('mara.png', await opaqueSprite())
    const r = await svc().importAsset(slug, id, src, { removeBackground: 'key', rebuild: false })
    expect(r.version).toMatchObject({ n: 1, file: 'v1.webp', engine: 'custom:import', prompt: 'imported from mara.png', custom: true })
    const e = await asset(id)
    expect(e).toMatchObject({ locked: true, selected: 1 })
    expect(e.versions).toHaveLength(1)
    const out = resolveFile(svc().store.dir(slug), e)!
    const meta = await sharp(out).metadata()
    expect(meta.height).toBe(972) // 90% of 1080
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 1 / 3)).toBeLessThan(0.05) // trimmed to the figure, a third as wide as it is tall (not 400x600)
    const { data, info } = await rawOf(out)
    expect(data[3]).toBe(0) // the corner is transparent
    expect(data[((info.height >> 1) * info.width + (info.width >> 1)) * 4 + 3]).toBeGreaterThan(200) // the figure is not
    expect(removeCalls).toBe(0) // the key needs no ComfyUI
    // the original stays next to it
    expect(existsSync(path.join(svc().store.dir(slug), 'assets', id, 'import-1.png'))).toBe(true)
  })

  it('an image that is transparent already skips the background removal (no ComfyUI call)', async () => {
    const id = await spriteId()
    const src = await pngFile('clear.png', await clearSprite())
    await svc().importAsset(slug, id, src, { rebuild: false })
    expect(removeCalls).toBe(0)
    expect(env.comfy.requests).toHaveLength(0)
    const out = resolveFile(svc().store.dir(slug), await asset(id))!
    const meta = await sharp(out).metadata()
    expect(meta.height).toBe(972)
    expect((await rawOf(out)).data[3]).toBe(0)
  })

  it('an opaque sprite with the auto setting asks the project background removal (BiRefNet) when ComfyUI is the art provider', async () => {
    const id = await spriteId()
    const src = await pngFile('mara.png', await opaqueSprite())
    await svc().importAsset(slug, id, src, { rebuild: false })
    expect(removeCalls).toBe(1) // birefnet: the fake has no model, so the key finishes it
    const { data } = await rawOf(resolveFile(svc().store.dir(slug), await asset(id))!)
    expect(data[3]).toBe(0)
    const e = await asset(id)
    expect(e.versions[0]!.warnings?.join(' ')).toMatch(/no BiRefNet background-removal model/)
  })

  it('a background of 800x600 becomes 1920x1080', async () => {
    const bg = (await assets()).find((a) => a.kind === 'background')!.id
    const src = await pngFile('bg.png', await sharp({ create: { width: 800, height: 600, channels: 3, background: '#335577' } }).png().toBuffer())
    await svc().importAsset(slug, bg, src, { rebuild: false })
    const meta = await sharp(resolveFile(svc().store.dir(slug), await asset(bg))!).metadata()
    expect(meta).toMatchObject({ width: 1920, height: 1080, format: 'webp' })
  })

  it('a landscape cover is fitted to the screen, a portrait one is kept whole', async () => {
    const wide = await pngFile('wide.png', await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#335577' } }).png().toBuffer())
    await svc().importAsset(slug, 'cover', wide, { rebuild: false })
    expect(await sharp(resolveFile(svc().store.dir(slug), await asset('cover'))!).metadata()).toMatchObject({ width: 1920, height: 1080 })
    const tall = await pngFile('tall.png', await sharp({ create: { width: 540, height: 960, channels: 3, background: '#775533' } }).png().toBuffer())
    await svc().importAsset(slug, 'cover', tall, { rebuild: false })
    const meta = await sharp(resolveFile(svc().store.dir(slug), await asset('cover'))!).metadata()
    expect(meta.height).toBe(1080) // scaled into the frame, not cut to a strip
    expect(meta.width).toBeLessThan(1000)
  })

  it('a pixel project gets exact palette colours', async () => {
    await svc().updateSettings(slug, { art: { style: 'pixel', palette: 'gameboy' } })
    const bg = (await assets()).find((a) => a.kind === 'background')!.id
    const gradient = Buffer.alloc(64 * 36 * 3)
    for (let i = 0; i < 64 * 36; i++) gradient.set([(i * 5) % 256, (i * 3) % 256, (i * 7) % 256], i * 3)
    const src = await pngFile('px.png', await sharp(gradient, { raw: { width: 64, height: 36, channels: 3 } }).png().toBuffer())
    await svc().importAsset(slug, bg, src, { rebuild: false })
    const palette = await loadPalette(path.resolve(__dirname, '..', 'seed', 'palettes'), 'gameboy')
    const { data, info } = await rawOf(resolveFile(svc().store.dir(slug), await asset(bg))!)
    expect(info).toMatchObject({ width: 1920, height: 1080 })
    const colours = new Set<string>()
    for (let i = 0; i < data.length; i += 4) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    const allowed = new Set(palette.map((c) => c.join(',')))
    expect([...colours].every((c) => allowed.has(c))).toBe(true)
    // pixelate: false keeps the picture as it is
    await svc().importAsset(slug, bg, src, { rebuild: false, pixelate: false })
    const plain = await rawOf(resolveFile(svc().store.dir(slug), await asset(bg))!)
    const plainColours = new Set<string>()
    for (let i = 0; i < plain.data.length; i += 4) plainColours.add(`${plain.data[i]},${plain.data[i + 1]},${plain.data[i + 2]}`)
    expect(plainColours.size).toBeGreaterThan(allowed.size)
  })

  it('process: none keeps the file exactly, like vno_asset_replace', async () => {
    const id = await spriteId()
    const bytes = await opaqueSprite()
    const src = await pngFile('mara.png', bytes)
    await svc().importAsset(slug, id, src, { process: 'none', rebuild: false })
    const out = resolveFile(svc().store.dir(slug), await asset(id))!
    expect(path.extname(out)).toBe('.png')
    expect((await readFile(out)).equals(bytes)).toBe(true)
    const other = (await assets()).find((a) => a.kind === 'sprite' && a.id !== id)!.id
    await svc().replaceAsset(slug, other, src, { rebuild: false })
    expect((await readFile(resolveFile(svc().store.dir(slug), await asset(other))!)).equals(bytes)).toBe(true)
    expect(removeCalls).toBe(0)
  })

  it('trim: false scales the sprite without cutting it to the figure', async () => {
    const id = await spriteId()
    const src = await pngFile('clear.png', await clearSprite())
    await svc().importAsset(slug, id, src, { trim: false, rebuild: false })
    const meta = await sharp(resolveFile(svc().store.dir(slug), await asset(id))!).metadata()
    expect(meta.height).toBe(972)
    expect(Math.abs((meta.width ?? 0) / (meta.height ?? 1) - 400 / 600)).toBeLessThan(0.02)
  })

  it('music is copied as it is, other kinds of file are refused with a clear message', async () => {
    await svc().updateSettings(slug, { music: { tracks: 1, provider: 'comfy' } })
    const wav = await pngFile('theme.wav', Buffer.from('RIFF....WAVEfmt '))
    await svc().importAsset(slug, 'music_01', wav, { rebuild: false })
    const e = await asset('music_01')
    expect(e).toMatchObject({ locked: true, selected: 1 })
    expect(e.versions[0]).toMatchObject({ file: 'v1.wav', engine: 'custom:import' })
    expect((await readFile(resolveFile(svc().store.dir(slug), e)!)).toString()).toBe('RIFF....WAVEfmt ')
    await expect(svc().importAsset(slug, 'music_01', await pngFile('x.png', await opaqueSprite()), { rebuild: false })).rejects.toThrow(/is audio: use a .ogg, .mp3, .wav, .opus, .flac file/)
    await expect(svc().importAsset(slug, await spriteId(), wav, { rebuild: false })).rejects.toThrow(/is an image: use a .png/)
    await expect(svc().importAsset(slug, await spriteId(), await pngFile('bad.png', Buffer.from('not an image')), { rebuild: false })).rejects.toThrow()
    await expect(svc().importAsset(slug, await spriteId(), file('missing.png'), { rebuild: false })).rejects.toThrow(/no such file/)
    await expect(svc().importAsset(slug, 'nothing', wav, { rebuild: false })).rejects.toThrow(/no asset "nothing"/)
  })

  it('hand-made art mode never calls ComfyUI for an image with auto: the flat-colour key cuts the sprite out', async () => {
    await svc().updateSettings(slug, { art: { provider: 'hand' } })
    const id = await spriteId()
    const src = await pngFile('mara.png', await opaqueSprite())
    await svc().importAsset(slug, id, src, { rebuild: false })
    expect(removeCalls).toBe(0)
    expect(env.comfy.requests).toHaveLength(0)
    const { data } = await rawOf(resolveFile(svc().store.dir(slug), await asset(id))!)
    expect(data[3]).toBe(0)
    // BiRefNet only when asked for
    await svc().importAsset(slug, id, src, { removeBackground: 'birefnet', rebuild: false })
    expect(removeCalls).toBe(1)
  })

  it('vno_asset_import through MCP, and the CLI-style flags', async () => {
    const tools = buildTools(svc())
    const id = await spriteId()
    const src = await pngFile('mara.png', await opaqueSprite())
    const r = await callTool(tools, 'vno_asset_import', { slug, id, file: src, removeBackground: 'key', rebuild: false })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toMatchObject({ asset: { id, locked: true }, version: { engine: 'custom:import', n: 1 } })
    const bad = await callTool(tools, 'vno_asset_import', { slug, id, file: src, removeBackground: 'magic' })
    expect(bad.isError).toBe(true)
  })

  it('rebuilds the game after an import unless told not to', async () => {
    const id = await spriteId()
    const src = await pngFile('mara.png', await opaqueSprite())
    await svc().importAsset(slug, id, src, { removeBackground: 'key' })
    const queued = await env.engine.jobs.list('queued')
    const running = await env.engine.jobs.list('running')
    const done = await env.engine.jobs.list('done')
    expect([...queued, ...running, ...done].some((j) => j.data.task === 'vn.build')).toBe(true)
  })
})
