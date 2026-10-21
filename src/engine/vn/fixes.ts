import { CANONICAL_EXPRESSIONS } from '../../shared/vn'
import type { CanonicalExpression, Edition, VnBeat, VnBook, VnScene } from '../../shared/vn'
import { visualWords } from '../assets/derive'
import type { AlignReport } from './align'
import type { Decision } from './agents/script-analyst'
import { uniqueNames } from './aliases'
import { backgroundId, normText, slugKey, spriteId } from './ids'
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

/** The times of day, in two runs that are close to each other inside a run (the morning light is near the day, the dusk near the night). */
const TIME_RUNS: string[][] = [['dawn', 'morning', 'day', 'afternoon'], ['evening', 'dusk', 'night']]
const timeDistance = (a: string, b: string): number => {
  const ra = TIME_RUNS.findIndex((r) => r.includes(a))
  const rb = TIME_RUNS.findIndex((r) => r.includes(b))
  if (ra < 0 || rb < 0) return 50
  return ra === rb ? Math.abs(TIME_RUNS[ra]!.indexOf(a) - TIME_RUNS[rb]!.indexOf(b)) : 10 + Math.abs(TIME_RUNS[ra]!.indexOf(a) - TIME_RUNS[rb]!.indexOf(b))
}

/** The expression whose sprite stands in for one that has no art: worried -> scared -> sad -> neutral. */
const EXPRESSION_FALLBACK: Record<string, string[]> = {
  worried: ['scared', 'sad', 'neutral'],
  scared: ['worried', 'sad', 'neutral'],
  sad: ['worried', 'neutral'],
  surprised: ['happy', 'neutral'],
  happy: ['neutral'],
  thinking: ['neutral'],
  angry: ['neutral']
}

/** What the analysis may rely on: whether an asset (a background, a sprite) already has a file. Without it nothing is held back. */
export interface DecisionOptions {
  hasFile?: (assetId: string) => boolean
}

const sceneText = (s: VnScene): string => ` ${normText([s.description, ...s.beats.map((b) => (b.type === 'cast' ? '' : b.text))].join(' '))} `

