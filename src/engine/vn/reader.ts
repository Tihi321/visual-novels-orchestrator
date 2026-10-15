import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { parseMd } from '../../shared/md'

/** Formats Scriptorium writes as scripts. */
export const VN_FORMATS = ['visual-novel', 'choice-visual-novel', 'kids-visual-story', 'kids-choice-visual-story'] as const
/** Prose books with choices that can also become visual novels (the prose becomes narration). */
export const PROSE_CHOICE_FORMATS = ['gamebook', 'kids-choice-book'] as const

export interface BookSummary {
  slug: string
  title: string
  format: string
  script: boolean
  stage: string
  hasChoices: boolean
  path: string
}

export interface RawChapter {
  n: number
  title: string
  body: string
}

export interface RawBook {
  path: string
  slug: string
  /** `book.md` frontmatter (empty when the file is missing). */
  book: Record<string, unknown>
  /** The body of `bible/bible.md` (or `bible.md`). */
  bible: string
  /** `outline.md` frontmatter. */
  outline: Record<string, unknown>
  chapters: RawChapter[]
  coverBrief?: string
}

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readMd(path: string) {
  const text = await readText(path)
  if (text === null) return null
  try {
    return parseMd(text, path)
  } catch {
    // Broken frontmatter: still use the body.
    return { data: {} as Record<string, unknown>, body: text }
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

/** The books in a Scriptorium data folder that can become visual novels. */
export async function listBooks(scriptoriumDataDir: string): Promise<BookSummary[]> {
  const root = join(scriptoriumDataDir, 'books')
  let names: string[]
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: BookSummary[] = []
  for (const name of names.sort()) {
    const doc = await readMd(join(root, name, 'book.md'))
    if (!doc) continue
    const format = str(doc.data.format)
    const script = doc.data.script === true
    const isVn = (VN_FORMATS as readonly string[]).includes(format) && script
    const isProse = (PROSE_CHOICE_FORMATS as readonly string[]).includes(format)
    if (!isVn && !isProse) continue
    out.push({
      slug: str(doc.data.slug, name),
      title: str(doc.data.title, name),
      format,
      script,
      stage: str(doc.data.stage, 'unknown'),
      hasChoices: /choice|gamebook/.test(format),
      path: join(root, name)
    })
  }
  return out
}

/** Reads a book folder (Scriptorium layout) from anywhere into its raw parts. Missing files are tolerated. */
export async function readBookFolder(path: string): Promise<RawBook> {
  const book = await readMd(join(path, 'book.md'))
  const bibleDoc = (await readMd(join(path, 'bible', 'bible.md'))) ?? (await readMd(join(path, 'bible.md')))
  const outline = await readMd(join(path, 'outline.md'))
  const cover = await readMd(join(path, 'cover-brief.md'))

  const chapters: RawChapter[] = []
  let files: string[] = []
  try {
    files = (await fs.readdir(join(path, 'chapters'), { withFileTypes: true })).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name)
  } catch {
    // no chapters folder
  }
  for (const file of files.sort()) {
    const doc = await readMd(join(path, 'chapters', file))
    if (!doc) continue
    const fromName = /(\d+)\.md$/i.exec(file)
    const n = Math.round(Number(doc.data.n ?? (fromName ? fromName[1] : NaN)))
    if (!Number.isFinite(n) || n < 1) continue
    const heading = /^#\s+(.+)$/m.exec(doc.body)
    chapters.push({ n, title: str(doc.data.title, heading ? heading[1]!.trim() : '').trim(), body: doc.body })
  }
  chapters.sort((a, b) => a.n - b.n)

  let coverBrief: string | undefined
  if (cover) {
    coverBrief =
      cover.body
        .split(/\r?\n/)
        .filter((l) => !/^#/.test(l) && !/^The template cover/i.test(l.trim()))
        .join('\n')
        .trim() || undefined
  }

  return {
    path,
    slug: str(book?.data.slug, basename(path)),
    book: book?.data ?? {},
    bible: bibleDoc?.body ?? '',
    outline: outline?.data ?? {},
    chapters,
    ...(coverBrief ? { coverBrief } : {})
  }
}
