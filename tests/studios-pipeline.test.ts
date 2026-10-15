import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { launchPlan, watchFile } from '../src/engine/studios/launch'
import { loadStudiosConfig } from '../src/engine/studios/config'
import { parseCliArgs, settingsPatchFromFlags } from '../src/engine/vncli'
import { resolveArtProvider, resolveMusicProvider, resolvePixel, resolvePixelProvider } from '../src/shared/vn'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { FakeChiptune, FakePixel } from './studio-fakes'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => T | Promise<T>, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error('timed out')
    await sleep(25)
  }
}

describe('the pipeline with Chiptune Studio and Pixel Studio', () => {
  it('a pixel book gets chiptune music (auto), loop points, <loop S> in the game, and pixel art from Pixel Studio', async () => {
    const chiptune = new FakeChiptune()
    const pixel = new FakePixel()
    env = await makeVnEnv({ sdk: false, engine: { chiptune, pixel } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { art: { style: 'pixel', palette: 'gameboy', pixelProvider: 'pixel-studio', pixel: { width: 320, height: 180 } }, music: { tracks: 2 } })
    const music = (await svc.store.loadAssets(slug)).assets.filter((a) => a.kind === 'music')
    expect(music.map((a) => a.engine)).toEqual(['chiptune', 'chiptune']) // auto: chiptune for a pixel book

    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug, 120_000)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])

    const plan = JSON.parse(await readFile(svc.store.file(slug, 'music.json'), 'utf8')) as { tracks: Record<string, { mood: string; bpm: number; chip: string }> }
    expect(Object.keys(plan.tracks)).toEqual(['music_01', 'music_02'])
    expect(plan.tracks.music_01!.chip).toBe('gb') // the gameboy palette
    const after = (await svc.store.loadAssets(slug)).assets
    const m1 = after.find((a) => a.id === 'music_01')!
    expect(m1.versions[0]).toMatchObject({ file: 'v1.ogg', loopStartSec: 2, loopEndSec: 41.5, songFile: 'v1.song' })
    expect(m1.prompt).toMatch(/^chiptune:/)
    // the composer's plan reached compose_track
    const composed = chiptune.calls.filter((c) => c.tool === 'compose_track').map((c) => c.args as { mood: string; chip: string })
    expect(composed.map((c) => c.chip)).toEqual(['gb', 'gb'])
    expect(env.comfy.requests.some((r) => r.engine.startsWith('ace-step'))).toBe(false)
    // a background went through Pixel Studio at the exact size
    expect(pixel.calls.filter((c) => c.tool === 'import_image').length).toBeGreaterThan(0)
    const bg = after.find((a) => a.kind === 'background')!
    const meta = await sharp(path.join(svc.store.dir(slug), 'assets', bg.id, bg.versions[0]!.file)).metadata()
    expect([meta.width, meta.height]).toEqual([1920, 1080])

    // the game plays the track with its loop point
    const rpy = await readFile(path.join(svc.gameDir(slug), 'game', 'ch01.rpy'), 'utf8')
    expect(rpy).toContain('play music "<loop 2>audio/music_0')
    expect(existsSync(path.join(svc.gameDir(slug), 'game', 'audio', 'music_01.ogg'))).toBe(true)
  }, 180_000)

  it('with Pixel Studio down the pixel art falls back with a warning, and chiptune music fails with the start hint', async () => {
    const chiptune = new FakeChiptune()
    chiptune.down = true
    const pixel = new FakePixel()
    pixel.down = true
    env = await makeVnEnv({ sdk: false, engine: { chiptune, pixel } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { art: { style: 'pixel', palette: 'gameboy', pixelProvider: 'pixel-studio' }, music: { tracks: 1 } })
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug, 120_000)
    expect(failed.some((id) => id.includes('music_01'))).toBe(true)
    expect((await failures(env)).join(' ')).toContain('yarn build && yarn mcp')
    const bg = (await svc.store.loadAssets(slug)).assets.find((a) => a.kind === 'background')!
    expect(bg.versions[0]!.warnings?.[0]).toMatch(/built-in pixelate/)
  }, 180_000)
})

