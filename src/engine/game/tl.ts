import fs from 'node:fs'
import path from 'node:path'
import { languageInfo } from '../../shared/languages'
import type { Edition, Lang, VnBook } from '../../shared/vn'
import { hasText } from '../../shared/vn'
import { translatableStrings, voicePath, type LineMapEntry, type VoiceSource } from './emit'
import { escapeRenpy, renpyString, renpyText } from './escape'

/**
 * Translations and localized editions for the web game engine.
 */

export const renpyLanguage = (code: string): string => languageInfo(code)?.renpy ?? code.replace(/[^a-z0-9]+/g, '_')
export const nativeName = (code: string): string => languageInfo(code)?.native ?? code
export const uiStrings = (code: string): Record<string, string> | undefined => languageInfo(code)?.ui

export interface FillContext {
  language: string
  lang: Lang
  lineMap: Map<string, string>
  byStatement: Map<string, string>
  beatText: (beatId: string) => string | undefined
  voice?: VoiceSource
  strings: Map<string, string>
}

export interface FillReport {
  missingBeats: string[]
  unmatched: string[]
  stringsFilled: string[]
  stringsKept: string[]
  saysFilled: number
}

export const newReport = (): FillReport => ({ missingBeats: [], unmatched: [], stringsFilled: [], stringsKept: [], saysFilled: 0 })

const STUB_HEAD = /^# game\/([^:]+):(\d+)\s*$/
const TRANSLATE_LINE = /^translate (\S+) (\S+):\s*$/

function splitStatement(line: string): { prefix: string; suffix: string } | null {
  const first = line.indexOf('"')
  const last = line.lastIndexOf('"')
  if (first < 0 || last <= first) return null
  return { prefix: line.slice(0, first), suffix: line.slice(last + 1) }
}

