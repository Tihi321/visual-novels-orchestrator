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
