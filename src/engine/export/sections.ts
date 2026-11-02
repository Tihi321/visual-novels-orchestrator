/**
 * Shared gamebook section numbering (HUB-25 "Shared section algorithm").
 *
 * The same algorithm lives in VN Studio (src/engine/export/sections.ts) and in Scriptorium
 * (src/engine/publish/sections.ts), and both test the same golden vector. A change here is a
 * change to the spec in creative-hub/.claude/tickets/HUB-25-book-export-kindle-pdf/plan.md
 * first, then to both repos together.
 *
 * - Input: n chapters (1-based, chapter 1 is the start), a seed string (default the book slug),
 *   order 'shuffled' (default) or 'in-order'.
 * - in-order: chapter k gets section k.
 * - shuffled: h = FNV-1a 32-bit of the UTF-8 bytes of the seed; mulberry32 seeded with h;
 *   nums = [2..n], Fisher-Yates from the end (j = floor(rand() * (i + 1))). Chapter 1 gets
 *   section 1, chapters 2..n get nums in order.
 * - Output: index k-1 is the section number of chapter k, a bijection onto 1..n.
 * - Golden vector: fnv1a32('golden') = 386248004; sections('golden', 8) = [1,4,2,8,5,3,7,6];
 *   sections('clockless-god', 5) = [1,4,3,2,5].
 */

export type SectionOrder = 'shuffled' | 'in-order'

export function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildSections(n: number, seed: string, order: SectionOrder = 'shuffled'): number[] {
  const nums: number[] = []
  for (let k = 2; k <= n; k++) nums.push(k)
  if (order === 'shuffled') {
    const rand = mulberry32(fnv1a32(seed))
    for (let i = nums.length - 1; i >= 1; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[nums[i], nums[j]] = [nums[j]!, nums[i]!]
    }
  }
  return n >= 1 ? [1, ...nums] : []
}

// ---- the stored map (VN Studio only: not part of the shared core above) ----

import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { atomicWrite } from '../store/atomic'

/**
 * The numbering of a project is stored in `projects/<slug>/export.json` (a sibling of vn.json, whose schema stays untouched):
 * `{ seed, order, sections: { "<chapter>": <section no> } }`. It is not per language: numbers depend on the chapters, which every edition shares.
 */
export const sectionMapSchema = z.object({
  seed: z.string(),
  order: z.enum(['shuffled', 'in-order']),
  sections: z.record(z.string(), z.number().int().positive())
})
export type SectionMap = z.infer<typeof sectionMapSchema>

export const EXPORT_FILE = 'export.json'

/** The numbering of these chapters (their `n`, any order): the first chapter is the start and gets section 1. */
export function chapterSectionMap(chapters: readonly number[], seed: string, order: SectionOrder = 'shuffled'): SectionMap {
  const ns = [...chapters].sort((a, b) => a - b)
  const nums = buildSections(ns.length, seed, order)
  return { seed, order, sections: Object.fromEntries(ns.map((n, i) => [String(n), nums[i]!])) }
}

/** The section number of a chapter; throws when the map does not know it. */
export function sectionOf(map: SectionMap, chapter: number): number {
  const no = map.sections[String(chapter)]
  if (no === undefined) throw new Error(`the section map has no number for chapter ${chapter}`)
  return no
}

/** Reads a stored map; null when there is none. A file that is not a map throws (it is never overwritten silently). */
export async function loadSectionMap(file: string): Promise<SectionMap | null> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    return sectionMapSchema.parse(JSON.parse(text))
  } catch {
    throw new Error(`${file} is not a section map ({ seed, order, sections }): fix or delete it`)
  }
}

export async function saveSectionMap(file: string, map: SectionMap): Promise<void> {
  await atomicWrite(file, JSON.stringify(map, null, 2) + '\n')
}

/** Why a stored map no longer fits these chapters (and the seed/order asked for); empty when it fits. */
export function staleReasons(stored: SectionMap, chapters: readonly number[], want: { seed?: string; order?: SectionOrder } = {}): string[] {
  const out: string[] = []
  const have = new Set(Object.keys(stored.sections).map(Number))
  const now = new Set(chapters)
  const added = [...now].filter((n) => !have.has(n)).sort((a, b) => a - b)
  const removed = [...have].filter((n) => !now.has(n)).sort((a, b) => a - b)
  if (added.length) out.push(`chapter(s) ${added.join(', ')} are new`)
  if (removed.length) out.push(`chapter(s) ${removed.join(', ')} no longer exist`)
  const nos = Object.values(stored.sections)
  if (new Set(nos).size !== nos.length || nos.some((v) => v > nos.length)) out.push('its numbers are not a bijection onto 1..N')
  if (want.seed !== undefined && want.seed !== stored.seed) out.push(`it was made with seed "${stored.seed}", not "${want.seed}"`)
  if (want.order !== undefined && want.order !== stored.order) out.push(`it is ${stored.order}, not ${want.order}`)
  return out
}

export interface ResolvedMap {
  map: SectionMap
  /** The stored map was used as it is. */
  reused: boolean
  /** The stored map did not fit; `map` is what a renumber would give and was not saved. */
  stale: string[]
  /** The map was written to `file` by this call. */
  saved: boolean
}

/**
 * The map an export uses. A stored map is reused; a stored map that does not fit (new or removed chapters, another seed or order asked for)
 * is stale: it comes back with the reasons and the map a renumber would give, and nothing is written (a caller that writes a file refuses).
 * `renumber: true` recomputes. The seed defaults to the stored one, else `slug`. Nothing is written unless `persist` is true.
 */
export async function resolveSectionMap(o: {
  file: string
  slug: string
  chapters: readonly number[]
  seed?: string
  order?: SectionOrder
  renumber?: boolean
  persist?: boolean
}): Promise<ResolvedMap> {
  const stored = await loadSectionMap(o.file)
  const reasons = stored && !o.renumber ? staleReasons(stored, o.chapters, { seed: o.seed, order: o.order }) : []
  if (stored && !o.renumber && reasons.length === 0) return { map: stored, reused: true, stale: [], saved: false }
  const map = chapterSectionMap(o.chapters, o.seed ?? stored?.seed ?? o.slug, o.order ?? stored?.order ?? 'shuffled')
  if (reasons.length) return { map, reused: false, stale: reasons, saved: false }
  if (o.persist) await saveSectionMap(o.file, map)
  return { map, reused: false, stale: [], saved: !!o.persist }
}
