import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseBible } from '../src/engine/vn/bible'
import { checkBranches } from '../src/engine/vn/branches'
import { importBook } from '../src/engine/vn/import'
import { listBooks, readBookFolder } from '../src/engine/vn/reader'
import { matchCharacter, matchPlace, parseChapterScript, parseSceneLine } from '../src/engine/vn/script'
import { vnBookSchema } from '../src/shared/vn'
import type { VnBeat } from '../src/shared/vn'

const books = join(__dirname, 'fixtures', 'books')
const beatsOf = (b: { chapters: { scenes: { beats: VnBeat[] }[] }[] }) => b.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats))

describe('the soother book', () => {
  it('imports as English with the outline choices and endings', async () => {
    const r = await importBook(join(books, 'soother'))
    expect(vnBookSchema.safeParse(r.book).success).toBe(true)
    expect(r.detected.lang).toBe('en')
    expect(r.book.primaryLang).toBe('en')
    expect(r.book.kind).toBe('choice')
    expect(r.book.format).toBe('kids-choice-visual-story')
    expect(r.book.chapters).toHaveLength(7)
    expect(r.book.chapters.map((c) => c.choices.map((x) => x.to))).toEqual([[2, 3], [4, 5], [4, 5], [6, 7], [], [], []])
    expect(r.book.chapters[0]!.choices[0]!.text).toBe('Follow Mango to the Lost Things Office')
    const endings = r.book.chapters.filter((c) => c.ending !== null)
    expect(endings.map((c) => c.n)).toEqual([5, 6, 7])
    expect(r.book.characters.map((c) => c.key)).toEqual(['petra', 'pip', 'mango', 'grumble', 'nib'])
    expect(r.book.places).toHaveLength(7)
    expect(r.book.characters[0]!.voice).toMatch(/^Bright and quick/)
    expect(r.book.coverBrief).toMatch(/yellow raincoat/)
    expect(r.edition.endings[6]).toMatch(/^happy/)
    expect(Object.keys(r.edition.choiceTexts)).toHaveLength(8)
    expect(r.book.warnings.length).toBeGreaterThan(0)
  })

  it("maps Petra's garden to Petra's House and strips the Narration prefix", async () => {
    const r = await importBook(join(books, 'soother'))
    const first = r.book.chapters[0]!.scenes[0]!
    expect(first.id).toBe('ch01.s01')
    expect(first.placeText).toBe("Petra's garden")
    expect(first.placeKey).toBe('petra_s_house')
    expect(first.time).toBe('morning')
    expect(first.backgroundId).toBe('bg_petra_s_house_morning')
    expect(first.description).toMatch(/^A small cottage with a red door/)
    expect(first.beats[0]).toMatchObject({ id: 'ch01.s01.b001', type: 'narration', text: 'The sun is warm. Flowers nod in the breeze. It should be a nice day.' })
    expect(beatsOf(r.book).some((b) => b.type === 'narration' && /^Narration:/.test(b.text))).toBe(false)
    // props in ON SCREEN are not cast
    const cast = beatsOf(r.book).flatMap((b) => (b.type === 'cast' ? b.cast.map((c) => c.charKey) : []))
    expect(new Set(cast)).toEqual(new Set(['petra', 'pip', 'mango', 'grumble', 'nib']))
    expect(r.book.chapters[0]!.scenes.some((s) => /soother spinning/.test(s.description))).toBe(true)
  })
})

