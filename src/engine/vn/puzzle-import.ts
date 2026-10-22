import { z } from 'zod'
import { puzzleCoreSchema, puzzleEntityIds, puzzleFindableIds, puzzleTextIds } from '../../shared/puzzle'
import type { PuzzleEntry, PuzzleProof } from '../../shared/puzzle'
import type { ImageEntry, VnChapter } from '../../shared/vn'
import type { Bible } from './bible'
import { normText, slugKey } from './ids'
import { exactCharacter } from './script'
import type { PuzzleLines } from './script'

/**
 * The puzzles of a Scriptorium book: `bible/puzzles.md` (the cores the hub handed in with the brief) plus the puzzle lines of the chapters
 * (`CLUE:`, `EVIDENCE:`, `PUZZLE:`, `TESTIMONY:`, see docs/visual-novel.md). The core is trusted for the logic and the lines only for the story:
 * the importer never decides from the prose which clue is true. A clue in the story's own words (not the canonical sentence) is flagged
 * until the read-back check (`vno_puzzle_check_text`) passes.
 */

const bibleEntrySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a lowercase key'),
  kind: z.string().optional(),
  title: z.string().optional(),
  chapter: z.number().int().optional(),
  core: z.unknown(),
  names: z.record(z.string(), z.string()).optional(),
  text: z.record(z.string(), z.string()).optional(),
  testimony: z
    .object({
      witness: z.string().optional(),
      breaks: z.array(z.object({ statement: z.number().int(), evidence: z.string() })).optional(),
      evidence: z.array(z.object({ key: z.string(), description: z.string().optional() })).optional()
    })
    .optional()
})
export type BiblePuzzle = z.infer<typeof bibleEntrySchema>

/** The entries of the frontmatter `puzzles` of `bible/puzzles.md`. A bad entry is a warning, not an error. */
export function parseBiblePuzzles(data: Record<string, unknown> | undefined, warnings: string[]): BiblePuzzle[] {
  if (!data) return []
  const list = (data as { puzzles?: unknown }).puzzles
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    warnings.push('bible/puzzles.md: `puzzles` is not a list: no puzzles imported')
    return []
  }
  const out: BiblePuzzle[] = []
  for (const [i, raw] of list.entries()) {
    const r = bibleEntrySchema.safeParse(raw)
    if (!r.success) warnings.push(`bible/puzzles.md: entry ${i + 1} is not a puzzle (${r.error.issues[0]?.path.join('.') || 'entry'}: ${r.error.issues[0]?.message}): skipped`)
    else if (out.some((p) => p.key === r.data.key)) warnings.push(`bible/puzzles.md: the puzzle key "${r.data.key}" is listed twice: the first one is used`)
    else out.push(r.data)
  }
  return out
}

export interface AssembledPuzzles {
  puzzles: PuzzleEntry[]
  /** Pictures the puzzles need that the cue and evidence lines did not make (the bible's evidence list). */
  images: ImageEntry[]
  warnings: string[]
}

const same = (a: string, b: string): boolean => normText(a) === normText(b)

/**
 * Puts the bible's puzzles and the puzzle lines of the chapters together. `verified.unique` and `deducible` are false here (nothing is proved
 * yet): `proveEntries` fills them. The story's words replace the canonical sentences of the clues (`CLUE:`) and of the statements
 * (`TESTIMONY:`); `clueAt` is the beat of each `CLUE:` line.
 */
