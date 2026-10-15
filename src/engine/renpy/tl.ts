import fs from 'node:fs'
import path from 'node:path'
import type { Edition, Lang, VnBook } from '../../shared/vn'
import { translatableStrings, voicePath, type LineMapEntry, type VoiceSource } from './emit'
import { renpyString, renpyText } from './escape'
import { runRenpy } from './run'

/**
 * Translated editions. The primary language is the Ren'Py source; every other edition gets `tl/<language>/`:
 * Ren'Py's `translate` command writes the stubs, then every stub is filled in place:
 *
 *  - say stubs (`# game/ch01.rpy:14` + `translate croatian ch_01_xxxx:`) are mapped to a beat id through the line map
 *    recorded at emit time (file:line -> beat id; the original statement text is the fallback) and get the edition's
 *    text (escaped the same way as the source);
 *  - `translate <language> strings:` blocks (chapter titles, menu choices, endings, character names, the book title and
 *    the UI strings of the template) get `new` from the edition or from the built-in UI table.
 *
 * Text the edition does not have stays in the source language and is reported in `missing`. Nothing is machine translated.
 */

export const RENPY_LANG: Record<Lang, string> = { en: 'english', hr: 'croatian' }
/** The names shown in the language picker (always in their own language). */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hr: 'Hrvatski' }

/**
 * The template's UI strings (the source is English). Keys are the strings as they appear in the Ren'Py source
 * (the `old` of a stub). Only Croatian is needed today: English is the template's own language.
 */