describe('linear fixture', () => {
  it('imports 3 chapters as a linear book', async () => {
    const r = await importBook(join(books, 'linear-en'))
    expect(r.detected.lang).toBe('en')
    expect(r.book.kind).toBe('linear')
    expect(r.book.chapters.map((c) => c.n)).toEqual([1, 2, 3])
    expect(r.book.chapters.map((c) => c.ending)).toEqual([null, null, ''])
    expect(r.book.characters.map((c) => c.key)).toEqual(['mara', 'tomas'])
    expect(r.book.places.map((p) => p.key)).toEqual(['harbour_wall', 'lighthouse_kitchen'])
    expect(r.book.chapters.map((c) => c.scenes.length)).toEqual([2, 1, 2])
    expect(r.book.chapters[0]!.scenes[1]!.breakBefore).toBe(true)
    expect(r.book.chapters[0]!.scenes[0]!.breakBefore).toBe(false)
    expect(r.book.chapters[0]!.scenes[0]!.backgroundId).toBe('bg_harbour_wall_dusk')
    expect(r.book.chapters[2]!.scenes[1]!.time).toBe('dawn')
    expect(r.book.warnings).toEqual([])
    expect(r.uncertain).toEqual([])
    const lines = beatsOf(r.book).filter((b) => b.type === 'line')
    expect(lines[0]).toMatchObject({ speakerKey: 'mara', speakerLabel: 'MARA', expression: 'worried' })
    // no bracket: the speaker keeps the last expression in the scene
    expect(lines.find((b) => b.type === 'line' && b.text.startsWith('The boat was slow'))).toMatchObject({ speakerKey: 'tomas', expression: 'happy' })
    expect(Object.keys(r.edition.beats)).toHaveLength(beatsOf(r.book).filter((b) => b.type !== 'cast').length)
    expect(r.edition.characterNames).toEqual({ mara: 'Mara', tomas: 'Tomas' })
    expect(r.edition.chapterTitles[1]).toBe('The Late Boat')
  })

  it('lets the caller override the language', async () => {
    const r = await importBook(join(books, 'linear-en'), { lang: 'hr' })
    expect(r.detected.lang).toBe('en')
    expect(r.book.primaryLang).toBe('hr')
    expect(r.edition.lang).toBe('hr')
  })

  it('imports the Croatian book as hr', async () => {
    const r = await importBook(join(books, 'linear-hr'))
    expect(r.detected.lang).toBe('hr')
    expect(r.book.primaryLang).toBe('hr')
    expect(r.book.warnings).toEqual([])
    expect(r.book.chapters[0]!.scenes[0]!.time).toBe('dusk')
    expect(r.book.chapters[0]!.scenes[0]!.placeKey).toBe('lukobran')
    expect(r.book.characters.map((c) => c.key)).toEqual(['mara', 'tomo'])
    expect(r.book.characters[1]!.voice).toMatch(/^veseo/)
    const lines = beatsOf(r.book).filter((b) => b.type === 'line')
    expect(lines[0]).toMatchObject({ speakerKey: 'mara', expression: 'worried' })
    expect(lines.some((b) => b.type === 'line' && b.expression === 'angry')).toBe(true)
  })
})

