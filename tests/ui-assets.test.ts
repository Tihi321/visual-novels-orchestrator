import { describe, expect, it } from 'vitest'
import type { AssetView } from '../src/shared/protocol'
import { charKeyOf, groupAssets, isAudioPath, isImagePath, missingAssets, readyCount, reviewBadge } from '../src/renderer/lib/assets'
import { engineChoices } from '../src/renderer/lib/engines'

function asset(id: string, kind: AssetView['kind'], extra: Partial<AssetView> = {}): AssetView {
  return { id, kind, prompt: '', engine: 'e', seed: null, size: null, versions: [], selected: null, source: 'generated', locked: false, fileRel: null, versionFiles: {}, orphaned: false, ...extra }
}

describe('charKeyOf', () => {
  it('reads sheet, sprite and voice ids', () => {
    expect(charKeyOf('sheet_petra')).toBe('petra')
    expect(charKeyOf('sprite_petra_happy')).toBe('petra')
    expect(charKeyOf('sprite_mr_fox_sad')).toBe('mr_fox')
    expect(charKeyOf('voice_narrator')).toBe('narrator')
    expect(charKeyOf('bg_cave_day')).toBeNull()
  })
})

describe('groupAssets', () => {
  it('groups by kind and keeps a character sheet with its sprites', () => {
    const g = groupAssets([
      asset('sprite_petra_sad', 'sprite'),
      asset('bg_b', 'background'),
      asset('bg_a', 'background'),
      asset('sheet_petra', 'sheet'),
      asset('sheet_zed', 'sheet'),
      asset('cover', 'cover'),
      asset('music_02', 'music'),
      asset('music_01', 'music'),
      asset('voice_narrator', 'voiceRef'),
      asset('sprite_petra_happy', 'sprite')
    ])
    expect(g.backgrounds.map((a) => a.id)).toEqual(['bg_a', 'bg_b'])
    expect(g.characters.map((c) => c.key)).toEqual(['petra', 'zed'])
    expect(g.characters[0]!.sheet?.id).toBe('sheet_petra')
    expect(g.characters[0]!.sprites.map((a) => a.id)).toEqual(['sprite_petra_happy', 'sprite_petra_sad'])
    expect(g.characters[1]!.sprites).toEqual([])
    expect(g.cover).toHaveLength(1)
    expect(g.music.map((a) => a.id)).toEqual(['music_01', 'music_02'])
    expect(g.voice).toHaveLength(1)
  })
  it('makes a character from sprites alone', () => {
    const g = groupAssets([asset('sprite_x_neutral', 'sprite')])
    expect(g.characters).toHaveLength(1)
    expect(g.characters[0]!.sheet).toBeUndefined()
  })
})

describe('badges and file kinds', () => {
  it('prefers the review status', () => {
    expect(reviewBadge(asset('a', 'cover', { review: { status: 'rejected' }, fileRel: 'x' })).tone).toBe('bad')
    expect(reviewBadge(asset('a', 'cover', { review: { status: 'approved' } })).label).toBe('approved')
    expect(reviewBadge(asset('a', 'cover')).label).toBe('no file yet')
    expect(reviewBadge(asset('a', 'cover', { fileRel: 'assets/a/v1.webp' })).label).toBe('not reviewed')
  })
  it('counts ready assets', () => {
    expect(readyCount([asset('a', 'cover', { fileRel: 'x' }), asset('b', 'cover')])).toEqual({ ready: 1, total: 2 })
  })
  it('tells images from audio', () => {
    expect(isImagePath('assets/a/v1.WEBP')).toBe(true)
    expect(isImagePath('assets/a/v1.mp3')).toBe(false)
    expect(isAudioPath('assets/music_01/v1.mp3')).toBe(true)
    expect(isAudioPath(null)).toBe(false)
  })
})

