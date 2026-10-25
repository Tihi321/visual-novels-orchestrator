import type { Expression, ImageEntry, Presentation, SoundEntry, VnBeat, VnScene } from '../../shared/vn'
import type { Bible, BibleCharacter, BiblePlace } from './bible'
import { mapExpression } from './expressions'
import { backgroundIdFor, beatId, normText, sceneId, slugKey } from './ids'

// The script grammar (docs/visual-novel.md), with Croatian keyword aliases.
export const SCENE_RE = /^\**\s*(?:scene|scena)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const CAST_RE = /^\**\s*(?:on screen|na ekranu)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const LINE_RE = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
const BREAK_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const HEADING_SCENE_RE = /^#{2,6}\s+(.+?)\s*#*\s*$/
/** A cue line: `CG: ...`, `INSERT: ...`, `SFX: ...`, `AMBIENCE: ...` (Croatian `SLIKA`, `ZVUK`, `ATMOSFERA`); `CG: none` and `END CG` hide the picture. */
export const CUE_RE = /^\**\s*(CG|SLIKA|INSERT|SFX|SOUND|ZVUK|AMBIENCE|ATMOSFERA)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const END_CG_RE = /^\**\s*(?:END\s+CG|KRAJ\s+SLIKE)\s*\**$/iu
/**
 * The puzzle lines of a mystery-puzzle book (docs/visual-novel.md, Puzzles): `CLUE: <puzzle>/<clue>: <prose>`, `EVIDENCE: <key>: <prose>`,
 * `PUZZLE: <key> (<kind>)`, `TESTIMONY: <witness>` ... `END TESTIMONY`. Croatian keywords: TRAG, DOKAZ, ZAGONETKA, SVJEDOČENJE, KRAJ SVJEDOČENJA.
 */
export const CLUE_RE = /^\**\s*(CLUE|TRAG)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*\/\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const EVIDENCE_RE = /^\**\s*(EVIDENCE|DOKAZ)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
export const PUZZLE_RE = /^\**\s*(PUZZLE|ZAGONETKA)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*(?:\(\s*([A-Za-z0-9_-]+)\s*\))?\s*\**$/iu
export const TESTIMONY_RE = /^\**\s*(TESTIMONY|SVJEDOČENJE)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const END_TESTIMONY_RE = /^\**\s*(?:END\s+TESTIMONY|KRAJ\s+SVJEDOČENJA)\s*\**$/iu
const NARRATION_RE = /^\**\s*(?:narration|narrator|naracija|pripovjeda[čc])\s*\**(?:\s*\([^)]*\))?\s*:\**\s*(.*)$/iu

/**
 * Screenplay directions that look like a speaker label (`SMASH CUT TO: ...`, `FADE OUT.`, `INT. KITCHEN - DAY`, `PRIJELAZ NA: ...`).
 * They are not characters: the parser keeps the text after the label as narration, or drops a direction with no text.
 */
const DIRECTION_RE =
  /^(?:(?:(?:SMASH|MATCH|JUMP|HARD|QUICK) )?CUT(?: (?:TO|BACK TO|NA))?|FADE(?: (?:IN|OUT|TO(?: (?:BLACK|WHITE))?|U CRNO))?|DISSOLVE(?: TO)?|(?:INT|EXT)(?:[ ./].*)?|REZ(?: NA)?|PRIJELAZ(?: NA)?|ZATAMNJENJE)$/u

/** True for a label (the text before the colon of a LINE) that is a screenplay direction, not a speaker. */
export function isDirectionLabel(label: string): boolean {
  const l = label.replace(/\*+/g, '').replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim().toUpperCase()
  return !!l && DIRECTION_RE.test(l)
}