describe('switching the music provider', () => {
  it('retargets existing ComfyUI tracks (plan and regenerate), and back', async () => {
    const chiptune = new FakeChiptune()
    env = await makeVnEnv({ sdk: false, engine: { chiptune, pixel: new FakePixel() } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { music: { tracks: 2 } })
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug, 120_000)
    let music = (await svc.store.loadAssets(slug)).assets.filter((a) => a.kind === 'music')
    expect(music.map((a) => [a.engine, a.versions[0]!.engine])).toEqual([['ace-step-v1-instrumental', 'ace-step-v1-instrumental'], ['ace-step-v1-instrumental', 'ace-step-v1-instrumental']])

    await svc.updateSettings(slug, { music: { provider: 'chiptune' } })
    music = (await svc.store.loadAssets(slug)).assets.filter((a) => a.kind === 'music')
    expect(music.map((a) => a.engine)).toEqual(['chiptune', 'chiptune'])
    // the plan step writes the chip plan for tracks that already have a file
    await svc.enqueue(slug, 'vn.music.plan', 'all', await svc.nextRun(slug), { body: { force: false } })
    await waitIdle(env, slug, 60_000)
    const plan = JSON.parse(await readFile(svc.store.file(slug, 'music.json'), 'utf8')) as { tracks: Record<string, unknown> }
    expect(Object.keys(plan.tracks)).toEqual(['music_01', 'music_02'])
    await svc.regenerateAsset(slug, 'music_01', { rebuild: false })
    await waitIdle(env, slug, 60_000)
    const m1 = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!
    expect(m1.versions.map((v) => v.engine)).toEqual(['ace-step-v1-instrumental', 'chiptune'])
    expect(m1.versions[1]).toMatchObject({ file: 'v2.ogg', loopStartSec: 2 })
    expect(chiptune.calls.filter((c) => c.tool === 'compose_track')).toHaveLength(1)

    await svc.updateSettings(slug, { music: { provider: 'comfy' } })
    await svc.regenerateAsset(slug, 'music_01', { rebuild: false })
    await waitIdle(env, slug, 60_000)
    const back = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!
    expect(back.versions.at(-1)).toMatchObject({ engine: 'ace-step-v1-instrumental', file: 'v3.mp3' })
  }, 180_000)
})

describe('the round trip', () => {
  it('opens an image in Pixel Studio, and each save becomes a new custom, locked, selected version', async () => {
    env = await makeVnEnv({ sdk: false, engine: { pixel: new FakePixel(), chiptune: new FakeChiptune() } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug, 120_000)
    const bg = (await svc.store.loadAssets(slug)).assets.find((a) => a.kind === 'background')!
    const launched: { command: string; args: string[] }[] = []
    let seen: { n: number; custom?: boolean } | undefined
    const r = await svc.openInStudio(slug, bg.id, {
      pollMs: 30,
      rebuild: false,
      onVersion: (_e, v) => (seen = v),
      launch: async (plan) => {
        launched.push(plan)
        // the studio opened the copy, the user edited a pixel and saved: the export file appears
        const exportTo = plan.args[plan.args.indexOf('--export-to') + 1]!
        const open = plan.args[plan.args.indexOf('--open') + 1]!
        expect(existsSync(open)).toBe(true) // a PNG copy to edit
        expect(plan.args).toContain('--export-width')
        setTimeout(() => void sharp({ create: { width: 1920, height: 1080, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 1 } } }).png().toFile(exportTo), 120)
        return { pid: 1 }
      }
    })
    expect(r).toMatchObject({ studio: 'pixel', mode: 'window' })
    expect(launched[0]!.command).toBe('yarn')
    const v = await until(() => seen)
    expect(v.n).toBe(2)
    const e = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === bg.id)!
    expect(e).toMatchObject({ selected: 2, locked: true, source: 'generated' })
    expect(e.versions[1]).toMatchObject({ file: 'v2.webp', custom: true, engine: 'custom:pixel-studio' })
    const m = await sharp(path.join(svc.store.dir(slug), 'assets', bg.id, 'v2.webp')).metadata()
    expect([m.width, m.height]).toEqual([1920, 1080])
    expect(env.events.some((x) => x.type === 'studio.opened')).toBe(true)
    // the pipeline never regenerates it
    const before = env.comfy.requests.length
    await svc.runPipeline(slug, 'generate')
    await waitIdle(env, slug, 60_000)
    expect(env.comfy.requests.length).toBe(before)
  }, 180_000)

  it('opens music in Chiptune Studio from the saved song, and the new version keeps the loop points', async () => {
    env = await makeVnEnv({ sdk: false, engine: { pixel: new FakePixel(), chiptune: new FakeChiptune() } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { art: { style: 'pixel' }, music: { tracks: 1 } })
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug, 120_000)
    let seen: { n: number } | undefined
    await svc.openInStudio(slug, 'music_01', {
      pollMs: 30,
      rebuild: false,
      onVersion: (_e, v) => (seen = v),
      launch: async (plan) => {
        const exportTo = plan.args[plan.args.indexOf('--export-to') + 1]!
        expect(plan.args).toContain('--export-format')
        const open = plan.args[plan.args.indexOf('--open') + 1]!
        expect(open).not.toContain(`${path.sep}assets${path.sep}`) // a copy: the version's song file is not edited
        setTimeout(() => void writeFile(exportTo, 'EDITED-OGG'), 100)
        return { pid: 2 }
      }
    })
    await until(() => seen)
    const e = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!
    expect(e).toMatchObject({ selected: 2, locked: true })
    expect(e.versions[1]).toMatchObject({ file: 'v2.ogg', custom: true, songFile: 'v2.song', loopStartSec: 2, loopEndSec: 41.5 })
    expect(e.versions[1]!.warnings?.[0]).toMatch(/loop points copied/)
    // an image-only asset kind and a voice ref have no wrong studio
    await expect(svc.openInStudio(slug, 'music_01', { via: 'launch', launch: async () => Promise.reject(new Error('no yarn')) })).rejects.toThrow('no yarn')
  }, 180_000)
})