describe('engineChoices', () => {
  const engines = {
    image: [
      { id: 'gen', kind: 'image' as const, label: 'Gen', edit: false, task: 'music' as const, languages: [] as string[] },
      { id: 'ed', kind: 'image' as const, label: 'Ed', edit: true, task: 'music' as const, languages: [] as string[] }
    ],
    audio: [
      { id: 'ace', kind: 'audio' as const, label: 'Ace', edit: false, task: 'music' as const, languages: [] as string[] },
      { id: 'moss', kind: 'audio' as const, label: 'MOSS', edit: false, task: 'sfx' as const, languages: [] as string[] },
      { id: 'tts', kind: 'audio' as const, label: 'TTS', edit: false, task: 'tts' as const, languages: ['en'] }
    ]
  }
  const wfs = [
    { name: 'img', kind: 'image' as const, languages: [] },
    { name: 'tts', kind: 'audio' as const, languages: ['en'] },
    { name: 'song', kind: 'audio' as const, languages: [] }
  ]
  it('offers editors for sprites and generators for the other images', () => {
    expect(engineChoices('sprite', engines, wfs).map((c) => c.id)).toEqual(['ed', 'custom:img'])
    expect(engineChoices('background', engines, wfs).map((c) => c.id)).toEqual(['gen', 'custom:img'])
  })
  it('offers music workflows but not TTS ones, and keeps the current engine', () => {
    expect(engineChoices('music', engines, wfs, 'old').map((c) => c.id)).toEqual(['ace', 'custom:song', 'old'])
  })
  it('filters the audio engines by what they make: music leaves out speech and effects, effects leave out speech', () => {
    expect(engineChoices('music', engines, wfs).map((c) => c.id)).toEqual(['ace', 'custom:song'])
    expect(engineChoices('sfx', engines, wfs).map((c) => c.id)).toEqual(['ace', 'moss', 'custom:song'])
    expect(engineChoices('ambience', engines, wfs).map((c) => c.id)).toEqual(['ace', 'custom:song'])
  })
  it('works before the engines are known', () => {
    expect(engineChoices('cover', null, [], 'cur').map((c) => c.id)).toEqual(['cur'])
  })
  it('offers audio engines (not image ones) and non-TTS audio workflows for every audio kind', () => {
    const audioEngines = {
      image: engines.image,
      audio: [
        { id: 'ace', kind: 'audio' as const, label: 'Ace', edit: false, task: 'music' as const, languages: [] as string[] },
        { id: 'chiptune', kind: 'audio' as const, label: 'Chiptune', edit: false, task: 'music' as const, languages: [] as string[] }
      ]
    }
    for (const kind of ['music', 'sfx', 'ambience'] as const) {
      expect(engineChoices(kind, audioEngines, wfs).map((c) => c.id)).toEqual(['ace', 'chiptune', 'custom:song'])
    }
  })
  it('keeps chiptune and none as the current engine for audio', () => {
    expect(engineChoices('sfx', engines, wfs, 'chiptune').map((c) => c.id)).toEqual(['ace', 'moss', 'custom:song', 'chiptune'])
    expect(engineChoices('sfx', null, [], 'none').map((c) => c.id)).toEqual(['none'])
  })
})

describe('missingAssets', () => {
  it('lists the non-orphaned assets without a file and what the pipeline may generate', () => {
    const list = [
      asset('bg_missing', 'background'),
      asset('bg_ready', 'background', { fileRel: 'assets/bg_ready/v1.webp' }),
      asset('bg_unused', 'background', { orphaned: true }),
      asset('bg_locked', 'background', { locked: true }),
      asset('bg_custom', 'background', { source: 'custom' }),
      asset('voice_narrator', 'voiceRef'),
      asset('sheet_petra', 'sheet'),
      asset('sprite_petra_neutral', 'sprite'),
      asset('cg_missing', 'cg'),
      asset('music_01', 'music'),
      asset('sfx_door', 'sfx', { engine: 'ace-step-v1-instrumental' }),
      asset('sfx_bell', 'sfx', { engine: 'none' }),
      asset('amb_rain', 'ambience')
    ]
    const m = missingAssets(list, { handArt: false })
    expect(m.all.map((a) => a.id)).toEqual([
      'bg_missing',
      'bg_locked',
      'bg_custom',
      'voice_narrator',
      'sheet_petra',
      'sprite_petra_neutral',
      'cg_missing',
      'music_01',
      'sfx_door',
      'sfx_bell',
      'amb_rain'
    ])
    expect(m.generatable.map((a) => a.id)).toEqual([
      'bg_missing',
      'sheet_petra',
      'sprite_petra_neutral',
      'cg_missing',
      'music_01',
      'sfx_door',
      'amb_rain'
    ])
  })
  it('leaves hand-made sheets out and never generates hand-made images', () => {
    const list = [asset('sheet_petra', 'sheet'), asset('bg_cave', 'background'), asset('music_01', 'music'), asset('sfx_door', 'sfx', { engine: 'none' })]
    const m = missingAssets(list, { handArt: true })
    expect(m.all.map((a) => a.id)).toEqual(['bg_cave', 'music_01', 'sfx_door'])
    expect(m.generatable.map((a) => a.id)).toEqual(['music_01'])
  })
  it('treats assets without a file only', () => {
    expect(missingAssets([asset('cover', 'cover', { fileRel: 'assets/cover/v1.webp' })], { handArt: false })).toEqual({ all: [], generatable: [] })
  })
})
