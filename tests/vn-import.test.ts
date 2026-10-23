import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseBible } from '../src/engine/vn/bible'
import { checkBranches } from '../src/engine/vn/branches'
import { importBook } from '../src/engine/vn/import'
import { listBooks, readBookFolder } from '../src/engine/vn/reader'
import { projectSlug } from '../src/engine/vn/project'
import { classifyOnScreen, matchCharacter, matchPlace, parseChapterScript, parseSceneLine } from '../src/engine/vn/script'
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

  it('VNO-35: a title the person fixed in brief.md (such as one ending in "(VN)") is the title; without title_fixed the book.md title stays', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vno-title-'))
    try {
      const make = async (name: string, brief: string | null) => {
        await cp(join(books, 'linear-en'), join(root, 'books', name), { recursive: true })
        const md = join(root, 'books', name, 'book.md')
        await writeFile(md, (await readFile(md, 'utf8')).replace(/^title: .*$/m, 'title: The Lighthouse That Kept Lists'))
        if (brief !== null) await writeFile(join(root, 'books', name, 'brief.md'), brief)
      }
      await make('fixed', '---\nkind: brief\ntitle: The Lighthouse That Kept Lists (VN)\ntitle_fixed: true\n---\n')
      await make('free', '---\nkind: brief\ntitle: Something Else\ntitle_fixed: false\n---\n')
      await make('nobrief', null)
      for (const [name, title] of [['fixed', 'The Lighthouse That Kept Lists (VN)'], ['free', 'The Lighthouse That Kept Lists'], ['nobrief', 'The Lighthouse That Kept Lists']] as const) {
        expect((await readBookFolder(join(root, 'books', name))).book.title).toBe(title)
        expect((await listBooks(root)).find((b) => b.path.endsWith(name))!.title).toBe(title)
      }
      expect((await importBook(join(root, 'books', 'fixed'))).book.title).toBe('The Lighthouse That Kept Lists (VN)')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads a bare folder', async () => {
    const raw = await readBookFolder(join(books, 'linear-hr'))
    expect(raw.chapters.map((c) => c.n)).toEqual([1, 2, 3])
    expect(raw.chapters[0]!.title).toBe('Zakašnjela lađa')
    expect(raw.bible).toMatch(/## Likovi/)
    expect(raw.book.title).toBe('Pisma sa svjetionika')
  })
})

describe('a Russian book (V4)', () => {
  it('imports with every speaker matched, transliterated keys and an ASCII project slug', async () => {
    const r = await importBook(join(books, 'linear-ru'))
    expect(vnBookSchema.safeParse(r.book).success).toBe(true)
    expect(r.detected.lang).toBe('ru')
    expect(r.book.characters.map((c) => c.key)).toEqual(['natasha', 'per'])
    expect(r.book.places.map((p) => p.key)).toEqual(['prichal', 'kukhnya_mayaka'])
    // every speaker and cast entry matches the bible, and so does every place
    expect(r.uncertain.filter((u) => u.kind === 'speaker' || u.kind === 'cast' || u.kind === 'place')).toEqual([])
    const lines = beatsOf(r.book).filter((b) => b.type === 'line')
    expect(lines.length).toBeGreaterThan(5)
    expect(lines.every((b) => b.type === 'line' && (b.speakerKey === 'natasha' || b.speakerKey === 'per'))).toBe(true)
    expect(r.book.chapters[0]!.scenes.map((s) => s.placeKey)).toEqual(['prichal', 'kukhnya_mayaka'])
    // the asset ids that follow are ASCII (Ren'Py identifiers)
    expect(r.book.chapters.flatMap((c) => c.scenes.map((s) => s.backgroundId)).every((id) => /^[a-z0-9_]+$/.test(id))).toBe(true)
    expect(r.book.slug).toBe('Маяк писем')
    expect(projectSlug(r.book.slug)).toBe('mayak-pisem')
  })
})

