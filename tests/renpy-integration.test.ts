import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPuzzlePoc } from '../scripts/puzzle-poc'
import { buildGame, type BuildGameResult } from '../src/engine/renpy/build'
import { DEFAULT_SDK_PATH, lint, sdkExists } from '../src/engine/renpy/run'
import { buildEdition, importBook } from '../src/engine/vn/import'
import { buildBook, storyInputSchema } from '../src/engine/vn/story'
import { knightsCoreSchema, puzzleCoreSchema, puzzleEntrySchema, testimonyCoreSchema } from '../src/shared/puzzle'
import { hasText } from '../src/shared/vn'
import type { Edition, VnBook } from '../src/shared/vn'
import { loadBook, loadEdition, loadSettings, type FixtureName } from './fixtures/vn/load'

/**
 * Builds the fixtures with placeholders (no ComfyUI) and runs the real Ren'Py lint. Skipped when the SDK is not there.
 * Output goes to `.claude/temp/renpy-it/<name>`.
 */

const sdkPath = process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH
const root = path.resolve(__dirname, '..', '.claude', 'temp', 'renpy-it')
const T = 240_000

async function build(name: FixtureName, dir: string, opts: { hr: boolean; voice?: boolean }): Promise<BuildGameResult> {
  const book = loadBook(name)
  const editions = [loadEdition(name, 'en'), ...(opts.hr ? [loadEdition(name, 'hr')] : [])]
  const clips = path.join(root, `${dir}-clips`)
  if (opts.voice) {
    fs.mkdirSync(clips, { recursive: true })
    for (const lang of ['en', 'hr']) {
      fs.mkdirSync(path.join(clips, lang), { recursive: true })
      for (const id of ['ch01.s01.b002', 'ch01.s01.b003']) fs.writeFileSync(path.join(clips, lang, `${id}.ogg`), '')
    }
  }
  return buildGame({
    projectDir: path.join(root, dir),
    book,
    editions,
    settings: loadSettings(book, { editions: opts.hr ? ['en', 'hr'] : ['en'], voice: { enabled: !!opts.voice, langs: ['en', 'hr'], provider: 'vibetts', engines: {}, voices: {} } }),
    resolveAsset: () => null,
    voice: opts.voice ? { has: (lang, id) => (fs.existsSync(path.join(clips, lang, `${id}.ogg`)) ? path.join(clips, lang, `${id}.ogg`) : null) } : undefined,
    sdkPath
  })
}


/** The choice fixture turned around: Croatian is the primary text, English the translated edition. */
function hrPrimary(): { book: VnBook; hr: Edition; en: Edition } {
  const book = loadBook('choice')
  const hr = loadEdition('choice', 'hr')
  const en = loadEdition('choice', 'en')
  book.primaryLang = 'hr'
  book.title = hr.title
  for (const ch of book.chapters) {
    ch.title = hr.chapterTitles[ch.n] ?? ch.title
    ch.choices.forEach((c, i) => (c.text = hr.choiceTexts[`${ch.n}:${i}`] ?? c.text))
    if (ch.ending) ch.ending = hr.endings[ch.n] ?? ch.ending
    for (const sc of ch.scenes) for (const b of sc.beats) if (hasText(b)) b.text = hr.beats[b.id] ?? b.text
  }
  return { book, hr, en }
}

