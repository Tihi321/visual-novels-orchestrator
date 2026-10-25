import { describe, expect, it } from 'vitest'
import type { SceneCuesView } from '../src/shared/protocol'
import type { VnBook, VnScene } from '../src/shared/vn'
import { computeStageAtBeat, resolveSceneAudio } from '../src/renderer/lib/stage-preview'

/** A narration beat: any beat may carry the picture, sound effect and ambience fields. */
function beat(id: string, extra: { image?: string | null; sfx?: string; ambience?: string | null } = {}) {
  return { id, type: 'narration' as const, text: id, ...extra }
}

function scene(id: string, beats: VnScene['beats'], extra: Partial<VnScene> = {}): VnScene {
  return {
    id,
    placeKey: 'room',
    placeText: 'Room',
    time: null,
    backgroundId: 'bg_room_day',
    description: '',
    beats,
    breakBefore: false,
    ...extra
  }
}

function book(chapters: { n: number; scenes: VnScene[] }[]): VnBook {
  return {
    slug: 'book',
    title: 'Book',
    format: 'linear',
    kind: 'linear',
    primaryLang: 'en',
    style: '',
    characters: [],
    places: [{ key: 'room', name: 'Room', looks: '' }],
    chapters: chapters.map((c) => ({ n: c.n, title: `Chapter ${c.n}`, choices: [], ending: null, scenes: c.scenes })),
    warnings: []
  }
}

const cues = (over: Record<string, Partial<SceneCuesView>> = {}): Record<string, SceneCuesView> =>
  Object.fromEntries(Object.entries(over).map(([id, v]) => [id, { casts: {}, ...v }]))

const stageMusic = { chapters: { '1': 'music_09', '2': null } }

describe('computeStageAtBeat pictures', () => {
  const picScene = scene('s1', [beat('b1', { image: 'ledger' }), beat('b2')])

  it('keeps the beat picture until another beat changes it', () => {
    expect(computeStageAtBeat(picScene, undefined, 0).cg).toBe('ledger')
    expect(computeStageAtBeat(picScene, undefined, 1).cg).toBe('ledger')
  })

  it('lets a beat cue win over the story image', () => {
    expect(computeStageAtBeat(picScene, undefined, 1, { b2: { image: 'rain' } }).cg).toBe('rain')
  })

  it('hides the picture with a null cue and leaves it with an empty cue', () => {
    expect(computeStageAtBeat(picScene, undefined, 0, { b1: { image: null } }).cg).toBeNull()
    expect(computeStageAtBeat(picScene, undefined, 1, { b2: { image: null } }).cg).toBeNull()
    expect(computeStageAtBeat(picScene, undefined, 1, { b2: {} }).cg).toBe('ledger')
  })

  it('lets a null story image hide an earlier picture', () => {
    const s = scene('s2', [beat('b1', { image: 'ledger' }), beat('b2', { image: null })])
    expect(computeStageAtBeat(s, undefined, 1).cg).toBeNull()
  })
})

describe('resolveSceneAudio music', () => {
  const b = book([
    { n: 1, scenes: [scene('s1', [beat('s1.b1')], { music: 'music_02' }), scene('s2', [beat('s2.b1')])] },
    { n: 2, scenes: [scene('s3', [beat('s3.b1')])] }
  ])

  it('uses the story field before the chapter track', () => {
    expect(resolveSceneAudio(b, cues(), stageMusic, 's1', 0)).toMatchObject({ music: 'music_02', musicFrom: 'story' })
    expect(resolveSceneAudio(b, cues(), stageMusic, 's2', 0)).toMatchObject({ music: 'music_09', musicFrom: 'chapter' })
  })

  it('lets a scene cue win, including a null cue as silence', () => {
    expect(resolveSceneAudio(b, cues({ s1: { music: 'music_05' } }), stageMusic, 's1', 0)).toMatchObject({ music: 'music_05', musicFrom: 'cue' })
    expect(resolveSceneAudio(b, cues({ s1: { music: null } }), stageMusic, 's1', 0)).toMatchObject({ music: null, musicFrom: 'cue' })
    expect(resolveSceneAudio(b, cues({ s1: { music: '' } }), stageMusic, 's1', 0)).toMatchObject({ music: null, musicFrom: 'cue' })
  })

  it('keeps the chapter track across a later chapter with no track of its own', () => {
    // s2 has no music of its own, so the chapter track (music_09) plays; chapter 2 has no track, so it keeps playing.
    expect(resolveSceneAudio(b, cues(), stageMusic, 's3', 0)).toMatchObject({ music: 'music_09', musicFrom: 'chapter' })
  })

  it('keeps the previous chapter track when a later chapter has none, and plays a later chapter track', () => {
    const chaptersOnly = book([{ n: 1, scenes: [scene('c1s1', [beat('c1s1.b1')])] }, { n: 2, scenes: [scene('c2s1', [beat('c2s1.b1')])] }])
    expect(resolveSceneAudio(chaptersOnly, cues(), stageMusic, 'c2s1', 0)).toMatchObject({ music: 'music_09', musicFrom: 'chapter' })
    expect(resolveSceneAudio(chaptersOnly, cues(), { chapters: { '1': 'music_09', '2': 'music_10' } }, 'c2s1', 0)).toMatchObject({
      music: 'music_10',
      musicFrom: 'chapter'
    })
  })

  it('returns nulls for an unknown scene or beat', () => {
    const nothing = { music: null, musicFrom: null, ambience: null, ambienceFrom: null, sfx: null, sfxFrom: null }
    expect(resolveSceneAudio(b, cues(), stageMusic, 'nope', 0)).toEqual(nothing)
    expect(resolveSceneAudio(b, cues(), stageMusic, 's1', 9)).toEqual(nothing)
    expect(resolveSceneAudio(b, cues(), stageMusic, 's1', -1)).toEqual(nothing)
  })
})