describe('ON SCREEN props and loose names (V7)', () => {
  it('a ledger or a list of names is narration, not a cast; a real list casts its people and flags the rest', async () => {
    const r = await importBook(join(books, 'quirks-cast-en'))
    const scene = r.book.chapters[0]!.scenes[0]!
    const narration = scene.beats.filter((b) => b.type === 'narration').map((b) => (b.type === 'narration' ? b.text : ''))
    expect(narration).toEqual(['A cramped room full of clocks.', 'The ledger page, headed DÉBITEURS: Delorme, Marc / Roux, Anselme, horloger', 'Lassalle, Gérard, notaire. Mars. Remis.'])
    expect(scene.description).toContain('Also on screen: The ledger page')
    const casts = scene.beats.filter((b) => b.type === 'cast')
    expect(casts).toHaveLength(2)
    expect(casts[0]).toMatchObject({ cast: [{ charKey: 'dec', look: 'grey coat' }, { charKey: 'ines', look: 'red scarf' }] })
    // Roux and Lassalle are not cast: they are only named inside a prop
    expect(JSON.stringify(casts)).not.toMatch(/roux|lassalle/)
    const unknown = r.uncertain.filter((u) => u.kind === 'cast').map((u) => u.text)
    expect(unknown).toEqual(['the silver-haired man (grey suit)', 'Madame Ferré (black shawl)'])
  })

  it('matches names ignoring articles and titles, and an alias exactly', () => {
    const bible = parseBible('## Characters\n- **Madame Jobin**: An old woman in a black shawl.\n- **The Baron**: A tall man.\n- **Mr Brown**: Round.\n- **Petra Novak**: A girl. Narration calls her "the girl in yellow".\n')
    const c = bible.characters
    expect(matchCharacter('Madame Ferré', c)).toBeNull()
    expect(matchCharacter('Madame Jobin', c)).toBe('madame_jobin')
    expect(matchCharacter('JOBIN', c)).toBe('madame_jobin')
    expect(matchCharacter('the silver-haired man', c)).toBeNull()
    expect(matchCharacter('Mr Smith', c)).toBeNull()
    expect(matchCharacter('the baron', c)).toBe('the_baron')
    expect(matchCharacter('The girl in yellow', c)).toBe('petra_novak')
    // the overlap rule is for speaker labels only
    expect(matchCharacter('NOVAK', c)).toBe('petra_novak')
    expect(matchCharacter('Novak the elder', c, { entry: true })).toBeNull()
  })

  const bible = parseBible('## Characters\n- **Aldric Vane**: A tall man.\n- **Mara**: A girl.\n- **Tomas**: A boy.\n- **Ivo**: A man.\n\n## Places\n- **Hall**: A hall.\n')
  const castOf = (p: ReturnType<typeof parseChapterScript>) => p.scenes[0]!.beats.find((b) => b.type === 'cast')
  const script = (extra: string) => parseChapterScript(`SCENE: The hall, night\nA quiet hall.\n${extra}\n`, { chapter: 1, bible })

  it('a character put on screen by a loose match, who neither speaks nor is named, is taken off and flagged', () => {
    const p = script('ON SCREEN: Aldric the Younger (cloak), Mara (coat)\nMARA: Hello.')
    expect(castOf(p)).toMatchObject({ type: 'cast', cast: [{ charKey: 'mara' }] })
    expect(p.uncertain).toEqual([expect.objectContaining({ kind: 'cast', text: 'Aldric the Younger (cloak)', reason: 'named only: on screen?', charKey: 'aldric_vane' })])
  })
  it('it stays when the character speaks, or when the narration names it', () => {
    const speaks = script('ON SCREEN: Aldric the Younger (cloak)\nALDRIC: Good evening.')
    expect(castOf(speaks)).toMatchObject({ cast: [{ charKey: 'aldric_vane' }] })
    expect(speaks.uncertain).toEqual([])
    const named = script('ON SCREEN: Aldric the Younger (cloak)\nAldric lifts the lamp.')
    expect(castOf(named)).toMatchObject({ cast: [{ charKey: 'aldric_vane' }] })
    expect(named.uncertain).toEqual([])
  })
  it('an exact name needs no second look, and a cast of more than 3 is flagged', () => {
    const exact = script('ON SCREEN: Mara, Tomas')
    expect(castOf(exact)).toMatchObject({ cast: [{ charKey: 'mara' }, { charKey: 'tomas' }] })
    expect(exact.uncertain).toEqual([])
    const four = script('ON SCREEN: Mara, Tomas, Ivo, Aldric Vane')
    expect(castOf(four)).toMatchObject({ cast: [{ charKey: 'mara' }, { charKey: 'tomas' }, { charKey: 'ivo' }, { charKey: 'aldric_vane' }] })
    expect(four.uncertain).toEqual([expect.objectContaining({ kind: 'cast', text: 'Aldric Vane', reason: 'more than 3 on screen', charKey: 'aldric_vane' })])
  })
  it('an ON SCREEN line that starts with an article is a prop unless its first entry is a character', () => {
    expect(classifyOnScreen('The ledger page, open', bible)).toBe('prop')
    expect(classifyOnScreen('A sign: CLOSED', bible)).toBe('prop')
    expect(classifyOnScreen('Mara (coat), Tomas', bible)).toBe('cast')
    expect(classifyOnScreen('Mara (worried: really), the lamp', bible)).toBe('cast')
    expect(classifyOnScreen('Mara, A very long entry that goes on and on forever', bible)).toBe('prop')
  })
})

