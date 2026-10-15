import type { CanonicalExpression } from '../../shared/vn'
import { normText } from './ids'

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

/** The canonical expression named by free text (a bracket like `grinning` or a look like `out of breath, grinning`), or null. */
export function findExpression(text: string): CanonicalExpression | null {
  for (const tok of normText(text).split(' ')) {
    if (!tok) continue
    const m = matchToken(tok)
    if (m) return m
  }
  return null
}

export interface MappedExpression {
  expression: CanonicalExpression
  /** The expression as written, when it was not already one of the standard words. */
  rawExpression?: string
  /** False when nothing matched and `neutral` is a fallback. */
  known: boolean
}

/** Maps a written expression to the canonical set; unknown words become `neutral` with the raw text kept. */
export function mapExpression(raw: string): MappedExpression {
  const text = raw.trim()
  const found = findExpression(text)
  if (!found) return { expression: 'neutral', rawExpression: text || undefined, known: false }
  const same = normText(text) === found
  return same ? { expression: found, known: true } : { expression: found, rawExpression: text, known: true }
}
