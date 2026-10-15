import { describe, expect, it } from 'vitest'
import { assignSlots, defaultCues } from '../src/engine/renpy/stage'
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
