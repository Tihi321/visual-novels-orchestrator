import { CANONICAL_EXPRESSIONS } from '../../shared/vn'
import type { CanonicalExpression, Edition, VnBeat, VnBook, VnScene } from '../../shared/vn'
import type { AlignReport } from './align'
import type { Decision } from './agents/script-analyst'
import { backgroundId, normText, slugKey } from './ids'
import { detectTime } from './script'
import type { Uncertain } from './script'

/** Applying the agents' answers to `vn.json` and the editions. Pure functions: they return new objects. */

export const CANONICAL_TIMES = ['dawn', 'morning', 'day', 'afternoon', 'evening', 'dusk', 'night'] as const

/** A time word (English or Croatian) or a canonical time -> the canonical time, else null. */
export function normaliseTime(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  if ((CANONICAL_TIMES as readonly string[]).includes(t)) return t
  return detectTime(text)
}

function uniqueKey(name: string, used: Set<string>): string {
  const base = slugKey(name)
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`
  used.add(key)
  return key
}

export interface DecisionResult {
  book: VnBook
  edition: Edition | undefined
  /** How many items got an answer that changed something. */
  applied: number
  /** Items the agent had no usable answer for: they keep the parser's defaults. */
  unresolved: Uncertain[]
  notes: string[]
}

/** Recomputes the import warnings that depend on what is still unresolved. */
export function refreshWarnings(book: VnBook, unresolved: Uncertain[]): string[] {
  const kept = book.warnings.filter((w) => !w.startsWith('speakers not in the bible') && !/scene\(s\) have a place that matches no bible place/.test(w))
  const unknown = [...new Set(unresolved.filter((u) => u.kind === 'speaker').map((u) => u.text))]
  if (unknown.length) kept.push(`speakers not in the bible (no sprite): ${unknown.join(', ')}`)
  const noPlace = unresolved.filter((u) => u.kind === 'place').length
  if (noPlace) kept.push(`${noPlace} scene(s) have a place that matches no bible place`)
  return kept
}

/**
 * Applies the script-analyst's decisions. `items[decision.index]` is the item a decision answers. The background ids are
 * recomputed for every scene whose place or time changed, so the asset list follows.
 */
export function applyDecisions(book: VnBook, edition: Edition | undefined, items: Uncertain[], decisions: Decision[]): DecisionResult {
  const b: VnBook = structuredClone(book)
  const ed = edition ? structuredClone(edition) : undefined
  const notes: string[] = []
  const resolved = new Set<number>()
  let applied = 0
  const scenes = new Map<string, VnScene>(b.chapters.flatMap((c) => c.scenes).map((s) => [s.id, s]))
  const usedChars = new Set(b.characters.map((c) => c.key))
  const usedPlaces = new Set(b.places.map((p) => p.key))

  const addCharacter = (name: string, looks: string): string => {
    // only the same name counts as the same character here (a loose match would take Blue Dragon for Pink Dragon)
    const found = b.characters.find((c) => normText(c.name) === normText(name) || c.key === slugKey(name))?.key
    if (found) return found
    const key = uniqueKey(name, usedChars)
    b.characters.push({ key, name: name.trim(), looks: looks.trim() })
    if (ed) ed.characterNames[key] = name.trim()
    notes.push(`new character ${name} (${key})`)
    return key
  }
  const addPlace = (name: string, looks: string): string => {
    const found = b.places.find((p) => normText(p.name) === normText(name) || p.key === slugKey(name))?.key
    if (found) return found
    const key = uniqueKey(name, usedPlaces)
    b.places.push({ key, name: name.trim(), looks: looks.trim() })
    notes.push(`new place ${name} (${key})`)
    return key
  }
  const rebackground = (s: VnScene) => {
    s.backgroundId = backgroundId(s.placeKey, s.placeText, s.time)
  }
  const lineBeats = (match: (beat: Extract<VnBeat, { type: 'line' }>) => boolean) =>
    [...scenes.values()].flatMap((s) => s.beats.filter((x): x is Extract<VnBeat, { type: 'line' }> => x.type === 'line' && match(x)))
  const toNarration = (beat: VnBeat, text: string) => {
    const any = beat as unknown as Record<string, unknown>
    for (const k of ['speakerKey', 'speakerLabel', 'expression', 'rawExpression']) delete any[k]
    any.type = 'narration'
    any.text = text
  }

  const byIndex = new Map(decisions.map((d) => [d.index, d]))
  items.forEach((u, i) => {
    const d = byIndex.get(i)
    if (!d) return
    const scene = scenes.get(u.sceneId)
    if (!scene) return
    let changed = false
    switch (u.kind) {
      case 'place': {
        const key = d.placeKey && b.places.some((p) => p.key === d.placeKey) ? d.placeKey : d.newPlace?.name.trim() ? addPlace(d.newPlace.name, d.newPlace.looks) : null
        if (key) {
          scene.placeKey = key
          changed = true
        }
        const time = normaliseTime(d.time)
        if (time && !scene.time) scene.time = time
        if (changed || time) rebackground(scene)
        break
      }
      case 'time': {
        const time = normaliseTime(d.time)
        if (time) {
          scene.time = time
          rebackground(scene)
          changed = true
        }
        break
      }
      case 'speaker': {
        const norm = normText(u.text)
        const same = lineBeats((x) => x.speakerKey === null && normText(x.speakerLabel) === norm)
        if (d.isDirection) {
          for (const beat of same) toNarration(beat, beat.text)
          changed = true
        } else {
          const key = d.charKey && b.characters.some((c) => c.key === d.charKey) ? d.charKey : d.newCharacter?.name.trim() ? addCharacter(d.newCharacter.name, d.newCharacter.looks) : null
          if (key) {
            for (const beat of same) beat.speakerKey = key
            changed = true
          }
        }
        break
      }
      case 'expression': {
        const beat = u.beatId ? scene.beats.find((x) => x.id === u.beatId) : undefined
        const expr = d.expression
        if (beat?.type === 'line' && expr && (CANONICAL_EXPRESSIONS as readonly string[]).includes(expr)) {
          const label = normText(beat.speakerLabel)
          const e: CanonicalExpression = expr
          for (const x of lineBeats((l) => normText(l.speakerLabel) === label && l.rawExpression === u.text)) x.expression = e
          changed = true
        }
        break
      }
      case 'cast': {
        const beat = u.beatId ? scene.beats.find((x) => x.id === u.beatId) : undefined
        if (beat?.type !== 'cast') break
        if (d.isDirection) {
          changed = true // a prop or a sign: it stays a scene hint
          break
        }
        const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(u.text)
        const look = m ? m[2]!.trim() : ''
        const key = d.charKey && b.characters.some((c) => c.key === d.charKey) ? d.charKey : d.newCharacter?.name.trim() ? addCharacter(d.newCharacter.name, d.newCharacter.looks || look) : null
        if (key) {
          if (!beat.cast.some((c) => c.charKey === key)) beat.cast.push({ charKey: key, ...(look ? { look } : {}) })
          changed = true
        }
        break
      }
    }
    if (changed) {
      resolved.add(i)
      applied++
    }
  })

  const unresolved = items.filter((_, i) => !resolved.has(i))
  // Speaker items are one per label: a label that got resolved clears the other items of the same label too.
  const stillUnknown = (u: Uncertain) =>
    u.kind !== 'speaker' || b.chapters.some((c) => c.scenes.some((sc) => sc.beats.some((x) => x.type === 'line' && x.speakerKey === null && normText(x.speakerLabel) === normText(u.text))))
  b.warnings = refreshWarnings(b, unresolved.filter(stillUnknown))
  return { book: b, edition: ed, applied, unresolved, notes }
}

// ---- edition alignment ----

export interface AlignFix {
  beatId: string
  /** The index into `report.extra`. */
  extraIndex: number
}

export interface AlignNameFix {
  charKey: string
  name: string
}

export interface AlignResult {
  edition: Edition
  report: AlignReport
  fixed: number
  names: number
  notes: string[]
}

/** Applies the edition-aligner's answer: moves the text of `extra` items into the beats they belong to, and confirms names. */
export function applyAlignmentFixes(book: VnBook, edition: Edition, report: AlignReport, fixes: AlignFix[], nameFixes: AlignNameFix[]): AlignResult {
  const ed: Edition = structuredClone(edition)
  const rep: AlignReport = structuredClone(report)
  const notes: string[] = []
  const known = new Set<string>()
  for (const c of book.chapters) for (const s of c.scenes) for (const x of s.beats) if (x.type !== 'cast') known.add(x.id)
  const usedExtra = new Set<number>()
  let fixed = 0
  for (const f of fixes) {
    const extra = report.extra[f.extraIndex]
    if (!extra || usedExtra.has(f.extraIndex)) {
      notes.push(`skipped a fix for ${f.beatId}: no such extra text`)
      continue
    }
    if (!report.missing.includes(f.beatId) || !known.has(f.beatId)) {
      notes.push(`skipped a fix for ${f.beatId}: that beat is not missing`)
      continue
    }
    if (ed.beats[f.beatId] !== undefined) continue
    ed.beats[f.beatId] = extra.text
    usedExtra.add(f.extraIndex)
    fixed++
  }
  rep.missing = rep.missing.filter((id) => ed.beats[id] === undefined)
  rep.extra = rep.extra.filter((_, i) => !usedExtra.has(i))
  rep.matched += fixed
  let names = 0
  const chars = new Set(book.characters.map((c) => c.key))
  for (const n of nameFixes) {
    const name = n.name.trim()
    if (!chars.has(n.charKey) || !name) continue
    if (ed.characterNames[n.charKey] !== name) names++
    ed.characterNames[n.charKey] = name
    rep.nameMap[n.charKey] = name
  }
  rep.warnings = rep.warnings.filter((w) => !/^no translated name for /.test(w) || !nameFixes.some((n) => w.includes(book.characters.find((c) => c.key === n.charKey)?.name ?? '\u0000')))
  return { edition: ed, report: rep, fixed, names, notes }
}