export function assemblePuzzles(input: { bible: Bible; chapters: VnChapter[]; lines: PuzzleLines; entries: BiblePuzzle[]; existingImages: ImageEntry[] }): AssembledPuzzles {
  const { bible, chapters, lines, entries } = input
  const warnings: string[] = []
  const images: ImageEntry[] = []
  const puzzles: PuzzleEntry[] = []
  const order = new Map<string, number>()
  for (const c of chapters) for (const s of c.scenes) for (const b of s.beats) order.set(b.id, order.size)
  const imageKeys = new Set(input.existingImages.map((i) => i.key))

  const known = new Set(entries.map((e) => e.key))
  for (const c of lines.clues) if (!known.has(c.puzzle)) warnings.push(`chapter ${c.chapter}: CLUE: ${c.puzzle}/${c.clue} names a puzzle that bible/puzzles.md does not have: the line stays as narration`)
  for (const z of lines.puzzles) if (!known.has(z.key)) warnings.push(`chapter ${z.chapter}: PUZZLE: ${z.key} is not in bible/puzzles.md: the beat is kept and the build skips it until the puzzle is made`)

  for (const e of entries) {
    const core = puzzleCoreSchema.safeParse(e.core)
    if (!core.success) {
      warnings.push(`puzzle "${e.key}": the core in bible/puzzles.md is not a valid puzzle core (${core.error.issues[0]?.path.join('.') || 'core'}: ${core.error.issues[0]?.message}): skipped`)
      continue
    }
    const data = core.data
    if (e.kind && e.kind !== data.kind) warnings.push(`puzzle "${e.key}": the entry says kind ${e.kind}, the core is ${data.kind}`)
    const names: Record<string, string> = { ...(e.names ?? {}) }
    const text: Record<string, string> = { ...(e.text ?? {}) }
    const canonical = { ...text }
    const textIds = new Set(puzzleTextIds(data))

    // the clues, in the story's own words, and where each is found
    const clueAt: Record<string, string> = {}
    const findable = new Set(puzzleFindableIds(data))
    const own: { id: string; chapter: number }[] = []
    const myClues = lines.clues.filter((c) => c.puzzle === e.key)
    const myPuzzleBeats = lines.puzzles.filter((z) => z.key === e.key)
    for (const c of myClues) {
      if (!textIds.has(c.clue)) {
        warnings.push(`chapter ${c.chapter}: CLUE: ${e.key}/${c.clue} is not a clue of the puzzle: the line stays as narration`)
        continue
      }
      if (c.clue in clueAt || own.some((o) => o.id === c.clue)) {
        warnings.push(`chapter ${c.chapter}: clue ${c.clue} of puzzle "${e.key}" is found twice: the first line counts`)
        continue
      }
      text[c.clue] = c.text
      own.push({ id: c.clue, chapter: c.chapter })
      if (findable.has(c.clue)) {
        clueAt[c.clue] = c.beatId
        const play = myPuzzleBeats[0]
        if (play && (order.get(c.beatId) ?? 0) >= (order.get(play.beatId) ?? Infinity)) warnings.push(`chapter ${c.chapter}: clue ${c.clue} of puzzle "${e.key}" comes after the PUZZLE: line`)
      }
    }
    for (const id of findable) if (data.kind !== 'testimony' && !own.some((o) => o.id === id)) warnings.push(`puzzle "${e.key}": clue ${id} is never found in the story (no CLUE: line): it is listed from the start`)
    if (!myPuzzleBeats.length) warnings.push(`puzzle "${e.key}": no PUZZLE: line in the story: nothing plays it`)
    if (myPuzzleBeats.length > 1) warnings.push(`puzzle "${e.key}": ${myPuzzleBeats.length} PUZZLE: lines (${myPuzzleBeats.map((z) => `chapter ${z.chapter}`).join(', ')}): a puzzle is played once`)
    for (const z of myPuzzleBeats) if (z.kind && z.kind !== data.kind) warnings.push(`chapter ${z.chapter}: PUZZLE: ${e.key} (${z.kind}) but the core is ${data.kind}`)

    // links: the item named like a character or a place, an evidence picture
    const links: NonNullable<PuzzleEntry['links']> = {}
    const evidenceKeys = lines.evidence.map((x) => ({ key: x.key, imageKey: x.imageKey }))
    for (const id of puzzleEntityIds(data)) {
      const name = names[id]
      if (!name) continue
      const character = exactCharacter(name, bible.characters)
      const place = bible.places.find((p) => same(p.name, name))
      const picture = evidenceKeys.find((x) => slugKey(name) === x.imageKey)
      if (character) links[id] = { type: 'character', key: character }
      else if (place && data.kind !== 'testimony') links[id] = { type: 'place', key: place.key }
      else if (picture) links[id] = { type: 'image', key: picture.imageKey }
    }

    if (data.kind === 'testimony') {
      const t = e.testimony
      const evKeys = (t?.evidence ?? []).map((x) => x.key)
      data.evidence.forEach((ev, i) => {
        const key = evKeys[i]
        if (!key) return
        const imageKey = slugKey(key)
        links[ev.id] = { type: 'image', key: imageKey }
        const planted = lines.evidence.find((x) => x.imageKey === imageKey)
        const play = myPuzzleBeats[0]
        if (planted && (!play || (order.get(planted.beatId) ?? 0) < (order.get(play.beatId) ?? Infinity))) clueAt[ev.id] = planted.beatId
        else if (planted) warnings.push(`chapter ${planted.chapter}: evidence ${key} is planted after the PUZZLE: line of "${e.key}": it is in the court record from the start`)
        if (!imageKeys.has(imageKey) && !images.some((x) => x.key === imageKey)) {
          const description = t?.evidence?.[i]?.description
          if (description) images.push({ key: imageKey, description, display: 'insert' })
          warnings.push(`puzzle "${e.key}": evidence ${key} is never planted (no EVIDENCE: line)${description ? '; its picture is made from the bible description' : ''}`)
        }
      })
      if (t && evKeys.length !== data.evidence.length) warnings.push(`puzzle "${e.key}": the bible lists ${evKeys.length} evidence key(s), the core has ${data.evidence.length} piece(s) of evidence (they pair by order)`)
      const sol = data.solution
      const num = Number(sol.statement.slice(1))
      const br = t?.breaks?.[0]
      if (br) {
        const wantKey = evKeys[data.evidence.findIndex((x) => x.id === sol.evidence)]
        if (br.statement !== num) warnings.push(`puzzle "${e.key}": the bible says statement ${br.statement} breaks, the core says statement ${num}`)
        if (wantKey && !same(br.evidence, wantKey)) warnings.push(`puzzle "${e.key}": the bible says evidence ${br.evidence} breaks it, the core says ${wantKey}`)
      }
      // the statements: a TESTIMONY block of the witness gives the story's words of statement n
      const witness = t?.witness ?? names.wit ?? ''
      const mine = lines.testimonies.filter((b) => same(b.witness, witness) || (!!exactCharacter(b.witness, bible.characters) && exactCharacter(b.witness, bible.characters) === exactCharacter(witness, bible.characters)))
      const block = mine[0] ?? (lines.testimonies.length === 1 && entries.filter((x) => (x.core as { kind?: string })?.kind === 'testimony').length === 1 ? lines.testimonies[0] : undefined)
      if (!block) warnings.push(`puzzle "${e.key}": no TESTIMONY: block for ${witness || 'its witness'}: the canonical statements are used`)
      else {
        if (block.statements.length !== data.statements.length) warnings.push(`chapter ${block.chapter}: the testimony of ${block.witness} has ${block.statements.length} statement(s), the core has ${data.statements.length}`)
        for (const st of block.statements) {
          const sid = data.statements[st.n - 1]?.id
          if (!sid) continue
          text[sid] = st.text
          own.push({ id: sid, chapter: block.chapter })
        }
        if (names.wit === undefined) {
          const label = block.statements[0]?.speaker
          if (label) names.wit = label
        }
      }
    }

    // which prose is not the canonical sentence: the read-back check has to pass first
    // a statement's canonical sentence starts with the witness (`Mr Halloran: "..."`): the story's speaker line has no such prefix
    const bare = (id: string): string => {
      const c = canonical[id]!
      const prefix = names.wit ? `${names.wit}:` : ''
      return data.kind === 'testimony' && prefix && c.trim().startsWith(prefix) ? c.trim().slice(prefix.length) : c
    }
    const changed = own.filter((o) => canonical[o.id] !== undefined && !same(bare(o.id), text[o.id]!))
    for (const o of changed) warnings.push(`chapter ${o.chapter}: ${o.id} of puzzle "${e.key}" is in the story's own words, not the canonical sentence: it needs the read-back check (vno_puzzle_check_text) before the build`)
    for (const id of textIds) if (!text[id]?.trim()) warnings.push(`puzzle "${e.key}": ${id} has no text (not in bible/puzzles.md, not in a ${data.kind === 'testimony' ? 'TESTIMONY:' : 'CLUE:'} line)`)
    for (const id of puzzleEntityIds(data)) if (!names[id]?.trim()) warnings.push(`puzzle "${e.key}": ${id} has no name in bible/puzzles.md`)

    puzzles.push({
      key: e.key,
      kind: data.kind,
      data,
      names,
      text,
      ...(Object.keys(links).length ? { links } : {}),
      ...(Object.keys(clueAt).length ? { clueAt } : {}),
      verified: { unique: false, deducible: false, score: data.difficulty.score, textChecked: changed.length === 0 && [...textIds].every((id) => !!text[id]?.trim()), by: 'import' }
    })
  }
  return { puzzles, images, warnings }
}

