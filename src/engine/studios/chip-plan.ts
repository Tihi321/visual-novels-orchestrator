import { z } from 'zod'
import { CHIPS } from '../../shared/vn'
import type { Chip } from '../../shared/vn'

/** The calm moods Chiptune Studio composes for a reading game (`compose_track`, see contracts.md). */
export const CALM_MOODS = ['ambient', 'lullaby', 'peaceful', 'mysterious-calm', 'calm', 'chill', 'underwater', 'sad'] as const

/** The synth moods (`compose_track`, calmest first) and the tempo range Chiptune Studio gives each. Only books that look 80s / neon / retro-futuristic get them. */
export const SYNTH_MOODS = ['dreamwave', 'synthwave', 'darkwave', 'outrun'] as const
/** The moods for kids and learning works (Chiptune Studio's newer moods; the `gm` chip's fallback plan rotates over them). */
export const KID_MOODS = ['storybook', 'playful', 'curious', 'wonder', 'focus', 'cafe', 'adventure-light'] as const
export const MUSIC_MOODS = [...CALM_MOODS, ...KID_MOODS, ...SYNTH_MOODS] as const
/** The `compose_track` textures and song forms (Chiptune Studio's own names). */
export const TEXTURES = ['pad-lead', 'broken-chord', 'ostinato', 'chorale', 'march', 'bossa', 'lullaby-rock', 'pizzicato-walk'] as const
export const FORMS = ['A', 'AB', 'ABA', 'AABA'] as const
/** The moods that dance get a higher tempo ceiling (Chiptune's own: playful 100-126, adventure-light 104-128). */
const LIVELY_MOODS: readonly string[] = ['playful', 'adventure-light']
export const MAX_LIVELY_BPM = 128
const SYNTH_BPM: Record<string, [number, number]> = { dreamwave: [80, 100], synthwave: [96, 118], darkwave: [88, 112], outrun: [108, 118] }

/** What the composer plans for one chiptune track: the arguments of `compose_track` that are not the seed. */
export interface ChipTrackPlan {
  mood: string
  chip: Chip
  bpm: number
  /** A key name such as `C`, `F#`, `Eb`. */
  key: string
  bars: number
  /** One of `TEXTURES`; missing: the studio picks. */
  texture?: string
  /** One of `FORMS`; missing: the studio picks. */
  form?: string
  /** Channel -> preset id (`{"M4": "gm.lead.clarinet"}`) of the plan's chip; missing: the studio's palette picks. */
  instruments?: Record<string, string>
}

/** The composer's answer for a track (every field optional: what is missing comes from the deterministic plan). */
export const chipTrackPlanSchema = z.object({
  mood: z.string().optional(),
  chip: z.string().optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  bars: z.number().optional(),
  texture: z.string().optional(),
  form: z.string().optional(),
  instruments: z.record(z.string(), z.string()).optional()
})
export type ChipTrackPlanDraft = z.infer<typeof chipTrackPlanSchema>

export const MIN_BPM = 50
export const MAX_BPM = 100
/** The cap for a synth mood (Chiptune's own: synthwave 96-118, outrun 108-118). */
export const MAX_SYNTH_BPM = 118
export const MIN_BARS = 8
export const MAX_BARS = 48

