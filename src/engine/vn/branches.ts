/** Stories with choices: a port of Scriptorium's `checkBranches`. Problems are warnings here, never exceptions. */

export interface Choice {
  text: string
  /** The chapter this choice leads to. */
  to: number
}

export interface BranchChapter {
  n: number
  title: string
  summary: string
  choices?: Choice[]
  /** For an ending: a few words on how it ends. */
  ending?: string
}

/** At most this many choices end a chapter. */
export const MAX_CHOICES = 3

export interface BranchCheck {
  chapters: BranchChapter[]
  warnings: string[]
}

/**
 * Cleans the chapter map: a choice leads to a later chapter (bad ones are dropped), a chapter without choices is an ending,
 * every chapter is reached from chapter 1, there are at least two endings and one real choice. Whatever is wrong becomes a warning.
 */
export function checkBranches(chapters: BranchChapter[]): BranchCheck {
  const warnings: string[] = []
  const known = new Set(chapters.map((c) => c.n))
  const out = chapters.map((c): BranchChapter => {
    const seen = new Set<number>()
    const choices: Choice[] = []
    for (const ch of c.choices ?? []) {
      const to = Math.round(Number(ch.to))
      const text = String(ch.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isFinite(to)) {
        warnings.push(`chapter ${c.n}: dropped a choice without text or target`)
        continue
      }
      if (to <= c.n) {
        warnings.push(`chapter ${c.n}: dropped choice "${text}": it leads back to chapter ${to}`)
        continue
      }
      if (!known.has(to)) {
        warnings.push(`chapter ${c.n}: dropped choice "${text}": there is no chapter ${to}`)
        continue
      }
      if (seen.has(to)) {
        warnings.push(`chapter ${c.n}: dropped choice "${text}": another choice already leads to chapter ${to}`)
        continue
      }
      seen.add(to)
      choices.push({ text, to })
    }
    if (choices.length > MAX_CHOICES) warnings.push(`chapter ${c.n}: ${choices.length} choices, keeping the first ${MAX_CHOICES}`)
    const { choices: _c, ending: _e, ...rest } = c
    return choices.length ? { ...rest, choices: choices.slice(0, MAX_CHOICES) } : { ...rest, ending: c.ending?.trim() ?? '' }
  })
  const reached = new Set([out[0]?.n ?? 1])
  for (const c of out) if (reached.has(c.n)) for (const ch of c.choices ?? []) reached.add(ch.to)
  const lost = out.filter((c) => !reached.has(c.n)).map((c) => c.n)
  if (lost.length) warnings.push(`no choice leads to chapter(s) ${lost.join(', ')}`)
  if (out.filter((c) => !c.choices).length < 2) warnings.push('the story with choices has fewer than two endings')
  if (!out.some((c) => (c.choices?.length ?? 0) >= 2)) warnings.push('the story with choices has no chapter that ends with two or more choices')
  return { chapters: out, warnings }
}

/** True when the chapters carry choices (a story with choices). */
export const isBranching = (chapters: BranchChapter[]) => chapters.some((c) => (c.choices?.length ?? 0) > 0)