describe('the Aliases sentence of a bible entry', () => {
  it('fills aliases and is taken out of the looks (and out of the sheet and sprite prompts)', () => {
    const bible = parseBible('## Characters\n- **Kessler**: A bald man in a grey coat, scarred hands. Aliases: the bald man, Brother Kessler. Voice: low and slow\n- **Mara**: A girl with red braids.\n- **Ivo**: Tall, tired. Nadimci: Stari, Brko.\n\n## Places\n- **Hall**: A hall.\n')
    const k = bible.characters.find((c) => c.name === 'Kessler')!
    expect(k.aliases).toEqual(['the bald man', 'Brother Kessler'])
    expect(k.looks).toBe('A bald man in a grey coat, scarred hands.')
    expect(k.voice).toBe('low and slow')
    expect(bible.characters.find((c) => c.name === 'Mara')!.looks).toBe('A girl with red braids.')
    const ivo = bible.characters.find((c) => c.name === 'Ivo')!
    expect(ivo.aliases).toEqual(['Stari', 'Brko'])
    expect(ivo.looks).toBe('Tall, tired.')
    expect(bible.characters.every((c) => !/aliases|nadimci/i.test(c.looks))).toBe(true)
  })
})

describe('media cue lines', () => {
  const bible = parseBible('## Characters\n- **Mara**: A girl.\n\n## Places\n- **Hall**: A hall.\n')
  const parse = (body: string) => parseChapterScript(`SCENE: The hall, night\nA quiet hall.\n${body}\n`, { chapter: 1, bible })

  it('CG, INSERT, SFX and AMBIENCE lines become catalogue entries and cues on the next beat, not speakers', () => {
    const p = parse('CG: The ledger page lies open on the desk\nAMBIENCE: Steady rain on the roof\nMARA (worried): What is this?\nSFX: A door creaks\nINSERT: A torn letter\nShe reads.')
    expect(p.images).toEqual([
      { key: 'ledger_page_lies_open', description: 'The ledger page lies open on the desk', display: 'full' },
      { key: 'torn_letter', description: 'A torn letter', display: 'insert' }
    ])
    expect(p.sounds).toEqual([
      { key: 'steady_rain_roof', kind: 'ambience', description: 'Steady rain on the roof' },
      { key: 'door_creaks', kind: 'sfx', description: 'A door creaks' }
    ])
    const beats = p.scenes[0]!.beats
    expect(beats.map((b) => b.type)).toEqual(['narration', 'line', 'narration'])
    expect(beats[1]).toMatchObject({ speakerKey: 'mara', image: 'ledger_page_lies_open', ambience: 'steady_rain_roof' })
    expect(beats[2]).toMatchObject({ text: 'She reads.', image: 'torn_letter', sfx: 'door_creaks' })
    expect(beats.some((b) => b.type === 'line' && /^(CG|SFX|INSERT|AMBIENCE)$/i.test(b.speakerLabel))).toBe(false)
    expect(p.warnings).toEqual([])
  })

  it('a CG gets the characters whose name or alias is in its cue text (at most 3, in order); none when nobody is named; an insert never does', () => {
    const b = parseBible('## Characters\n- **Mara**: A girl. Aliases: the red cloak. Voice: soft\n- **Tomas**: A man.\n- **Dr Vey**: A doctor.\n- **Ana**: A cook.\n\n## Places\n- **Hall**: A hall.\n')
    const p = parseChapterScript('SCENE: The hall, night\nA quiet hall.\nCG: Tomas and the red cloak stand by Dr. Vey and Ana\nMARA: One.\nINSERT: A torn letter signed Ana\nMARA: Two.\nCG: Marathon runners in the street\nMARA: Three.\n', { chapter: 1, bible: b })
    const key = (name: string) => b.characters.find((c) => c.name === name)!.key
    expect(p.images).toHaveLength(3)
    expect(p.images[0]!.characters).toEqual([key('Tomas'), key('Mara'), key('Dr Vey')])
    expect(p.images[1]).toMatchObject({ display: 'insert' })
    expect(p.images[1]).not.toHaveProperty('characters')
    expect(p.images[2]).not.toHaveProperty('characters')
  })

  it('VNO-32: a name in a possessive that names a place or thing, or in a heading on a document, does not put the character in the CG', () => {
    const b = parseBible('## Characters\n- **Mara**: A girl.\n- **Ivka**: A woman.\n- **Dino**: A man.\n\n## Places\n- **Hall**: A hall.\n')
    const chars = (text: string) => parseChapterScript('SCENE: The hall, night\nA quiet hall.\nCG: ' + text + '\nMARA: One.\n', { chapter: 1, bible: b }).images[0]!.characters ?? []
    const key = (name: string) => b.characters.find((c) => c.name === name)!.key
    expect(chars("Mara and Dino in a dark alley looking up at a lit window behind Ivka's shop")).toEqual([key('Mara'), key('Dino')])
    expect(chars('Dino filling Mara’s doorway')).toEqual([key('Dino')])
    expect(chars("Mara holds Ivka's hand in the doorway")).toEqual([key('Mara'), key('Ivka')])
    expect(chars('Mara reading a sheet headed FOR IVKA. ONE APOLOGY, IN PARTS.')).toEqual([key('Mara')])
    expect(chars('Dino holds a sheet signed IVKA')).toEqual([key('Dino')])
    expect(chars('Mara reads the card that says "For Dino" aloud')).toEqual([key('Mara')])
    expect(chars("Ivka at Ivka's shop")).toEqual([key('Ivka')])
  })

  it('VNO-32: an INSERT never gets characters from its text', () => {
    const b = parseBible('## Characters\n- **Mara**: A girl.\n- **Ivka**: A woman.\n\n## Places\n- **Hall**: A hall.\n')
    const p = parseChapterScript('SCENE: The hall, night\nA quiet hall.\nINSERT: a teleprinter sheet headed FOR IVKA, signed Mara\nMARA: One.\n', { chapter: 1, bible: b })
    expect(p.images).toEqual([{ key: expect.any(String), description: expect.any(String), display: 'insert' }])
  })

  it('CG: none, END CG and AMBIENCE: none clear; Croatian lines work; a reused description keeps one entry', () => {
    const p = parse('CG: A torn letter\nMARA: One.\nCG: none\nAMBIENCE: none\nMARA: Two.\nSLIKA: A torn letter\nZVUK: Zvono zvoni\nMARA: Three.\nEND CG\nMARA: Four.')
    const lines = p.scenes[0]!.beats.filter((b) => b.type === 'line')
    expect(lines[0]).toMatchObject({ image: 'torn_letter' })
    expect(lines[1]).toMatchObject({ image: null, ambience: null })
    expect(lines[2]).toMatchObject({ image: 'torn_letter', sfx: 'zvono_zvoni' })
    expect(lines[3]).toMatchObject({ image: null })
    expect(p.images).toHaveLength(1)
    expect(p.sounds).toEqual([{ key: 'zvono_zvoni', kind: 'sfx', description: 'Zvono zvoni' }])
  })

  it('a CG or ambience with no beat after it in its scene is dropped with a warning', () => {
    const p = parse('MARA: Hello.\nCG: A torn letter\nAMBIENCE: Wind')
    expect(p.scenes[0]!.beats.every((b) => !('image' in b) && !('ambience' in b))).toBe(true)
    expect(p.warnings).toEqual([expect.stringMatching(/a CG and AMBIENCE line .* has no beat after it in its scene: dropped/)])
  })

  it('VNO-33: a trailing SFX goes on the last beat of its scene, so its sound has a cue; when that beat has a sound already it is dropped with a warning', () => {
    const p = parse('MARA: Hello.\nSFX: A door creaks\n---\nSCENE: The yard, day\nMARA: Bye.\nSFX: Rain\n')
    expect(p.scenes[0]!.beats.at(-1)).toMatchObject({ sfx: 'door_creaks' })
    expect(p.scenes[1]!.beats.at(-1)).toMatchObject({ sfx: 'rain' })
    expect(p.warnings).toEqual([])
    const q = parse('SFX: A bell\nMARA: Hello.\nSFX: A door creaks')
    expect(q.scenes[0]!.beats.at(-1)).toMatchObject({ sfx: 'bell' })
    expect(q.warnings).toEqual([expect.stringMatching(/a SFX line .* has no beat after it in its scene: dropped/)])
  })
})
