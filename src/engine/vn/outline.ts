import { checkBranches as checkBranchesFor } from './branches'
import type { BranchChapter, Choice } from './branches'

/** What the outline frontmatter says about the chapters (`chapters[]`: n, title, summary, choices, ending). */
export interface OutlineChapter extends BranchChapter {
  /** The ending text exactly as written, when the key was present (even empty). */
  endingWritten: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** Reads `chapters[]` from outline frontmatter leniently. Never throws; unusable entries are skipped. */
export function parseOutlineChapters(data: Record<string, unknown>): OutlineChapter[] {
  const raw = data.chapters
  if (!Array.isArray(raw)) return []
  const out: OutlineChapter[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const n = Math.round(Number(o.n ?? i + 1))
    if (!Number.isFinite(n) || n < 1) return
    const choices: Choice[] = []
    if (Array.isArray(o.choices)) {
      for (const c of o.choices) {
        if (!c || typeof c !== 'object') continue
        const co = c as Record<string, unknown>
        choices.push({ text: str(co.text), to: Math.round(Number(co.to)) })
      }
    }
    out.push({
      n,
      title: str(o.title).trim(),
      summary: str(o.summary).trim(),
      ...(choices.length ? { choices } : {}),
      ...(o.ending !== undefined && o.ending !== null ? { ending: str(o.ending).trim() } : {}),
      endingWritten: o.ending !== undefined && o.ending !== null
    })
  })
  return out.sort((a, b) => a.n - b.n)
}

export interface MappedChapter {
  n: number
  title: string
  summary?: string
  choices: Choice[]
  ending: string | null
}

export interface ChapterMap {
  kind: 'linear' | 'choice'
  chapters: MappedChapter[]
  warnings: string[]
}

/** The placeholder ending text for a choice chapter that has neither choices nor ending text. */
export const DEFAULT_ENDING = 'The End'

/**
 * Combines the chapter files with the outline: titles, summaries, choices and endings.
 * Kind is `choice` when any chapter has choices, else `linear` (only the last chapter ends, with '' or the outline's text).
 */
export function buildChapterMap(outline: OutlineChapter[], files: { n: number; title: string }[], format?: string): ChapterMap {
  const warnings: string[] = []
  const byN = new Map(outline.map((c) => [c.n, c]))
  const fileNs = new Set(files.map((f) => f.n))
  for (const o of outline) if (!fileNs.has(o.n)) warnings.push(`the outline lists chapter ${o.n} but there is no chapter file for it`)
  const base = [...files]
    .sort((a, b) => a.n - b.n)
    .map((f) => {
      const o = byN.get(f.n)
      return { f, o }
    })
  const branching = base.some(({ o }) => (o?.choices?.length ?? 0) > 0)

  if (!branching) {
    if (format && /choice|gamebook/.test(format)) warnings.push(`the format is ${format} but the outline has no choices: importing as a linear story`)
    const chapters = base.map(({ f, o }, i): MappedChapter => {
      const last = i === base.length - 1
      return {
        n: f.n,
        title: f.title || o?.title || `Chapter ${f.n}`,
        ...(o?.summary ? { summary: o.summary } : {}),
        choices: [],
        ending: last ? (o?.ending ?? '') : null
      }
    })
    return { kind: 'linear', chapters, warnings }
  }

  const check = checkBranchesFor(base.map(({ f, o }) => ({ n: f.n, title: f.title || o?.title || `Chapter ${f.n}`, summary: o?.summary ?? '', ...(o?.choices ? { choices: o.choices } : {}), ...(o?.ending !== undefined ? { ending: o.ending } : {}) })))
  warnings.push(...check.warnings)
  const chapters = check.chapters.map((c): MappedChapter => {
    const choices = c.choices ?? []
    let ending: string | null = null
    if (!choices.length) {
      ending = c.ending?.trim() || ''
      if (!ending) {
        ending = DEFAULT_ENDING
        warnings.push(`chapter ${c.n} has no choices and no ending text: using "${DEFAULT_ENDING}"`)
      } else if (/^an ending\.?$/i.test(ending)) {
        warnings.push(`chapter ${c.n} is an ending without a description ("${ending}")`)
      }
    }
    return { n: c.n, title: c.title, ...(c.summary ? { summary: c.summary } : {}), choices, ending }
  })
  return { kind: 'choice', chapters, warnings }
}


