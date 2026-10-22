import { CANONICAL_EXPRESSIONS } from '../../shared/vn'
import type { CanonicalExpression, Expression, VnBook } from '../../shared/vn'
import { normText } from './ids'

/** The expression a sprite is made for when the set lacks one, nearest first: worried -> scared -> sad -> neutral. */
export const EXPRESSION_CHAIN: Record<string, string[]> = {
  worried: ['scared', 'sad', 'neutral'],
  scared: ['worried', 'sad', 'neutral'],
  sad: ['worried', 'neutral'],
  surprised: ['happy', 'neutral'],
  happy: ['neutral'],
  thinking: ['neutral'],
  angry: ['neutral']
}

/** The expressions a character has sprites for: the book's set (default: the standard eight) plus its own. */
export function expressionsOf(book: Pick<VnBook, 'expressions'>, char?: { expressions?: string[] }): Expression[] {
  return [...new Set([...(book.expressions ?? CANONICAL_EXPRESSIONS), ...(char?.expressions ?? [])])]
}

/** A standard expression in terms of `set`: itself, else the nearest one down its chain that the set has, else neutral. */
export function fitExpression(expression: string, set: readonly string[]): string {
  if (set.includes(expression)) return expression
  return (EXPRESSION_CHAIN[expression] ?? ['neutral']).find((e) => set.includes(e)) ?? 'neutral'
}

/**
 * Free-form expression words (English and Croatian) -> the canonical set.
 * Entries of 4+ letters also match as a prefix (`ljut` matches `ljuta`, `grin` matches `grinning`).
 */
const TABLE: Record<Exclude<CanonicalExpression, 'neutral'>, string[]> = {
  happy: [
    'happy', 'grin', 'smil', 'laugh', 'giggl', 'cheerful', 'delighted', 'joyful', 'joyous', 'pleased', 'proud', 'amused', 'glad', 'beaming',
    'excited', 'hopeful', 'relieved', 'kind', 'warm', 'bouncing', 'playful', 'thrilled', 'sretn', 'sretan', 'vesel', 'nasmijan',
    'osmjeh', 'smijes', 'radosn', 'zadovoljn', 'ponosn', 'uzbudjen', 'raduj', 'nasmijesen'
  ],
  sad: [
    'sad', 'crying', 'cried', 'cry', 'tearful', 'sniff', 'sobbing', 'sorry', 'disappointed', 'lonely', 'gloomy', 'upset', 'tuzn', 'tuzan', 'plak', 'placuc', 'suzn',
    'razocaran', 'ojadjen', 'usamljen'
  ],
  angry: [
    'angry', 'annoyed', 'grumpy', 'furious', 'cross', 'mad', 'stern', 'irritated', 'scowl', 'frown', 'ljut', 'bijesn', 'bijesan', 'razjaren',
    'ljutit', 'namrgodjen', 'nerviran', 'mrzovolj'
  ],
  surprised: [
    'surprised', 'startled', 'amazed', 'shocked', 'gasp', 'astonished', 'stunned', 'wow', 'iznenad', 'zaprepast', 'zapanjen', 'sokiran', 'zacudjen'
  ],
  worried: [
    'worried', 'anxious', 'nervous', 'concerned', 'uneasy', 'hesitant', 'sheepish', 'fretful', 'zabrinut', 'nervozn', 'nervozan', 'uznemiren',
    'brizn', 'nesiguran', 'ustrucan'
  ],
  scared: ['scared', 'afraid', 'frightened', 'terrified', 'fearful', 'trembling', 'uplasen', 'preplasen', 'prestrasen', 'uzasnut', 'bojazljiv', 'uplas'],
  thinking: [
    'thinking', 'thoughtful', 'curious', 'ponder', 'puzzled', 'confused', 'interested', 'wondering', 'pensive', 'zamislj', 'znatizelj',
    'razmisl', 'zbunjen', 'smeten', 'zainteresiran'
  ]
}
const NEUTRAL = ['neutral', 'calm', 'normal', 'plain', 'neutralan', 'miran', 'mirna', 'smiren']

function matchToken(tok: string): CanonicalExpression | null {
  if (NEUTRAL.includes(tok)) return 'neutral'
  for (const [expr, words] of Object.entries(TABLE) as [CanonicalExpression, string[]][]) {
    for (const w of words) {
      if (tok === w || (w.length >= 4 && tok.startsWith(w))) return expr
    }
  }
  return null
}

/**
 * The expression named by free text (a bracket like `grinning` or a look like `out of breath, grinning`), or null. A word of `set` wins as it is;
 * else the standard table maps it, and a standard word the set lacks goes down the chain to the nearest one it has.
 */
export function findExpression(text: string, set: readonly string[] = CANONICAL_EXPRESSIONS): Expression | null {
  for (const tok of normText(text).split(' ')) {
    if (!tok) continue
    if (set.includes(tok)) return tok
    const m = matchToken(tok)
    if (m) return fitExpression(m, set)
  }
  return null
}

export interface MappedExpression {
  expression: Expression
  /** The expression as written, when it was not already one of the words of the set. */
  rawExpression?: string
  /** False when nothing matched and `neutral` is a fallback. */
  known: boolean
}

/** Maps a written expression to the set (default: the standard eight); unknown words become `neutral` with the raw text kept. */
export function mapExpression(raw: string, set: readonly string[] = CANONICAL_EXPRESSIONS): MappedExpression {
  const text = raw.trim()
  const found = findExpression(text, set)
  if (!found) return { expression: 'neutral', rawExpression: text || undefined, known: false }
  const same = normText(text) === found
  return same ? { expression: found, known: true } : { expression: found, rawExpression: text, known: true }
}