export const UI_STRINGS: Partial<Record<Lang, Record<string, string>>> = {
  hr: {
    Language: 'Jezik',
    'The End': 'Kraj',
    'Start again': 'Počni ispočetka',
    'Back to main menu': 'Natrag na glavni izbornik',
    Start: 'Započni',
    Load: 'Učitaj',
    Save: 'Spremi',
    Preferences: 'Postavke',
    Prefs: 'Postavke',
    About: 'O igri',
    Help: 'Pomoć',
    Quit: 'Izlaz',
    History: 'Povijest',
    Skip: 'Preskoči',
    Skipping: 'Preskakanje',
    Auto: 'Automatski',
    'Q.Save': 'Br.spremi',
    'Q.Load': 'Br.učitaj',
    Return: 'Povratak',
    Back: 'Natrag',
    Menu: 'Izbornik',
    'Main Menu': 'Glavni izbornik',
    Window: 'Prozor',
    Fullscreen: 'Cijeli zaslon',
    Display: 'Prikaz',
    'Unseen Text': 'Neviđeni tekst',
    'After Choices': 'Nakon izbora',
    Transitions: 'Prijelazi',
    'Text Speed': 'Brzina teksta',
    'Auto-Forward Time': 'Vrijeme automatskog prelaska',
    'Music Volume': 'Glasnoća glazbe',
    'Sound Volume': 'Glasnoća zvukova',
    'Voice Volume': 'Glasnoća glasa',
    'Mute All': 'Utišaj sve',
    Yes: 'Da',
    No: 'Ne',
    'empty slot': 'prazno mjesto',
    'Automatic saves': 'Automatska spremanja',
    'Quick saves': 'Brza spremanja',
    'Page {}': 'Stranica {}',
    'The dialogue history is empty.': 'Povijest dijaloga je prazna.',
    'Are you sure?': 'Jeste li sigurni?',
    'Are you sure you want to quit?': 'Jeste li sigurni da želite izaći?',
    'Are you sure you want to delete this save?': 'Jeste li sigurni da želite izbrisati ovo spremanje?',
    'Are you sure you want to overwrite your save?': 'Jeste li sigurni da želite prepisati svoje spremanje?',
    'Loading will lose unsaved progress.\\nAre you sure you want to do this?': 'Učitavanje će izgubiti nespremljeni napredak.\\nJeste li sigurni da to želite?',
    'Are you sure you want to return to the main menu?\\nThis will lose unsaved progress.':
      'Jeste li sigurni da se želite vratiti u glavni izbornik?\\nNespremljeni napredak će se izgubiti.',
    'Are you sure you want to begin skipping?': 'Jeste li sigurni da želite početi preskakati?',
    'Are you sure you want to skip to the next choice?': 'Jeste li sigurni da želite preskočiti do sljedećeg izbora?'
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pure filling logic (tested on synthetic stubs).
// ---------------------------------------------------------------------------------------------------------------

export interface FillContext {
  language: string
  lang: Lang
  /** `ch01.rpy:14` -> beat id. */
  lineMap: Map<string, string>
  /** The emitted say statement -> beat id, for stubs whose line is not in the map (only unique statements). */
  byStatement: Map<string, string>
  /** The edition's text of a beat (raw, with markdown emphasis), if it has one. */
  beatText: (beatId: string) => string | undefined
  /** Voice clips (only when the book has voice on). */
  voice?: VoiceSource
  /** `old` literal -> `new` literal for the `strings:` blocks. */
  strings: Map<string, string>
}

export interface FillReport {
  /** Beat ids the edition has no text for (the source text stays). */
  missingBeats: string[]
  /** Stubs that could not be mapped to a beat. */
  unmatched: string[]
  /** `old` strings that were filled. */
  stringsFilled: string[]
  /** `old` strings that stayed in the source language. */
  stringsKept: string[]
  /** Number of say stubs filled. */
  saysFilled: number
}

export const newReport = (): FillReport => ({ missingBeats: [], unmatched: [], stringsFilled: [], stringsKept: [], saysFilled: 0 })

const STUB_HEAD = /^# game\/([^:]+):(\d+)\s*$/
const TRANSLATE_LINE = /^translate (\S+) (\S+):\s*$/

/** The literal from the first to the last double quote of a statement line. */
function splitStatement(line: string): { prefix: string; suffix: string } | null {
  const first = line.indexOf('"')
  const last = line.lastIndexOf('"')
  if (first < 0 || last <= first) return null
  return { prefix: line.slice(0, first), suffix: line.slice(last + 1) }
}

/** Fill one stub file (the text of a `tl/<language>/*.rpy`). */
export function fillStub(text: string, ctx: FillContext, report: FillReport): string {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = clean.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!

    // A say stub: `# game/ch01.rpy:14` then `translate croatian id:`.
    const head = STUB_HEAD.exec(line)
    const t = head ? TRANSLATE_LINE.exec(lines[i + 1] ?? '') : null
    if (head && t) {
      let j = i + 2
      const body: string[] = []
      while (j < lines.length && (lines[j] === '' || /^\s/.test(lines[j]!))) {
        body.push(lines[j]!)
        j++
      }
      // Trailing blank lines belong after the block.
      const trailing: string[] = []
      while (body.length && body[body.length - 1] === '') trailing.push(body.pop()!)

      const file = path.basename(head[1]!)
      // A `voice` statement above the say is part of the block (and the stub's line is the voice line): the block
      // replaces both, so the source language's clip is dropped and the edition's own (if any) is written.
      const isVoice = (l: string): boolean => /^\s*voice\s/.test(l)
      const comment = body.filter((l) => /^\s*#/.test(l) && !/^\s*#\s*voice\s/.test(l))
      const stmts = body.filter((l) => l.trim() !== '' && !/^\s*#/.test(l) && !isVoice(l))
      let beatId = ctx.lineMap.get(`${file}:${head[2]}`)
      if (!beatId) {
        const orig = comment.map((c) => c.replace(/^\s*#\s?/, '').trim()).find((c) => ctx.byStatement.has(c))
        if (orig) beatId = ctx.byStatement.get(orig)
      }
      const stmt = stmts[0]
      const parts = stmt ? splitStatement(stmt) : null
      if (!beatId || !stmt || !parts || stmts.length !== 1) {
        report.unmatched.push(`${head[1]}:${head[2]} ${t[2]}`)
        out.push(line, lines[i + 1]!, ...body, ...trailing)
        i = j
        continue
      }
      const newText = ctx.beatText(beatId)
      const block: string[] = [...comment]
      const ind = stmt.match(/^\s*/)![0]
      const clip = ctx.voice?.has(ctx.lang, beatId) ?? null
      if (clip) block.push(`${ind}voice ${JSON.stringify(voicePath(ctx.lang, beatId, clip))}`)
      if (newText !== undefined && newText.trim() !== '') {
        block.push(`${parts.prefix}${renpyString(newText)}${parts.suffix}`)
        report.saysFilled++
      } else {
        block.push(stmt)
        report.missingBeats.push(beatId)
      }
      out.push(line, lines[i + 1]!, '', ...block, ...trailing)
      i = j
      continue
    }

    // A strings block entry: `old "..."` then `new "..."`.
    const old = /^(\s*)old "(.*)"\s*$/.exec(line)
    const nw = old ? /^(\s*)new "(.*)"\s*$/.exec(lines[i + 1] ?? '') : null
    if (old && nw) {
      const found = ctx.strings.get(old[2]!)
      if (found !== undefined && found !== old[2]) {
        out.push(line, `${nw[1]}new "${found}"`)
        report.stringsFilled.push(old[2]!)
      } else {
        out.push(line, lines[i + 1]!)
        report.stringsKept.push(old[2]!)
      }
      i += 2
      continue
    }

    out.push(line)
    i++
  }
  return out.join('\n')
}

/** The `old` -> `new` table for the strings blocks: the edition's titles, choices, endings, names, plus the UI table. */
export function buildStringTable(book: VnBook, primaryNames: Record<string, string>, edition: Edition, missing: string[] = []): Map<string, string> {
  const map = new Map<string, string>()
  for (const [src, dst] of Object.entries(UI_STRINGS[edition.lang] ?? {})) map.set(src, dst)
  for (const s of translatableStrings(book, primaryNames)) {
    const v = s.pick(edition)
    if (v === undefined || v.trim() === '') {
      missing.push(s.what)
      continue
    }
    const nw = renpyText(v)
    const prev = map.get(s.old)
    if (prev !== undefined && prev !== nw) missing.push(`${s.what} (same source text as another string, different translation; the first is used)`)
    else map.set(s.old, nw)
  }
  return map
}

// ---------------------------------------------------------------------------------------------------------------
// Running Ren'Py.
// ---------------------------------------------------------------------------------------------------------------

export interface GenerateTranslationsInput {
  /** The Ren'Py project folder (contains `game/`). */
  gameDir: string
  sdkPath: string
  book: VnBook
  primaryEdition?: Edition
  edition: Edition
  lineMap: LineMapEntry[]
  voice?: VoiceSource
  warnings: string[]
}

export interface GenerateTranslationsResult {
  language: string
  report: FillReport
  files: string[]
}

export async function generateTranslations(inp: GenerateTranslationsInput): Promise<GenerateTranslationsResult> {
  const language = RENPY_LANG[inp.edition.lang]
  const tlDir = path.join(inp.gameDir, 'game', 'tl', language)
  fs.rmSync(tlDir, { recursive: true, force: true })

  const r = await runRenpy(inp.sdkPath, [inp.gameDir, 'translate', language], { timeoutMs: 180000 })
  if (r.code !== 0 || !fs.existsSync(tlDir)) {
    throw new Error(`renpy translate ${language} failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-600)}`)
  }

  const missingStrings: string[] = []
  const strings = buildStringTable(inp.book, inp.primaryEdition?.characterNames ?? {}, inp.edition, missingStrings)
  const ctx: FillContext = {
    language,
    lang: inp.edition.lang,
    lineMap: stubLineMap(inp.lineMap),
    byStatement: uniqueStatements(inp.lineMap),
    beatText: (id) => inp.edition.beats[id],
    voice: inp.voice,
    strings
  }
  const report = newReport()
  const files: string[] = []
  for (const f of fs.readdirSync(tlDir)) {
    if (!f.endsWith('.rpy')) continue
    const p = path.join(tlDir, f)
    fs.writeFileSync(p, fillStub(fs.readFileSync(p, 'utf8'), ctx, report), 'utf8')
    files.push(f)
  }

  const lang = inp.edition.lang
  if (report.missingBeats.length) inp.warnings.push(`edition ${lang}: ${report.missingBeats.length} beat(s) have no text and stay in ${inp.book.primaryLang}: ${report.missingBeats.slice(0, 8).join(', ')}${report.missingBeats.length > 8 ? ' ...' : ''}`)
  if (report.unmatched.length) inp.warnings.push(`edition ${lang}: ${report.unmatched.length} translation stub(s) could not be matched to a beat: ${report.unmatched.slice(0, 5).join(', ')}`)
  if (missingStrings.length) inp.warnings.push(`edition ${lang}: no text for ${missingStrings.join('; ')}`)
  return { language, report, files }
}

/** file:line -> beat id, for the say line and (with a voice statement above it) the stub's voice line. */
export function stubLineMap(lineMap: LineMapEntry[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of lineMap) {
    m.set(`${e.file}:${e.line}`, e.beatId)
    if (e.stubLine) m.set(`${e.file}:${e.stubLine}`, e.beatId)
  }
  return m
}

function uniqueStatements(lineMap: LineMapEntry[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const e of lineMap) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
  const out = new Map<string, string>()
  for (const e of lineMap) if (counts.get(e.source) === 1) out.set(e.source, e.beatId)
  return out
}

/**
 * For a book whose primary language has no English UI (Croatian): the template's UI strings in
 * `tl/<language>/ui.rpy`, so the menus of the primary language are not English. The default language is set to it.
 */
export function writeUiStrings(gameSubdir: string, language: string): void {
  const lang = (Object.keys(RENPY_LANG) as Lang[]).find((l) => RENPY_LANG[l] === language)
  const table = lang ? UI_STRINGS[lang] : undefined
  if (!table) return
  const dir = path.join(gameSubdir, 'tl', language)
  fs.mkdirSync(dir, { recursive: true })
  const out = ['# Generated by VN Studio: the template UI in this language.', '', `translate ${language} strings:`, '']
  for (const [src, dst] of Object.entries(table)) {
    out.push(`    old "${src}"`, `    new "${dst}"`, '')
  }
  fs.writeFileSync(path.join(dir, 'ui.rpy'), out.join('\n'), 'utf8')
}
