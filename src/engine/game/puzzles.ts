import type { PuzzleEntry, PuzzleKind } from '../../shared/puzzle'
import type { VnBook } from '../../shared/vn'
import { renpyString, renpyText } from './escape'
import { cgImageName, spriteImageName, type ImageFormat } from './images'

/**
 * Puzzles compilation and image resolution for the visual novel web engine.
 */

export interface CompiledPuzzle {
  key: string
  kind: PuzzleKind
  title?: string
  data: Record<string, unknown>
  names: Record<string, string>
  text: Record<string, string>
  portraits: Record<string, string>
  clueAt: Record<string, string>
  onFail?: { mode: 'retry' | 'continue' | 'chapter'; to?: number; maxTries?: number }
  hints: boolean
  editions?: Record<string, { names: Record<string, string>; text: Record<string, string> }>
}

export interface PuzzleEmitResult {
  puzzles: Record<string, CompiledPuzzle>
  usedImages: {
    sprites: { charKey: string; expression: string }[]
    cgs: { key: string; display: 'full' | 'insert' }[]
  }
}

/** The puzzles that a beat plays, in the order of the book. */
export function playedPuzzles(book: VnBook): PuzzleEntry[] {
  const keys = new Set<string>()
  for (const c of book.chapters) {
    for (const s of c.scenes) {
      for (const b of s.beats) {
        if (b.type === 'puzzle') keys.add(b.puzzle)
      }
    }
  }
  return (book.puzzles ?? []).filter((p) => keys.has(p.key))
}

/** Item id -> the image shown in its header (Ren'Py image names for backward compatibility). */
export function puzzlePics(book: VnBook, p: PuzzleEntry): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [item, l] of Object.entries(p.links ?? {})) {
    if (l.type === 'character' && book.characters.some((c) => c.key === l.key)) {
      out[item] = spriteImageName(l.key, 'neutral')
    } else if (l.type === 'image' && book.images?.some((i) => i.key === l.key)) {
      out[item] = cgImageName(l.key)
    }
  }
  return out
}

/**
 * Item id -> image file path relative to game folder (`images/sprite_...` or `images/cg_...`).
 */
export function puzzlePortraits(book: VnBook, p: PuzzleEntry, format: ImageFormat = 'webp'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [item, l] of Object.entries(p.links ?? {})) {
    if (l.type === 'character' && book.characters.some((c) => c.key === l.key)) {
      out[item] = `images/${spriteImageName(l.key, 'neutral')}.${format}`
    } else if (l.type === 'image' && book.images?.some((i) => i.key === l.key)) {
      out[item] = `images/${cgImageName(l.key)}.${format}`
    }
  }
  return out
}

/** Compile a PuzzleEntry into a rich CompiledPuzzle for game-data.json */
export function compilePuzzle(book: VnBook, p: PuzzleEntry, format: ImageFormat = 'webp'): CompiledPuzzle {
  const portraits = puzzlePortraits(book, p, format)
  const { seed: _seed, band: _band, ...core } = p.data as unknown as Record<string, unknown>
  const data: Record<string, unknown> = { ...core }

  if ((p.kind === 'murdle' || p.kind === 'logic') && Array.isArray(core.clues)) {
    data.clues = (core.clues as Array<{ id: string }>).map((c) => ({
      ...c,
      ...(p.clueAt?.[c.id] ? { at: p.clueAt[c.id] } : {})
    }))
  }
  if (p.kind === 'testimony' && Array.isArray(core.evidence)) {
    data.evidence = (core.evidence as Array<{ id: string }>).map((e) => ({
      ...e,
      ...(p.clueAt?.[e.id] ? { at: p.clueAt[e.id] } : {})
    }))
  }

  return {
    key: p.key,
    kind: p.kind,
    data,
    names: { ...p.names },
    text: { ...p.text },
    portraits,
    clueAt: { ...(p.clueAt ?? {}) },
    onFail: p.onFail,
    hints: p.hints !== false
  }
}