describe.skipIf(!sdkExists(sdkPath))('Ren\'Py build + real lint', () => {
  it('linear book (EN only) builds with placeholders and lints clean', { timeout: T }, async () => {
    const r = await build('linear', 'linear', { hr: false })
    expect(r.translated).toEqual([])
    expect(r.placeholders.length).toBeGreaterThan(0)
    const game = path.join(r.gameDir, 'game')
    expect(fs.existsSync(path.join(game, 'images', 'bg harbour_wall_dusk.webp'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'images', 'mara worried.webp'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'gui', 'main_menu.png'))).toBe(true)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('linear book with the HR edition: translation stubs are filled and lint stays clean (also a rebuild in place)', { timeout: T }, async () => {
    const r = await build('linear', 'linear', { hr: true })
    expect(r.translated).toEqual(['croatian'])
    const tl = fs.readFileSync(path.join(r.gameDir, 'game', 'tl', 'croatian', 'ch01.rpy'), 'utf8')
    expect(tl).toContain('"More je bilo mirno. {i}Previše{/i} mirno, pomisli Mara."')
    expect(tl).toContain('old "The Harbour"\n    new "Luka"')
    const opts = fs.readFileSync(path.join(r.gameDir, 'game', 'options.rpy'), 'utf8')
    expect(opts).toContain('define vn_languages = [(None, "English"), ("croatian", "Hrvatski")]')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
    expect(l.statistics).toContain('croatian translation')
  })

  it('choice book (2 endings) EN only and with HR lint clean', { timeout: T }, async () => {
    const en = await build('choice', 'choice-en', { hr: false })
    const lEn = await lint(en.gameDir, { sdkPath })
    expect(lEn.messages).toEqual([])
    expect(lEn.statistics).toContain('1 menus')
    const hr = await build('choice', 'choice-hr', { hr: true })
    const lHr = await lint(hr.gameDir, { sdkPath })
    expect(lHr.messages).toEqual([])
    const tl = fs.readFileSync(path.join(hr.gameDir, 'game', 'tl', 'croatian', 'ch01.rpy'), 'utf8')
    expect(tl).toContain('new "Idi Riječnom ulicom"')
    expect(hr.theme).toBe('storybook')
  })

  it('voice off: no voice statements anywhere; voice on: clips are copied and lint is clean', { timeout: T }, async () => {
    const off = await build('linear', 'voice-off', { hr: true })
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    const rpys = walk(path.join(off.gameDir, 'game')).filter((f) => f.endsWith('.rpy') && !/[\\/]tl[\\/]croatian[\\/](common|screens|options)\.rpy$/.test(f))
    for (const f of rpys) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/^\s*voice\s+"/m)
    expect(fs.existsSync(path.join(off.gameDir, 'game', 'voice'))).toBe(false)

    const on = await build('linear', 'voice-on', { hr: true, voice: true })
    expect(fs.existsSync(path.join(on.gameDir, 'game', 'voice', 'en', 'ch01.s01.b002.ogg'))).toBe(true)
    expect(fs.existsSync(path.join(on.gameDir, 'game', 'voice', 'hr', 'ch01.s01.b003.ogg'))).toBe(true)
    const ch = fs.readFileSync(path.join(on.gameDir, 'game', 'ch01.rpy'), 'utf8')
    expect(ch).toContain('voice "voice/en/ch01.s01.b002.ogg"')
    const tl = fs.readFileSync(path.join(on.gameDir, 'game', 'tl', 'croatian', 'ch01.rpy'), 'utf8')
    expect(tl).toContain('voice "voice/hr/ch01.s01.b002.ogg"')
    expect(fs.readFileSync(path.join(on.gameDir, 'game', 'options.rpy'), 'utf8')).toContain('define vn_voice = True')
    const l = await lint(on.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
  })

  it('a ja and an ar edition: a font block for Japanese, the mirrored layout for Arabic, lint clean', { timeout: T }, async () => {
    const book = loadBook('linear')
    const hr = loadEdition('linear', 'hr') // the text stays Croatian: only the language code matters for the build
    const editions: Edition[] = [loadEdition('linear', 'en'), { ...hr, lang: 'ja' }, { ...hr, lang: 'ar' }]
    // a font in the data folder for kana: DejaVuSans from the SDK stands in for a Japanese font
    const fontsDir = path.join(root, 'ja-ar-fonts')
    fs.mkdirSync(fontsDir, { recursive: true })
    fs.copyFileSync(path.join(sdkPath, 'renpy', 'common', 'DejaVuSans.ttf'), path.join(fontsDir, 'kana.ttf'))
    const r = await buildGame({
      projectDir: path.join(root, 'ja-ar'),
      book,
      editions,
      settings: loadSettings(book, { editions: ['en', 'ja', 'ar'] }),
      resolveAsset: () => null,
      sdkPath,
      fontsDir
    })
    expect(r.translated.sort()).toEqual(['arabic', 'japanese'])
    const game = path.join(r.gameDir, 'game')
    expect(fs.existsSync(path.join(game, 'fonts', 'lang', 'kana.ttf'))).toBe(true)
    const fonts = fs.readFileSync(path.join(game, 'vno_fonts.rpy'), 'utf8')
    expect(fonts).toContain('translate japanese python:')
    expect(fonts).toContain('    gui.text_font = "fonts/lang/kana.ttf"')
    expect(fonts).toContain('translate arabic python:')
    expect(fonts).toContain('    gui.text_font = "DejaVuSans.ttf"')
    expect(r.warnings.filter((w) => w.startsWith('no font') || w.startsWith('copied the system font'))).toEqual([])
    const rtl = fs.readFileSync(path.join(game, 'vno_rtl.rpy'), 'utf8')
    expect(rtl).toContain('define config.rtl = True')
    expect(rtl).toContain('translate arabic python:\n    gui.name_xpos = 1560')
    expect(rtl).toContain('translate None python:\n    gui.name_xpos = 360')
    expect(rtl).toContain('translate japanese python:\n    gui.name_xpos = 360')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a Russian book (Cyrillic names, ASCII keys) builds and lints clean', { timeout: T }, async () => {
    const r0 = await importBook(path.join(__dirname, 'fixtures', 'books', 'linear-ru'))
    const edition = buildEdition('ru', r0.book.title, r0.book.chapters, r0.book.characters)
    const r = await buildGame({
      projectDir: path.join(root, 'linear-ru'),
      book: r0.book,
      editions: [edition],
      settings: loadSettings(r0.book, { primaryLang: 'ru', editions: ['ru'] }),
      resolveAsset: () => null,
      sdkPath
    })
    const game = path.join(r.gameDir, 'game')
    const characters = fs.readFileSync(path.join(game, 'characters.rpy'), 'utf8')
    expect(characters).toContain('define natasha = Character(_("Наташа")')
    expect(characters).toContain('define per = Character(_("Пьер")')
    expect(fs.existsSync(path.join(game, 'images', 'natasha neutral.webp'))).toBe(true)
    expect(fs.readFileSync(path.join(game, 'ch01.rpy'), 'utf8')).toContain('natasha "Ты опоздал."')
    expect(fs.readFileSync(path.join(game, 'tl', 'russian', 'ui.rpy'), 'utf8')).toContain('new "Начать"')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a book with a puzzle beat, a clue found earlier and an HR edition with translated clues: the library, the data, the tl strings, lint clean (and a book with no puzzle has none of it)', { timeout: T }, async () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'murdle-medium-1.json'), 'utf8')) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }
    const base = buildBook(
      storyInputSchema.parse({
        title: 'The Cold Dinner',
        characters: [{ name: 'Hartley', looks: 'a tired detective' }],
        places: [{ name: 'Manor', looks: 'a dark dining room' }],
        chapters: [
          { title: 'The Body', choices: [{ text: 'Go on', to: 2 }], scenes: [{ place: 'manor', beats: [{ cast: ['hartley'] }, { speaker: 'Hartley', text: 'The dinner went cold.' }, { text: 'A rope lay on the floor.' }, { puzzle: 'dinner' }, { text: 'It was over.' }] }] },
          { title: 'The Bad End', ending: 'Nobody was caught.', scenes: [{ place: 'manor', beats: [{ text: 'The culprit left.' }] }] }
        ]
      }),
      { slug: 'dinner', lang: 'en' }
    ).book
    const book = { ...base, puzzles: [puzzleEntrySchema.parse({ key: 'dinner', kind: 'murdle', data: puzzleCoreSchema.parse(fixture), names: fixture.names, text: fixture.text, clueAt: { c1: 'ch01.s01.b003' }, onFail: { mode: 'chapter', to: 2, maxTries: 3 }, verified: { unique: true, deducible: true, score: 37, textChecked: true, by: 'test' } })] }
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const hrNames = Object.fromEntries(Object.entries(fixture.names).map(([k, v]) => [k, `${v} (hr)`]))
    const hrText = Object.fromEntries(Object.entries(fixture.text).map(([k, v]) => [k, `${v} Na hrvatskom.`]))
    const hr = { ...en, lang: 'hr', title: 'Hladna večera', chapterTitles: { 1: 'Tijelo', 2: 'Loš kraj' }, choiceTexts: { '1:0': 'Dalje' }, endings: { 2: 'Nitko nije uhvaćen.' }, beats: { 'ch01.s01.b002': 'Večera se ohladila.', 'ch01.s01.b003': 'Uže je ležalo na podu.', 'ch01.s01.b005': 'Bilo je gotovo.', 'ch02.s01.b001': 'Ubojica je otišao.' }, puzzles: { dinner: { names: hrNames, text: hrText } } }
    const r = await buildGame({ projectDir: path.join(root, 'puzzle-book'), book, editions: [en, hr], settings: loadSettings(book, { editions: ['en', 'hr'] }), resolveAsset: () => null, sdkPath })
    const game = path.join(r.gameDir, 'game')
    expect(r.translated).toEqual(['croatian'])
    expect(fs.existsSync(path.join(game, 'python-packages', 'vno_puzzles', 'solver.py'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'vno_puzzle.rpy'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'poc'))).toBe(false)
    expect(fs.existsSync(path.join(game, 'puzzle_poc.rpy'))).toBe(false)
    const ch = fs.readFileSync(path.join(game, 'ch01.rpy'), 'utf8')
    expect(ch).toContain('call vno_puzzle_play("dinner", vno_puzzle_data["dinner"])\n    if not _return:\n        jump ch_02')
    expect(ch).toContain('$ vno_clue_found("dinner", "c1")')
    const data = fs.readFileSync(path.join(game, 'vno_puzzles_data.rpy'), 'utf8')
    expect(data).toContain(`_("${fixture.text.c1}")`)
    const tl = fs.readdirSync(path.join(game, 'tl', 'croatian')).map((f) => fs.readFileSync(path.join(game, 'tl', 'croatian', f), 'utf8')).join('\n')
    expect(tl).toContain(`old "${fixture.text.c1}"\n    new "${hrText.c1}"`)
    expect(tl).toContain(`old "${fixture.names.s1}"\n    new "${hrNames.s1}"`)
    expect(tl).toContain(`old "${fixture.text.murder}"\n    new "${hrText.murder}"`)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
    // a book with no puzzle has neither the library nor the data
    const plain = await build('linear', 'linear-nopuzzle', { hr: false })
    expect(fs.existsSync(path.join(plain.gameDir, 'game', 'python-packages'))).toBe(false)
    expect(fs.existsSync(path.join(plain.gameDir, 'game', 'vno_puzzle.rpy'))).toBe(false)
    expect(fs.existsSync(path.join(plain.gameDir, 'game', 'vno_puzzles_data.rpy'))).toBe(false)
  })

  it('a 4x4 Murdle with a motive and attribute clues, portraits and an object picture in the headers: the images are made, the grid scrolls, lint clean', { timeout: T }, async () => {
    const big = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'murdle-4x4-motive-attrs-2.json'), 'utf8')) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }
    const base = buildBook(
      storyInputSchema.parse({
        title: 'The Big Dinner',
        characters: [{ name: 'Hartley', looks: 'a tired detective' }, { name: 'Varga', looks: 'a quiet inspector' }],
        places: [{ name: 'Manor', looks: 'a dark dining room' }],
        images: [{ key: 'rope', description: 'a coil of rope', display: 'insert' }],
        chapters: [{ title: 'The Body', scenes: [{ place: 'manor', beats: [{ cast: ['hartley'] }, { text: 'The dinner went cold.' }, { puzzle: 'big' }, { text: 'It was over.' }] }] }]
      }),
      { slug: 'big', lang: 'en' }
    ).book
    const book = {
      ...base,
      puzzles: [
        puzzleEntrySchema.parse({
          key: 'big',
          kind: 'murdle',
          data: puzzleCoreSchema.parse(big),
          names: big.names,
          text: big.text,
          links: { s1: { type: 'character', key: 'hartley' }, s2: { type: 'character', key: 'varga' }, w1: { type: 'image', key: 'rope' }, p1: { type: 'place', key: 'manor' } },
          verified: { unique: true, deducible: true, score: 150, textChecked: true, by: 'test' }
        })
      ]
    }
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const r = await buildGame({ projectDir: path.join(root, 'puzzle-big'), book, editions: [en], settings: loadSettings(book, { editions: ['en'] }), resolveAsset: () => null, sdkPath })
    const game = path.join(r.gameDir, 'game')
    const data = fs.readFileSync(path.join(game, 'vno_puzzles_data.rpy'), 'utf8')
    expect(data).toContain('"pics": {"s1": "hartley neutral", "s2": "varga neutral", "w1": "cg rope"}')
    expect(data).toContain('"descr": ')
    expect(fs.existsSync(path.join(game, 'images', 'hartley neutral.webp'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'images', 'varga neutral.webp'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'images', 'cg rope.webp'))).toBe(true)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a Knights and Knaves puzzle with portraits and an HR edition with translated statements: the data, the tl strings, lint clean', { timeout: T }, async () => {
    const kk = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'knights-4-medium-3.json'), 'utf8')) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }
    const base = buildBook(
      storyInputSchema.parse({
        title: 'The Island',
        characters: [{ name: 'Hartley', looks: 'a tired detective' }, { name: 'Varga', looks: 'a quiet inspector' }],
        places: [{ name: 'Beach', looks: 'a white beach' }],
        chapters: [{ title: 'Landing', scenes: [{ place: 'beach', beats: [{ cast: ['hartley'] }, { text: 'Four islanders waited on the sand.' }, { puzzle: 'island' }, { text: 'The boat left.' }] }] }]
      }),
      { slug: 'island', lang: 'en' }
    ).book
    const book = {
      ...base,
      puzzles: [puzzleEntrySchema.parse({ key: 'island', kind: 'knights', data: knightsCoreSchema.parse(kk), names: kk.names, text: kk.text, links: { k1: { type: 'character', key: 'hartley' }, k2: { type: 'character', key: 'varga' } }, verified: { unique: true, deducible: true, score: 5, textChecked: true, by: 'test' } })]
    }
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const hrNames = Object.fromEntries(Object.entries(kk.names).map(([k, v]) => [k, `${v} (hr)`]))
    const hrText = Object.fromEntries(Object.entries(kk.text).map(([k, v]) => [k, `${v} Na hrvatskom.`]))
    const hr = { ...en, lang: 'hr', title: 'Otok', chapterTitles: { 1: 'Slijetanje' }, beats: { 'ch01.s01.b002': 'Cetiri otocanina cekala su na pijesku.', 'ch01.s01.b004': 'Brod je otplovio.' }, puzzles: { island: { names: hrNames, text: hrText } } }
    const r = await buildGame({ projectDir: path.join(root, 'puzzle-knights'), book, editions: [en, hr], settings: loadSettings(book, { editions: ['en', 'hr'] }), resolveAsset: () => null, sdkPath })
    const game = path.join(r.gameDir, 'game')
    const data = fs.readFileSync(path.join(game, 'vno_puzzles_data.rpy'), 'utf8')
    expect(data).toContain('"kind": "knights"')
    expect(data).toContain('"pics": {"k1": "hartley neutral", "k2": "varga neutral"}')
    expect(fs.existsSync(path.join(game, 'images', 'varga neutral.webp'))).toBe(true)
    const tl = fs.readdirSync(path.join(game, 'tl', 'croatian')).map((f) => fs.readFileSync(path.join(game, 'tl', 'croatian', f), 'utf8')).join('\n')
    const q = (t: string) => t.replace(/"/g, '\\"')
    expect(tl).toContain(`old "${q(kk.text.t1!)}"\n    new "${q(hrText.t1!)}"`)
    expect(tl).toContain(`old "${kk.names.k1}"\n    new "${hrNames.k1}"`)
    expect(tl).toContain(`old "${kk.text.intro}"\n    new "${hrText.intro}"`)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a testimony with the witness portrait, an evidence picture and an HR edition: the data, the tl strings, lint clean', { timeout: T }, async () => {
    const tm = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'testimony-medium-4.json'), 'utf8')) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }
    const base = buildBook(
      storyInputSchema.parse({
        title: 'The Trial',
        characters: [{ name: 'Hartley', looks: 'a tired lawyer' }, { name: 'Halloran', looks: 'a nervous witness' }],
        places: [{ name: 'Court', looks: 'a courtroom' }],
        images: [{ key: 'watch', description: 'a stopped pocket watch', display: 'insert' }],
        chapters: [{ title: 'Cross-examination', scenes: [{ place: 'court', beats: [{ cast: ['hartley'] }, { text: 'The witness took the stand.' }, { puzzle: 'court' }, { text: 'Court adjourned.' }] }] }]
      }),
      { slug: 'trial', lang: 'en' }
    ).book
    const book = {
      ...base,
      puzzles: [puzzleEntrySchema.parse({ key: 'court', kind: 'testimony', data: testimonyCoreSchema.parse(tm), names: tm.names, text: tm.text, links: { wit: { type: 'character', key: 'halloran' }, e1: { type: 'image', key: 'watch' } }, clueAt: { e2: 'ch01.s01.b002' }, verified: { unique: true, deducible: true, score: 5, textChecked: true, by: 'test' } })]
    }
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const hrNames = Object.fromEntries(Object.entries(tm.names).map(([k, v]) => [k, `${v} (hr)`]))
    const hrText = Object.fromEntries(Object.entries(tm.text).map(([k, v]) => [k, `${v} Na hrvatskom.`]))
    const hr = { ...en, lang: 'hr', title: 'Sudjenje', chapterTitles: { 1: 'Unakrsno' }, beats: { 'ch01.s01.b002': 'Svjedok je stao pred sud.', 'ch01.s01.b004': 'Sud je odgodjen.' }, puzzles: { court: { names: hrNames, text: hrText } } }
    const r = await buildGame({ projectDir: path.join(root, 'puzzle-testimony'), book, editions: [en, hr], settings: loadSettings(book, { editions: ['en', 'hr'] }), resolveAsset: () => null, sdkPath })
    const game = path.join(r.gameDir, 'game')
    const data = fs.readFileSync(path.join(game, 'vno_puzzles_data.rpy'), 'utf8')
    expect(data).toContain('"kind": "testimony"')
    expect(data).toContain('"pics": {"wit": "halloran neutral", "e1": "cg watch"}')
    expect(data).toMatch(/"at": "ch01.s01.b002"/)
    expect(fs.existsSync(path.join(game, 'images', 'halloran neutral.webp'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'images', 'cg watch.webp'))).toBe(true)
    expect(fs.readFileSync(path.join(game, 'vno_puzzle.rpy'), 'utf8')).toContain('screen vno_testimony(pid, p):')
    const tl = fs.readdirSync(path.join(game, 'tl', 'croatian')).map((f) => fs.readFileSync(path.join(game, 'tl', 'croatian', f), 'utf8')).join('\n')
    const q = (t: string) => t.replace(/"/g, '\\"')
    expect(tl).toContain(`old "${q(tm.text.t1!)}"\n    new "${q(hrText.t1!)}"`)
    expect(tl).toContain(`old "${tm.names.e1}"\n    new "${hrNames.e1}"`)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('the puzzle proof of concept: the library in python-packages, the screens and the PoC story, lint clean', { timeout: T }, async () => {
    const r = await buildPuzzlePoc(path.join(root, 'puzzle-poc'), sdkPath)
    const game = path.join(r.gameDir, 'game')
    expect(fs.existsSync(path.join(game, 'python-packages', 'vno_puzzles', 'solver.py'))).toBe(true)
    expect(fs.readFileSync(path.join(game, 'vno_puzzle.rpy'), 'utf8')).toContain('screen vno_murdle(pid, p):')
    expect(fs.readFileSync(path.join(game, 'script.rpy'), 'utf8')).toContain('jump puzzle_poc')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a character with an alias: the alias Character, its translated name and a lint-clean build', { timeout: T }, async () => {
    const book = buildBook(
      storyInputSchema.parse({
        title: 'The Clock',
        characters: [{ name: 'Kessler', looks: 'a heavy bald man in a dark overcoat', aliases: ['the bald man'] }, { name: 'Roux', looks: 'a clockmaker with spectacles' }],
        places: [{ name: 'Workshop', looks: 'a room full of clocks' }],
        chapters: [
          {
            title: 'Night',
            scenes: [{ place: 'workshop', time: 'night', beats: [{ cast: ['kessler', 'roux'] }, { speaker: 'the bald man', text: 'Where is the key?' }, { speaker: 'Roux', text: 'Mr Kessler, please.' }, { speaker: 'Kessler', text: 'Now you know.' }] }]
          }
        ]
      }),
      { slug: 'clock', lang: 'en' }
    ).book
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const fr = { ...en, lang: 'fr', title: "L'Horloge", chapterTitles: { 1: 'Nuit' }, characterNames: { kessler: 'Kessler', roux: 'Roux', 'kessler#1': "l'homme chauve" }, beats: { 'ch01.s01.b002': 'Où est la clé ?', 'ch01.s01.b003': 'Monsieur Kessler, je vous en prie.', 'ch01.s01.b004': 'Maintenant vous savez.' } }
    const r = await buildGame({ projectDir: path.join(root, 'alias'), book, editions: [en, fr], settings: loadSettings(book, { editions: ['en', 'fr'] }), resolveAsset: () => null, sdkPath })
    const game = path.join(r.gameDir, 'game')
    expect(fs.readFileSync(path.join(game, 'characters.rpy'), 'utf8')).toContain('define kessler__a1 = Character(_("the bald man"), kind=kessler)')
    expect(fs.readFileSync(path.join(game, 'ch01.rpy'), 'utf8')).toContain('kessler__a1 "Where is the key?"')
    expect(fs.readFileSync(path.join(game, 'tl', 'french', 'characters.rpy'), 'utf8')).toContain('old "the bald man"\n    new "l\'homme chauve"')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('a CG, an insert, a sound effect, an ambience and scene music: files copied and a lint-clean build', { timeout: T }, async () => {
    const book = buildBook(
      storyInputSchema.parse({
        title: 'The Ledger',
        characters: [{ name: 'Mara', looks: 'a girl in a red raincoat' }],
        places: [{ name: 'Harbour', looks: 'a stone harbour' }],
        images: [{ key: 'ledger', description: 'an open ledger', display: 'insert' }, { key: 'storm', description: 'a storm over the sea', display: 'full' }],
        sounds: [{ key: 'door', kind: 'sfx', description: 'a door creaks' }, { key: 'rain', kind: 'ambience', description: 'steady rain' }],
        chapters: [
          {
            title: 'Night',
            scenes: [
              { place: 'harbour', time: 'night', ambience: 'rain', beats: [{ cast: ['mara'] }, { speaker: 'Mara', text: 'Look.', image: 'ledger', sfx: 'door' }, { text: 'The storm came.', image: 'storm' }, { text: 'Later.', image: null }] },
              { place: 'harbour', time: 'night', music: null, beats: [{ speaker: 'Mara', text: 'Quiet now.', ambience: null }] }
            ]
          }
        ]
      }),
      { slug: 'ledger', lang: 'en' }
    ).book
    const en = buildEdition('en', book.title, book.chapters, book.characters)
    const tmp = path.join(root, 'media-src')
    fs.mkdirSync(tmp, { recursive: true })
    const files: Record<string, string> = { sfx_door: 'sfx_door.ogg', amb_rain: 'amb_rain.ogg' }
    for (const f of Object.values(files)) fs.writeFileSync(path.join(tmp, f), '')
    const r = await buildGame({ projectDir: path.join(root, 'media'), book, editions: [en], settings: loadSettings(book, { editions: ['en'] }), resolveAsset: (id) => (files[id] ? path.join(tmp, files[id]!) : null), sdkPath })
    const game = path.join(r.gameDir, 'game')
    const ch = fs.readFileSync(path.join(game, 'ch01.rpy'), 'utf8')
    expect(ch).toContain('show cg ledger as vn_cg at vn_insert zorder 50')
    expect(ch).toContain('play sound "audio/sfx_door.ogg"')
    expect(ch).toContain('play ambience "audio/amb_rain.ogg"')
    expect(ch).toContain('stop music fadeout 2.0')
    expect(fs.existsSync(path.join(game, 'audio', 'sfx_door.ogg'))).toBe(true)
    expect(fs.existsSync(path.join(game, 'vno_media.rpy'))).toBe(true)
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })

  it('Croatian primary with an English edition: Croatian UI by default, lint clean', { timeout: T }, async () => {
    const { book, hr, en } = hrPrimary()
    const r = await buildGame({
      projectDir: path.join(root, 'choice-hr-primary'),
      book,
      editions: [hr, en],
      settings: loadSettings(book, { primaryLang: 'hr', editions: ['hr', 'en'] }),
      resolveAsset: () => null,
      sdkPath
    })
    expect(r.translated).toEqual(['english'])
    const game = path.join(r.gameDir, 'game')
    const opts = fs.readFileSync(path.join(game, 'options.rpy'), 'utf8')
    expect(opts).toContain('define vn_languages = [("croatian", "Hrvatski"), ("english", "English")]')
    expect(opts).toContain('define config.default_language = "croatian"')
    expect(fs.readFileSync(path.join(game, 'tl', 'croatian', 'ui.rpy'), 'utf8')).toContain('new "Započni"')
    expect(fs.readFileSync(path.join(game, 'ch01.rpy'), 'utf8')).toContain('petra "Kamo, Mango?"')
    expect(fs.readFileSync(path.join(game, 'tl', 'english', 'ch01.rpy'), 'utf8')).toContain('petra "Which way, Mango?"')
    const l = await lint(r.gameDir, { sdkPath })
    expect(l.messages).toEqual([])
    expect(l.ok).toBe(true)
  })
})
