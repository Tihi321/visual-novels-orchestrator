import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetIds, deriveAssets, fallbackNegative, fallbackPrompt } from '../src/engine/assets/derive'
import {
  addVersion,
  assetDir,
  loadManifest,
  mergeDerived,
  nextVersionN,
  pickVersion,
  resolveFile,
  saveManifest,
  setCustom,
  unlock
} from '../src/engine/assets/manifest'
import type { AssetEntry } from '../src/shared/vn'
import { book, mediaBook, settings } from './assets-fixtures'

describe('deriveAssets', () => {
  it('derives backgrounds, sheets, sprites, cover and music in a stable order', () => {
    const assets = deriveAssets(book, settings())
    expect(assets.map((a) => a.id)).toEqual([
      'bg_harbour_dusk',
      'bg_attic_any',
      'sheet_petra',
      'sheet_wizard',
      'sheet_mango',
      'sprite_petra_neutral',
      'sprite_petra_worried',
      'sprite_wizard_neutral',
      'sprite_mango_happy',
      'cover',
      'music_01',
      'music_02',
      'music_03'
    ])
    expect(deriveAssets(book, settings())).toEqual(assets)
  })

  it('sets kinds, sizes, engines and references; prompts are empty stubs', () => {
    const assets = deriveAssets(book, settings())
    const by = (id: string) => assets.find((a) => a.id === id)!
    expect(by('bg_harbour_dusk')).toMatchObject({ kind: 'background', engine: 'qwen-image-2.1', size: { w: 1664, h: 928 }, prompt: '', versions: [], selected: null, source: 'generated', locked: false, seed: null })
    expect(by('sheet_petra')).toMatchObject({ kind: 'sheet', size: { w: 928, h: 1664 } })
    expect(by('sprite_petra_worried')).toMatchObject({ kind: 'sprite', engine: 'qwen-image-2.1-edit', refs: ['sheet_petra'] })
    expect(by('cover')).toMatchObject({ kind: 'cover', size: { w: 1664, h: 928 } }) // the menu picture is landscape
    expect(by('music_01')).toMatchObject({ kind: 'music', engine: 'ace-step-v1-instrumental', size: null })
  })

  it('does not create sprites or sheets for unknown speakers, and honours the music count', () => {
    const assets = deriveAssets(book, settings({ music: { engine: 'yue2', tracks: 1 } }))
    expect(assets.filter((a) => a.kind === 'music')).toHaveLength(1)
    expect(assets.find((a) => a.kind === 'music')!.engine).toBe('yue2')
    expect(assets.some((a) => a.id.includes('crowd'))).toBe(false)
  })

  it('adds voice references only when voice is enabled', () => {
    expect(deriveAssets(book, settings()).some((a) => a.kind === 'voiceRef')).toBe(false)
    const on = deriveAssets(book, settings({ voice: { enabled: true, langs: ['en'], provider: 'comfy', voices: {}, engines: { en: 'custom:chatterbox-multilingual' } } }))
    expect(on.filter((a) => a.kind === 'voiceRef').map((a) => a.id)).toEqual(['voice_petra', 'voice_mango', 'voice_narrator'])
    expect(on.find((a) => a.id === 'voice_petra')!.engine).toBe('custom:chatterbox-multilingual')
  })

  it('exposes the id formats', () => {
    expect(assetIds.sheet('a')).toBe('sheet_a')
    expect(assetIds.sprite('a', 'sad')).toBe('sprite_a_sad')
    expect(assetIds.music(2)).toBe('music_02')
    expect(assetIds.voiceRef('narrator')).toBe('voice_narrator')
  })
})

