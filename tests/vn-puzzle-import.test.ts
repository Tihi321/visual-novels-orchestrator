import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SDK_PATH, sdkPython } from '../src/engine/renpy/run'
import { alignEdition } from '../src/engine/vn/align'
import { parseBible } from '../src/engine/vn/bible'
import { importBook, parseRawBook } from '../src/engine/vn/import'
import { readBookFolder } from '../src/engine/vn/reader'
import { parseChapterScript } from '../src/engine/vn/script'
import { validateBook } from '../src/engine/vn/story'
import type { PuzzleEntry, PuzzleProof } from '../src/shared/puzzle'
import { book, makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

const fixture = book('mystery-puzzle')
const bible = parseBible(readFileSync(path.join(fixture, 'bible', 'bible.md'), 'utf8'))
const proof = (over: Partial<PuzzleProof> = {}): PuzzleProof => ({ unique: true, deducible: true, solutions: 1, band: 'medium', score: 9, steps: [], rules: {}, ...over })

describe('the puzzle lines of a script', () => {
  const parse = (body: string) => parseChapterScript(body, { chapter: 2, bible })

  it('CLUE and EVIDENCE are narration beats, PUZZLE is a puzzle beat, and where each landed is recorded', () => {
    const r = parse(
      ['SCENE: The kitchen, evening', 'ON SCREEN: Hartley', 'CLUE: dinner/c2: The rope was in the kitchen or the garden.', 'EVIDENCE: pocket_watch: A pocket watch, stopped at nine.', 'PUZZLE: dinner (murdle)', 'HARTLEY: Well.'].join('\n')
    )
    const beats = r.scenes[0]!.beats
    expect(beats.map((b) => b.type)).toEqual(['cast', 'narration', 'narration', 'puzzle', 'line'])
    expect(beats[1]).toMatchObject({ text: 'The rope was in the kitchen or the garden.' })
    expect(beats[3]).toMatchObject({ type: 'puzzle', puzzle: 'dinner' })
    expect(r.puzzleLines.clues).toEqual([{ chapter: 2, puzzle: 'dinner', clue: 'c2', text: 'The rope was in the kitchen or the garden.', beatId: beats[1]!.id }])
    expect(r.puzzleLines.evidence[0]).toMatchObject({ key: 'pocket_watch', imageKey: 'pocket_watch', beatId: beats[2]!.id })
    expect(r.puzzleLines.puzzles).toEqual([{ chapter: 2, key: 'dinner', kind: 'murdle', beatId: beats[3]!.id }])
    expect(r.images).toEqual([{ key: 'pocket_watch', description: 'A pocket watch, stopped at nine.', display: 'insert' }])
    expect(r.uncertain.filter((u) => u.kind === 'speaker')).toEqual([])
  })

  it('a PUZZLE line without a kind, bold keywords, and a speaker that is not called CLUE', () => {
    const r = parse(['SCENE: The kitchen, evening', '**PUZZLE:** dinner', '**CLUE:** dinner/c1: Not the rope.'].join('\n'))
    expect(r.puzzleLines.puzzles[0]).toMatchObject({ key: 'dinner', kind: null })
    expect(r.puzzleLines.clues[0]).toMatchObject({ clue: 'c1', text: 'Not the rope.' })
    expect(r.uncertain.filter((u) => u.kind === 'speaker')).toEqual([])
  })

  it('a malformed puzzle line is not one: it falls through to the speaker rule, as the docs say', () => {
    const r = parse(['SCENE: The kitchen, evening', 'CLUE: no slash here'].join('\n'))
    expect(r.puzzleLines.clues).toEqual([])
    expect(r.scenes[0]!.beats[0]).toMatchObject({ type: 'line', speakerLabel: 'CLUE' })
  })

  it('Croatian keywords: TRAG, DOKAZ, ZAGONETKA, SVJEDOCENJE and KRAJ SVJEDOCENJA', () => {
    const r = parse(
      ['SCENA: Kuhinja, vecer', 'TRAG: dinner/c1: Doktor Birch nije imao uze.', 'DOKAZ: sat: Dzepni sat, stao u devet.', 'SVJEDOČENJE: Mr Halloran', 'MR HALLORAN: Bio sam u vrtu.', 'KRAJ SVJEDOČENJA', 'ZAGONETKA: dinner (murdle)'].join('\n')
    )
    expect(r.puzzleLines.clues[0]).toMatchObject({ puzzle: 'dinner', clue: 'c1' })
    expect(r.puzzleLines.evidence[0]).toMatchObject({ key: 'sat' })
    expect(r.puzzleLines.testimonies[0]!.statements).toHaveLength(1)
    expect(r.puzzleLines.puzzles[0]).toMatchObject({ key: 'dinner' })
  })

  it('a testimony lasts through its speaker lines and ends at END TESTIMONY or at a line that is not a speaker line', () => {
    const r = parse(
      [
        'SCENE: The court, day',
        'TESTIMONY: Mr Halloran',
        'MR HALLORAN (nervous): One.',
        'MR HALLORAN: Two.',
        'END TESTIMONY',
        'MR HALLORAN: Not a statement.',
        'TESTIMONY: Miss Cole',
        'MISS COLE: First.',
        'The room went quiet.',
        'MISS COLE: Not a statement either.'
      ].join('\n')
    )
    expect(r.puzzleLines.testimonies.map((t) => [t.witness, t.statements.map((s) => s.text)])).toEqual([
      ['Mr Halloran', ['One.', 'Two.']],
      ['Miss Cole', ['First.']]
    ])
    // the statements are ordinary speaker lines, with their expressions
    expect(r.scenes[0]!.beats[0]).toMatchObject({ type: 'line', rawExpression: 'nervous' })
  })

  it('a testimony with no statements is a warning', () => {
    expect(parse(['SCENE: The court, day', 'TESTIMONY: Mr Halloran', 'END TESTIMONY', 'HARTLEY: Well.'].join('\n')).warnings.join(' ')).toMatch(/TESTIMONY: Mr Halloran has no speaker line/)
  })
})

describe('a mystery-puzzle book folder', () => {
  const parsed = async () => parseRawBook(await readBookFolder(fixture))

  it('imports with its puzzles: cores from bible/puzzles.md, the story words, where each clue is found, links and pictures', async () => {
    const p = await parsed()
    expect(p.puzzles.map((x) => x.key)).toEqual(['dinner', 'courtroom'])
    const dinner = p.puzzles[0]!
    expect(dinner.kind).toBe('murdle')
    expect(Object.keys(dinner.clueAt ?? {})).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    const chapter2 = p.chapters.find((c) => c.n === 2)!
    const beatOf = (id: string) => chapter2.scenes.flatMap((s) => s.beats).find((b) => b.id === id)
    expect(beatOf(dinner.clueAt!.c3!)).toMatchObject({ type: 'narration', text: dinner.text.c3 })
    expect(dinner.text.c3).toMatch(/Hartley noted/)
    expect(dinner.text.c1).toBe('Doctor Birch did not have the rope.')
    expect(dinner.links).toMatchObject({ s1: { type: 'character', key: 'colonel_ash' }, p1: { type: 'place', key: 'library' } })
    const play = chapter2.scenes.flatMap((s) => s.beats).find((b) => b.type === 'puzzle')!
    expect(play).toMatchObject({ puzzle: 'dinner' })

    const court = p.puzzles[1]!
    expect(court.kind).toBe('testimony')
    expect(court.links).toMatchObject({ wit: { type: 'character', key: 'mr_halloran' }, e1: { type: 'image', key: 'guest_list' }, e4: { type: 'image', key: 'photograph' } })
    expect(Object.keys(court.clueAt ?? {})).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(court.text.t4).toBe('I heard the clock strike twelve, I swear it.')
    expect(court.text.t1).toBe('I heard the clock strike twelve just before the scream.')
    expect(court.text['t2.press']).toMatch(/Now that you ask/)
    expect(p.images.map((i) => i.key).sort()).toEqual(['guest_list', 'photograph', 'weather_report', 'weather_report_2'])
    expect(p.images.every((i) => i.display === 'insert')).toBe(true)
  })

  it('the prose that is not the canonical sentence is flagged with its chapter; the canonical ones are not', async () => {
    const p = await parsed()
    const w = p.warnings.join('\n')
    expect(w).toMatch(/chapter 2: c3 of puzzle "dinner" is in the story's own words/)
    expect(w).toMatch(/chapter 3: t3 of puzzle "courtroom"/)
    expect(w).toMatch(/chapter 3: t4 of puzzle "courtroom"/)
    expect(w).not.toMatch(/c1 of puzzle "dinner"/)
    expect(w).not.toMatch(/t1 of puzzle "courtroom"/)
    expect(p.puzzles.every((x) => x.verified.textChecked === false)).toBe(true)
  })

  it('a book with no puzzle lines or bible/puzzles.md has no puzzles', async () => {
    const r = parseRawBook(await readBookFolder(book('linear-en')))
    expect(r.puzzles).toEqual([])
    expect(r.warnings.join(' ')).not.toMatch(/puzzle/i)
  })

  it('importBook proves the cores (a stub prover here), makes a valid book, and the evidence pictures are in the catalogue', async () => {
    const proved: string[] = []
    const r = await importBook(fixture, {
      prove: async (p: PuzzleEntry) => {
        proved.push(p.key)
        return proof({ score: p.data.difficulty.score })
      }
    })
    expect(proved).toEqual(['dinner', 'courtroom'])
    expect(r.book.puzzles!.map((x) => x.verified)).toEqual([
      { unique: true, deducible: true, score: 37, textChecked: false, by: 'import' },
      { unique: true, deducible: true, score: 24, textChecked: false, by: 'import' }
    ])
    expect(r.book.format).toBe('mystery-puzzle-visual-novel')
    expect(validateBook(r.book).errors).toEqual([])
    expect(r.book.images?.map((i) => i.key)).toContain('guest_list')
    expect(r.book.warnings.join(' ')).not.toMatch(/not proved/)
  })

  it('a core that is not sound is a warning that says so, an unavailable prover leaves a warning too', async () => {
    const bad = await importBook(fixture, { prove: async () => proof({ unique: false, solutions: 2 }) })
    expect(bad.book.warnings.join(' ')).toMatch(/puzzle "dinner": the core in bible\/puzzles.md is not sound \(2 solution/)
    expect(bad.book.puzzles![0]!.verified.unique).toBe(false)
    const none = await importBook(fixture)
    expect(none.book.warnings.join(' ')).toMatch(/2 puzzle\(s\) not proved at import/)
    const boom = await importBook(fixture, {
      prove: async () => {
        throw new Error('no python')
      }
    })
    expect(boom.book.warnings.join(' ')).toMatch(/puzzle "dinner": not proved at import \(no python\)/)
  })
})

describe('what the importer says when the lines and the bible do not agree', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'vno-puzzle-import-'))
    cpSync(fixture, dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const edit = (file: string, f: (s: string) => string) => {
    const p = path.join(dir, file)
    writeFileSync(p, f(readFileSync(p, 'utf8')))
  }
  const warnings = async () => parseRawBook(await readBookFolder(dir)).warnings.join('\n')

  it('a clue that is never found, a clue found after the puzzle, an unknown clue, an unknown puzzle and a second PUZZLE line', async () => {
    edit('chapters/ch-02.md', (s) =>
      s
        .replace(/^CLUE: dinner\/c5: .*$/m, 'CLUE: dinner/c9: A clue the core does not have.')
        .replace('HARTLEY (satisfied): The case is closed. Almost.', 'CLUE: dinner/c1: Found too late.\nPUZZLE: dinner\nPUZZLE: ghost (murdle)')
    )
    const w = await warnings()
    expect(w).toMatch(/CLUE: dinner\/c9 is not a clue of the puzzle/)
    expect(w).toMatch(/puzzle "dinner": clue c5 is never found/)
    expect(w).toMatch(/clue c1 of puzzle "dinner" is found twice/)
    expect(w).toMatch(/puzzle "dinner": 2 PUZZLE: lines/)
    expect(w).toMatch(/PUZZLE: ghost is not in bible\/puzzles.md/)
  })

  it('a clue after the PUZZLE line is named with its chapter', async () => {
    edit('chapters/ch-02.md', (s) => s.replace(/^CLUE: dinner\/c5: .*$/m, '').replace('PUZZLE: dinner (murdle)', 'PUZZLE: dinner (murdle)\nCLUE: dinner/c5: Miss Cole was in the kitchen.'))
    expect(await warnings()).toMatch(/chapter 2: clue c5 of puzzle "dinner" comes after the PUZZLE: line/)
  })

  it('a bad core, a testimony that disagrees with its bible entry, evidence never planted', async () => {
    edit('bible/puzzles.md', (s) => s.replace(/"statement": 5,/, '"statement": 2,').replace('"key": "photograph",', '"key": "photo_missing",'))
    edit('chapters/ch-03.md', (s) => s.replace(/^EVIDENCE: photograph: .*$/m, ''))
    const w = await warnings()
    expect(w).toMatch(/the bible says statement 2 breaks, the core says statement 5/)
    expect(w).toMatch(/evidence photo_missing is never planted/)
    edit('bible/puzzles.md', (s) => s.replace(/"size": 3,/, '"size": 9,'))
    expect(await warnings()).toMatch(/puzzle "dinner": the core in bible\/puzzles.md is not a valid puzzle core/)
  })

  it('a book with puzzle lines but no bible/puzzles.md keeps the beats and says what is missing', async () => {
    rmSync(path.join(dir, 'bible', 'puzzles.md'))
    const w = await warnings()
    expect(w).toMatch(/the script has puzzle lines but bible\/puzzles.md lists no puzzle/)
    const r = parseRawBook(await readBookFolder(dir))
    expect(r.puzzles).toEqual([])
    expect(r.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats)).filter((b) => b.type === 'puzzle')).toHaveLength(2)
  })
})

