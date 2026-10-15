import { basename } from 'node:path'
import { vnBookSchema } from '../../shared/vn'
import type { Edition, Lang, VnBook, VnChapter } from '../../shared/vn'
import { parseBible } from './bible'
import type { Bible } from './bible'
import { detectLanguage } from './lang'
import type { LangDetection } from './lang'
import { buildChapterMap, parseOutlineChapters } from './outline'
import type { ChapterMap } from './outline'
import { readBookFolder } from './reader'
import type { RawBook } from './reader'
import { parseChapterScript } from './script'
import type { Uncertain } from './script'

/** A book folder parsed with the deterministic parser, before a language is chosen. */
export interface ParsedFolder {
  raw: RawBook
  bible: Bible
  map: ChapterMap
  /** Chapters in the shape of the contract (no summaries lost). */
  chapters: VnChapter[]
  uncertain: Uncertain[]
  warnings: string[]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Parses the raw parts of a book folder: bible, chapter map, scripts. Never throws on bad content. */
export function parseRawBook(raw: RawBook): ParsedFolder {
  const bible = parseBible(raw.bible)
  const warnings: string[] = []
  const uncertain: Uncertain[] = []
  if (!raw.chapters.length) warnings.push('the book has no chapter files')
  if (!bible.characters.length) warnings.push('the bible lists no characters (## Characters / ## Likovi)')
  if (!bible.places.length) warnings.push('the bible lists no places (## Places / ## Mjesta)')

  const outline = parseOutlineChapters(raw.outline)
  const format = str(raw.book.format)
  const map = buildChapterMap(outline, raw.chapters.map((c) => ({ n: c.n, title: c.title })), format)
  warnings.push(...map.warnings)

  const chapters: VnChapter[] = []
  for (const m of map.chapters) {
    const file = raw.chapters.find((c) => c.n === m.n)!
    const parsed = parseChapterScript(file.body, { chapter: m.n, bible })
    warnings.push(...parsed.warnings)
    uncertain.push(...parsed.uncertain)
    chapters.push({ n: m.n, title: m.title, ...(m.summary ? { summary: m.summary } : {}), choices: m.choices, ending: m.ending, scenes: parsed.scenes })
  }

  const unknown = [...new Set(uncertain.filter((u) => u.kind === 'speaker').map((u) => u.text))]
  if (unknown.length) warnings.push(`speakers not in the bible (no sprite): ${unknown.join(', ')}`)
  const noPlace = uncertain.filter((u) => u.kind === 'place').length
  if (noPlace) warnings.push(`${noPlace} scene(s) have a place that matches no bible place`)
  return { raw, bible, map, chapters, uncertain, warnings }
}

/** The text used to detect the language: chapter titles and every spoken or narrated line. */
export function textSample(chapters: VnChapter[]): string {
  const parts: string[] = []
  for (const c of chapters) {
    parts.push(c.title)
    for (const s of c.scenes) for (const b of s.beats) if (b.type !== 'cast') parts.push(b.text)
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
    for (const s of c.scenes) for (const b of s.beats) if (b.type !== 'cast') beats[b.id] = b.text
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
  /** Places, times, speakers, cast entries and expressions the parser could not settle (for the script-analyst). */
  uncertain: Uncertain[]
}

/** Imports a book folder from anywhere (Scriptorium layout). `lang` overrides the detected language. */
export async function importBook(folderPath: string, opts: { lang?: Lang } = {}): Promise<ImportResult> {
  const raw = await readBookFolder(folderPath)
  const parsed = parseRawBook(raw)
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
    ...(raw.coverBrief ? { coverBrief: raw.coverBrief } : {}),
    chapters: parsed.chapters,
    warnings: parsed.warnings
  })
  const edition = buildEdition(lang, title, book.chapters, book.characters)
  return { book, edition, detected, uncertain: parsed.uncertain }
}