/** A line that is only a direction (`FADE OUT.`, `CUT TO:`). */
const DIRECTION_ONLY_RE = /^\**([\p{Lu}][\p{Lu}\p{N}'’ ./-]{0,40}?)\**\s*[:.]?\**$/u

/** Canonical English time keys. Unknown words give null. */
export const TIME_WORDS: Record<string, string> = {
  dawn: 'dawn', daybreak: 'dawn', sunrise: 'dawn', zora: 'dawn', zorom: 'dawn', svitanje: 'dawn',
  morning: 'morning', jutro: 'morning', jutra: 'morning', jutru: 'morning', jutarnje: 'morning', ujutro: 'morning',
  day: 'day', daytime: 'day', noon: 'day', midday: 'day', dan: 'day', podne: 'day', podnevu: 'day', danju: 'day',
  afternoon: 'afternoon', poslijepodne: 'afternoon', popodne: 'afternoon',
  evening: 'evening', vecer: 'evening', veceri: 'evening', navecer: 'evening', uvecer: 'evening',
  dusk: 'dusk', sunset: 'dusk', twilight: 'dusk', sumrak: 'dusk', sumraku: 'dusk', zalazak: 'dusk',
  night: 'night', midnight: 'night', noc: 'night', nocu: 'night', ponoc: 'night', noci: 'night'
}

/** The canonical time named in a short text, or null. */
export function detectTime(text: string): string | null {
  for (const tok of normText(text).split(' ')) {
    const t = TIME_WORDS[tok]
    if (t) return t
  }
  return null
}

export interface SceneLine {
  place: string
  time: string | null
  /** What follows the first sentence: a description of the place. */
  rest: string
}

/** `Petra's garden, morning. A small cottage ...` -> place, time, description. */
export function parseSceneLine(text: string): SceneLine {
  const t = text.replace(/\*+/g, '').trim()
  const m = /^(.*?)\.(?=\s|$)\s*(.*)$/s.exec(t)
  const head = (m ? m[1]! : t).trim()
  const rest = (m ? m[2]! : '').trim()
  const idx = head.lastIndexOf(',')
  if (idx >= 0) {
    const tail = head.slice(idx + 1)
    const time = tail.trim().split(/\s+/).length <= 4 ? detectTime(tail) : null
    if (time) return { place: head.slice(0, idx).trim(), time, rest }
  }
  return { place: head, time: null, rest }
}

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'near', 'inside', 'outside', 'u', 'na', 'kod', 'unutar', 'ispred', 'pored', 'i', 'with', 'by', 'over', 'to'])
const contentTokens = (s: string) => normText(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t))

/** Matches a SCENE place text against the bible places: by key, by containment either way, then by first words. */
export function matchPlace(placeText: string, places: BiblePlace[]): string | null {
  const text = normText(placeText)
  if (!text || !places.length) return null
  const key = slugKey(placeText)
  const byKey = places.find((p) => p.key === key)
  if (byKey) return byKey.key
  const padded = ` ${text} `
  let best: { key: string; len: number } | null = null
  for (const p of places) {
    const name = normText(p.name)
    if (!name) continue
    if (padded.includes(` ${name} `) || ` ${name} `.includes(padded)) {
      if (!best || name.length > best.len) best = { key: p.key, len: name.length }
    }
  }
  if (best) return best.key
  const first = contentTokens(placeText)[0]
  if (!first || first.length < 4) return null
  const cands = places.filter((p) => contentTokens(p.name)[0] === first)
  if (cands.length === 1) return cands[0]!.key
  if (cands.length > 1) {
    const mine = new Set(contentTokens(placeText))
    const score = (p: BiblePlace) => contentTokens(p.name).filter((t) => mine.has(t)).length
    return [...cands].sort((a, b) => score(b) - score(a))[0]!.key
  }
  return null
}

/**
 * Words that say what someone is rather than who: articles, titles, relations, ages. They are left out when a name is matched loosely, so
 * "the silver-haired man" is not the first bible name that starts with "The", and "Madame Ferré" is not "Madame Jobin".
 */
const NOT_NAMES = new Set([
  'the', 'a', 'an', 'of', 'man', 'woman', 'lady', 'girl', 'boy', 'old', 'young', 'brother', 'sister', 'mother', 'father', 'mr', 'mrs', 'ms',
  'madame', 'monsieur', 'mademoiselle', 'maitre', 'frere', 'mere', 'dr', 'doctor', 'sir',
  // Croatian
  'gospodin', 'gospoda', 'gospodica', 'doktor', 'doktorica', 'brat', 'sestra', 'majka', 'otac', 'stari', 'stara', 'mladi', 'mlada', 'covjek', 'zena', 'djevojka', 'djecak'
])

/** A name token counts from 3 letters in a Latin script, from 2 in the others (a Chinese or Cyrillic name can be short). */
const minLength = (t: string): number => (/^[\p{Script=Latin}\p{N}]+$/u.test(t) ? 3 : 2)
const significantTokens = (s: string): string[] => normText(s).split(' ').filter((t) => t.length >= minLength(t) && !NOT_NAMES.has(t))