describe('a translated edition lines up by clue id', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('the clue and statement prose of the translation, the names of its bible/puzzles.md, the rest of the primary words', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'vno-puzzle-align-'))
    cpSync(fixture, dir, { recursive: true })
    for (const f of readdirSync(path.join(dir, 'chapters'))) {
      const p = path.join(dir, 'chapters', f)
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^((?:CLUE|EVIDENCE): [^:]+(?:\/[^:]+)?: .*)$/gm, '$1 (hr)').replace(/^(MR HALLORAN.*: .*)$/gm, '$1 (hr)'))
    }
    const bp = path.join(dir, 'bible', 'puzzles.md')
    writeFileSync(bp, readFileSync(bp, 'utf8').replace('"s1": "Colonel Ash"', '"s1": "Pukovnik Ash"'))
    const primary = (await importBook(fixture)).book
    const { edition, report } = await alignEdition(primary, dir, 'hr')
    expect(edition.puzzles!.dinner!.text.c1).toBe(`${primary.puzzles![0]!.text.c1} (hr)`)
    expect(edition.puzzles!.dinner!.text.c3).toMatch(/\(hr\)$/)
    expect(edition.puzzles!.dinner!.names.s1).toBe('Pukovnik Ash')
    expect(edition.puzzles!.dinner!.names.s2).toBe('Doctor Birch')
    expect(edition.puzzles!.courtroom!.text.t4).toMatch(/\(hr\)$/)
    expect(edition.puzzles!.courtroom!.text['t2.press']).toBe(primary.puzzles![1]!.text['t2.press'])
    expect(report.warnings.join('\n')).toMatch(/puzzle "courtroom": t2.press has no translated text/)
    // the CLUE and EVIDENCE lines are narration beats: they line up like any other
    const beat = primary.puzzles![0]!.clueAt!.c1!
    expect(edition.beats[beat]).toMatch(/\(hr\)$/)
  })
})

describe.skipIf(!sdkPython(process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH))('importing a puzzle book through the service', () => {
  let env: VnEnv
  beforeEach(async () => {
    env = await makeVnEnv({ sdk: undefined })
  })
  afterEach(async () => {
    await env.cleanup()
  })

  it('importProject proves the cores with the real puzzle library and keeps the puzzles in the project', async () => {
    const { slug, preview } = await env.engine.vn.importProject(fixture)
    const saved = await env.engine.vn.store.loadBook(slug)
    expect(saved.puzzles!.map((p) => [p.key, p.verified.unique, p.verified.deducible, p.verified.by])).toEqual([
      ['dinner', true, true, 'import'],
      ['courtroom', true, true, 'import']
    ])
    expect(preview.warnings.join(' ')).not.toMatch(/not proved/)
    expect(preview.warnings.join(' ')).toMatch(/c3 of puzzle "dinner" is in the story's own words/)
    expect(validateBook(saved).errors).toEqual([])
  })
})
