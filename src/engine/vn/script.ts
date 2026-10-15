import type { CanonicalExpression, VnBeat, VnScene } from '../../shared/vn'
import type { Bible, BibleCharacter, BiblePlace } from './bible'
import { mapExpression } from './expressions'
import { backgroundId, beatId, normText, sceneId, slugKey } from './ids'

// The script grammar (docs/visual-novel.md), with Croatian keyword aliases.
export const SCENE_RE = /^\**\s*(?:scene|scena)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const CAST_RE = /^\**\s*(?:on screen|na ekranu)\s*:\s*\**\s*(.+?)\s*\**$/iu
export const LINE_RE = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
const BREAK_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const HEADING_SCENE_RE = /^#{2,6}\s+(.+?)\s*#*\s*$/
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

/** Matches a speaker or ON SCREEN name against the bible characters (case and diacritics ignored). */
export function matchCharacter(label: string, chars: BibleCharacter[]): string | null {
  const l = normText(label)
  if (!l || !chars.length) return null
  const lk = slugKey(label)
  const norm = chars.map((c) => ({ c, n: normText(c.name) }))
  const exact = norm.find((x) => x.n === l || x.c.key === lk)
  if (exact) return exact.c.key
  const lTok = l.split(' ')
  const first = norm.find((x) => x.n.split(' ')[0] === lTok[0])
  if (first) return first.c.key
  const starts = norm.find((x) => x.n.startsWith(l + ' ') || l.startsWith(x.n + ' '))
  if (starts) return starts.c.key
  const overlap = norm.filter((x) => x.n.split(' ').some((t) => t.length >= 3 && lTok.includes(t)))
  return overlap.length === 1 ? overlap[0]!.c.key : null
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

export type UncertainKind = 'place' | 'time' | 'speaker' | 'cast' | 'expression'

/** Something the deterministic parser could not settle; the script-analyst agent looks at these later. */
export interface Uncertain {
  kind: UncertainKind
  chapter: number
  sceneId: string
  beatId?: string
  text: string
  reason: string
}

export interface ParsedChapterScript {
  scenes: VnScene[]
  uncertain: Uncertain[]
  warnings: string[]
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type BeatBody = DistributiveOmit<VnBeat, 'id'>

interface BeatDraft {
  body: BeatBody
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

/** Parses one chapter's script, leniently. Never throws. */
export function parseChapterScript(body: string, opts: { chapter: number; bible: Bible }): ParsedChapterScript {
  const { chapter, bible } = opts
  const warnings: string[] = []
  const drafts: SceneDraft[] = []
  const unc: UncertainDraft[] = []
  const seenUnc = new Set<string>()
  let cur: SceneDraft | null = null
  let pendingBreak = false
  let lastExpr = new Map<string, CanonicalExpression>()

  const flag = (d: UncertainDraft, dedupe?: string) => {
    if (dedupe) {
      if (seenUnc.has(dedupe)) return
      seenUnc.add(dedupe)
    }
    unc.push(d)
  }

  const openScene = (placeText: string, placeKey: string | null, time: string | null, description: string[], breakBefore: boolean): SceneDraft => {
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
    if (BREAK_RE.test(line)) {
      if (cur) pendingBreak = true
      continue
    }
    const sm = SCENE_RE.exec(line) ?? HEADING_SCENE_RE.exec(line)
    if (sm) {
      startScene(sm[1]!)
      continue
    }
    const cm = CAST_RE.exec(line)
    if (cm) {
      const s = scene()
      const cast: { charKey: string; look?: string }[] = []
      const hints: string[] = []
      const beat: BeatDraft = { body: { type: 'cast', cast } }
      for (const entry of splitTopLevel(cm[1]!)) {
        const em = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(entry)
        const name = (em ? em[1]! : entry).replace(/\*+/g, '').trim()
        const look = em ? em[2]!.trim() : ''
        const key = matchCharacter(name, bible.characters)
        if (key) {
          if (!cast.some((c) => c.charKey === key)) cast.push({ charKey: key, ...(look ? { look } : {}) })
        } else {
          hints.push(entry.replace(/\*+/g, '').trim())
          flag({ kind: 'cast', scene: s, beat, text: entry, reason: 'not a bible character: kept as a scene hint' })
        }
      }
      if (hints.length) s.description.push(`Also on screen: ${hints.join('; ')}.`)
      s.beats.push(beat)
      continue
    }
    const nm = NARRATION_RE.exec(line)
    if (nm) {
      const text = nm[1]!.trim()
      if (text) scene().beats.push({ body: { type: 'narration', text } })
      continue
    }
    const dm = DIRECTION_ONLY_RE.exec(line)
    if (dm && isDirectionLabel(dm[1]!)) continue // `FADE OUT.`, `CUT TO:`: a direction with no text, nothing to show
    const lm = LINE_RE.exec(line)
    if (lm && isDirectionLabel(lm[1]!)) {
      // `SMASH CUT TO: Grumble sets the soother down.`: the label is a stage direction, not a speaker; the text stays as narration
      const text = lm[3]!.trim()
      if (text) scene().beats.push({ body: { type: 'narration', text } })
      continue
    }
    if (lm) {
      const s = scene()
      const label = lm[1]!.replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
      const speakerKey = matchCharacter(label, bible.characters)
      const memo = speakerKey ?? `?${label}`
      let expression: CanonicalExpression = lastExpr.get(memo) ?? 'neutral'
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
      s.beats.push(beat)
      if (!speakerKey) flag({ kind: 'speaker', scene: s, beat, text: label, reason: 'not a bible character' }, `speaker:${label}`)
      if (unknownExpr && rawExpression) flag({ kind: 'expression', scene: s, beat, text: rawExpression, reason: `unknown expression for ${label}: neutral used` }, `expr:${label}|${rawExpression}`)
      continue
    }
    scene().beats.push({ body: { type: 'narration', text: line } })
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
      backgroundId: backgroundId(d.placeKey, d.placeText, d.time),
      description: d.description.join(' ').trim(),
      beats,
      breakBefore: d.breakBefore
    })
  }
  const uncertain: Uncertain[] = []
  for (const u of unc) {
    const sid = ids.get(u.scene)
    if (!sid) continue
    const bid = u.beat ? beatIds.get(u.beat) : undefined
    uncertain.push({ kind: u.kind, chapter, sceneId: sid, ...(bid ? { beatId: bid } : {}), text: u.text, reason: u.reason })
  }
  return { scenes, uncertain, warnings }
}