export interface CharacterMatch {
  key: string
  /** The name, key or an alias, or a bare first name: nothing to double-check. False for a looser match (a partial overlap). */
  exact: boolean
}

/** The character whose name, key or alias is exactly this text (case, diacritics and punctuation ignored). */
export function exactCharacter(label: string, chars: BibleCharacter[]): string | null {
  const l = normText(label)
  if (!l) return null
  const lk = slugKey(label)
  return chars.find((c) => normText(c.name) === l || c.key === lk || (c.aliases ?? []).some((a) => normText(a) === l))?.key ?? null
}

/**
 * Matches a speaker label or an ON SCREEN entry against the bible characters. The name, key or an alias first; then, ignoring articles and
 * titles, the first name word, then a name that starts the text or is started by it; for a speaker label (not for an ON SCREEN `entry`), a
 * single character that shares a name word. Only names of three words or fewer are matched loosely.
 */
export function matchCharacterDetail(label: string, chars: BibleCharacter[], o: { entry?: boolean } = {}): CharacterMatch | null {
  if (!normText(label) || !chars.length) return null
  const key = exactCharacter(label, chars)
  if (key) return { key, exact: true }
  const lTok = significantTokens(label)
  if (!lTok.length) return null
  const cands = chars.map((c) => ({ c, tok: significantTokens(c.name) })).filter((x) => x.tok.length && normText(x.c.name).split(' ').length <= 3)
  const first = cands.find((x) => x.tok[0] === lTok[0])
  if (first) return { key: first.c.key, exact: lTok.length === 1 }
  const l = lTok.join(' ')
  const starts = cands.find((x) => x.tok.join(' ').startsWith(l + ' ') || l.startsWith(x.tok.join(' ') + ' '))
  if (starts) return { key: starts.c.key, exact: false }
  if (!o.entry) {
    const overlap = cands.filter((x) => x.tok.some((t) => lTok.includes(t)))
    if (overlap.length === 1) return { key: overlap[0]!.c.key, exact: false }
  }
  return null
}

/** The most characters a CG or insert gets from its cue text (the art director draws from their sheets). */
export const MAX_CUE_CHARACTERS = 3

/** Words after a possessive name that are part of the person (Ivka's hand): the name then puts her in the picture. */
const BODY_WORDS = new Set(['hand', 'hands', 'face', 'hair', 'eyes', 'eye', 'shoulder', 'shoulders', 'back', 'arm', 'arms', 'fingers', 'finger', 'head', 'feet', 'foot', 'legs', 'lap', 'mouth', 'braids', 'braid', 'silhouette', 'shadow', 'reflection', 'profile', 'gaze', 'smile', 'voice', 'figure'])

/**
 * The cue text without what only names a character: a name in a possessive that names a place or thing (`Ivka's shop`, not `Ivka's hand`), and
 * a name in text written on a document: a run of two or more all-caps words (`FOR IVKA`), one all-caps word after headed / signed / titled /
 * reads / marked / addressed, and anything in quotation marks.
 */