describe('quirks fixture', () => {
  it('handles prefixes, long SCENE lines, props, unknown speakers and a missing SCENE', async () => {
    const r = await importBook(join(books, 'quirks-en'))
    const ch1 = r.book.chapters[0]!
    // text before any SCENE: an implicit scene without a place
    expect(ch1.scenes[0]!.placeText).toBe('')
    expect(ch1.scenes[0]!.backgroundId).toBe('bg_unknown_any')
    expect(ch1.scenes[0]!.beats[0]).toMatchObject({ type: 'narration', text: 'A line of text before any SCENE at the start of the chapter.' })
    expect(r.book.warnings.some((w) => /before any SCENE/.test(w))).toBe(true)
    const garden = ch1.scenes[1]!
    expect(garden.placeKey).toBe('petra_s_house')
    expect(garden.time).toBe('morning')
    expect(garden.description).toMatch(/^A small cottage with a red door\. Baby clothes flap on a clothesline\./)
    expect(garden.description).toMatch(/Also on screen: the soother spinning in the sky\./)
    const castBeat = garden.beats.find((b) => b.type === 'cast')
    expect(castBeat).toMatchObject({ cast: [{ charKey: 'petra_novak', look: 'yellow raincoat, hands over ears' }, { charKey: 'mango', look: 'tiny, orange' }] })
    expect(garden.beats.filter((b) => b.type === 'narration').map((b) => (b.type === 'narration' ? b.text : ''))).toEqual(['The sun is warm.', 'Croatian narrator label also works.'])
    const lines = garden.beats.filter((b) => b.type === 'line')
    expect(lines.map((b) => (b.type === 'line' ? [b.speakerKey, b.expression] : []))).toEqual([
      ['petra_novak', 'angry'],
      ['petra_novak', 'angry'],
      ['mango', 'neutral'],
      [null, 'neutral'],
      ['petra_novak', 'happy'],
      ['petra_novak', 'happy']
    ])
    expect(lines[2]).toMatchObject({ rawExpression: 'singing' })
    expect(lines[1]).toMatchObject({ text: 'Oops. *Really* oops.' })
    // a new scene resets expressions
    const last = ch1.scenes[2]!
    expect(last.breakBefore).toBe(true)
    expect(last.placeKey).toBeNull()
    expect(last.backgroundId).toBe('bg_somewhere_over_the_rainbow_any')
    expect(last.beats.find((b) => b.type === 'line')).toMatchObject({ expression: 'neutral' })
    expect(r.uncertain.some((u) => u.kind === 'speaker' && u.text === 'GROGGLE')).toBe(true)
    expect(r.uncertain.some((u) => u.kind === 'cast' && /soother/.test(u.text))).toBe(true)
    expect(r.uncertain.some((u) => u.kind === 'place' && /rainbow/.test(u.text))).toBe(true)
    expect(r.uncertain.some((u) => u.kind === 'expression' && u.text === 'singing')).toBe(true)
  })

  it('gives a choice chapter without choices and ending text a placeholder ending', async () => {
    const r = await importBook(join(books, 'quirks-en'))
    expect(r.book.kind).toBe('choice')
    expect(r.book.chapters.map((c) => c.ending)).toEqual([null, 'happy', 'The End'])
    expect(r.book.warnings.some((w) => /chapter 3 has no choices and no ending text/.test(w))).toBe(true)
  })
})

describe('script parsing units', () => {
  const bible = parseBible("## Characters\n- **Petra Novak**: kid\n\n## Places\n- **Golden Cave**: a cave\n- **Petra's House**: house\n")
  it('parses SCENE lines', () => {
    expect(parseSceneLine("Petra's garden, morning. A small cottage.")).toEqual({ place: "Petra's garden", time: 'morning', rest: 'A small cottage.' })
    expect(parseSceneLine('Grassy hill, Dragon Land, midday. Green sky.')).toMatchObject({ place: 'Grassy hill, Dragon Land', time: 'day' })
    expect(parseSceneLine('Lukobran, sumrak')).toEqual({ place: 'Lukobran', time: 'dusk', rest: '' })
    expect(parseSceneLine('Kuhinja, večer')).toMatchObject({ time: 'evening' })
    expect(parseSceneLine('The cave, warm golden light')).toMatchObject({ place: 'The cave, warm golden light', time: null })
  })
  it('matches names and places', () => {
    expect(matchCharacter('PETRA', bible.characters)).toBe('petra_novak')
    expect(matchCharacter('Petra Novak', bible.characters)).toBe('petra_novak')
    expect(matchCharacter('NOVAK', bible.characters)).toBe('petra_novak')
    expect(matchCharacter('Mango', bible.characters)).toBeNull()
    expect(matchPlace('Inside the Golden Cave', bible.places)).toBe('golden_cave')
    expect(matchPlace("Petra's garden", bible.places)).toBe('petra_s_house')
    expect(matchPlace('Somewhere else', bible.places)).toBeNull()
  })
  it('accepts markdown headings as scenes, breaks, bold labels and uppercase narration', () => {
    const p = parseChapterScript('## The Golden Cave, night\n**PETRA** (worried): Hi.\n***\nNARRATION: Quiet.\nNARRATOR (soft): Still quiet.\n', { chapter: 2, bible })
    expect(p.scenes).toHaveLength(2)
    expect(p.scenes[0]!.beats[0]).toMatchObject({ type: 'line', speakerKey: 'petra_novak', expression: 'worried', text: 'Hi.' })
    expect(p.scenes[1]!.breakBefore).toBe(true)
    expect(p.scenes[1]!.placeKey).toBe('golden_cave')
    expect(p.scenes[1]!.beats.map((b) => b.type)).toEqual(['narration', 'narration'])
  })
})

