import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { puzzleCoreSchema, puzzleEntrySchema } from '../src/shared/puzzle'
import type { PuzzleEntry } from '../src/shared/puzzle'
import { applyStoryOps, buildBook, storyInputSchema, syncEdition, validateBook } from '../src/engine/vn/story'
import type { StoryOp } from '../src/engine/vn/story'
import { editionSchema, hasText, vnBookSchema } from '../src/shared/vn'
import type { VnBook } from '../src/shared/vn'
import { settings } from './assets-fixtures'

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'murdle-medium-1.json'), 'utf8')) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }
const core = puzzleCoreSchema.parse(fixture)
const entry = (over: Partial<PuzzleEntry> = {}): PuzzleEntry =>
  puzzleEntrySchema.parse({ key: 'dinner', kind: 'murdle', data: core, names: fixture.names, text: fixture.text, verified: { unique: true, deducible: true, score: core.difficulty.score, textChecked: true, by: 'test' }, ...over })

/** Two scenes with a puzzle beat between them (the clue of c1 is found in the first scene). */
const story = () =>
  buildBook(
    storyInputSchema.parse({
      title: 'The Cold Dinner',
      characters: [{ name: 'Hartley', looks: 'a tired detective' }],
      places: [{ name: 'Manor', looks: 'a dark dining room' }],
      images: [{ key: 'rope', description: 'a coil of rope', display: 'insert' }],
      chapters: [
        {
          title: 'The Body',
          scenes: [
            { place: 'manor', time: 'night', beats: [{ cast: ['hartley'] }, { speaker: 'Hartley', text: 'The dinner went cold.' }, { text: 'A rope lay on the floor.' }] },
            { place: 'manor', time: 'night', beats: [{ puzzle: 'dinner' }, { text: 'It was over.' }] }
          ]
        }
      ]
    }),
    { slug: 'dinner', lang: 'en' }
  )

const withPuzzle = (over: Partial<PuzzleEntry> = {}): VnBook => {
  const { book } = story()
  return vnBookSchema.parse({ ...book, puzzles: [entry(over)] })
}

describe('the puzzle schemas', () => {
  it('the generated core parses; a clue, a step and a puzzle beat have their shapes', () => {
    expect(core.clues.length).toBeGreaterThan(3)
    expect(core.categories.map((c) => c.key)).toEqual(['suspect', 'weapon', 'place'])
    expect(core.murder.answer).toMatchObject({ suspect: expect.stringMatching(/^s\d$/) })
    expect(() => puzzleCoreSchema.parse({ ...core, format: 2 })).toThrow()
    expect(() => puzzleCoreSchema.parse({ ...core, clues: [{ id: 'x', type: 'is', a: 's1', b: 's2' }] })).toThrow()
    expect(puzzleEntrySchema.parse({ ...entry(), onFail: { mode: 'chapter', to: 2, maxTries: 3 }, hints: false, clueAt: { c1: 'ch01.s01.b003' }, links: { w1: { type: 'image', key: 'rope' } } }).onFail?.mode).toBe('chapter')
    const b = story().book
    expect(b.chapters[0]!.scenes[1]!.beats[0]).toEqual({ id: 'ch01.s02.b001', type: 'puzzle', puzzle: 'dinner' })
    expect(hasText(b.chapters[0]!.scenes[1]!.beats[0]!)).toBe(false)
    expect(hasText(b.chapters[0]!.scenes[1]!.beats[1]!)).toBe(true)
  })

  it('a puzzle beat accepts cues but not a speaker or text', () => {
    const base = storyInputSchema.parse({ title: 'T', characters: [{ name: 'A' }], places: [{ name: 'P' }], images: [{ key: 'rope', description: 'a rope', display: 'insert' }], chapters: [{ title: 'c', scenes: [{ place: 'p', beats: [{ puzzle: 'q', image: 'rope' }] }] }] })
    expect(buildBook(base, { slug: 't', lang: 'en' }).book.chapters[0]!.scenes[0]!.beats[0]).toMatchObject({ type: 'puzzle', puzzle: 'q', image: 'rope' })
    const bad = storyInputSchema.parse({ title: 'T', characters: [{ name: 'A' }], places: [{ name: 'P' }], chapters: [{ title: 'c', scenes: [{ place: 'p', beats: [{ puzzle: 'q', text: 'hello' }] }] }] })
    expect(() => buildBook(bad, { slug: 't', lang: 'en' })).toThrow(/only a puzzle key/)
  })
})