const KEYS = ['C', 'F', 'G', 'D', 'A', 'Eb']
const BPMS = [72, 66, 78, 70, 84, 64]
const KEY_RE = /^[A-G][#b]?$/

const SYNTH_GENRE = /synthwave|retrowave|outrun|vaporwave|neon|\b80s\b|1980s|retro-?futur/i
const PS1_GENRE = /ps1|playstation|psx|y2k|\b90s\b|1990s/i

/** Kids' and picture-book genres: their music defaults to the `gm` chip (real instruments), not the SNES. */
const KIDS_GENRE = /kids|children|picture[- ]?book|bedtime/i

const GENRE_MOOD: Array<[RegExp, string]> = [
  [SYNTH_GENRE, 'dreamwave'],
  [/kids|children|bedtime|lullaby/i, 'lullaby'],
  [/myster|detective|noir|crime|horror|gothic|ghost/i, 'mysterious-calm'],
  [/sci-?fi|space|cyber/i, 'ambient']
]

/** The number in a music asset id (`music_03` is 3). */
export const trackNumber = (id: string): number => Number(id.replace(/^music_/, '')) || 1

/**
 * The chip a book looks like: the chip chosen for the project, else its palette (Game Boy or NES colours), else its genre (synth: Dreamcast,
 * late 90s: PS1), else `gm` for a kids' or picture-book work that is not pixel art, else SNES (the softest).
 */
export function chipFor(opts: { chip?: Chip; palette?: string; genreText?: string; presentation?: string; artStyle?: string }): Chip {
  if (opts.chip) return opts.chip
  if (opts.palette && /gameboy|gb/i.test(opts.palette)) return 'gb'
  if (opts.palette && /nes/i.test(opts.palette)) return 'nes'
  if (SYNTH_GENRE.test(opts.genreText ?? '')) return 'dreamcast'
  if (PS1_GENRE.test(opts.genreText ?? '')) return 'ps1'
  if (opts.artStyle !== 'pixel' && (opts.presentation === 'picture-book' || KIDS_GENRE.test(opts.genreText ?? ''))) return 'gm'
  return 'snes'
}

/** The `gm` chip's fallback tracks, one per track number: each its own mood, texture, form and tempo, so the tracks of a book do not sound alike. */
const GM_ROTATION: Array<{ mood: string; bpm: number; texture: string; form: string }> = [
  { mood: 'storybook', bpm: 84, texture: 'broken-chord', form: 'AB' },
  { mood: 'playful', bpm: 112, texture: 'pizzicato-walk', form: 'ABA' },
  { mood: 'curious', bpm: 96, texture: 'ostinato', form: 'AB' },
  { mood: 'wonder', bpm: 76, texture: 'chorale', form: 'AABA' },
  { mood: 'lullaby', bpm: 66, texture: 'lullaby-rock', form: 'ABA' },
  { mood: 'cafe', bpm: 92, texture: 'bossa', form: 'AB' },
  { mood: 'adventure-light', bpm: 118, texture: 'march', form: 'ABA' }
]

/** Bars for a length in seconds at a tempo (4/4), in whole groups of four so a phrase ends cleanly. */
export function barsFor(seconds: number, bpm: number): number {
  const bars = Math.round(((seconds * bpm) / 240 / 4)) * 4
  return Math.min(MAX_BARS, Math.max(MIN_BARS, bars))
}

/** The deterministic plan of a track: a calm mood from the genre (a synth book gets the synth moods; rotating over the tracks), a slow tempo, a key and a length. */
export function fallbackChipPlan(id: string, opts: { genreText?: string; chip?: Chip; palette?: string; seconds?: number; presentation?: string; artStyle?: string }): ChipTrackPlan {
  const n = trackNumber(id)
  const chip = chipFor(opts)
  const base = GENRE_MOOD.find(([re]) => re.test(opts.genreText ?? ''))?.[1] ?? 'peaceful'
  if (chip === 'gm') {
    // a mystery or sci-fi book keeps its own first mood (a slow chorale); every other track takes the next tempo and texture
    const own = base === 'mysterious-calm' || base === 'ambient' ? [{ mood: base, bpm: 72, texture: 'chorale', form: 'AB' }] : []
    const rotation = [...own, ...GM_ROTATION]
    const t = rotation[(n - 1) % rotation.length]!
    return { mood: t.mood, chip, bpm: t.bpm, key: KEYS[(n - 1) % KEYS.length]!, bars: barsFor(opts.seconds ?? 100, t.bpm), texture: t.texture, form: t.form }
  }
  const synth = SYNTH_GENRE.test(opts.genreText ?? '')
  const moods = synth ? ['dreamwave', 'synthwave', 'darkwave', 'dreamwave', 'ambient'] : [...new Set([base, 'peaceful', 'ambient', 'calm', 'lullaby'])]
  const mood = moods[(n - 1) % moods.length]!
  const range = SYNTH_BPM[mood]
  const slow = BPMS[(n - 1) % BPMS.length]!
  const bpm = range ? Math.min(range[1], Math.max(range[0], slow)) : slow
  return { mood, chip, bpm, key: KEYS[(n - 1) % KEYS.length]!, bars: barsFor(opts.seconds ?? 100, bpm) }
}

/** The composer's draft over the deterministic plan: unknown moods and chips, wild tempos and lengths fall back. */
export function mergeChipPlan(draft: ChipTrackPlanDraft | undefined, base: ChipTrackPlan, forceChip?: Chip): ChipTrackPlan {
  if (!draft) return forceChip ? { ...base, chip: forceChip } : base
  const mood = draft.mood && (MUSIC_MOODS as readonly string[]).includes(draft.mood) ? draft.mood : base.mood
  const chip = forceChip ?? ((CHIPS as readonly string[]).includes(draft.chip ?? '') ? (draft.chip as Chip) : base.chip)
  const bpm = draft.bpm && Number.isFinite(draft.bpm) ? Math.min((SYNTH_MOODS as readonly string[]).includes(mood) ? MAX_SYNTH_BPM : LIVELY_MOODS.includes(mood) ? MAX_LIVELY_BPM : MAX_BPM, Math.max(MIN_BPM, Math.round(draft.bpm))) : base.bpm
  const key = draft.key && KEY_RE.test(draft.key.trim()) ? draft.key.trim() : base.key
  const bars = draft.bars && Number.isFinite(draft.bars) ? Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(draft.bars))) : base.bars
  const texture = draft.texture && (TEXTURES as readonly string[]).includes(draft.texture) ? draft.texture : base.texture
  const form = draft.form && (FORMS as readonly string[]).includes(draft.form) ? draft.form : base.form
  // a preset id belongs to one chip (`gm.lead.clarinet`): ids of another chip are dropped
  const picked = Object.entries(draft.instruments ?? {}).filter(([ch, id]) => /^[A-Z]\d{1,2}$/.test(ch) && id.startsWith(`${chip}.`))
  const instruments = picked.length ? Object.fromEntries(picked) : base.instruments
  return { mood, chip, bpm, key, bars, ...(texture ? { texture } : {}), ...(form ? { form } : {}), ...(instruments ? { instruments } : {}) }
}

/** A one-line description of the plan, kept as the asset's prompt so the gallery shows what the track is. */
export const planSummary = (p: ChipTrackPlan): string => `chiptune: ${p.mood}, ${p.chip}, ${p.bpm} bpm, key ${p.key}, ${p.bars} bars${p.texture ? `, ${p.texture}` : ''}`
