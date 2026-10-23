import { z } from 'zod'
import type { SoundEntry, VnBook, VnChapter } from '../../../shared/vn'
import type { BeatCue, SceneTransition, Slot, StageCues } from '../../renpy/stage'
import { MAX_ON_SCREEN } from '../../renpy/stage'
import { asJson, askJson, clip } from './common'
import type { AgentCall } from './common'

/**
 * stage-director / stage_chapter: for one chapter, where the sprites stand (left, center, right), how each scene is shown,
 * and which music plays. The answer overrides the deterministic `defaultCues`; anything that does not fit the book is dropped.
 */
export const stageChapterSchema = z.object({
  /** A music asset id for the chapter, or null for the default. */
  music: z.string().nullable(),
  scenes: z.array(z.object({ id: z.string(), transition: z.enum(['dissolve', 'fade', 'none']), pause: z.number() })),
  casts: z.array(z.object({ beatId: z.string(), slots: z.array(z.object({ charKey: z.string(), slot: z.enum(['left', 'center', 'right']) })) })),
  /** Sound effects, from the book's catalogue only: the beat that plays one. */
  sfx: z.array(z.object({ beatId: z.string(), key: z.string() })).default([]),
  /** Ambiences, from the catalogue only: the beat where one starts, or (key null) stops. */
  ambience: z.array(z.object({ beatId: z.string(), key: z.string().nullable() })).default([])
})
export type StageChapter = z.infer<typeof stageChapterSchema>

/** The cues the story already has on a beat, so the agent does not add another. */
const cuesOf = (b: { image?: string | null; sfx?: string; ambience?: string | null }) => ({
  ...(b.image !== undefined ? { image: b.image } : {}),
  ...(b.sfx ? { sfx: b.sfx } : {}),
  ...(b.ambience !== undefined ? { ambience: b.ambience } : {})
})

/** The chapter as the agent sees it. */
export function describeChapter(book: VnBook, chapter: VnChapter): Record<string, unknown> {
  const chars = new Map(book.characters.map((c) => [c.key, c.name]))
  return {
    n: chapter.n,
    title: chapter.title,
    ending: chapter.ending !== null,
    scenes: chapter.scenes.map((s) => ({
      id: s.id,
      place: s.placeText,
      time: s.time,
      afterBreak: s.breakBefore,
      description: clip(s.description, 140),
      beats: s.beats.map((b) =>
        b.type === 'cast'
          ? { id: b.id, type: 'cast', cast: b.cast.map((c) => ({ charKey: c.charKey, name: chars.get(c.charKey) ?? c.charKey })) }
          : b.type === 'line'
            ? { id: b.id, type: 'line', speaker: b.speakerKey ?? b.speakerLabel, expression: b.expression, text: clip(b.text, 60), ...cuesOf(b) }
            : b.type === 'puzzle'
              ? { id: b.id, type: 'narration', text: '[a puzzle: the player solves it here]' }
              : { id: b.id, type: 'narration', text: clip(b.text, 60), ...cuesOf(b) }
      )
    }))
  }
}

export interface MergedStage {
  cues: StageCues
  /** What was dropped or fixed, for the log. */
  notes: string[]
}

/** Lays the agent's answer for one chapter over the cues; invalid entries are ignored and listed in `notes`. */
export function mergeChapterCues(cues: StageCues, chapter: VnChapter, answer: StageChapter, musicIds: string[], sounds: SoundEntry[] = []): MergedStage {
  const out: StageCues = { ...cues, chapters: { ...cues.chapters }, scenes: { ...cues.scenes }, casts: { ...cues.casts }, ...(cues.beats ? { beats: { ...cues.beats } } : {}) }
  const notes: string[] = []
  if (answer.music !== null) {
    if (musicIds.includes(answer.music)) out.chapters[chapter.n] = { music: answer.music }
    else notes.push(`chapter ${chapter.n}: unknown music ${answer.music}`)
  }
  const sceneIds = new Set(chapter.scenes.map((s) => s.id))
  for (const s of answer.scenes) {
    if (!sceneIds.has(s.id)) {
      notes.push(`unknown scene ${s.id}`)
      continue
    }
    const transition: SceneTransition = s.transition
    const pause = Math.min(3, Math.max(0, Number.isFinite(s.pause) ? s.pause : 0))
    const old = out.scenes[s.id]
    out.scenes[s.id] = { transition, ...(pause > 0 ? { pause: Math.round(pause * 10) / 10 } : {}), ...(old && 'music' in old ? { music: old.music } : {}), ...(old && 'ambience' in old ? { ambience: old.ambience } : {}) }
  }
  const castBeats = new Map(chapter.scenes.flatMap((s) => s.beats).flatMap((b) => (b.type === 'cast' ? [[b.id, new Set(b.cast.map((c) => c.charKey))] as const] : [])))
  for (const c of answer.casts) {
    const allowed = castBeats.get(c.beatId)
    if (!allowed) {
      notes.push(`unknown cast beat ${c.beatId}`)
      continue
    }
    const slots: Record<string, Slot> = {}
    const usedSlots = new Set<Slot>()
    let ok = c.slots.length <= MAX_ON_SCREEN
    for (const x of c.slots) {
      if (!allowed.has(x.charKey) || usedSlots.has(x.slot) || x.charKey in slots) ok = false
      slots[x.charKey] = x.slot
      usedSlots.add(x.slot)
    }
    if (ok) out.casts[c.beatId] = slots
    else notes.push(`cast ${c.beatId}: the slots do not fit the cast, the default stays`)
  }
  // sound effects and ambiences: only from the catalogue, only on beats of this chapter, and never over a cue the story gives that beat
  const beats = new Map(chapter.scenes.flatMap((s) => s.beats).map((b) => [b.id, b] as const))
  const catalogue = (kind: SoundEntry['kind']) => new Set(sounds.filter((s) => s.kind === kind).map((s) => s.key))
  const sfxKeys = catalogue('sfx')
  const ambienceKeys = catalogue('ambience')
  const cueOf = (id: string): BeatCue => {
    out.beats ??= {}
    return (out.beats[id] ??= {})
  }
  for (const x of answer.sfx) {
    const beat = beats.get(x.beatId)
    if (!beat) notes.push(`unknown beat ${x.beatId} for sfx ${x.key}`)
    else if (!sfxKeys.has(x.key)) notes.push(`${x.beatId}: sfx ${x.key} is not in the book's sounds`)
    else if (!beat.sfx) cueOf(x.beatId).sfx = x.key
  }
  for (const x of answer.ambience) {
    const beat = beats.get(x.beatId)
    if (!beat) notes.push(`unknown beat ${x.beatId} for ambience ${x.key}`)
    else if (x.key !== null && !ambienceKeys.has(x.key)) notes.push(`${x.beatId}: ambience ${x.key} is not in the book's sounds`)
    else if (beat.ambience === undefined) cueOf(x.beatId).ambience = x.key
  }
  return { cues: out, notes }
}

export async function stageChapter(call: AgentCall, book: VnBook, chapter: VnChapter, musicIds: string[]): Promise<StageChapter> {
  return askJson(
    call,
    'stage-director',
    'stage_chapter',
    { title: book.title, genre: book.genre ?? '', chapter: asJson(describeChapter(book, chapter)), musicIds: asJson(musicIds), sounds: asJson(book.sounds ?? []) },
    stageChapterSchema,
    { maxTokens: 3000 }
  )
}