describe('resolveSceneAudio ambience', () => {
  it('carries a beat ambience into the next scene of the chapter', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'rain' }), beat('s1.b2')]), scene('s2', [beat('s2.b1')])] }])
    expect(resolveSceneAudio(b, cues(), stageMusic, 's2', 0)).toMatchObject({ ambience: 'rain', ambienceFrom: 'story' })
  })

  it('lets the scene cue win over the scene story field, and a beat over the scene', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1')], { ambience: 'rain' })] }])
    expect(resolveSceneAudio(b, cues({ s1: { ambience: 'wind' } }), stageMusic, 's1', 0)).toMatchObject({ ambience: 'wind', ambienceFrom: 'cue' })
    expect(resolveSceneAudio(b, cues({ s1: { ambience: null } }), stageMusic, 's1', 0)).toMatchObject({ ambience: null, ambienceFrom: 'cue' })

    const withBeat = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'birds' })], { ambience: 'rain' })] }])
    expect(resolveSceneAudio(withBeat, cues(), stageMusic, 's1', 0)).toMatchObject({ ambience: 'birds', ambienceFrom: 'story' })
  })

  it('stops on a null beat cue, and the stop carries into the next scene', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'rain' }), beat('s1.b2')]), scene('s2', [beat('s2.b1')])] }])
    const withStop = cues({ s1: { beats: { 's1.b2': { ambience: null } } } })
    expect(resolveSceneAudio(b, withStop, stageMusic, 's1', 1)).toMatchObject({ ambience: null, ambienceFrom: 'cue' })
    expect(resolveSceneAudio(b, withStop, stageMusic, 's2', 0)).toMatchObject({ ambience: null, ambienceFrom: 'cue' })
  })

  it('carries an ambience across a chapter boundary until something stops it', () => {
    const b = book([
      { n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'rain' })])] },
      { n: 2, scenes: [scene('s2', [beat('s2.b1')])] }
    ])
    expect(resolveSceneAudio(b, cues(), stageMusic, 's2', 0)).toMatchObject({ ambience: 'rain', ambienceFrom: 'story' })
  })

  it('keeps an ambience stopped in an earlier chapter stopped', () => {
    const b = book([
      { n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'rain' }), beat('s1.b2')])] },
      { n: 2, scenes: [scene('s2', [beat('s2.b1')])] }
    ])
    const stopped = cues({ s1: { beats: { 's1.b2': { ambience: null } } } })
    expect(resolveSceneAudio(b, stopped, stageMusic, 's2', 0)).toMatchObject({ ambience: null, ambienceFrom: 'cue' })
  })

  it('normalises an empty ambience to a stop', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { ambience: 'rain' }), beat('s1.b2')])] }])
    const withEmpty = cues({ s1: { beats: { 's1.b2': { ambience: '' } } } })
    expect(resolveSceneAudio(b, withEmpty, stageMusic, 's1', 1)).toMatchObject({ ambience: null, ambienceFrom: 'cue' })
  })
})

describe('resolveSceneAudio sound effects', () => {
  it('uses the cue of this beat before the story field', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { sfx: 'bell' }), beat('s1.b2')])] }])
    expect(resolveSceneAudio(b, cues(), stageMusic, 's1', 0)).toMatchObject({ sfx: 'bell', sfxFrom: 'story' })
    expect(resolveSceneAudio(b, cues({ s1: { beats: { 's1.b1': { sfx: 'door' } } } }), stageMusic, 's1', 0)).toMatchObject({
      sfx: 'door',
      sfxFrom: 'cue'
    })
  })

  it('plays nothing on a beat without a sound effect', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { sfx: 'bell' }), beat('s1.b2')])] }])
    expect(resolveSceneAudio(b, cues(), stageMusic, 's1', 1)).toMatchObject({ sfx: null, sfxFrom: null })
  })

  it('normalises an empty cue to no sound effect', () => {
    const b = book([{ n: 1, scenes: [scene('s1', [beat('s1.b1', { sfx: 'bell' })])] }])
    expect(resolveSceneAudio(b, cues({ s1: { beats: { 's1.b1': { sfx: '' } } } }), stageMusic, 's1', 0)).toMatchObject({ sfx: null, sfxFrom: 'cue' })
  })
})
