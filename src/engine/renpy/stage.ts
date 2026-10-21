import type { VnBook } from '../../shared/vn'

/**
 * Stage cues: where sprites stand, how scenes change and which music plays. `defaultCues` is the deterministic
 * heuristic; the stage-director agent can return a `StageCues` of its own (same shape) to override it.
 */

export type Slot = 'left' | 'center' | 'right'
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
  /** Beat id -> its picture, sound effect and ambience cues (the stage-director fills the beats the story leaves without). */
  beats?: Record<string, BeatCue>
  /** Set with `vno_set_cues`: the stage step keeps these cues and does not ask the stage-director. */
  byHand?: boolean
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

/**
 * Puts the composer's scene music (`MusicPlan.scenes`) into the cues. A scene whose story sets its own `music`, or that already has a music cue
 * (set by hand), keeps it. Tracks that do not exist yet are skipped.
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
  /** Music asset ids that exist, in order (`music_01` ...). The first is the main menu theme. */
  musicIds?: string[]
  /** Receives warnings (a cast with more than three characters). */
  warn?: (msg: string) => void
}

export function defaultCues(book: VnBook, opts: DefaultCueOptions = {}): StageCues {
  const musicIds = opts.musicIds ?? []
  const menuMusic = musicIds[0] ?? null
  // The chapters rotate over the tracks that are left; with only one track it plays everywhere.
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