/** Compile all played puzzles in the book and list referenced images. */
export function emitPuzzles(book: VnBook, format: ImageFormat = 'webp'): PuzzleEmitResult {
  const list = playedPuzzles(book)
  const puzzles: Record<string, CompiledPuzzle> = {}
  const usedSprites: { charKey: string; expression: string }[] = []
  const usedCgs: { key: string; display: 'full' | 'insert' }[] = []

  for (const p of list) {
    puzzles[p.key] = compilePuzzle(book, p, format)
    for (const l of Object.values(p.links ?? {})) {
      if (l.type === 'character') {
        usedSprites.push({ charKey: l.key, expression: 'neutral' })
      } else if (l.type === 'image') {
        const display = book.images?.find((i) => i.key === l.key)?.display ?? 'insert'
        usedCgs.push({ key: l.key, display })
      }
    }
  }

  return {
    puzzles,
    usedImages: {
      sprites: usedSprites,
      cgs: usedCgs
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ren'Py backward compatibility helpers
// ---------------------------------------------------------------------------------------------------------------------

function py(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (v === null || v === undefined) return 'None'
  if (Array.isArray(v)) return `[${v.map(py).join(', ')}]`
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`)
    .join(', ')}}`
}

function entryLiteral(p: PuzzleEntry, pics: Record<string, string>): string {
  const tr = (rec: Record<string, string>) => `{${Object.entries(rec).map(([k, t]) => `${JSON.stringify(k)}: _(${renpyString(t)})`).join(', ')}}`
  const { seed: _seed, band: _band, ...core } = p.data as unknown as Record<string, unknown>
  const data: Record<string, unknown> = Object.assign({ format: core.format, kind: core.kind, size: core.size }, core)
  if ((core.kind === 'murdle' || core.kind === 'logic') && Array.isArray(core.clues)) {
    data.clues = (core.clues as Array<{ id: string }>).map((c) => ({ ...c, ...(p.clueAt?.[c.id] ? { at: p.clueAt[c.id] } : {}) }))
  }
  if (core.kind === 'testimony' && Array.isArray(core.evidence)) {
    data.evidence = (core.evidence as Array<{ id: string }>).map((e) => ({ ...e, ...(p.clueAt?.[e.id] ? { at: p.clueAt[e.id] } : {}) }))
  }
  const parts = [
    ...Object.entries(data).map(([k, v]) => `${JSON.stringify(k)}: ${py(v)}`),
    `"names": ${tr(p.names)}`,
    `"text": ${tr(p.text)}`,
    `"hints": ${py(p.hints !== false)}`,
    ...(Object.keys(pics).length ? [`"pics": ${py(pics)}`] : []),
    ...(p.onFail ? [`"onFail": ${py(p.onFail)}`] : [])
  ]
  return `{${parts.join(', ')}}`
}

export function emitPuzzleData(book: VnBook): string | null {
  const list = playedPuzzles(book)
  if (!list.length) return null
  return [
    '# Generated by VN Studio. Do not edit: the next build overwrites this file.',
    'define vno_puzzle_data = {',
    ...list.map((p) => `    ${JSON.stringify(p.key)}: ${entryLiteral(p, puzzlePics(book, p))},`),
    '}',
    ''
  ].join('\n')
}

export function puzzleStrings(book: VnBook): { old: string; pick: (e: { puzzles?: Record<string, { names: Record<string, string>; text: Record<string, string> }> }) => string | undefined; what: string }[] {
  const out: ReturnType<typeof puzzleStrings> = []
  for (const p of playedPuzzles(book)) {
    for (const [item, name] of Object.entries(p.names)) out.push({ old: renpyText(name), pick: (e) => e.puzzles?.[p.key]?.names[item], what: `puzzle ${p.key} name of ${item}` })
    for (const [id, text] of Object.entries(p.text)) out.push({ old: renpyText(text), pick: (e) => e.puzzles?.[p.key]?.text[id], what: `puzzle ${p.key} ${id === 'murder' ? 'murder note' : `clue ${id}`}` })
  }
  return out
}
