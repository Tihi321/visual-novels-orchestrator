import { z } from 'zod'
import type { ProjectSettings, VnBook } from '../../../shared/vn'
import { asJson, askJson, clip } from './common'
import type { AgentCall } from './common'

/** composer / plan_music: calm instrumental prompts for the tracks, and which track plays in which chapter. */
export const planMusicSchema = z.object({
  tracks: z.array(z.object({ id: z.string(), prompt: z.string(), seconds: z.number() })),
  /** The track of the main menu. */
  menuTrack: z.string(),
  chapters: z.array(z.object({ n: z.number().int(), trackId: z.string() }))
})
export type PlanMusic = z.infer<typeof planMusicSchema>

/** The saved plan (`music.json`). */
export interface MusicPlan {
  menu: string | null
  /** Chapter number -> track id. */
  chapters: Record<number, string>
  /** Track id -> length in seconds. */
  seconds: Record<string, number>
}

export const MIN_SECONDS = 60
export const MAX_SECONDS = 180
export const DEFAULT_SECONDS = 100

/** Keeps what the book can use: known track ids, lengths in range. */
export function validateMusicPlan(plan: PlanMusic, trackIds: string[]): { prompts: Map<string, string>; plan: MusicPlan } {
  const ids = new Set(trackIds)
  const prompts = new Map<string, string>()
  const seconds: Record<string, number> = {}
  for (const t of plan.tracks) {
    if (!ids.has(t.id) || !t.prompt.trim()) continue
    prompts.set(t.id, t.prompt.trim())
    seconds[t.id] = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(t.seconds) || DEFAULT_SECONDS))
  }
  const chapters: Record<number, string> = {}
  for (const c of plan.chapters) if (ids.has(c.trackId)) chapters[c.n] = c.trackId
  return { prompts, plan: { menu: ids.has(plan.menuTrack) ? plan.menuTrack : null, chapters, seconds } }
}

export async function planMusic(call: AgentCall, book: VnBook, settings: ProjectSettings, trackIds: string[]): Promise<{ prompts: Map<string, string>; plan: MusicPlan }> {
  const r = await askJson(
    call,
    'composer',
    'plan_music',
    {
      title: book.title,
      genre: book.genre ?? '',
      format: book.format,
      style: clip(book.style, 400),
      engine: settings.music.engine,
      trackIds: asJson(trackIds),
      chapters: asJson(book.chapters.map((c) => ({ n: c.n, title: c.title, summary: clip(c.summary ?? '', 200), ending: c.ending !== null }))),
      minSeconds: MIN_SECONDS,
      maxSeconds: MAX_SECONDS
    },
    planMusicSchema,
    { maxTokens: 2500 }
  )
  return validateMusicPlan(r, trackIds)
}
