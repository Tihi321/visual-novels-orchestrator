import type { SceneCuesView, StageSlotView } from '../../shared/protocol'
import type { VnBook, VnScene } from '../../shared/vn'

export const STAGE_SLOTS: readonly StageSlotView[] = ['left', 'center', 'right']

export interface AccumulatedStage {
  slots: Partial<Record<StageSlotView, { charKey: string; expression: string }>>
  cg: string | null
  activeSpeaker: string | null
}

/** The picture cue of a beat: `image` undefined leaves the picture as it is, null hides it. */
export interface BeatPictureCue {
  image?: string | null
}

export function computeStageAtBeat(
  scene: VnScene,
  cuesCasts: Record<string, Record<string, StageSlotView>> | undefined,
  beatIdx: number,
  beatCues?: Record<string, BeatPictureCue>
): AccumulatedStage {
  const slots: Partial<Record<StageSlotView, { charKey: string; expression: string }>> = {}
  const charSlot = new Map<string, StageSlotView>()
  const charExpr = new Map<string, string>()
  let cg: string | null = null

  const limit = Math.min(beatIdx, scene.beats.length - 1)
  for (let i = 0; i <= limit; i++) {
    const b = scene.beats[i]!
    if (b.type === 'cast') {
      const seen = new Set<string>()
      const deduped = b.cast.filter((c) => {
        if (seen.has(c.charKey)) return false
        seen.add(c.charKey)
        return true
      })
      const activeKeys = deduped.map((c) => c.charKey).slice(0, 3)
      const activeSet = new Set(activeKeys)

      // Clear characters no longer in cast
      for (const [k, slot] of charSlot.entries()) {
        if (!activeSet.has(k)) {
          if (slots[slot]?.charKey === k) delete slots[slot]
          charSlot.delete(k)
        }
      }

      // Slot allocation
      const raw = cuesCasts?.[b.id] ?? {}
      const usedSlots = new Set<StageSlotView>()
      const assigned = new Map<string, StageSlotView>()

      for (const k of activeKeys) {
        const pref = raw[k]
        if (pref && !usedSlots.has(pref)) {
          assigned.set(k, pref)
          usedSlots.add(pref)
        }
      }
      for (const k of activeKeys) {
        if (!assigned.has(k)) {
          const free = STAGE_SLOTS.find((s) => !usedSlots.has(s)) ?? 'center'
          assigned.set(k, free)
          usedSlots.add(free)
        }
      }

      for (const k of STAGE_SLOTS) delete slots[k]
      charSlot.clear()

      for (const [k, slot] of assigned.entries()) {
        charSlot.set(k, slot)
        const expr = charExpr.get(k) ?? 'neutral'
        slots[slot] = { charKey: k, expression: expr }
      }
    } else if (b.type === 'line') {
      if (b.speakerKey) {
        charExpr.set(b.speakerKey, b.expression)
        const slot = charSlot.get(b.speakerKey)
        if (slot) {
          slots[slot] = { charKey: b.speakerKey, expression: b.expression }
        }
      }
    }

    // A cue picture wins over the beat's own field; an empty cue leaves the current picture.
    const cueImage = beatCues?.[b.id]?.image
    const image = cueImage !== undefined ? cueImage : b.image
    if (image !== undefined) {
      cg = image
    }
  }

  const curBeat = scene.beats[limit]
  const activeSpeaker = curBeat?.type === 'line' ? curBeat.speakerKey : null
  return { slots, cg, activeSpeaker }
}

/** The chapter tracks the game plays when a scene has no own track (from `cues.json`). */
export interface StageMusicLike {
  chapters: Record<string, string | null>
}

/** The music, ambience and sound effect of a scene at one beat, and which field each value came from. */
export interface SceneAudio {
  music: string | null
  musicFrom: 'cue' | 'story' | 'chapter' | null
  ambience: string | null
  ambienceFrom: 'cue' | 'story' | null
  sfx: string | null
  sfxFrom: 'cue' | 'story' | null
}

const noAudio = (): SceneAudio => ({ music: null, musicFrom: null, ambience: null, ambienceFrom: null, sfx: null, sfxFrom: null })

/** An empty string is a cleared field, never a track or sound key. */
const text = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/**
 * The sound the built game plays in a scene at a beat, mirroring `src/engine/game/emit.ts`: a cue in `cues.json` wins over the story
 * field (a cue `null` is silence or a stop), the music falls back to the chapter's track, and both channels keep playing across
 * scenes and chapters until a cue changes or stops them (emit.ts only stops music or ambience on an explicit null). The sound
 * effect comes from the current beat.
 */
export function resolveSceneAudio(
  book: VnBook,
  cues: Record<string, SceneCuesView>,
  stageMusic: StageMusicLike,
  sceneId: string,
  beatIdx: number
): SceneAudio {
  const out = noAudio()
  const chapter = book.chapters.find((ch) => ch.scenes.some((sc) => sc.id === sceneId))
  const scene = chapter?.scenes.find((sc) => sc.id === sceneId)
  if (!chapter || !scene || beatIdx < 0 || beatIdx >= scene.beats.length) return out
  const beat = scene.beats[beatIdx]!

  // Walk the book up to this scene once: the two channels carry across scene and chapter starts.
  let music: string | null = null
  let musicFrom: SceneAudio['musicFrom'] = null
  let ambience: string | null = null
  let ambienceFrom: SceneAudio['ambienceFrom'] = null
  let reached = false
  for (const ch of book.chapters) {
    const chapterTrack = text(stageMusic.chapters[String(ch.n)])
    // A chapter with no track changes nothing (emit.ts starts no music and does not stop the previous track).
    if (chapterTrack) {
      music = chapterTrack
      musicFrom = 'chapter'
    }
    for (const sc of ch.scenes) {
      const cue = cues[sc.id]
      const sceneMusic = cue?.music !== undefined ? cue.music : sc.music
      if (sceneMusic !== undefined) {
        music = text(sceneMusic)
        musicFrom = cue?.music !== undefined ? 'cue' : 'story'
      } else if (chapterTrack) {
        // emit.ts falls back to the chapter track in every scene that has no music of its own.
        music = chapterTrack
        musicFrom = 'chapter'
      }
      if (cue?.ambience !== undefined) {
        ambience = text(cue.ambience)
        ambienceFrom = 'cue'
      } else if (sc.ambience !== undefined) {
        ambience = text(sc.ambience)
        ambienceFrom = 'story'
      }
      const last = sc.id === sceneId ? beatIdx : sc.beats.length - 1
      for (let i = 0; i <= last; i++) {
        const b = sc.beats[i]!
        const bc = cues[sc.id]?.beats?.[b.id]
        if (bc?.ambience !== undefined) {
          ambience = text(bc.ambience)
          ambienceFrom = 'cue'
        } else if (b.ambience !== undefined) {
          ambience = text(b.ambience)
          ambienceFrom = 'story'
        }
      }
      if (sc.id === sceneId) {
        reached = true
        break
      }
    }
    if (reached) break
  }
  out.music = music
  out.musicFrom = musicFrom
  out.ambience = ambience
  out.ambienceFrom = ambienceFrom

  // Sound effect: the current beat's cue wins over the beat's own field.
  const beatCue = cues[sceneId]?.beats?.[beat.id]
  if (beatCue?.sfx !== undefined) {
    out.sfx = text(beatCue.sfx)
    out.sfxFrom = 'cue'
  } else if (beat.sfx !== undefined) {
    out.sfx = text(beat.sfx)
    out.sfxFrom = 'story'
  }
  return out
}