export function fillStub(text: string, ctx: FillContext, report: FillReport): string {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = clean.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const head = STUB_HEAD.exec(line)
    const t = head ? TRANSLATE_LINE.exec(lines[i + 1] ?? '') : null
    if (head && t) {
      let j = i + 2
      const body: string[] = []
      while (j < lines.length && (lines[j] === '' || /^\s/.test(lines[j]!))) {
        body.push(lines[j]!)
        j++
      }
      const trailing: string[] = []
      while (body.length && body[body.length - 1] === '') trailing.push(body.pop()!)
      const file = path.basename(head[1]!)
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

export function buildStringTable(book: VnBook, primaryNames: Record<string, string>, edition: Edition, missing: string[] = []): Map<string, string> {
  const map = new Map<string, string>()
  for (const [src, dst] of Object.entries(uiStrings(edition.lang) ?? {})) map.set(src, dst)
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

export function stubLineMap(lineMap: LineMapEntry[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of lineMap) {
    m.set(`${e.file}:${e.line}`, e.beatId)
    if (e.stubLine) m.set(`${e.file}:${e.stubLine}`, e.beatId)
  }
  return m
}

export function writeUiStrings(gameSubdir: string, code: string): boolean {
  const language = renpyLanguage(code)
  const table = uiStrings(code)
  const dir = path.join(gameSubdir, 'tl', language)
  fs.mkdirSync(dir, { recursive: true })
  const out = ['# Generated by VN Studio: the template UI in this language.', '', `translate ${language} strings:`, '']
  for (const [src, dst] of Object.entries(table ?? { Language: 'Language' })) {
    out.push(`    old "${src}"`, `    new "${dst}"`, '')
  }
  fs.writeFileSync(path.join(dir, 'ui.rpy'), out.join('\n'), 'utf8')
  return table !== undefined
}

export interface GenerateTranslationsInput {
  gameDir: string
  sdkPath?: string
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
  const language = renpyLanguage(inp.edition.lang)
  const tlDir = path.join(inp.gameDir, 'tl', language)
  fs.mkdirSync(tlDir, { recursive: true })

  const report = newReport()
  const files: string[] = []

  // 1. ui.rpy
  writeUiStrings(inp.gameDir, inp.edition.lang)
  files.push('ui.rpy')

  // 2. common.rpy, screens.rpy, options.rpy stubs
  for (const stub of ['common.rpy', 'screens.rpy', 'options.rpy']) {
    const stubPath = path.join(tlDir, stub)
    if (!fs.existsSync(stubPath)) {
      fs.writeFileSync(stubPath, `# Translation stub for ${stub}\n`, 'utf8')
      files.push(stub)
    }
  }

  // 3. characters.rpy
  const charLines: string[] = [`# Generated by VN Studio: translated characters`, '', `translate ${language} strings:`, '']
  for (const c of inp.book.characters) {
    const trName = inp.edition.characterNames[c.key]?.trim()
    if (trName && trName !== c.name) {
      charLines.push(`    old "${escapeRenpy(c.name)}"`, `    new "${escapeRenpy(trName)}"`, '')
    }
    if (c.aliases) {
      c.aliases.forEach((alias, idx) => {
        const aliasKey = `${c.key}#${idx + 1}`
        const trAlias = inp.edition.characterNames[aliasKey]?.trim()
        if (trAlias && trAlias !== alias) {
          charLines.push(`    old "${escapeRenpy(alias)}"`, `    new "${escapeRenpy(trAlias)}"`, '')
        }
      })
    }
  }
  if (charLines.length > 4) {
    fs.writeFileSync(path.join(tlDir, 'characters.rpy'), charLines.join('\n'), 'utf8')
    files.push('characters.rpy')
  }

  // 4. Chapter translation files (e.g. ch01.rpy)
  const entriesByFile = new Map<string, LineMapEntry[]>()
  for (const e of inp.lineMap) {
    if (!entriesByFile.has(e.file)) entriesByFile.set(e.file, [])
    entriesByFile.get(e.file)!.push(e)
  }

  for (const ch of inp.book.chapters) {
    const chFile = `ch${String(ch.n).padStart(2, '0')}.rpy`
    const chLabel = `ch_${String(ch.n).padStart(2, '0')}`
    const entries = entriesByFile.get(chFile) ?? []
    const out: string[] = [`# Generated by VN Studio: translation of ${chFile}`, '']

    // Beats
    for (const e of entries) {
      const beatText = inp.edition.beats[e.beatId]
      const label = `${chLabel}_${e.beatId.replace(/[^a-zA-Z0-9]/g, '_')}`
      out.push(`# game/${e.file}:${e.line}`)
      out.push(`translate ${language} ${label}:`)
      out.push('')
      out.push(`    # ${e.source}`)

      const voiceClip = inp.voice?.has(inp.edition.lang, e.beatId)
      if (voiceClip) {
        out.push(`    voice "voice/${inp.edition.lang}/${e.beatId}${path.extname(voiceClip) || '.ogg'}"`)
      }

      // Speaker prefix if any
      const m = /^(\w+)\s+"/.exec(e.source)
      const speaker = m ? `${m[1]} ` : ''
      const translated = beatText !== undefined && beatText.trim() ? renpyString(beatText.trim()) : renpyString(e.source)
      if (beatText === undefined || !beatText.trim()) {
        report.missingBeats.push(e.beatId)
      } else {
        report.saysFilled++
      }
      out.push(`    ${speaker}${translated}`)
      out.push('')
    }

    // Strings (title, choices, ending)
    const strLines: string[] = [`translate ${language} strings:`, '']
    const trTitle = inp.edition.chapterTitles[ch.n]?.trim()
    if (trTitle) {
      strLines.push(`    # game/${chFile}:title`, `    old "${escapeRenpy(ch.title)}"`, `    new "${escapeRenpy(trTitle)}"`, '')
    }
    ch.choices.forEach((c, idx) => {
      const key = `${ch.n}:${idx}`
      const trChoice = inp.edition.choiceTexts[key]?.trim()
      if (trChoice) {
        strLines.push(`    # game/${chFile}:choice`, `    old "${escapeRenpy(c.text)}"`, `    new "${escapeRenpy(trChoice)}"`, '')
      }
    })
    if (ch.ending) {
      const trEnding = inp.edition.endings[ch.n]?.trim()
      if (trEnding) {
        strLines.push(`    # game/${chFile}:ending`, `    old "${escapeRenpy(ch.ending)}"`, `    new "${escapeRenpy(trEnding)}"`, '')
      }
    }
    if (strLines.length > 2) {
      out.push(...strLines)
    }

    fs.writeFileSync(path.join(tlDir, chFile), out.join('\n'), 'utf8')
    files.push(chFile)
  }

  // 5. Puzzles strings
  if (inp.book.puzzles && inp.book.puzzles.length > 0) {
    const pzLines: string[] = [`# Generated by VN Studio: translated puzzles`, '', `translate ${language} strings:`, '']
    for (const p of inp.book.puzzles) {
      const edPz = inp.edition.puzzles?.[p.key]
      if (!edPz) continue
      for (const [k, v] of Object.entries(edPz.text ?? {})) {
        const orig = p.text[k]
        if (orig && v && v.trim()) {
          pzLines.push(`    old "${escapeRenpy(orig)}"`, `    new "${escapeRenpy(v.trim())}"`, '')
        }
      }
      for (const [k, v] of Object.entries(edPz.names ?? {})) {
        const orig = p.names[k]
        if (orig && v && v.trim()) {
          pzLines.push(`    old "${escapeRenpy(orig)}"`, `    new "${escapeRenpy(v.trim())}"`, '')
        }
      }
    }
    if (pzLines.length > 4) {
      fs.writeFileSync(path.join(tlDir, 'vno_puzzles.rpy'), pzLines.join('\n'), 'utf8')
      files.push('vno_puzzles.rpy')
    }
  }

  return { language, report, files }
}

// ---------------------------------------------------------------------------------------------------------------------
// Web Game Engine Edition Compilation
// ---------------------------------------------------------------------------------------------------------------------

export interface CompiledPuzzleEdition {
  title?: string
  names: Record<string, string>
  text: Record<string, string>
}

export interface CompiledEdition {
  lang: Lang
  title: string
  characterNames: Record<string, string>
  chapterTitles: Record<number, string>
  sceneTitles?: Record<string, string>
  endings: Record<number, string>
  choices: Record<string, string>
  beats: Record<string, string>
  puzzles: Record<string, CompiledPuzzleEdition>
  ui: Record<string, string>
  voice: Record<string, string>
}

/**
 * Builds a structured dictionary of all editions (Record<Lang, CompiledEdition>) for game-data.json:
 * - Localized title, characterNames, chapterTitles, endings, choices
 * - Localized beats with fallback to primary language (recording missing beats in warnings)
 * - Localized puzzles (Record<puzzleKey, { title?: string; names: Record<string, string>; text: Record<string, string> }>)
 * - Localized ui strings from uiStrings(lang)
 * - Per-beat voice map (Record<beatId, string>) for that language.
 */
export function compileEditions(
  book: VnBook,
  primaryEdition: Edition | undefined,
  editions: Edition[],
  voice?: VoiceSource,
  warnings: string[] = []
): Record<Lang, CompiledEdition> {
  const primaryLang = book.primaryLang
  const result: Record<string, CompiledEdition> = {}

  // 1. Build Primary Edition
  const primaryCharNames: Record<string, string> = {}
  for (const c of book.characters) {
    primaryCharNames[c.key] = primaryEdition?.characterNames[c.key]?.trim() || c.name
    if (c.aliases) {
      c.aliases.forEach((alias, idx) => {
        primaryCharNames[`${c.key}#${idx + 1}`] = primaryEdition?.characterNames[`${c.key}#${idx + 1}`]?.trim() || alias
      })
    }
  }

  const primaryChapterTitles: Record<number, string> = {}
  const primaryEndings: Record<number, string> = {}
  const primaryChoices: Record<string, string> = {}
  const primaryBeats: Record<string, string> = {}
  const primaryPuzzles: Record<string, CompiledPuzzleEdition> = {}
  const primaryVoice: Record<string, string> = {}

  for (const ch of book.chapters) {
    primaryChapterTitles[ch.n] = primaryEdition?.chapterTitles[ch.n]?.trim() || ch.title
    if (ch.ending) {
      primaryEndings[ch.n] = primaryEdition?.endings[ch.n]?.trim() || ch.ending
    }
    ch.choices.forEach((c, idx) => {
      const key = `${ch.n}:${idx}`
      primaryChoices[key] = primaryEdition?.choiceTexts[key]?.trim() || c.text
    })
    for (const sc of ch.scenes) {
      for (const b of sc.beats) {
        if (hasText(b)) {
          primaryBeats[b.id] = primaryEdition?.beats[b.id]?.trim() || b.text
        }
        if (voice) {
          const clip = voice.has(primaryLang, b.id)
          if (clip) {
            primaryVoice[b.id] = voicePath(primaryLang, b.id, clip)
          }
        }
      }
    }
  }

  for (const p of book.puzzles ?? []) {
    primaryPuzzles[p.key] = {
      names: { ...(primaryEdition?.puzzles?.[p.key]?.names ?? p.names) },
      text: { ...(primaryEdition?.puzzles?.[p.key]?.text ?? p.text) }
    }
  }

  const primaryCompiled: CompiledEdition = {
    lang: primaryLang,
    title: primaryEdition?.title?.trim() || book.title,
    characterNames: primaryCharNames,
    chapterTitles: primaryChapterTitles,
    endings: primaryEndings,
    choices: primaryChoices,
    beats: primaryBeats,
    puzzles: primaryPuzzles,
    ui: uiStrings(primaryLang) ?? {},
    voice: primaryVoice
  }

  result[primaryLang] = primaryCompiled

  // 2. Compile each non-primary edition
  for (const ed of editions) {
    if (ed.lang === primaryLang) continue

    const charNames: Record<string, string> = { ...primaryCharNames }
    for (const [k, v] of Object.entries(ed.characterNames)) {
      if (v && v.trim()) charNames[k] = v.trim()
    }

    const chapterTitles: Record<number, string> = { ...primaryChapterTitles }
    for (const [k, v] of Object.entries(ed.chapterTitles)) {
      if (v && v.trim()) chapterTitles[Number(k)] = v.trim()
    }

    const endings: Record<number, string> = { ...primaryEndings }
    for (const [k, v] of Object.entries(ed.endings)) {
      if (v && v.trim()) endings[Number(k)] = v.trim()
    }

    const choices: Record<string, string> = { ...primaryChoices }
    for (const [k, v] of Object.entries(ed.choiceTexts)) {
      if (v && v.trim()) choices[k] = v.trim()
    }

    const beats: Record<string, string> = {}
    const missingBeats: string[] = []
    const edVoice: Record<string, string> = {}

    for (const [beatId, primaryText] of Object.entries(primaryBeats)) {
      const edText = ed.beats[beatId]
      if (edText !== undefined && edText.trim() !== '') {
        beats[beatId] = edText.trim()
      } else {
        beats[beatId] = primaryText
        missingBeats.push(beatId)
      }
      if (voice) {
        const clip = voice.has(ed.lang, beatId)
        if (clip) {
          edVoice[beatId] = voicePath(ed.lang, beatId, clip)
        }
      }
    }

    if (missingBeats.length > 0) {
      warnings.push(
        `edition ${ed.lang}: ${missingBeats.length} beat(s) have no text and stay in ${primaryLang}: ${missingBeats.slice(0, 8).join(', ')}${missingBeats.length > 8 ? ' ...' : ''}`
      )
    }

    const puzzles: Record<string, CompiledPuzzleEdition> = {}
    for (const p of book.puzzles ?? []) {
      const edPz = ed.puzzles?.[p.key]
      puzzles[p.key] = {
        names: { ...primaryPuzzles[p.key]?.names, ...(edPz?.names ?? {}) },
        text: { ...primaryPuzzles[p.key]?.text, ...(edPz?.text ?? {}) }
      }
    }

    result[ed.lang] = {
      lang: ed.lang,
      title: ed.title?.trim() || primaryCompiled.title,
      characterNames: charNames,
      chapterTitles,
      endings,
      choices,
      beats,
      puzzles,
      ui: uiStrings(ed.lang) ?? {},
      voice: edVoice
    }
  }

  return result
}