function eachBeatOf(book: VnBook, fn: (beat: VnBeat) => void): void {
  for (const c of book.chapters) for (const s of c.scenes) for (const x of s.beats) fn(x)
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
export function applyDecisions(book: VnBook, edition: Edition | undefined, items: Uncertain[], decisions: Decision[], opts: DecisionOptions = {}): DecisionResult {
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
  const hasFile = opts.hasFile
  /**
   * The analysis must not make a new background that has no art when one exists: if the new background has no file and the old one has, the
   * old time and background stay; if neither has, the nearest time that has art for the place is used.
   */
  const keepArt = (s: VnScene, was: { time: string | null; backgroundId: string }): void => {
    if (!hasFile || s.backgroundId === was.backgroundId || hasFile(s.backgroundId)) return
    const wanted = s.backgroundId
    if (hasFile(was.backgroundId)) {
      s.time = was.time
      s.backgroundId = was.backgroundId
      notes.push(`kept ${was.backgroundId}: no art for ${wanted}`)
      return
    }
    const options = [...CANONICAL_TIMES, 'any'].filter((t) => hasFile(backgroundId(s.placeKey, s.placeText, t === 'any' ? null : t)))
    if (!options.length) return
    const want = s.time ?? 'any'
    const best = [...options].sort((x, y) => timeDistance(want, x) - timeDistance(want, y))[0]!
    s.time = best === 'any' ? null : best
    s.backgroundId = backgroundId(s.placeKey, s.placeText, s.time)
    notes.push(`used ${s.backgroundId} for ${wanted}: no art for it`)
  }
  /** The sprite expression that has art, when the wanted one has none. */
  const keepSprite = (charKey: string | null, expression: string): string => {
    if (!hasFile || !charKey || hasFile(spriteId(charKey, expression))) return expression
    for (const e of EXPRESSION_FALLBACK[expression] ?? ['neutral']) {
      if (hasFile(spriteId(charKey, e))) {
        notes.push(`used ${spriteId(charKey, e)} for ${expression}: no art for ${spriteId(charKey, expression)}`)
        return e
      }
    }
    return expression
  }
  /** Is this character there? It speaks in the scene or is named in it, or shares a word of its looks with the text. Says why not, or null. */
  const notThere = (key: string, scene: VnScene, text: string): string | null => {
    const c = b.characters.find((x) => x.key === key)
    if (!c) return `no character ${key}`
    if (scene.beats.some((x) => x.type === 'line' && x.speakerKey === key)) return null
    const around = sceneText(scene)
    if ([normText(c.name), ...(c.aliases ?? []).map(normText)].some((f) => f && around.includes(` ${f} `))) return null
    const mine = visualWords(c.looks)
    if (normText(text).split(' ').some((t) => mine.has(t))) return null
    return `rejected ${key} for "${text}": not in the scene and looks do not match`
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
    if (u.kind === 'alias') {
      // two bible entries that may be one person: merge the entry named in the item into the character the analyst names
      const target = d.aliasOf ? b.characters.find((c) => c.key === d.aliasOf) : undefined
      const dup = b.characters.find((c) => normText(c.name) === normText(u.text))
      if (!target || !dup || target.key === dup.key) return
      target.aliases = uniqueNames([...(target.aliases ?? []), dup.name, ...(dup.aliases ?? [])], target.name)
      eachBeatOf(b, (beat) => {
        if (beat.type === 'line' && beat.speakerKey === dup.key) beat.speakerKey = target.key
        if (beat.type === 'cast') {
          beat.cast = beat.cast.map((c) => (c.charKey === dup.key ? { ...c, charKey: target.key } : c)).filter((c, at, all) => all.findIndex((x) => x.charKey === c.charKey) === at)
        }
      })
      b.characters = b.characters.filter((c) => c.key !== dup.key)
      if (ed) delete ed.characterNames[dup.key]
      notes.push(`aliases merged: ${dup.name} -> ${target.key} (the script-analyst)`)
      resolved.add(i)
      applied++
      return
    }
    const scene = scenes.get(u.sceneId)
    if (!scene) return
    let changed = false
    switch (u.kind) {
      case 'place': {
        const was = { time: scene.time, backgroundId: scene.backgroundId }
        const key = d.placeKey && b.places.some((p) => p.key === d.placeKey) ? d.placeKey : d.newPlace?.name.trim() ? addPlace(d.newPlace.name, d.newPlace.looks) : null
        if (key) {
          scene.placeKey = key
          changed = true
        }
        const time = normaliseTime(d.time)
        if (time && !scene.time) scene.time = time
        if (changed || time) {
          rebackground(scene)
          keepArt(scene, was)
        }
        break
      }
      case 'time': {
        const time = normaliseTime(d.time)
        if (time) {
          const was = { time: scene.time, backgroundId: scene.backgroundId }
          scene.time = time
          rebackground(scene)
          keepArt(scene, was)
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
          for (const x of lineBeats((l) => normText(l.speakerLabel) === label && l.rawExpression === u.text)) x.expression = keepSprite(x.speakerKey, e) as CanonicalExpression
          changed = true
        }
        break
      }
      case 'cast': {
        const beat = u.beatId ? scene.beats.find((x) => x.id === u.beatId) : undefined
        if (beat?.type !== 'cast') break
        if (u.reason === 'more than 3 on screen' && u.charKey) {
          // the analyst says who is really there: a direction answer takes the character off the cast, anything else keeps it
          if (d.isDirection || (d.charKey && d.charKey !== u.charKey)) beat.cast = beat.cast.filter((c) => c.charKey !== u.charKey)
          changed = true
          break
        }
        if (d.isDirection) {
          changed = true // a prop or a sign: it stays a scene hint
          break
        }
        const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(u.text)
        const look = m ? m[2]!.trim() : ''
        if (d.charKey && b.characters.some((c) => c.key === d.charKey)) {
          // the analyst may only put someone on screen who is in the scene, or whose looks the entry describes
          const why = notThere(d.charKey, scene, u.text)
          if (why) {
            notes.push(why)
            break
          }
        }
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