describe('launch and watch helpers', () => {
  it('builds the contract command line (repo or exe, pixel or chiptune flags)', async () => {
    const dir = (await import('node:os')).tmpdir()
    const c = await loadStudiosConfig(dir, {})
    const p = launchPlan(c, 'pixel', { open: 'C:\\a.png', exportTo: 'C:\\b.png', exportWidth: 1920, exportHeight: 1080 })
    expect(p).toEqual({ command: 'yarn', args: ['--cwd', c.pixelStudioRepo, 'electron', '.', '--open', 'C:\\a.png', '--export-to', 'C:\\b.png', '--export-width', '1920', '--export-height', '1080'], cwd: c.pixelStudioRepo })
    const q = launchPlan({ ...c, chiptuneStudioExe: 'C:\\c.exe' }, 'chiptune', { open: 's', exportTo: 'e.ogg', exportFormat: 'ogg' })
    expect(q).toEqual({ command: 'C:\\c.exe', args: ['--open', 's', '--export-to', 'e.ogg', '--export-format', 'ogg'] })
  })

  it('watchFile ignores a file that was already there, reports each settled change once, and stops', async () => {
    const f = path.join((await import('node:os')).tmpdir(), `vno-watch-${Date.now()}.txt`)
    await writeFile(f, 'old')
    const seen: string[] = []
    const w = watchFile(f, async (file) => void seen.push(await readFile(file, 'utf8')), { intervalMs: 25 })
    await sleep(120)
    expect(seen).toEqual([])
    await writeFile(f, 'first save')
    await until(() => seen.length === 1)
    await sleep(120)
    expect(seen).toEqual(['first save'])
    await writeFile(f, 'second save, longer')
    await until(() => seen.length === 2)
    w.stop()
    await writeFile(f, 'after stop!!!!!!!!!!')
    await sleep(150)
    expect(seen).toHaveLength(2)
    await (await import('node:fs/promises')).rm(f, { force: true })
  })
})

describe('contract defaults and migration', () => {
  it('a project from before VNO-02 parses unchanged and resolves to the defaults', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    const file = svc.store.file(slug, 'project.md')
    const text = await readFile(file, 'utf8')
    expect(text).not.toMatch(/pixelProvider|chip:|provider: pixel/)
    const { settings } = await svc.store.loadSettings(slug)
    expect(settings.art.pixel).toBeUndefined()
    expect(resolvePixel(settings.art)).toEqual({ width: 320, height: 180, dither: 'none', outline: false })
    expect(resolvePixelProvider(settings.art)).toBe('vno')
    expect(resolveArtProvider(settings.art)).toBe('comfy')
    expect(resolveMusicProvider(settings)).toBe('comfy')
    expect(resolveMusicProvider({ ...settings, art: { ...settings.art, style: 'pixel' } })).toBe('chiptune')
    expect(resolveMusicProvider({ ...settings, art: { ...settings.art, style: 'pixel' }, music: { ...settings.music, provider: 'comfy' } })).toBe('comfy')
  })

  it('settings patches merge the pixel fields and null clears them', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { art: { pixel: { width: 256, height: 144 }, pixelProvider: 'pixel-studio', provider: 'pixel-studio-draw' }, music: { provider: 'chiptune', chip: 'nes' } })
    let s = (await svc.store.loadSettings(slug)).settings
    expect(s.art).toMatchObject({ pixel: { width: 256, height: 144 }, pixelProvider: 'pixel-studio', provider: 'pixel-studio-draw' })
    expect(s.music).toMatchObject({ provider: 'chiptune', chip: 'nes' })
    await svc.updateSettings(slug, { art: { pixel: { dither: 'floyd' } } })
    s = (await svc.store.loadSettings(slug)).settings
    expect(s.art.pixel).toEqual({ width: 256, height: 144, dither: 'floyd' })
    await svc.updateSettings(slug, { art: { pixelProvider: null, provider: null, pixel: null }, music: { chip: null, provider: null } })
    s = (await svc.store.loadSettings(slug)).settings
    expect(s.art.pixelProvider).toBeUndefined()
    expect(s.art.pixel).toBeUndefined()
    expect(s.music.chip).toBeUndefined()
    expect(s.music.provider).toBeUndefined()
  })

  it('the settings CLI flags make the patch', () => {
    const p = settingsPatchFromFlags(parseCliArgs(['settings', 's', '--style', 'pixel', '--music-provider', 'chiptune', '--chip', 'snes', '--pixel-provider', 'pixel-studio', '--art-provider', 'auto', '--pixel-size', '320x180', '--dither', 'ordered', '--outline']))
    expect(p).toEqual({ art: { style: 'pixel', pixelProvider: 'pixel-studio', provider: null, pixel: { width: 320, height: 180, dither: 'ordered', outline: true } }, music: { provider: 'chiptune', chip: 'snes' } })
    expect(() => settingsPatchFromFlags(parseCliArgs(['settings', 's', '--chip', 'amiga']))).toThrow(/--chip must be one of/)
    expect(() => settingsPatchFromFlags(parseCliArgs(['settings', 's', '--pixel-size', 'big']))).toThrow(/WIDTHxHEIGHT/)
  })
})
