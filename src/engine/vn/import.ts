import { basename } from 'node:path'
import { hasText, vnBookSchema } from '../../shared/vn'
import type { Edition, ImageEntry, Lang, SoundEntry, VnBook, VnChapter } from '../../shared/vn'
import type { PuzzleEntry, PuzzleProof } from '../../shared/puzzle'
import { mergeBibleAliases } from './aliases'
import type { AliasMerge } from './aliases'
import { parseBible } from './bible'
import type { Bible } from './bible'
import { detectLanguage } from './lang'
import type { LangDetection } from './lang'
import { buildChapterMap, parseOutlineChapters } from './outline'
import type { ChapterMap } from './outline'
import { readBookFolder } from './reader'
import type { RawBook } from './reader'
import { assemblePuzzles, parseBiblePuzzles, proveEntries } from './puzzle-import'
import { parseChapterScript } from './script'
import type { PuzzleLines, Uncertain } from './script'

/** A book folder parsed with the deterministic parser, before a language is chosen. */
export interface ParsedFolder {
  raw: RawBook
  bible: Bible
  map: ChapterMap
  /** Chapters in the shape of the contract (no summaries lost). */
  chapters: VnChapter[]
  uncertain: Uncertain[]
  warnings: string[]
  /** The pictures and sounds the cue lines (`CG:`, `SFX:` ...) of the scripts named, once each. */
  images: ImageEntry[]
  sounds: SoundEntry[]
  /** Bible entries that were the same person under another name and were merged into one character. */
  aliases: AliasMerge[]
  /** The puzzles of `bible/puzzles.md` with the puzzle lines of the scripts put in (not proved yet: see `importBook`). */
  puzzles: PuzzleEntry[]
  puzzleLines: PuzzleLines
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Parses the raw parts of a book folder: bible, chapter map, scripts. Never throws on bad content. */
export function parseRawBook(raw: RawBook): ParsedFolder {
  const merged = mergeBibleAliases(parseBible(raw.bible))
  const bible = merged.bible
  const warnings: string[] = merged.merged.map((m) => `aliases merged: ${m.alias} -> ${m.into} (${m.reason})`)
  // entries that only look alike are left to the script-analyst: it says whether one is another name of the other
  const uncertain: Uncertain[] = merged.suspects.map((s) => ({ kind: 'alias', chapter: 0, sceneId: '', text: s.alias.name, reason: s.reason, charKey: s.of.key }))
  if (!raw.chapters.length) warnings.push('the book has no chapter files')
  if (!bible.characters.length) warnings.push('the bible lists no characters (## Characters / ## Likovi)')
  if (!bible.places.length) warnings.push('the bible lists no places (## Places / ## Mjesta)')

  const outline = parseOutlineChapters(raw.outline)
  const format = str(raw.book.format)
  const map = buildChapterMap(outline, raw.chapters.map((c) => ({ n: c.n, title: c.title })), format)
  warnings.push(...map.warnings)

  const chapters: VnChapter[] = []
  const images = new Map<string, ImageEntry>()
  const sounds = new Map<string, SoundEntry>()
  const puzzleLines: PuzzleLines = { clues: [], evidence: [], puzzles: [], testimonies: [] }
  for (const m of map.chapters) {
    const file = raw.chapters.find((c) => c.n === m.n)!
    const parsed = parseChapterScript(file.body, { chapter: m.n, bible })
    warnings.push(...parsed.warnings)
    uncertain.push(...parsed.uncertain)
    for (const i of parsed.images) if (!images.has(i.key)) images.set(i.key, i)
    for (const x of parsed.sounds) if (!sounds.has(`${x.kind}:${x.key}`)) sounds.set(`${x.kind}:${x.key}`, x)
    puzzleLines.clues.push(...parsed.puzzleLines.clues)
    puzzleLines.evidence.push(...parsed.puzzleLines.evidence)
    puzzleLines.puzzles.push(...parsed.puzzleLines.puzzles)
    puzzleLines.testimonies.push(...parsed.puzzleLines.testimonies)
    chapters.push({ n: m.n, title: m.title, ...(m.summary ? { summary: m.summary } : {}), choices: m.choices, ending: m.ending, scenes: parsed.scenes })
  }

  const bibleEntries = parseBiblePuzzles(raw.puzzles, warnings)
  if (!bibleEntries.length && (puzzleLines.puzzles.length || puzzleLines.clues.length)) warnings.push('the script has puzzle lines but bible/puzzles.md lists no puzzle: the puzzle beats are kept and the build skips them until vno_puzzle_set makes the puzzles')
  const assembled = assemblePuzzles({ bible, chapters, lines: puzzleLines, entries: bibleEntries, existingImages: [...images.values()] })
  warnings.push(...assembled.warnings)
  for (const i of assembled.images) if (!images.has(i.key)) images.set(i.key, i)

  const unknown = [...new Set(uncertain.filter((u) => u.kind === 'speaker').map((u) => u.text))]
  if (unknown.length) warnings.push(`speakers not in the bible (no sprite): ${unknown.join(', ')}`)
  const noPlace = uncertain.filter((u) => u.kind === 'place').length
  if (noPlace) warnings.push(`${noPlace} scene(s) have a place that matches no bible place`)
  return { raw, bible, map, chapters, uncertain, warnings, images: [...images.values()], sounds: [...sounds.values()], aliases: merged.merged, puzzles: assembled.puzzles, puzzleLines }
}

/** The text used to detect the language: chapter titles and every spoken or narrated line. */
export function textSample(chapters: VnChapter[]): string {
  const parts: string[] = []
  for (const c of chapters) {
    parts.push(c.title)
    for (const s of c.scenes) for (const b of s.beats) if (hasText(b)) parts.push(b.text)
  }
  return parts.join('\n')
}

/** The edition (text keyed by beat id) of a parsed set of chapters. */
export function buildEdition(lang: Lang, title: string, chapters: VnChapter[], characters: { key: string; name: string }[]): Edition {
  const beats: Record<string, string> = {}
  const chapterTitles: Record<number, string> = {}
  const choiceTexts: Record<string, string> = {}
  const endings: Record<number, string> = {}
  for (const c of chapters) {
    chapterTitles[c.n] = c.title
    c.choices.forEach((ch, i) => (choiceTexts[`${c.n}:${i}`] = ch.text))
    if (c.ending) endings[c.n] = c.ending
    for (const s of c.scenes) for (const b of s.beats) if (hasText(b)) beats[b.id] = b.text
  }
  const characterNames: Record<string, string> = {}
  for (const ch of characters) characterNames[ch.key] = ch.name
  return { lang, title, chapterTitles, choiceTexts, endings, characterNames, beats }
}

export interface ImportResult {
  book: VnBook
  /** The primary-language edition. */
  edition: Edition
  detected: LangDetection
  /** Places, times, speakers, cast entries, expressions and look-alike bible entries the parser could not settle (for the script-analyst). */
  uncertain: Uncertain[]
  /** The bible entries merged as aliases (also in `book.warnings`). */
  aliases: AliasMerge[]
}

/** Imports a book folder from anywhere (Scriptorium layout). `lang` overrides the detected language. */
export async function importBook(folderPath: string, opts: { lang?: Lang; prove?: ((p: PuzzleEntry) => Promise<PuzzleProof>) | null } = {}): Promise<ImportResult> {
  const raw = await readBookFolder(folderPath)
  const parsed = parseRawBook(raw)
  const proved = await proveEntries(parsed.puzzles, opts.prove ?? null)
  parsed.warnings.push(...proved.warnings)
  const detected = detectLanguage(textSample(parsed.chapters))
  const lang = opts.lang ?? detected.lang
  const slug = str(raw.book.slug) ?? (basename(folderPath) || 'book')
  const title = str(raw.book.title) ?? slug
  const book = vnBookSchema.parse({
    slug,
    title,
    ...(str(raw.book.author) ? { author: str(raw.book.author) } : {}),
    ...(str(raw.book.genre) ? { genre: str(raw.book.genre) } : {}),
    format: str(raw.book.format) ?? 'visual-novel',
    kind: parsed.map.kind,
    primaryLang: lang,
    style: parsed.bible.style,
    characters: parsed.bible.characters,
    places: parsed.bible.places,
    ...(parsed.images.length ? { images: parsed.images } : {}),
    ...(parsed.sounds.length ? { sounds: parsed.sounds } : {}),
    ...(raw.coverBrief ? { coverBrief: raw.coverBrief } : {}),
    chapters: parsed.chapters,
    ...(proved.puzzles.length ? { puzzles: proved.puzzles } : {}),
    warnings: parsed.warnings
  })
  const edition = buildEdition(lang, title, book.chapters, book.characters)
  return { book, edition, detected, uncertain: parsed.uncertain, aliases: parsed.aliases }
}
