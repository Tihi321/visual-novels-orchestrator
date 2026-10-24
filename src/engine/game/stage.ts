import type { VnBeat, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { CANONICAL_EXPRESSIONS } from '../../shared/vn'

/**
 * Stage cues and planning: where sprites stand, how scenes change, and which media cues play.
 */

export type Slot = 'left' | 'center' | 'right'
export const STAGE_SLOTS: readonly Slot[] = ['left', 'center', 'right'] as const
export const DEFAULT_EXPRESSIONS = CANONICAL_EXPRESSIONS
export type SceneTransition = 'dissolve' | 'fade' | 'none'

export interface SceneCue {
  /** How the scene is shown. `fade` goes through black. */
  transition: SceneTransition
  /** A pause in seconds after the scene is shown, or 0. */
  pause?: number
  /** Music for this scene: a track id, null for silence. Missing: the story's `scene.music`, else the chapter's music goes on. */
  music?: string | null
  /** An ambience (a key of the book's sounds) for this scene, null to stop it. Missing: the story's, else what plays goes on. */
  ambience?: string | null
}

/** Cues on a beat: a picture shown from it (null hides it), a sound effect, an ambience started or (null) stopped. They win over the beat's own fields. */
export interface BeatCue {
  image?: string | null
  sfx?: string
  ambience?: string | null
}

export interface StageCues {
  /** Music asset id for the main menu, or null. */
  menuMusic: string | null
  /** Chapter number -> music asset id (null: no change). */
  chapters: Record<number, { music: string | null }>
  /** Scene id -> cue. */
  scenes: Record<string, SceneCue>
  /** Cast beat id -> char key -> slot. Characters left out of the map are not shown. */
  casts: Record<string, Record<string, Slot>>
  /** Beat id -> its picture, sound effect and ambience cues. */
  beats?: Record<string, BeatCue>
  /** Set with `vno_set_cues`: the stage step keeps these cues and does not ask the stage-director. */
  byHand?: boolean
}

export const SLOTS_BY_SIZE: Record<number, Slot[]> = {
  1: ['center'],
  2: ['left', 'right'],
  3: ['left', 'center', 'right']
}

export const MAX_ON_SCREEN = 3

/** The slots for a cast of `keys` (in order). The characters past the third are not shown; `dropped` lists them. */
export function assignSlots(keys: string[]): { slots: Record<string, Slot>; dropped: string[] } {
  const shown = keys.slice(0, MAX_ON_SCREEN)
  const layout = SLOTS_BY_SIZE[shown.length] ?? []
  const slots: Record<string, Slot> = {}
  shown.forEach((k, i) => {
    const slot = layout[i]
    if (slot) slots[k] = slot
  })
  return { slots, dropped: keys.slice(MAX_ON_SCREEN) }
}

/** Adds the default cues for the chapters, scenes and casts `cues` lacks (new ones after a story edit); what it has is kept. */
export function fillCues(cues: StageCues, book: VnBook, opts: DefaultCueOptions = {}): { cues: StageCues; added: number } {
  const base = defaultCues(book, opts)
  let added = 0
  const out: StageCues = { ...cues, chapters: { ...cues.chapters }, scenes: { ...cues.scenes }, casts: { ...cues.casts } }
  for (const [n, c] of Object.entries(base.chapters)) {
    if (n in out.chapters) continue
    out.chapters[Number(n)] = c
    added++
  }
  for (const [id, c] of Object.entries(base.scenes)) {
    if (id in out.scenes) continue
    out.scenes[id] = c
    added++
  }
  for (const [id, c] of Object.entries(base.casts)) {
    if (id in out.casts) continue
    out.casts[id] = c
    added++
  }
  return { cues: out, added }
}

/**
 * Puts the composer's scene music into the cues.
 */
export function addScenePlan(cues: StageCues, book: VnBook, plan: Record<string, string | null> | undefined, musicIds: string[]): void {
  if (!plan) return
  for (const ch of book.chapters) {
    for (const s of ch.scenes) {
      const track = plan[s.id]
      if (track === undefined || s.music !== undefined) continue
      if (track !== null && !musicIds.includes(track)) continue
      const cue = cues.scenes[s.id] ?? { transition: 'dissolve' as const }
      if ('music' in cue) continue
      cues.scenes[s.id] = { ...cue, music: track }
    }
  }
}

export interface DefaultCueOptions {
  musicIds?: string[]
  warn?: (msg: string) => void
}

export function defaultCues(book: VnBook, opts: DefaultCueOptions = {}): StageCues {
  const musicIds = opts.musicIds ?? []
  const menuMusic = musicIds[0] ?? null
  const rotation = musicIds.length > 1 ? musicIds.slice(1) : musicIds
  const cues: StageCues = { menuMusic, chapters: {}, scenes: {}, casts: {} }

  book.chapters.forEach((ch, idx) => {
    cues.chapters[ch.n] = { music: rotation.length ? (rotation[idx % rotation.length] ?? null) : null }
    for (const scene of ch.scenes) {
      cues.scenes[scene.id] = { transition: scene.breakBefore ? 'fade' : 'dissolve' }
      for (const beat of scene.beats) {
        if (beat.type !== 'cast') continue
        const keys = [...new Set(beat.cast.map((c) => c.charKey))]
        const { slots, dropped } = assignSlots(keys)
        cues.casts[beat.id] = slots
        if (dropped.length) {
          opts.warn?.(`${beat.id}: ${keys.length} characters on screen, showing the first ${MAX_ON_SCREEN} (not shown: ${dropped.join(', ')})`)
        }
      }
    }
  })
  return cues
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage Planning for the Web Game Engine
// ---------------------------------------------------------------------------------------------------------------------

export interface SlotState {
  charKey: string
  expression: string
  slot: Slot
}

export interface BeatStagePlan {
  beatId: string
  /** Sprites to show or update at their respective slots. */
  shows: SlotState[]
  /** Character keys to hide from the stage. */
  hides: string[]
  /** Currently active speaker on stage, if any. */
  activeCharKey?: string | null
  /** Expression shown or updated on this beat. */
  expression?: string | null
  /** CG image key shown (or null to hide current CG). */
  cg?: string | null
  /** CG display mode ('full' | 'insert'). */
  cgDisplay?: 'full' | 'insert' | null
  /** Sound effect asset or key played on this beat. */
  sfx?: string | null
  /** Ambience key played (or null to stop) on this beat. */
  ambience?: string | null
  /** Relative voice path if this beat has voiced speech. */
  voicePath?: string | null
}

export interface SceneStagePlan {
  sceneId: string
  backgroundId: string | null
  transition: SceneTransition
  pause?: number
  music?: string | null
  ambience?: string | null
  beats: Record<string, BeatStagePlan>
}

/** Looks ahead in a scene for the next expression a character uses. */
function nextExpression(scene: VnScene, idx: number, charKey: string): string {
  for (let j = idx + 1; j < scene.beats.length; j++) {
    const b = scene.beats[j]!
    if (b.type === 'cast') break
    if (b.type === 'line' && b.speakerKey === charKey) return b.expression
  }
  return 'neutral'
}

/**
 * Computes the stage plan for a scene, tracking sprite slots, CGs, and audio cues.
 */
export function planScene(scene: VnScene, cues?: Partial<StageCues>, knownChars: Set<string> = new Set()): SceneStagePlan {
  const cue = cues?.scenes?.[scene.id] ?? { transition: scene.breakBefore ? 'fade' : 'dissolve' }
  const currentShown = new Map<string, { expression: string; slot: Slot }>()
  let currentCg: string | null = null
  const beats: Record<string, BeatStagePlan> = {}

  scene.beats.forEach((beat: VnBeat, idx: number) => {
    const bc = cues?.beats?.[beat.id]
    const image = bc?.image !== undefined ? bc.image : beat.image
    const sfx = bc?.sfx ?? beat.sfx ?? null
    const ambience = bc?.ambience !== undefined ? bc.ambience : (beat.ambience ?? undefined)

    const plan: BeatStagePlan = {
      beatId: beat.id,
      shows: [],
      hides: [],
      sfx,
      ambience: ambience !== undefined ? ambience : null
    }

    // CG handling
    if (image === null) {
      if (currentCg !== null) {
        plan.cg = null
        currentCg = null
      }
    } else if (image !== undefined) {
      plan.cg = image
      currentCg = image
    }

    if (beat.type === 'cast') {
      const seenKeys = new Set<string>()
      const dedupedCast = beat.cast.filter((c) => {
        if (seenKeys.has(c.charKey)) return false
        seenKeys.add(c.charKey)
        return knownChars.size === 0 || knownChars.has(c.charKey)
      })
      const keys = dedupedCast.map((c) => c.charKey)
      const rawSlots = cues?.casts?.[beat.id] ?? assignSlots(keys).slots
      const usedSlots = new Set<Slot>()
      const slots: Record<string, Slot> = {}
      for (const k of keys) {
        const desired = rawSlots[k]
        if (!desired) continue
        if (!usedSlots.has(desired)) {
          slots[k] = desired
          usedSlots.add(desired)
        } else {
          const free = STAGE_SLOTS.find((s) => !usedSlots.has(s))
          if (free) {
            slots[k] = free
            usedSlots.add(free)
          }
        }
      }
      
      // Characters to hide
      for (const [k] of currentShown) {
        if (!(k in slots)) {
          plan.hides.push(k)
          currentShown.delete(k)
        }
      }

      // Characters to show
      for (const k of keys) {
        const slot = slots[k]
        if (!slot) continue
        const cur = currentShown.get(k)
        if (cur && cur.slot === slot) continue
        const expression = cur?.expression ?? nextExpression(scene, idx, k)
        const state: SlotState = { charKey: k, expression, slot }
        plan.shows.push(state)
        currentShown.set(k, { expression, slot })
      }
    } else if (beat.type === 'line') {
      const key = beat.speakerKey
      if (key && (knownChars.size === 0 || knownChars.has(key))) {
        plan.activeCharKey = key
        plan.expression = beat.expression
        const cur = currentShown.get(key)
        if (cur && cur.expression !== beat.expression) {
          cur.expression = beat.expression
          plan.shows.push({ charKey: key, expression: beat.expression, slot: cur.slot })
        }
      }
    }

    beats[beat.id] = plan
  })

  return {
    sceneId: scene.id,
    backgroundId: scene.backgroundId || null,
    transition: cue.transition,
    pause: cue.pause,
    music: 'music' in cue ? cue.music : scene.music,
    ambience: 'ambience' in cue ? cue.ambience : scene.ambience,
    beats
  }
}

/**
 * Computes stage plans for all scenes in a chapter.
 */
export function planChapter(chapter: VnChapter, cues: StageCues, knownChars?: Set<string>): Record<string, SceneStagePlan> {
  const result: Record<string, SceneStagePlan> = {}
  for (const scene of chapter.scenes) {
    result[scene.id] = planScene(scene, cues, knownChars)
  }
  return result
}