describe('bible', () => {
  it('reads English and Croatian headings', () => {
    const en = parseBible('## Setting\nA town.\n\n## Characters\n- **Mara**: red scarf. Voice: dry jokes.\n\n## Places\n- **Pier**: stone.\n\n## Style\nMoody.')
    expect(en.characters).toEqual([{ key: 'mara', name: 'Mara', looks: 'red scarf.', voice: 'dry jokes.' }])
    expect(en.places).toEqual([{ key: 'pier', name: 'Pier', looks: 'stone.' }])
    expect(en.style).toBe('Moody.')
    expect(en.setting).toBe('A town.')
    const hr = parseBible('## Okruženje\nGradić.\n\n## Likovi\n- **Šime**: crna kosa. Glas: tih.\n\n## Mjesta\n- **Luka**: kamen.\n\n## Stil\nSumorno.')
    expect(hr.characters).toEqual([{ key: 'sime', name: 'Šime', looks: 'crna kosa.', voice: 'tih.' }])
    expect(hr.places[0]!.key).toBe('luka')
    expect(hr.style).toBe('Sumorno.')
    expect(hr.setting).toBe('Gradić.')
  })
})

describe('checkBranches', () => {
  const ch = (n: number, to: number[], ending?: string) => ({
    n,
    title: `C${n}`,
    summary: '',
    ...(to.length ? { choices: to.map((t) => ({ text: `go ${t}`, to: t })) } : {}),
    ...(ending ? { ending } : {})
  })
  it('accepts a good map', () => {
    const r = checkBranches([ch(1, [2, 3]), ch(2, [], 'a'), ch(3, [], 'b')])
    expect(r.warnings).toEqual([])
    expect(r.chapters[1]!.ending).toBe('a')
  })
  it('warns instead of throwing', () => {
    const r = checkBranches([ch(1, [2, 1, 9]), ch(2, []), ch(3, [])])
    expect(r.warnings.some((w) => /leads back/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /no chapter 9/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /no choice leads to chapter\(s\) 3/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /two or more choices/.test(w))).toBe(true)
  })
})

describe('reader', () => {
  let dir = ''
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('lists VN and prose choice books of a Scriptorium data folder', async () => {
    dir = await mkdtemp(join(tmpdir(), 'vno-books-'))
    await cp(join(books, 'soother'), join(dir, 'books', 'soother'), { recursive: true })
    await cp(join(books, 'linear-en'), join(dir, 'books', 'linear'), { recursive: true })
    await mkdir(join(dir, 'books', 'novel'), { recursive: true })
    await writeFile(join(dir, 'books', 'novel', 'book.md'), '---\ntitle: A Novel\nformat: novel\nscript: false\n---\n')
    await mkdir(join(dir, 'books', 'gb'), { recursive: true })
    await writeFile(join(dir, 'books', 'gb', 'book.md'), '---\ntitle: A Gamebook\nformat: gamebook\nstage: draft\n---\n')
    const list = await listBooks(dir)
    expect(list.map((b) => b.slug)).toEqual(['gb', 'lighthouse-letters', 'the-soother-that-fell-into-dragon-land'])
    const soother = list.find((b) => b.slug.startsWith('the-soother'))!
    expect(soother).toMatchObject({ title: 'The Soother That Fell Into Dragon Land', format: 'kids-choice-visual-story', script: true, stage: 'published', hasChoices: true })
    expect(list.find((b) => b.slug === 'gb')).toMatchObject({ hasChoices: true, stage: 'draft' })
    expect(await listBooks(join(dir, 'nothing'))).toEqual([])
  })

  it('reads a bare folder', async () => {
    const raw = await readBookFolder(join(books, 'linear-hr'))
    expect(raw.chapters.map((c) => c.n)).toEqual([1, 2, 3])
    expect(raw.chapters[0]!.title).toBe('Zakašnjela lađa')
    expect(raw.bible).toMatch(/## Likovi/)
    expect(raw.book.title).toBe('Pisma sa svjetionika')
  })
})