describe('fallbackPrompt', () => {
  it('builds English prompts from the bible', () => {
    const bg = fallbackPrompt({ id: 'bg_harbour_dusk', kind: 'background' }, book)
    expect(bg).toContain('fantasy visual novel illustration') // the style comes from the genre, not from the bible's Style text
    expect(bg).not.toContain('storybook')
    expect(bg).toContain('empty environment, no people, no characters, no creatures, no animals')
    expect(bg).toContain('wooden pier, gulls')
    expect(bg).toContain('The sun sinks behind the masts.')
    expect(bg).toContain('dusk lighting')
    expect(fallbackPrompt({ id: 'sheet_petra', kind: 'sheet' }, book)).toContain('a small girl with red braids')
    const sprite = fallbackPrompt({ id: 'sprite_petra_worried', kind: 'sprite' }, book)
    expect(sprite).toContain('Show only this one character as a single full-body figure, centered, facing the viewer, worried facial expression, plain pure white background, nothing else')
    expect(sprite).toContain('red braids')
    expect(fallbackPrompt({ id: 'cover', kind: 'cover' }, book)).toContain('a girl and a dragon on a pier')
    expect(fallbackPrompt({ id: 'cover', kind: 'cover' }, book)).toMatch(/wide 16:9 key art, landscape composition, keep the left third calm for the menu/)
    expect(fallbackPrompt({ id: 'cover', kind: 'cover' }, book)).not.toContain('portrait')
    const music = fallbackPrompt({ id: 'music_02', kind: 'music' }, book)
    expect(music).toContain('calm, gentle, soft piano and strings, ambient, slow, instrumental, no vocals')
    expect(music).toContain('whimsical harp')
    expect(music).toContain('chapter theme 1')
  })

  it('adds pixel wording and has no negative for music', () => {
    expect(fallbackPrompt({ id: 'cover', kind: 'cover' }, book, { pixel: true })).toContain('pixel art')
    expect(fallbackNegative('music')).toBe('')
    expect(fallbackNegative('background')).toContain('watermark')
  })
})

describe('manifest', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'vno-manifest-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const entry = (over: Partial<AssetEntry> = {}): AssetEntry => ({ id: 'bg_a_any', kind: 'background', prompt: '', engine: 'qwen-image-2.1', seed: null, size: { w: 1664, h: 928 }, versions: [], selected: null, source: 'generated', locked: false, ...over })
  const version = (n: number) => ({ n, file: `v${n}.webp`, createdAt: '2026-01-01T00:00:00.000Z', seed: n, engine: 'qwen-image-2.1', prompt: 'p' })

  it('round-trips assets.json and treats a missing file as empty', async () => {
    expect(await loadManifest(dir)).toEqual({ assets: [] })
    const m = { assets: [entry()] }
    await saveManifest(dir, m)
    expect(await loadManifest(dir)).toEqual(m)
    expect(JSON.parse(await readFile(path.join(dir, 'assets.json'), 'utf8')).assets).toHaveLength(1)
  })

  it('adds versions and selects the newest; picks an older one', () => {
    let e = entry()
    expect(nextVersionN(e)).toBe(1)
    e = addVersion(e, version(1))
    e = addVersion(e, version(2))
    expect(e).toMatchObject({ selected: 2, source: 'generated' })
    expect(nextVersionN(e)).toBe(3)
    expect(pickVersion(e, 1).selected).toBe(1)
    expect(() => pickVersion(e, 9)).toThrow(/no version 9/)
    expect(() => addVersion(e, version(2))).toThrow(/already exists/)
    expect(addVersion(e, version(3), { select: false }).selected).toBe(2)
  })

  it('merges derived stubs: keeps versions, lock and custom, adds new, reports orphans', () => {
    const kept = entry({ id: 'bg_old_any', prompt: 'my prompt', engine: 'z-image-turbo', versions: [version(1)], selected: 1, locked: true, source: 'custom', customFile: 'custom.png' })
    const bare = entry({ id: 'bg_a_any' })
    const gone = entry({ id: 'bg_gone_any', versions: [version(1)], selected: 1 })
    const derived = [entry({ id: 'bg_old_any', engine: 'qwen-image-2.1-turbo' }), entry({ id: 'bg_a_any', engine: 'krea2-turbo' }), entry({ id: 'bg_new_any' })]
    const { manifest, added, orphaned } = mergeDerived({ assets: [kept, bare, gone] }, derived)
    expect(added).toEqual(['bg_new_any'])
    expect(orphaned).toEqual(['bg_gone_any'])
    expect(manifest.assets.map((a) => a.id)).toEqual(['bg_old_any', 'bg_a_any', 'bg_new_any', 'bg_gone_any'])
    const old = manifest.assets[0]!
    expect(old).toMatchObject({ prompt: 'my prompt', engine: 'z-image-turbo', locked: true, source: 'custom', selected: 1 })
    expect(old.versions).toHaveLength(1)
    expect(manifest.assets[1]!.engine).toBe('krea2-turbo') // no work to protect: the new settings apply
  })

  it('copies a custom file, locks the asset and resolves it', async () => {
    const src = path.join(dir, 'mine.png')
    await writeFile(src, 'IMG')
    let e = addVersion(entry(), version(1))
    await mkdir(assetDir(dir, e.id), { recursive: true })
    await writeFile(path.join(assetDir(dir, e.id), 'v1.webp'), 'GEN')
    expect(resolveFile(dir, e)).toBe(path.join(assetDir(dir, e.id), 'v1.webp'))
    e = await setCustom(dir, e, src)
    expect(e).toMatchObject({ source: 'custom', customFile: 'custom.png', locked: true })
    expect(await readFile(path.join(assetDir(dir, e.id), 'custom.png'), 'utf8')).toBe('IMG')
    expect(resolveFile(dir, e)).toBe(path.join(assetDir(dir, e.id), 'custom.png'))
    expect(unlock(e).locked).toBe(false)
    // picking a generated version goes back to the generated file
    const back = pickVersion(e, 1)
    expect(resolveFile(dir, back)).toBe(path.join(assetDir(dir, e.id), 'v1.webp'))
  })

  it('resolves to null when there is no file', () => {
    expect(resolveFile(dir, entry())).toBeNull()
    expect(resolveFile(dir, addVersion(entry(), version(1)))).toBeNull() // recorded, but not on disk
  })
})