export function withoutNamesOnThings(text: string): string {
  return text
    .replace(/["“][^"”]*["”]/gu, ' ')
    .replace(/(?<!\p{L})(?:headed|signed|titled|labelled|labeled|marked|addressed(?: to)?|reads?|stamped)\s+\p{Lu}{2,}(?!\p{L})/gu, ' ')
    .replace(/(?<!\p{L})\p{Lu}{2,}(?:[\s,.:;!?-]+\p{Lu}{2,})+(?!\p{L})/gu, ' ')
    .replace(/(\p{L}+)['’]s\s+(\p{L}+)/gu, (all, _name: string, next: string) => (BODY_WORDS.has(next.toLowerCase()) ? all : ' '))
}

/**
 * The bible characters whose name or alias appears, as whole words, in a cue text, in the order they appear; at most `MAX_CUE_CHARACTERS`.
 * A name in a possessive that names a place or thing, or in text written on a document, does not count (see `withoutNamesOnThings`).
 */
export function charactersInText(text: string, chars: BibleCharacter[]): string[] {
  const hay = ` ${normText(withoutNamesOnThings(text))} `
  const found: { key: string; at: number }[] = []
  for (const c of chars) {
    let at = -1
    for (const form of [c.name, ...(c.aliases ?? [])]) {
      const n = normText(form)
      if (!n) continue
      const i = hay.indexOf(` ${n} `)
      if (i >= 0 && (at < 0 || i < at)) at = i
    }
    if (at >= 0) found.push({ key: c.key, at })
  }
  return found.sort((a, b) => a.at - b.at).slice(0, MAX_CUE_CHARACTERS).map((f) => f.key)
}

export function matchCharacter(label: string, chars: BibleCharacter[], o: { entry?: boolean } = {}): string | null {
  return matchCharacterDetail(label, chars, o)?.key ?? null
}

const PROP_START = /^(?:a|an|the|over|on|in|at|under|beside|na|u|iznad)\s/i
const withoutBrackets = (s: string): string => s.replace(/\([^)]*\)/g, ' ').replace(/\*+/g, '').replace(/\s+/g, ' ').trim()

/**
 * Is an ON SCREEN line a prop (a ledger page, a sign, a letter) and not a list of people? It is when, outside the brackets, it has a colon or
 * a slash between parts; or an entry has more than five words or a sentence inside it; or it starts with an article or a preposition and its
 * first entry is not a character by name, key or alias.
 */
export function classifyOnScreen(text: string, bible: Pick<Bible, 'characters'>): 'prop' | 'cast' {
  const flat = withoutBrackets(text)
  if (flat.includes(':') || flat.includes(' / ')) return 'prop'
  const entries = splitTopLevel(text).map(withoutBrackets)
  for (const e of entries) {
    // a long entry is a sentence, not a name; a leading article does not count ("the soother spinning in the sky" is a hint, not a sentence)
    const bare = e.replace(/[.!;]+$/, '').replace(/^(?:a|an|the)\s+/i, '').trim()
    if (bare.split(' ').filter(Boolean).length > 5 || /[.;!]/.test(bare)) return 'prop'
  }
  const first = entries[0] ?? ''
  if (PROP_START.test(first) && !exactCharacter(first, bible.characters)) return 'prop'
  return 'cast'
}

/** Splits on commas outside brackets. */
export function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

export type UncertainKind = 'place' | 'time' | 'speaker' | 'cast' | 'expression' | 'alias'

/** Something the deterministic parser could not settle; the script-analyst agent looks at these later. */
export interface Uncertain {
  kind: UncertainKind
  chapter: number
  sceneId: string
  beatId?: string
  text: string
  reason: string
  /** A character the item is about: the one a loose ON SCREEN match pointed at, or the entry that may be the same person (kind alias). */
  charKey?: string
}

/** What the puzzle lines of one chapter said, with the beats they became. */
export interface PuzzleLines {
  /** `CLUE: dinner/c2: prose`: a narration beat that shows the clue. */
  clues: { chapter: number; puzzle: string; clue: string; text: string; beatId: string }[]
  /** `EVIDENCE: key: prose`: a narration beat; the item is also a picture (an `insert`) of the book's catalogue, with the key `key` as a slug. */
  evidence: { chapter: number; key: string; imageKey: string; text: string; beatId: string }[]
  /** `PUZZLE: key (kind)`: a `puzzle` beat. */
  puzzles: { chapter: number; key: string; kind: string | null; beatId: string }[]
  /** `TESTIMONY: witness` ... `END TESTIMONY`: the statements are ordinary speaker lines (beats), in order. */
  testimonies: { chapter: number; witness: string; statements: { n: number; speaker: string; text: string; beatId: string }[] }[]
}

export interface ParsedChapterScript {
  scenes: VnScene[]
  uncertain: Uncertain[]
  warnings: string[]
  /** The pictures and sounds the cue lines of this chapter named (the book's catalogue gets them). */
  images: ImageEntry[]
  sounds: SoundEntry[]
  /** The puzzle lines (empty for a book without them). */
  puzzleLines: PuzzleLines
}

const CUE_STOP = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'to', 'and', 'with', 'by', 'for', 'from', 'u', 'na', 'i', 's', 'sa', 'iz', 'za', 'od'])

/** The catalogue key of a cue description: its first four content words (`The ledger page lies open on the desk` -> `ledger_page_lies_open`). */
export function cueKey(text: string): string {
  const words = normText(text).split(' ').filter((w) => w.length > 1 && !CUE_STOP.has(w)).slice(0, 4)
  return slugKey(words.join(' ') || text)
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type BeatBody = DistributiveOmit<VnBeat, 'id'>

interface BeatDraft {
  body: BeatBody
  /** Cast entries matched by a loose rule: char key -> the entry as written. They need a second look (`checkCasts`). */
  loose?: Map<string, string>
}
interface SceneDraft {
  placeText: string
  placeKey: string | null
  time: string | null
  description: string[]
  beats: BeatDraft[]
  breakBefore: boolean
}
interface UncertainDraft {
  kind: UncertainKind
  scene: SceneDraft
  beat?: BeatDraft
  text: string
  reason: string
}

/**
 * A second look at the cast of every scene. A character put on screen by a loose name match who neither speaks in the scene nor is named
 * in its narration (by name or alias) is taken off the cast and flagged for the script-analyst (`named only: on screen?`): an entry that only
 * reads, lists or remembers someone is not a person who is there. A cast of more than three is flagged too. `loose`: beat id -> char key ->
 * the entry as written. Edits the scenes and returns the flagged items.
 */
export function checkCasts(scenes: VnScene[], bible: Pick<Bible, 'characters'>, loose: Map<string, Map<string, string>>, chapter: number): Uncertain[] {
  const out: Uncertain[] = []
  const chars = new Map(bible.characters.map((c) => [c.key, c]))
  for (const scene of scenes) {
    const speakers = new Set(scene.beats.flatMap((b) => (b.type === 'line' && b.speakerKey ? [b.speakerKey] : [])))
    const narrated = ` ${normText([scene.description, ...scene.beats.map((b) => (b.type === 'narration' ? b.text : ''))].join(' '))} `
    const named = (key: string): boolean => {
      const c = chars.get(key)
      if (!c) return false
      const forms = [normText(c.name), ...significantTokens(c.name), ...(c.aliases ?? []).map(normText)].filter(Boolean)
      return forms.some((f) => narrated.includes(` ${f} `))
    }
    for (const beat of scene.beats) {
      if (beat.type !== 'cast') continue
      for (const [key, entry] of loose.get(beat.id) ?? []) {
        if (!beat.cast.some((c) => c.charKey === key) || speakers.has(key) || named(key)) continue
        beat.cast = beat.cast.filter((c) => c.charKey !== key)
        out.push({ kind: 'cast', chapter, sceneId: scene.id, beatId: beat.id, text: entry, reason: 'named only: on screen?', charKey: key })
      }
      beat.cast.slice(3).forEach((c) => out.push({ kind: 'cast', chapter, sceneId: scene.id, beatId: beat.id, text: chars.get(c.charKey)?.name ?? c.charKey, reason: 'more than 3 on screen', charKey: c.charKey }))
    }
  }
  return out
}

/** Parses one chapter's script, leniently. Never throws. `presentation` gives a picture book one page id per scene (`bg_ch01_s01`). */
export function parseChapterScript(body: string, opts: { chapter: number; bible: Bible; presentation?: Presentation }): ParsedChapterScript {
  const { chapter, bible } = opts
  const warnings: string[] = []
  const drafts: SceneDraft[] = []
  const unc: UncertainDraft[] = []
  const seenUnc = new Set<string>()
  let cur: SceneDraft | null = null
  let pendingBreak = false
  let lastExpr = new Map<string, Expression>()
  const images = new Map<string, ImageEntry>()
  const sounds = new Map<string, SoundEntry>()
  // the puzzle lines, with the drafts of the beats they became (the beat ids are known only when the scenes are numbered)
  const clueDrafts: { puzzle: string; clue: string; text: string; beat: BeatDraft }[] = []
  const evidenceDrafts: { key: string; imageKey: string; text: string; beat: BeatDraft; scene: SceneDraft }[] = []
  const puzzleDrafts: { key: string; kind: string | null; beat: BeatDraft }[] = []
  const testimonyDrafts: { witness: string; line: number; statements: { speaker: string; text: string; beat: BeatDraft }[] }[] = []
  let testimony: (typeof testimonyDrafts)[number] | null = null
  let lineNo = 0
  /** Cues read since the last beat: they go on the next beat of the scene. */
  let pending: { image?: string | null; sfx?: string; ambience?: string | null } = {}

  /**
   * A cue with no beat after it in its scene: a sound effect goes on the scene's last beat (when that beat has none of its own), so the sound
   * is not left in the catalogue with no cue; the other cues are dropped, with a warning.
   */
  const dropPending = (where: string) => {
    const last = drafts[drafts.length - 1]?.beats.at(-1)
    if (pending.sfx && last && !(last.body as { sfx?: string }).sfx) {
      Object.assign(last.body, { sfx: pending.sfx })
      delete pending.sfx
    }
    if (Object.keys(pending).length) warnings.push(`chapter ${chapter}: a ${Object.keys(pending).map((k) => (k === 'image' ? 'CG' : k === 'sfx' ? 'SFX' : 'AMBIENCE')).join(' and ')} line ${where} has no beat after it in its scene: dropped`)
    pending = {}
  }
  /** Adds a beat to a scene, with the cues that wait for it. */
  const add = (s: SceneDraft, beat: BeatDraft) => {
    Object.assign(beat.body, pending)
    pending = {}
    s.beats.push(beat)
  }

  const flag = (d: UncertainDraft, dedupe?: string) => {
    if (dedupe) {
      if (seenUnc.has(dedupe)) return
      seenUnc.add(dedupe)
    }
    unc.push(d)
  }

  const openScene = (placeText: string, placeKey: string | null, time: string | null, description: string[], breakBefore: boolean): SceneDraft => {
    dropPending('at the end of a scene')
    const s: SceneDraft = { placeText, placeKey, time, description, beats: [], breakBefore }
    drafts.push(s)
    lastExpr = new Map()
    return s
  }

  /** The scene a content line belongs to: the current one, a new one after a break, or an implicit first one. */
  const scene = (): SceneDraft => {
    if (!cur) {
      warnings.push(`chapter ${chapter}: the script has text before any SCENE line`)
      cur = openScene('', null, null, [], false)
    } else if (pendingBreak && cur.beats.length) {
      cur = openScene(cur.placeText, cur.placeKey, cur.time, [], true)
    }
    pendingBreak = false
    return cur
  }

  const startScene = (raw: string) => {
    const p = parseSceneLine(raw)
    const breakBefore = pendingBreak && drafts.length > 0
    pendingBreak = false
    const placeKey = matchPlace(p.place, bible.places)
    const s = openScene(p.place, placeKey, p.time, p.rest ? [p.rest] : [], breakBefore)
    cur = s
    if (p.place && !placeKey) flag({ kind: 'place', scene: s, text: p.place, reason: 'no bible place matches' })
    if (!p.time) flag({ kind: 'time', scene: s, text: raw, reason: 'no time of day recognised' })
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#\s/.test(line)) continue
    lineNo++
    if (testimony) {
      // a testimony lasts while speaker lines follow it, or until END TESTIMONY
      if (END_TESTIMONY_RE.test(line)) {
        testimony = null
        continue
      }
      if (testimony.line !== lineNo - 1) testimony = null
    }
    if (BREAK_RE.test(line)) {
      if (cur) pendingBreak = true
      continue
    }
    const sm = SCENE_RE.exec(line) ?? HEADING_SCENE_RE.exec(line)
    if (sm) {
      startScene(sm[1]!)
      continue
    }
    const cue = CUE_RE.exec(line)
    if (cue) {
      scene()
      const kind = cue[1]!.toUpperCase()
      const text = cue[2]!.trim()
      if (!text) continue
      if (kind === 'CG' || kind === 'SLIKA' || kind === 'INSERT') {
        if (/^(?:none|ništa|nista)$/i.test(text)) pending.image = null
        else {
          const key = cueKey(text)
          if (!images.has(key)) {
            // an insert is an object close-up: it never gets characters from its text
            const characters = kind === 'INSERT' ? [] : charactersInText(text, bible.characters)
            images.set(key, { key, description: text, display: kind === 'INSERT' ? 'insert' : 'full', ...(characters.length ? { characters } : {}) })
          }
          pending.image = key
        }
      } else if (kind === 'AMBIENCE' || kind === 'ATMOSFERA') {
        if (/^(?:none|ništa|nista)$/i.test(text)) pending.ambience = null
        else {
          const key = cueKey(text)
          if (!sounds.has(`ambience:${key}`)) sounds.set(`ambience:${key}`, { key, kind: 'ambience', description: text })
          pending.ambience = key
        }
      } else {
        const key = cueKey(text)
        if (!sounds.has(`sfx:${key}`)) sounds.set(`sfx:${key}`, { key, kind: 'sfx', description: text })
        pending.sfx = key
      }
      continue
    }
    if (END_CG_RE.test(line)) {
      scene()
      pending.image = null
      continue
    }
    const clue = CLUE_RE.exec(line)
    if (clue) {
      const text = clue[4]!.trim()
      if (text) {
        const beat: BeatDraft = { body: { type: 'narration', text } }
        add(scene(), beat)
        clueDrafts.push({ puzzle: clue[2]!, clue: clue[3]!, text, beat })
      }
      continue
    }
    const evidence = EVIDENCE_RE.exec(line)
    if (evidence) {
      const text = evidence[3]!.trim()
      if (text) {
        const key = evidence[2]!
        const imageKey = slugKey(key)
        if (!images.has(imageKey)) images.set(imageKey, { key: imageKey, description: text, display: 'insert' })
        const beat: BeatDraft = { body: { type: 'narration', text } }
        const s = scene()
        add(s, beat)
        // the picture is shown with its line, whatever the puzzles of the book are (VNO-30); an INSERT: line right before it wins
        if (beat.body.image === undefined) beat.body.image = imageKey
        evidenceDrafts.push({ key, imageKey, text, beat, scene: s })
      }
      continue
    }
    const pz = PUZZLE_RE.exec(line)
    if (pz) {
      const s = scene()
      const beat: BeatDraft = { body: { type: 'puzzle', puzzle: pz[2]! } }
      s.beats.push(beat)
      puzzleDrafts.push({ key: pz[2]!, kind: pz[3] ? pz[3].toLowerCase() : null, beat })
      continue
    }
    const tm = TESTIMONY_RE.exec(line)
    if (tm) {
      scene()
      testimony = { witness: tm[2]!.replace(/\*+/g, '').trim(), line: lineNo, statements: [] }
      testimonyDrafts.push(testimony)
      continue
    }
    const cm = CAST_RE.exec(line)
    if (cm && classifyOnScreen(cm[1]!, bible) === 'prop') {
      // a ledger page, a sign, a letter: the reader is shown it as narration, and the scene keeps it as a hint. Nobody is cast.
      const s = scene()
      const text = cm[1]!.replace(/\*+/g, '').trim()
      add(s, { body: { type: 'narration', text } })
      s.description.push(`Also on screen: ${text}.`)
      continue
    }
    if (cm) {
      const s = scene()
      const cast: { charKey: string; look?: string }[] = []
      const hints: string[] = []
      const beat: BeatDraft = { body: { type: 'cast', cast } }
      for (const entry of splitTopLevel(cm[1]!)) {
        const em = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(entry)
        const name = (em ? em[1]! : entry).replace(/\*+/g, '').trim()
        const look = em ? em[2]!.trim() : ''
        const m = matchCharacterDetail(name, bible.characters, { entry: true })
        if (m) {
          const key = m.key
          if (!cast.some((c) => c.charKey === key)) cast.push({ charKey: key, ...(look ? { look } : {}) })
          if (!m.exact) (beat.loose ??= new Map()).set(key, entry.replace(/\*+/g, '').trim())
        } else {
          hints.push(entry.replace(/\*+/g, '').trim())
          flag({ kind: 'cast', scene: s, beat, text: entry, reason: 'not a bible character: kept as a scene hint' })
        }
      }
      if (hints.length) s.description.push(`Also on screen: ${hints.join('; ')}.`)
      add(s, beat)
      continue
    }
    const nm = NARRATION_RE.exec(line)
    if (nm) {
      const text = nm[1]!.trim()
      if (text) add(scene(), { body: { type: 'narration', text } })
      continue
    }
    const dm = DIRECTION_ONLY_RE.exec(line)
    if (dm && isDirectionLabel(dm[1]!)) continue // `FADE OUT.`, `CUT TO:`: a direction with no text, nothing to show
    const lm = LINE_RE.exec(line)
    if (lm && isDirectionLabel(lm[1]!)) {
      // `SMASH CUT TO: Grumble sets the soother down.`: the label is a stage direction, not a speaker; the text stays as narration
      const text = lm[3]!.trim()
      if (text) add(scene(), { body: { type: 'narration', text } })
      continue
    }
    if (lm) {
      const s = scene()
      const label = lm[1]!.replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
      const speakerKey = matchCharacter(label, bible.characters)
      const memo = speakerKey ?? `?${label}`
      let expression: Expression = lastExpr.get(memo) ?? 'neutral'
      let rawExpression: string | undefined
      let unknownExpr = false
      if (lm[2] !== undefined && lm[2].trim()) {
        const m = mapExpression(lm[2])
        expression = m.expression
        rawExpression = m.rawExpression
        unknownExpr = !m.known
      }
      lastExpr.set(memo, expression)
      const beat: BeatDraft = {
        body: {
          type: 'line',
          speakerKey,
          speakerLabel: label,
          expression,
          ...(rawExpression ? { rawExpression } : {}),
          text: lm[3]!.trim()
        }
      }
      add(s, beat)
      if (testimony) {
        testimony.line = lineNo
        testimony.statements.push({ speaker: label, text: lm[3]!.trim(), beat })
      }
      if (!speakerKey) flag({ kind: 'speaker', scene: s, beat, text: label, reason: 'not a bible character' }, `speaker:${label}`)
      if (unknownExpr && rawExpression) flag({ kind: 'expression', scene: s, beat, text: rawExpression, reason: `unknown expression for ${label}: neutral used` }, `expr:${label}|${rawExpression}`)
      continue
    }
    add(scene(), { body: { type: 'narration', text: line } })
  }

  dropPending('at the end of the chapter')
  // An evidence picture is hidden at the next beat of its scene (the end of the scene clears it), unless that beat shows or hides one itself.
  for (const e of evidenceDrafts) {
    if (e.beat.body.image !== e.imageKey) continue
    const next = e.scene.beats[e.scene.beats.indexOf(e.beat) + 1]
    if (next && next.body.image === undefined) next.body.image = null
  }

  // Number the scenes that have beats.
  const scenes: VnScene[] = []
  const ids = new Map<SceneDraft, string>()
  const beatIds = new Map<BeatDraft, string>()
  for (const d of drafts) {
    if (!d.beats.length) {
      warnings.push(`chapter ${chapter}: a SCENE line ("${d.placeText}") has no text after it and was skipped`)
      continue
    }
    const id = sceneId(chapter, scenes.length + 1)
    ids.set(d, id)
    const beats = d.beats.map((b, i) => {
      const bid = beatId(id, i + 1)
      beatIds.set(b, bid)
      return { id: bid, ...b.body } as VnBeat
    })
    scenes.push({
      id,
      placeKey: d.placeKey,
      placeText: d.placeText,
      time: d.time,
      backgroundId: backgroundIdFor(opts.presentation, id, d.placeKey, d.placeText, d.time),
      description: d.description.join(' ').trim(),
      beats,
      breakBefore: d.breakBefore
    })
  }
  const at = (b: BeatDraft): string | undefined => beatIds.get(b)
  const puzzleLines: PuzzleLines = { clues: [], evidence: [], puzzles: [], testimonies: [] }
  for (const c of clueDrafts) {
    const beatId = at(c.beat)
    if (beatId) puzzleLines.clues.push({ chapter, puzzle: c.puzzle, clue: c.clue, text: c.text, beatId })
  }
  for (const e of evidenceDrafts) {
    const beatId = at(e.beat)
    if (beatId) puzzleLines.evidence.push({ chapter, key: e.key, imageKey: e.imageKey, text: e.text, beatId })
  }
  for (const z of puzzleDrafts) {
    const beatId = at(z.beat)
    if (beatId) puzzleLines.puzzles.push({ chapter, key: z.key, kind: z.kind, beatId })
  }
  for (const t of testimonyDrafts) {
    const statements = t.statements.flatMap((x, i) => {
      const beatId = at(x.beat)
      return beatId ? [{ n: i + 1, speaker: x.speaker, text: x.text, beatId }] : []
    })
    if (!statements.length) warnings.push(`chapter ${chapter}: TESTIMONY: ${t.witness} has no speaker line after it`)
    else puzzleLines.testimonies.push({ chapter, witness: t.witness, statements })
  }
  const uncertain: Uncertain[] = []
  for (const u of unc) {
    const sid = ids.get(u.scene)
    if (!sid) continue
    const bid = u.beat ? beatIds.get(u.beat) : undefined
    uncertain.push({ kind: u.kind, chapter, sceneId: sid, ...(bid ? { beatId: bid } : {}), text: u.text, reason: u.reason })
  }
  const loose = new Map<string, Map<string, string>>()
  for (const [draft, id] of beatIds) if (draft.loose) loose.set(id, draft.loose)
  uncertain.push(...checkCasts(scenes, bible, loose, chapter))
  return { scenes, uncertain, warnings, images: [...images.values()], sounds: [...sounds.values()], puzzleLines }
}
