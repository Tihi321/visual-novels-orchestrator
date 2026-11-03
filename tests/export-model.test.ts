import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildExportBook } from '../src/engine/export/model'
import { buildSections, chapterSectionMap, fnv1a32, resolveSectionMap } from '../src/engine/export/sections'
import type { SectionMap } from '../src/engine/export/sections'
import { vnBookSchema } from '../src/shared/vn'
import type { Edition, VnBook } from '../src/shared/vn'

/** HUB-25 / VNO-52: the section numbering and the ExportBook model. Pure data: no project folder, no service. */

type Spec = { to?: number[]; puzzle?: boolean }

/** A choice book: chapter n has the given choices (none: an ending) and one scene with a narration and a line. */
function makeBook(spec: Record<number, Spec>, kind: 'choice' | 'linear' = 'choice'): { book: VnBook; edition: Edition } {
  const beats: Record<string, string> = {}
  const chapters = Object.entries(spec).map(([k, s]) => {
    const n = Number(k)
    const bid = (i: number) => `ch${n}.s1.b${i}`
    beats[bid(1)] = `Narration ${n}.`
    beats[bid(2)] = `Line ${n}.`
    return {
      n,
      title: `Chapter ${n}`,
      choices: (s.to ?? []).map((to) => ({ text: `Go to ${to}`, to })),
      ending: s.to?.length ? null : 'The end.',
      scenes: [
        {
          id: `ch${n}.s1`,
          placeKey: null,
          placeText: 'Somewhere',
          time: null,
          backgroundId: `bg_${n}`,
          description: '',
          breakBefore: false,
          beats: [
            { id: bid(1), type: 'narration', text: `Narration ${n}.` },
            { id: bid(2), type: 'line', speakerKey: 'mara', speakerLabel: 'Mara', expression: 'neutral', text: `Line ${n}.` },
            ...(s.puzzle ? [{ id: bid(3), type: 'puzzle', puzzle: 'p1' }] : [])
          ]
        }
      ]
    }
  })
  const book = vnBookSchema.parse({ slug: 'clockless-god', title: 'T', format: 'x', kind, primaryLang: 'en', style: '', characters: [], places: [], chapters, warnings: [] })
  return { book, edition: { lang: 'en', title: 'T', chapterTitles: {}, choiceTexts: {}, endings: {}, characterNames: {}, beats } }
}

const STORY: Record<number, Spec> = { 1: { to: [2, 3] }, 2: { to: [4, 5] }, 3: { to: [4] }, 4: {}, 5: {} }
const files = (id: string) => (id === 'bg_3' ? null : `/pics/${id}.png`)
const build = (spec: Record<number, Spec>, map: SectionMap, kind: 'choice' | 'linear' = 'choice') => {
  const { book, edition } = makeBook(spec, kind)
  return buildExportBook({ book, edition, lang: 'en', resolveAsset: files, map })
}

describe('shared numbering (HUB-25 golden vector, the same in Scriptorium)', () => {
  it('gives the golden values', () => {
    expect(fnv1a32('golden')).toBe(386248004)
    expect(buildSections(8, 'golden')).toEqual([1, 4, 2, 8, 5, 3, 7, 6])
    expect(buildSections(5, 'clockless-god')).toEqual([1, 4, 3, 2, 5])
  })
})

describe('section map in the book', () => {
  it('starts at 1, is a bijection, links every choice, is deterministic per seed, and in-order keeps chapter order', () => {
    const chapters = [1, 2, 3, 4, 5]
    const a = chapterSectionMap(chapters, 'clockless-god')
    const b = build(STORY, a)
    expect(b.mode).toBe('gamebook')
    expect(b.sections.map((s) => s.no)).toEqual([1, 2, 3, 4, 5]) // in number order
    expect(b.sections.find((s) => s.chapter === 1)!.no).toBe(1)
    const nos = new Set(b.sections.map((s) => s.no))
    for (const s of b.sections) for (const c of s.choices ?? []) expect(nos.has(c.toNo)).toBe(true)
    expect(b.sections.find((s) => s.chapter === 1)!.choices!.map((c) => c.toNo)).toEqual([a.sections['2'], a.sections['3']])
    expect(b.sections.find((s) => s.chapter === 4)!.ending).toBe('The end.')
    expect(Object.values(a.sections).sort()).toEqual([1, 2, 3, 4, 5])
    expect(chapterSectionMap(chapters, 'clockless-god')).toEqual(a)
    expect(chapterSectionMap(chapters, 'another-seed')).not.toEqual(a)
    expect(Object.values(chapterSectionMap(chapters, 'x', 'in-order').sections)).toEqual([1, 2, 3, 4, 5])
  })

  describe('stored map', () => {
    let dir = ''
    beforeEach(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'vno-export-'))
    })
    afterEach(() => rm(dir, { recursive: true, force: true }))

    it('is reused on re-export, reported stale (not renumbered) when the chapters change, and recomputed on renumber', async () => {
      const file = path.join(dir, 'export.json')
      const base = { file, slug: 'clockless-god', chapters: [1, 2, 3, 4, 5] }
      const first = await resolveSectionMap({ ...base, persist: true })
      expect(first).toMatchObject({ reused: false, saved: true, stale: [] })
      const again = await resolveSectionMap({ ...base, persist: true })
      expect(again).toMatchObject({ reused: true, saved: false, map: first.map })

      const grown = await resolveSectionMap({ ...base, chapters: [1, 2, 3, 4, 5, 6], persist: true })
      expect(grown.stale.join(' ')).toContain('chapter(s) 6 are new')
      expect(grown.saved).toBe(false)
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(first.map) // untouched

      const renumbered = await resolveSectionMap({ ...base, chapters: [1, 2, 3, 4, 5, 6], renumber: true, persist: true })
      expect(renumbered).toMatchObject({ stale: [], saved: true })
      expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).sections)).toHaveLength(6)
    })
  })
})