describe('deriveAssets: media cues and expression sets', () => {
  it('derives a cg with the sheets of its characters, sfx and ambience stubs, and a sprite for a character expression', () => {
    const assets = deriveAssets(mediaBook(), settings())
    const byId = new Map(assets.map((a) => [a.id, a]))
    expect(byId.get('cg_farewell')).toMatchObject({ kind: 'cg', engine: 'qwen-image-2.1-edit', refs: ['sheet_petra', 'sheet_wizard'] })
    expect(byId.get('cg_letter')).toMatchObject({ kind: 'cg', engine: 'qwen-image-2.1' })
    expect(byId.get('cg_letter')!.refs).toBeUndefined()
    expect(byId.get('cg_letter')!.size).toEqual({ w: byId.get('cg_letter')!.size!.w, h: byId.get('cg_letter')!.size!.w }) // an insert is square
    expect(byId.get('sfx_bell')).toMatchObject({ kind: 'sfx', engine: '', size: null })
    expect(byId.get('amb_waves')).toMatchObject({ kind: 'ambience', engine: 'ace-step-v1-instrumental', size: null })
    expect(byId.get('sprite_petra_smug')).toMatchObject({ kind: 'sprite', refs: ['sheet_petra'] })
    // a custom sfx engine is kept on the stub; an entry no beat uses gets no asset
    const custom = deriveAssets(mediaBook(), settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'custom:foley' } }))
    expect(custom.find((a) => a.id === 'sfx_bell')!.engine).toBe('custom:foley')
    const unused = mediaBook()
    unused.chapters[0]!.scenes[0]!.beats[2]!.image = undefined
    expect(deriveAssets(unused, settings()).some((a) => a.id === 'cg_letter')).toBe(false)
  })

  it('the fallback prompts of a cg and an ambience', () => {
    const b = mediaBook()
    const assets = deriveAssets(b, settings())
    const cg = fallbackPrompt(assets.find((a) => a.id === 'cg_farewell')!, b)
    expect(cg).toMatch(/Petra waves to the Wizard, .*red braids.*grey beard.*wooden pier.*full-bleed/)
    expect(fallbackPrompt(assets.find((a) => a.id === 'cg_letter')!, b)).toMatch(/a torn letter, .*close-up/)
    expect(fallbackPrompt(assets.find((a) => a.id === 'amb_waves')!, b)).toBe('ambient soundscape, waves on the pier, no melody, no drums, seamless loop')
  })
})
