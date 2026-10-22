import { describe, expect, it } from 'vitest'
import { addScenePlan, assignSlots, defaultCues } from '../src/engine/renpy/stage'
import { mergeChapterCues } from '../src/engine/vn/agents/stage-director'
import type { StageChapter } from '../src/engine/vn/agents/stage-director'
import { loadBook } from './fixtures/vn/load'

describe('assignSlots', () => {
  it('places by cast size', () => {
    expect(assignSlots(['a']).slots).toEqual({ a: 'center' })
    expect(assignSlots(['a', 'b']).slots).toEqual({ a: 'left', b: 'right' })
    expect(assignSlots(['a', 'b', 'c']).slots).toEqual({ a: 'left', b: 'center', c: 'right' })
  })

  it('shows the first three and reports the rest', () => {
    const r = assignSlots(['a', 'b', 'c', 'd', 'e'])
    expect(Object.keys(r.slots)).toEqual(['a', 'b', 'c'])
    expect(r.dropped).toEqual(['d', 'e'])
  })

  it('an empty cast has no slots', () => {
    expect(assignSlots([]).slots).toEqual({})
  })
})

describe('defaultCues', () => {
  it('uses dissolve for scenes and fade after a scene break', () => {
    const cues = defaultCues(loadBook('linear'))
    expect(cues.scenes['ch01.s01']?.transition).toBe('dissolve')
    expect(cues.scenes['ch01.s02']?.transition).toBe('fade')
  })

  it('assigns slots for every cast beat and warns about a crowded one', () => {
    const warnings: string[] = []
    const cues = defaultCues(loadBook('linear'), { warn: (m) => warnings.push(m) })
    expect(cues.casts['ch01.s01.b001']).toEqual({ mara: 'center' })
    expect(cues.casts['ch01.s01.b004']).toEqual({ mara: 'left', tomo: 'right' })
    expect(cues.casts['ch01.s02.b001']).toEqual({ mara: 'left', tomo: 'center', dog: 'right' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('nina')
  })

  it('main menu gets the first track and chapters rotate the others', () => {
    const book = loadBook('choice') // 3 chapters
    const cues = defaultCues(book, { musicIds: ['music_01', 'music_02', 'music_03'] })
    expect(cues.menuMusic).toBe('music_01')
    expect(cues.chapters[1]?.music).toBe('music_02')
    expect(cues.chapters[2]?.music).toBe('music_03')
    expect(cues.chapters[3]?.music).toBe('music_02')
  })

  it('a single track plays everywhere; no tracks means no music', () => {
    const book = loadBook('linear')
    const one = defaultCues(book, { musicIds: ['music_01'] })
    expect(one.menuMusic).toBe('music_01')
    expect(one.chapters[1]?.music).toBe('music_01')
    const none = defaultCues(book)
    expect(none.menuMusic).toBeNull()
    expect(none.chapters[1]?.music).toBeNull()
  })
})

describe('media cue precedence', () => {
  const sounds = [
    { key: 'door', kind: 'sfx' as const, description: 'a door' },
    { key: 'bell', kind: 'sfx' as const, description: 'a bell' },
    { key: 'rain', kind: 'ambience' as const, description: 'rain' }
  ]
  /** The linear book; ch01.s01.b002 has its own sfx (door) and ch01.s02 its own music (silence). */
  const media = () => {
    const book = loadBook('linear')
    book.sounds = sounds
    book.chapters[0]!.scenes[0]!.beats[1]!.sfx = 'door'
    book.chapters[0]!.scenes[1]!.music = null
    return book
  }
  const answer = (over: Partial<StageChapter> = {}): StageChapter => ({ music: null, scenes: [], casts: [], sfx: [], ambience: [], ...over })

  it('the stage-director adds sfx and ambience from the catalogue only, never over a cue the story gives the beat', () => {
    const book = media()
    const ch = book.chapters[0]!
    const m = mergeChapterCues(
      defaultCues(book),
      ch,
      answer({
        sfx: [
          { beatId: 'ch01.s01.b002', key: 'bell' }, // the story says door
          { beatId: 'ch01.s01.b003', key: 'bell' },
          { beatId: 'ch01.s01.b005', key: 'thunder' }, // not in the catalogue
          { beatId: 'ch09.s01.b001', key: 'bell' }
        ],
        ambience: [
          { beatId: 'ch01.s01.b003', key: 'rain' },
          { beatId: 'ch01.s01.b007', key: null },
          { beatId: 'ch01.s01.b005', key: 'door' } // an sfx, not an ambience
        ]
      }),
      [],
      sounds
    )
    expect(m.cues.beats).toEqual({ 'ch01.s01.b003': { sfx: 'bell', ambience: 'rain' }, 'ch01.s01.b007': { ambience: null } })
    expect(m.notes).toEqual(expect.arrayContaining([expect.stringMatching(/thunder is not in the book's sounds/), expect.stringMatching(/unknown beat ch09/), expect.stringMatching(/ambience door is not in the book's sounds/)]))
  })

  it('a new transition from the stage-director keeps the scene music and ambience set before', () => {
    const book = media()
    const cues = defaultCues(book)
    cues.scenes['ch01.s01'] = { transition: 'dissolve', music: 'music_02', ambience: 'rain' }
    const m = mergeChapterCues(cues, book.chapters[0]!, answer({ scenes: [{ id: 'ch01.s01', transition: 'fade', pause: 1 }] }), [], sounds)
    expect(m.cues.scenes['ch01.s01']).toEqual({ transition: 'fade', pause: 1, music: 'music_02', ambience: 'rain' })
  })

  it("the composer's scene music never overrides the story's or a hand-set cue, and skips tracks that do not exist", () => {
    const book = media()
    const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
    cues.scenes['ch02.s01'] = { ...cues.scenes['ch02.s01']!, music: 'music_01' } // set by hand
    addScenePlan(cues, book, { 'ch01.s01': 'music_01', 'ch01.s02': 'music_02', 'ch02.s01': 'music_02', 'ch03.s01': 'music_09' }, ['music_01', 'music_02'])
    expect(cues.scenes['ch01.s01']!.music).toBe('music_01')
    expect('music' in cues.scenes['ch01.s02']!).toBe(false) // the story says silence there: the build plays that
    expect(cues.scenes['ch02.s01']!.music).toBe('music_01')
  })
})