/**
 * Runs the proof of every core (exactly one solution, found without guessing) and sets `verified`. `prove` is the puzzle library; null
 * (no Ren'Py SDK) leaves the puzzles unproved, with a warning: `vno_puzzle_set` proves them later.
 */
export async function proveEntries(puzzles: PuzzleEntry[], prove: ((p: PuzzleEntry) => Promise<PuzzleProof>) | null): Promise<{ puzzles: PuzzleEntry[]; warnings: string[] }> {
  const warnings: string[] = []
  if (!prove) {
    if (puzzles.length) warnings.push(`${puzzles.length} puzzle(s) not proved at import (the puzzle library needs the Ren'Py SDK: set sdkPath in config/renpy.md): vno_puzzle_set proves a puzzle when it is set`)
    return { puzzles, warnings }
  }
  const out: PuzzleEntry[] = []
  for (const p of puzzles) {
    try {
      const r = await prove(p)
      if (!r.unique || !r.deducible) warnings.push(`puzzle "${p.key}": the core in bible/puzzles.md is not sound (${r.solutions} solution(s)${r.deducible ? '' : ', not solvable by deduction alone'}): send it back to the hub`)
      out.push({ ...p, verified: { ...p.verified, unique: r.unique, deducible: r.deducible, score: r.score, by: 'import' } })
    } catch (err) {
      warnings.push(`puzzle "${p.key}": not proved at import (${(err as Error).message})`)
      out.push(p)
    }
  }
  return { puzzles: out, warnings }
}
