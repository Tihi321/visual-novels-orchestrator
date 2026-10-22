import { visualWords } from '../assets/derive'
import type { Bible, BibleCharacter } from './bible'
import { normText } from './ids'

/**
 * Bible aliases. A Scriptorium bible sometimes lists one person twice: once under the name and once under a name the narration uses
 * (`the bald man`), each with its own bullet, so the importer made two characters, two sheets and two voices. Here the entry that is
 * the same person is found and merged into the other one as an alias, with a report; pairs that only look alike go to the script-analyst.
 */

const OPEN = '["“„\'‘]'
const CLOSE = '["”\'’]'
/** A quoted name after a word that introduces another name: `Narration calls him 'the bald man'`, `known as "Rusty"`, `zovu ga 'Brko'`. */
const ALIAS_AFTER = new RegExp(
  `(?:\\bcalls?\\s+(?:him|her|them|it)|\\balso\\s+called|\\bknown\\s+as|\\bcalled|\\bnicknamed|\\ba\\.k\\.a\\.?|\\bzovu\\s+(?:ga|je|ih)|\\bpoznata?\\s+kao|\\btakođer\\s+zvana?)\\s+(?:also\\s+)?${OPEN}([^"”’'‘“„]{2,60}?)${CLOSE}(?=[\\s.,;:)!?]|$)`,
  'giu'
)
/** An explicit list: `Aliases: the bald man, Rusty.` / `Also: ...`. */
const ALIAS_LIST = /\b(?:aliases|alias|also|nadimci|nadimak)\s*:\s*([^.\n]+)/iu

/** The other names an entry gives its character. The name itself and repeats are left out. */
export function extractAliases(text: string, name = ''): string[] {
  const found: string[] = []
  for (const m of text.matchAll(ALIAS_AFTER)) found.push(m[1]!)
  const list = ALIAS_LIST.exec(text)
  if (list) for (const part of list[1]!.split(/[,;]|\s+(?:or|ili)\s+/i)) found.push(part.replace(/^[\s"“„'‘]+|[\s"”'’]+$/g, ''))
  const own = normText(name)
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of found.map((s) => s.replace(/\s+/g, ' ').trim())) {
    const n = normText(a)
    if (a.length < 2 || a.length > 60 || !n || n === own || seen.has(n)) continue
    seen.add(n)
    out.push(a)
  }
  return out
}

/** The `Aliases: a, b.` sentence (the form Scriptorium writes) taken out of a description: the names are kept as `aliases`, the looks stay clean for the image prompts. */
export function stripAliasSentence(text: string): string {
  return text.replace(/(?:^|\s)(?:aliases|alias|nadimci|nadimak)\s*:\s*[^.\n]+\.?/iu, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim()
}

export interface AliasMerge {
  /** The name that became an alias. */
  alias: string
  /** The key of the character it was merged into. */
  into: string
  reason: string
}

export interface AliasSuspect {
  /** The entry that may be the same person as `of`. */
  alias: BibleCharacter
  of: BibleCharacter
  reason: string
}

export interface AliasResult {
  bible: Bible
  merged: AliasMerge[]
  /** Pairs that look alike but where no entry names the other: for the script-analyst. */
  suspects: AliasSuspect[]
}

const words = (s: string): string[] => normText(s).split(' ').filter(Boolean)
const padded = (s: string): string => ` ${normText(s)} `
const firstSentence = (s: string): string => /^(.*?)(?:[.!?](?:\s|$)|\n|$)/su.exec(s.trim())?.[1] ?? ''

/** The text of an entry that can name the person: the looks and the voice note. */
const entryText = (c: BibleCharacter): string => `${c.looks} ${c.voice ?? ''}`

/** Does the entry text of `a` give `b` as another name for the same person? Says how, or null. */
function namedIn(a: BibleCharacter, b: BibleCharacter): string | null {
  const bn = normText(b.name)
  if (!bn) return null
  const own = (a.aliases ?? []).map(normText)
  if (own.includes(bn)) return `named in ${a.name}'s entry`
  const text = entryText(a)
  const escaped = b.name.trim().replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
  const quoted = new RegExp(`${OPEN}\\s*${escaped}\\s*${CLOSE}`, 'iu').test(text)
  if (!(words(b.name).length >= 2 || quoted)) return null
  if (!padded(text).includes(padded(b.name))) return null
  // two people who mention each other (a brother, a wife) are two people: an alias is only named by the entry of the person it stands for
  if (!quoted && padded(entryText(b)).includes(padded(a.name))) return null
  return `named in ${a.name}'s entry`
}

/** Does `b`'s entry start with `a`'s name as its first sentence (`Dec. 34, from Galway`)? */
function startsWithName(a: BibleCharacter, b: BibleCharacter): string | null {
  const first = normText(firstSentence(b.looks))
  return first && first === normText(a.name) ? `its text starts with the name ${a.name}` : null
}

/** The overlap of what two entries say they look like (0 to 1), over the visible words. */
function looksOverlap(a: BibleCharacter, b: BibleCharacter): number {
  const x = visualWords(a.looks)
  const y = visualWords(b.looks)
  if (x.size < 2 || y.size < 2) return 0
  const both = [...x].filter((w) => y.has(w)).length
  return both / (x.size + y.size - both)
}

/**
 * Merges the entries that are the same person under another name. An entry B becomes an alias of A when A's text names B in full (two
 * words or more, or quoted) or lists it as an alias, or when B's text starts with A's name as its first sentence. A keeps its looks. Pairs
 * that only share looks (word overlap of 0.5 or more) are not merged: they come back in `suspects`.
 */
export function mergeBibleAliases(bible: Bible): AliasResult {
  const chars: BibleCharacter[] = bible.characters.map((c) => ({ ...c, ...(c.aliases ? { aliases: [...c.aliases] } : {}) }))
  const gone = new Set<string>()
  const merged: AliasMerge[] = []
  for (const b of chars) {
    if (gone.has(b.key)) continue
    for (const a of chars) {
      if (a.key === b.key || gone.has(a.key)) continue
      const reason = namedIn(a, b) ?? startsWithName(a, b)
      if (!reason) continue
      a.aliases = uniqueNames([...(a.aliases ?? []), b.name, ...(b.aliases ?? [])], a.name)
      gone.add(b.key)
      merged.push({ alias: b.name, into: a.key, reason })
      break
    }
  }
  const kept = chars.filter((c) => !gone.has(c.key))
  const suspects: AliasSuspect[] = []
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length && suspects.length < 10; j++) {
      const a = kept[i]!
      const b = kept[j]!
      const overlap = looksOverlap(a, b)
      if (overlap >= 0.5) suspects.push({ alias: b, of: a, reason: `${b.name} and ${a.name} are described with the same words (${Math.round(overlap * 100)}% of the looks)` })
    }
  }
  return { bible: { ...bible, characters: kept }, merged, suspects }
}

/** The names without repeats (case, diacritics and punctuation ignored; the first spelling stays), and without `own`. */
export function uniqueNames(names: string[], own = ''): string[] {
  const seen = new Set([normText(own)])
  return names.filter((n) => {
    const k = normText(n)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The index (1-based) of the alias of `c` that `label` is, or 0 when it is the name itself or nothing. */
export function aliasIndex(c: Pick<BibleCharacter, 'name' | 'aliases'>, label: string): number {
  const n = normText(label)
  if (!n || n === normText(c.name)) return 0
  return (c.aliases ?? []).findIndex((a) => normText(a) === n) + 1
}
