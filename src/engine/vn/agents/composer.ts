import { z } from 'zod'
import { resolveMusicProvider } from '../../../shared/vn'
import type { Chip, ProjectSettings, VnBook } from '../../../shared/vn'
import { CALM_MOODS, chipTrackPlanSchema, fallbackChipPlan, mergeChipPlan, planSummary } from '../../studios/chip-plan'
import type { ChipTrackPlan, ChipTrackPlanDraft } from '../../studios/chip-plan'
import { asJson, askJson, clip } from './common'
import type { AgentCall } from './common'

/** composer / plan_music: calm instrumental prompts for the tracks, and which track plays in which chapter. */
export const planMusicSchema = z.object({
  tracks: z.array(z.object({ id: z.string(), prompt: z.string().optional().default(''), seconds: z.number().optional().default(100), ...chipTrackPlanSchema.shape })),
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
  /** Chiptune Studio: track id -> what to compose (`compose_track` arguments). Only when the project's music provider is chiptune. */
  tracks?: Record<string, ChipTrackPlan>
}

export const MIN_SECONDS = 60
export const MAX_SECONDS = 180
export const DEFAULT_SECONDS = 100

export interface ChipOptions {
  /** The chiptune plan is wanted (the project's music provider is Chiptune Studio). */
  chiptune: boolean
  chip?: Chip
  genreText?: string
  palette?: string
}

/** Keeps what the book can use: known track ids, lengths in range. With `chip` options, also a `compose_track` plan per track (the composer's draft over the deterministic one). */
export function validateMusicPlan(plan: PlanMusic, trackIds: string[], chipOpts?: ChipOptions): { prompts: Map<string, string>; plan: MusicPlan } {
  const ids = new Set(trackIds)
  const prompts = new Map<string, string>()
  const seconds: Record<string, number> = {}
  const drafts = new Map<string, ChipTrackPlanDraft>()
  for (const t of plan.tracks) {
    if (!ids.has(t.id)) continue
    drafts.set(t.id, { mood: t.mood, chip: t.chip, bpm: t.bpm, key: t.key, bars: t.bars })
    seconds[t.id] = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(t.seconds) || DEFAULT_SECONDS))
    if (!t.prompt.trim()) continue
    prompts.set(t.id, t.prompt.trim())
  }
  const chapters: Record<number, string> = {}
  for (const c of plan.chapters) if (ids.has(c.trackId)) chapters[c.n] = c.trackId
  const out: MusicPlan = { menu: ids.has(plan.menuTrack) ? plan.menuTrack : null, chapters, seconds }
  if (chipOpts?.chiptune) {
    out.tracks = {}
    for (const id of trackIds) {
      const base = fallbackChipPlan(id, { genreText: chipOpts.genreText, chip: chipOpts.chip, palette: chipOpts.palette, seconds: seconds[id] })
      out.tracks[id] = mergeChipPlan(drafts.get(id), base, chipOpts.chip)
      prompts.set(id, planSummary(out.tracks[id]!))
    }
  }
  return { prompts, plan: out }
}

/** The deterministic chiptune plan of every track (no model answered). */
export function fallbackChipPlans(trackIds: string[], opts: ChipOptions, seconds: Record<string, number> = {}): Record<string, ChipTrackPlan> {
  return Object.fromEntries(trackIds.map((id) => [id, fallbackChipPlan(id, { genreText: opts.genreText, chip: opts.chip, palette: opts.palette, seconds: seconds[id] })]))
}

/** What a chiptune plan means for the settings: the chip options of a project. */
export function chipOptionsFor(book: VnBook, settings: ProjectSettings): ChipOptions {
  return { chiptune: resolveMusicProvider(settings) === 'chiptune', chip: settings.music.chip, genreText: `${book.genre ?? ''} ${book.format} ${book.style}`, palette: settings.art.palette }
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
      provider: resolveMusicProvider(settings),
      chip: settings.music.chip ?? '',
      chips: asJson(['nes', 'gb', 'genesis', 'snes', 'pce']),
      moods: asJson(CALM_MOODS),
      trackIds: asJson(trackIds),
      chapters: asJson(book.chapters.map((c) => ({ n: c.n, title: c.title, summary: clip(c.summary ?? '', 200), ending: c.ending !== null }))),
      minSeconds: MIN_SECONDS,
      maxSeconds: MAX_SECONDS
    },
    planMusicSchema,
    { maxTokens: 2500 }
  )
  return validateMusicPlan(r, trackIds, chipOptionsFor(book, settings))
}