describe('a broken story fails loudly', () => {
  it.each([
    ['a choice to a missing chapter', { 1: { to: [2, 9] }, 2: {}, 3: {} }, /chapter 1, choice 2 \("Go to 9"\) leads to chapter 9, which does not exist/],
    ['an unreachable chapter', { 1: { to: [2] }, 2: {}, 3: {} }, /chapter 3 \("Chapter 3"\) cannot be reached from chapter 1/]
  ] as [string, Record<number, Spec>, RegExp][])('%s', (_name, spec, message) => {
    expect(() => build(spec, chapterSectionMap([1, 2, 3], 's'))).toThrow(message)
  })
})

describe('what a printed book cannot show', () => {
  it('skips a puzzle beat with a warning naming the chapter, and prints a text page when the picture is missing', () => {
    const b = build({ 1: { to: [2, 3] }, 2: { puzzle: true }, 3: {} }, chapterSectionMap([1, 2, 3], 's'))
    expect(b.warnings).toContain('chapter 2: puzzle beat "p1" skipped (a puzzle cannot be printed)')
    const noPicture = b.sections.find((s) => s.chapter === 3)!
    expect(noPicture.picture).toBeUndefined()
    expect(noPicture.paragraphs).toEqual(['Narration 3.', 'Mara: Line 3.'])
    expect(b.warnings.some((w) => w.startsWith('chapter 3:') && w.includes('bg_3'))).toBe(true)
    expect(b.sections.find((s) => s.chapter === 1)!.picture?.file).toBe('/pics/bg_1.png')
    expect(b.warnings.some((w) => w.startsWith('longest section:'))).toBe(true)
  })
})

describe('parallel text (VNO-58)', () => {
  const de = (book: VnBook, edition: Edition): Edition => ({
    lang: 'de',
    title: 'T-DE',
    chapterTitles: {},
    choiceTexts: Object.fromEntries(book.chapters.flatMap((c) => c.choices.map((_, i) => [`${c.n}:${i}`, `Gehe zu ${c.n}.${i}`]))),
    endings: Object.fromEntries(book.chapters.filter((c) => c.ending).map((c) => [c.n, `Ende ${c.n}.`])),
    characterNames: { mara: 'Mara-DE' },
    beats: Object.fromEntries(Object.keys(edition.beats).filter((id) => id !== 'ch2.s1.b1').map((id) => [id, id.endsWith('b1') ? `Erzaehlung ${id}.` : `Zeile ${id.charAt(2)}.`]))
  })

  it('pairs by id, prints a missing line alone with one warning, uses lang2 speaker names, and adds no keys without lang2', () => {
    const { book, edition } = makeBook(STORY)
    const map = chapterSectionMap([1, 2, 3, 4, 5], 's')
    const b = buildExportBook({ book, edition, lang: 'en', edition2: de(book, edition), lang2: 'de', resolveAsset: files, map })
    expect(b.lang2).toBe('de')
    expect(b.sections.find((s) => s.chapter === 2)!.paragraphs2).toEqual([null, 'Mara-DE: Zeile 2.'])
    expect(b.sections.find((s) => s.chapter === 1)!.choices!.map((c) => c.text2)).toEqual(['Gehe zu 1.0', 'Gehe zu 1.1'])
    expect(b.sections.find((s) => s.chapter === 4)!.ending2).toBe('Ende 4.')
    expect(b.pairing!.unpaired).toEqual(['ch2.s1.b1'])
    expect(b.warnings.filter((w) => w.includes('print without translation'))).toEqual(['1 line(s) have no de text and print without translation: ch2.s1.b1'])
    const single = buildExportBook({ book, edition, lang: 'en', resolveAsset: files, map })
    expect(single).not.toHaveProperty('lang2')
    expect(single).not.toHaveProperty('pairing')
    expect(single.sections.some((s) => 'paragraphs2' in s || 'title2' in s || 'ending2' in s)).toBe(false)
  })

  it.each([
    ['en', /must differ/],
    ['ar', /right-to-left/]
  ] as const)('refuses lang2 %s', (lang2, message) => {
    const { book, edition } = makeBook(STORY)
    expect(() => buildExportBook({ book, edition, lang: 'en', edition2: edition, lang2, resolveAsset: files, map: chapterSectionMap([1, 2, 3, 4, 5], 's') })).toThrow(message)
  })
})