describe('puzzle operations', () => {
  const set = (over: Partial<Extract<StoryOp, { op: 'puzzle.set' }>> = {}): StoryOp => ({ op: 'puzzle.set', key: 'dinner', data: core, names: fixture.names, text: fixture.text, verified: entry().verified, ...over }) as StoryOp

  it('puzzle.set adds a puzzle (needs the core, names, text and what was verified) and changes one', () => {
    const { book } = story()
    const r = applyStoryOps(book, [set()])
    expect(r.created).toContain('puzzle dinner')
    expect(r.book.puzzles).toHaveLength(1)
    expect(r.changed.has('puzzles')).toBe(true)
    expect(() => applyStoryOps(book, [{ op: 'puzzle.set', key: 'dinner' } as StoryOp])).toThrow(/give data, names, text and verified/)
    expect(() => applyStoryOps(book, [set({ key: 'Bad Key' })])).toThrow(/lowercase letters/)
    // a change: new names, new prose: the proof stays, the prose is not checked any more; onFail null clears
    const next = applyStoryOps(r.book, [{ op: 'puzzle.set', key: 'dinner', names: { s1: 'Anna' }, text: { c1: 'Anna was in the loft.' }, onFail: { mode: 'continue', maxTries: 2 } } as StoryOp]).book.puzzles![0]!
    expect(next.names.s1).toBe('Anna')
    expect(next.names.s2).toBe(fixture.names.s2)
    expect(next.verified).toMatchObject({ unique: true, textChecked: false })
    expect(next.onFail).toEqual({ mode: 'continue', maxTries: 2 })
    const cleared = applyStoryOps(applyStoryOps(r.book, [{ op: 'puzzle.set', key: 'dinner', onFail: { mode: 'retry' } } as StoryOp]).book, [{ op: 'puzzle.set', key: 'dinner', onFail: null } as StoryOp]).book.puzzles![0]!
    expect(cleared.onFail).toBeUndefined()
  })

  it('puzzle.remove is refused while a beat plays it, unless force (which removes the beat)', () => {
    const book = withPuzzle()
    expect(() => applyStoryOps(book, [{ op: 'puzzle.remove', key: 'dinner' }])).toThrow(/played by beat ch01.s02.b001/)
    const r = applyStoryOps(book, [{ op: 'puzzle.remove', key: 'dinner', force: true }])
    expect(r.book.puzzles).toBeUndefined()
    expect(r.book.chapters[0]!.scenes[1]!.beats.map((b) => b.type)).toEqual(['narration'])
    expect(() => applyStoryOps(book, [{ op: 'puzzle.remove', key: 'nope' }])).toThrow(/no puzzle/)
  })

  it('a puzzle beat is added with beat.add and plays a puzzle that is not made yet with a warning', () => {
    const { book } = story()
    const r = applyStoryOps(book, [{ op: 'beat.add', sceneId: 'ch01.s01', beats: [{ puzzle: 'later' }] }])
    expect(validateBook(r.book).errors).toEqual([])
    expect(validateBook(r.book).warnings.join(' ')).toMatch(/puzzle "later" is not made yet/)
  })
})

describe('validating puzzles', () => {
  const errors = (b: VnBook) => validateBook(b).errors.join(' | ')

  it('a good book has no errors', () => {
    expect(validateBook(withPuzzle()).errors).toEqual([])
    expect(validateBook(withPuzzle({ clueAt: { c1: 'ch01.s01.b003' }, links: { s1: { type: 'character', key: 'hartley' }, p1: { type: 'place', key: 'manor' }, w1: { type: 'image', key: 'rope' } } })).errors).toEqual([])
  })

  it('refuses a puzzle played twice, an unknown link, a clue found after the puzzle or at no beat, a missing name or clue text, an onFail chapter that is not there', () => {
    const twice = withPuzzle()
    twice.chapters[0]!.scenes[0]!.beats.push({ id: 'ch01.s01.b999', type: 'puzzle', puzzle: 'dinner' })
    expect(errors(twice)).toMatch(/played by two beats/)
    expect(errors(withPuzzle({ links: { s1: { type: 'character', key: 'ghost' } } }))).toMatch(/s1 links to character "ghost"/)
    expect(errors(withPuzzle({ links: { zz: { type: 'image', key: 'rope' } } }))).toMatch(/link of unknown item zz/)
    expect(errors(withPuzzle({ clueAt: { c1: 'ch01.s02.b002' } }))).toMatch(/clue c1 is found at ch01.s02.b002, which is not before the puzzle beat ch01.s02.b001/)
    expect(errors(withPuzzle({ clueAt: { c1: 'ch09.s01.b001' } }))).toMatch(/does not exist/)
    expect(errors(withPuzzle({ clueAt: { c99: 'ch01.s01.b001' } }))).toMatch(/unknown clue c99/)
    expect(errors(withPuzzle({ names: { ...fixture.names, s1: '' } }))).toMatch(/item s1 has no name/)
    const noText = { ...fixture.text }
    delete noText.c1
    expect(errors(withPuzzle({ text: noText }))).toMatch(/clue c1 has no text/)
    expect(errors(withPuzzle({ onFail: { mode: 'chapter', to: 7 } }))).toMatch(/onFail chapter 7 does not exist/)
    expect(validateBook(withPuzzle({ onFail: { mode: 'chapter', to: 1 } })).errors).toEqual([])
  })

  it('warns about a puzzle no beat plays', () => {
    const { book } = story()
    const b = vnBookSchema.parse({ ...book, puzzles: [entry()] })
    b.chapters[0]!.scenes[1]!.beats.shift()
    expect(validateBook(b).warnings.join(' ')).toMatch(/puzzle "dinner" is not played by any beat/)
  })
})

describe('editions and assets', () => {
  it('syncEdition keeps the words of a puzzle that is still there and drops the rest', () => {
    const book = withPuzzle()
    const ed = editionSchema.parse({
      lang: 'hr',
      title: 'Hladna večera',
      chapterTitles: {},
      choiceTexts: {},
      endings: {},
      characterNames: {},
      beats: {},
      puzzles: { dinner: { names: { s1: 'Ana', zz: 'x' }, text: { c1: 'Ana je bila u dvorani.', c99: 'x' } }, gone: { names: {}, text: {} } }
    })
    const synced = syncEdition(ed, book)
    expect(Object.keys(synced.puzzles!)).toEqual(['dinner'])
    expect(synced.puzzles!.dinner).toEqual({ names: { s1: 'Ana' }, text: { c1: 'Ana je bila u dvorani.' } })
    expect(syncEdition({ ...ed, puzzles: undefined }, book).puzzles).toBeUndefined()
  })

  it('an item linked to an image makes the image asset even when no beat shows it', () => {
    const plain = deriveAssets(story().book, settings()).some((a) => a.id === 'cg_rope')
    expect(plain).toBe(false)
    expect(deriveAssets(withPuzzle({ links: { w1: { type: 'image', key: 'rope' } } }), settings()).some((a) => a.id === 'cg_rope')).toBe(true)
  })
})
