import { z } from 'zod'
import { BUILTIN_LANGUAGES, LEGACY_LANGS } from './languages'

/**
 * The VN data contract: the book structure (`vn.json`), editions (`editions/<lang>.json`), the per-project settings
 * (`project.md` frontmatter) and the asset manifest (`assets.json`). Schemas first, types inferred from them.
 *
 * Structure and text are kept apart: `vn.json` holds the structure and the primary-language text; an edition holds
 * the words of another language keyed by beat id, so a new edition reuses every asset.
 */

/** The codes of the built-in languages (`config/languages.md` can add more: see `shared/languages.ts`). */
export const LANGS: readonly string[] = BUILTIN_LANGUAGES.map((l) => l.code)
/** The format of a language code only: whether it is known is checked where a language enters a project (`assertKnownLang`). */
export const langSchema = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'a language code such as en, hr, de or pt-br')
export type Lang = z.infer<typeof langSchema>

/** The standard sprite expressions. Free-form ones in a script are mapped to one of these. */
export const CANONICAL_EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried', 'scared', 'thinking'] as const
export const canonicalExpressionSchema = z.enum(CANONICAL_EXPRESSIONS)
export type CanonicalExpression = z.infer<typeof canonicalExpressionSchema>

// ---- beats ----

/** Who is on screen from this beat on. */
export const castBeatSchema = z.object({
  /** `ch01.s01.b001` */
  id: z.string(),
  type: z.literal('cast'),
  cast: z.array(z.object({ charKey: z.string(), look: z.string().optional() }))
})

/** A spoken line. */
export const lineBeatSchema = z.object({
  id: z.string(),
  type: z.literal('line'),
  /** The character key, or null for a speaker that is not in the bible. */
  speakerKey: z.string().nullable(),
  /** The name as written in the script. */
  speakerLabel: z.string(),
  expression: canonicalExpressionSchema,
  /** The expression as written, when it was not one of the standard ones. */
  rawExpression: z.string().optional(),
  text: z.string()
})

export const narrationBeatSchema = z.object({
  id: z.string(),
  type: z.literal('narration'),
  text: z.string()
})

export const vnBeatSchema = z.discriminatedUnion('type', [castBeatSchema, lineBeatSchema, narrationBeatSchema])
export type VnBeat = z.infer<typeof vnBeatSchema>

// ---- scenes, chapters, book ----

export const vnSceneSchema = z.object({
  /** `ch01.s01` */
  id: z.string(),
  placeKey: z.string().nullable(),
  /** The place as written in the script. */
  placeText: z.string(),
  time: z.string().nullable(),
  /** The asset id of the background (one per place and time). */
  backgroundId: z.string(),
  description: z.string(),
  beats: z.array(vnBeatSchema),
  /** A scene break (`---`) came before this scene. */
  breakBefore: z.boolean()
})
export type VnScene = z.infer<typeof vnSceneSchema>

export const vnChapterSchema = z.object({
  n: z.number().int().positive(),
  title: z.string(),
  summary: z.string().optional(),
  /** Choices at the end of the chapter: the text and the chapter number it leads to. Empty for a linear chapter. */
  choices: z.array(z.object({ text: z.string(), to: z.number().int().positive() })),
  /** The ending text when the chapter is an ending, else null. */
  ending: z.string().nullable(),
  scenes: z.array(vnSceneSchema)
})
export type VnChapter = z.infer<typeof vnChapterSchema>

export const vnBookSchema = z.object({
  slug: z.string(),
  title: z.string(),
  author: z.string().optional(),
  genre: z.string().optional(),
  /** The Scriptorium format id, for example `choice-visual-novel`. */
  format: z.string(),
  kind: z.enum(['linear', 'choice']),
  primaryLang: langSchema,
  /** The art style from the bible's Style section. */
  style: z.string(),
  characters: z.array(z.object({ key: z.string(), name: z.string(), looks: z.string(), voice: z.string().optional() })),
  places: z.array(z.object({ key: z.string(), name: z.string(), looks: z.string() })),
  coverBrief: z.string().optional(),
  chapters: z.array(vnChapterSchema),
  /** Problems found while importing (a bad branch, an unknown speaker ...). */
  warnings: z.array(z.string())
})
export type VnBook = z.infer<typeof vnBookSchema>

// ---- editions ----

/** The text of one language. Keyed so it lines up with the structure in `vn.json`. */
export const editionSchema = z.object({
  lang: langSchema,
  title: z.string(),
  /** Chapter number -> title. */
  chapterTitles: z.record(z.coerce.number(), z.string()),
  /** `${chapterNumber}:${choiceIndex}` -> choice text. */
  choiceTexts: z.record(z.string(), z.string()),
  /** Chapter number -> ending text. */
  endings: z.record(z.coerce.number(), z.string()),
  /** Character key -> display name. */
  characterNames: z.record(z.string(), z.string()),
  /** Beat id -> text. */
  beats: z.record(z.string(), z.string())
})
export type Edition = z.infer<typeof editionSchema>

// ---- project settings (project.md frontmatter) ----

export const ART_PROVIDERS = ['comfy', 'pixel-studio-draw'] as const
export const PIXEL_PROVIDERS = ['vno', 'pixel-studio'] as const
export const MUSIC_PROVIDERS = ['comfy', 'chiptune'] as const
/** The chips of Chiptune Studio. */
export const CHIPS = ['nes', 'gb', 'genesis', 'snes', 'pce'] as const
export const DITHERS = ['none', 'ordered', 'floyd'] as const
export type Chip = (typeof CHIPS)[number]
export type Dither = (typeof DITHERS)[number]

/** The pixel grid of a background (the game image is this grid scaled up with nearest-neighbour) and how the conversion looks. */
export const pixelSchema = z.object({
  width: z.number().int().min(16).max(512).optional(),
  height: z.number().int().min(16).max(512).optional(),
  dither: z.enum(DITHERS).optional(),
  /** A 1px outline round the opaque pixels (Pixel Studio import). */
  outline: z.boolean().optional()
})

/** The pixel settings a project that has none uses: 320x180 backgrounds (a 6x scale to 1920x1080). */
export const PIXEL_DEFAULTS = { width: 320, height: 180, dither: 'none' as Dither, outline: false }

/**
 * Projects from before per-language voices stored one voice id per speaker. An OmniVoice id (`omni:*`) is dropped (the speaker needs
 * a new plan), a Supertonic id reads English and Croatian (the languages of that time), any other id (Kokoro) reads English only.
 */
function legacyVoices(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [speaker, v] of Object.entries(raw)) {
    if (typeof v !== 'string') out[speaker] = v
    else if (v.startsWith('supertonic:')) out[speaker] = Object.fromEntries(LEGACY_LANGS.map((l) => [l, v]))
    else if (!v.startsWith('omni:') && v) out[speaker] = { en: v }
  }
  return out
}

export const projectSettingsSchema = z.object({
  slug: z.string(),
  /** The book folder the project was imported from. */
  source: z.string(),
  primaryLang: langSchema,
  /** The languages that have an edition (the primary one included). */
  editions: z.array(langSchema).default([]),
  /** The game theme, or null to pick one from the format, genre and style. */
  theme: z.string().nullable().default(null),
  art: z
    .object({
      style: z.enum(['illustrated', 'pixel']).default('illustrated'),
      /** ComfyUI generator engine id. */
      generator: z.string().default('qwen-image-2.1'),
      /** ComfyUI edit engine id (sprites from the character sheet). */
      editor: z.string().default('qwen-image-2.1-edit'),
      /** A pixel palette name, for pixel mode. */
      palette: z.string().optional(),
      /** The art-critic reviews every generated image. */
      review: z.boolean().default(false),
      /** The style words every image prompt starts with. Empty: derived from the format, genre and art mode (never from the bible's Style section, which is a writing note). */
      stylePrompt: z.string().optional(),
      /** How sprites get a transparent background: ComfyUI BiRefNet, a Qwen-Image edit pass then BiRefNet, or keying out a flat background. */
      bgRemoval: z.enum(['birefnet', 'qwen-edit', 'key']).default('birefnet'),
      /** Who makes the sprites: ComfyUI (the default), or `pixel-studio-draw`: an agent draws small pixel sprites in Pixel Studio. Missing: `comfy`. */
      provider: z.enum(ART_PROVIDERS).optional(),
      /** Who turns an image into pixel art (pixel style only): the built-in sharp quantiser (`vno`) or Pixel Studio. Missing: `vno`. */
      pixelProvider: z.enum(PIXEL_PROVIDERS).optional(),
      /** Pixel art size and look. Missing fields take `PIXEL_DEFAULTS`. */
      pixel: pixelSchema.optional()
    })
    .default({ style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' }),
  music: z
    .object({
      engine: z.string().default('ace-step-v1-instrumental'),
      tracks: z.number().int().nonnegative().default(3),
      /** Who makes the music: ComfyUI (ACE-Step) or Chiptune Studio. Missing: chiptune for pixel books, else comfy. */
      provider: z.enum(MUSIC_PROVIDERS).optional(),
      /** The chip of Chiptune Studio. Missing: the composer picks one per track. */
      chip: z.enum(CHIPS).optional()
    })
    .default({ engine: 'ace-step-v1-instrumental', tracks: 3 }),
  voice: z
    .object({
      enabled: z.boolean().default(false),
      langs: z.array(langSchema).default([]),
      /** Where clips come from: VibeTTS (Kokoro and Supertonic over its local MCP server) or a ComfyUI TTS workflow. */
      provider: z.enum(['vibetts', 'comfy']).default('vibetts'),
      /** Language -> TTS engine id (ComfyUI custom workflow name), used when `provider` is `comfy`. */
      engines: z.record(z.string(), z.string()).default({}),
      /** Which engine reads English: the Kokoro voices (the default) or the Supertonic ones. Other languages always use Supertonic. Missing: `kokoro`. */
      englishEngine: z.enum(['kokoro', 'supertonic']).optional(),
      /** Speaker key (character key or `narrator`) -> language -> VibeTTS voice id such as `af_heart` (en) or `supertonic:F2`. */
      voices: z.preprocess(legacyVoices, z.record(z.string(), z.record(langSchema, z.string()))).default({})
    })
    .default({ enabled: false, langs: [], provider: 'vibetts', engines: {}, voices: {} })
})
export type ProjectSettings = z.infer<typeof projectSettingsSchema>

// The newer settings are optional, so a project.md from before them still parses (and is saved unchanged). These give their values.

export function resolvePixel(art: Pick<ProjectSettings['art'], 'pixel'>): { width: number; height: number; dither: Dither; outline: boolean } {
  const p = art.pixel ?? {}
  return { width: p.width ?? PIXEL_DEFAULTS.width, height: p.height ?? PIXEL_DEFAULTS.height, dither: p.dither ?? PIXEL_DEFAULTS.dither, outline: p.outline ?? PIXEL_DEFAULTS.outline }
}

export const resolvePixelProvider = (art: Pick<ProjectSettings['art'], 'pixelProvider'>): (typeof PIXEL_PROVIDERS)[number] => art.pixelProvider ?? 'vno'
export const resolveArtProvider = (art: Pick<ProjectSettings['art'], 'provider'>): (typeof ART_PROVIDERS)[number] => art.provider ?? 'comfy'

/** The music provider: the chosen one, else Chiptune Studio for pixel-style books and ComfyUI for the rest. */
export function resolveMusicProvider(settings: Pick<ProjectSettings, 'art' | 'music'>): (typeof MUSIC_PROVIDERS)[number] {
  return settings.music.provider ?? (settings.art.style === 'pixel' ? 'chiptune' : 'comfy')
}

/** The pseudo engine id of a music asset made by Chiptune Studio. */
export const CHIPTUNE_ENGINE = 'chiptune'

// ---- assets (assets.json) ----

export const ASSET_KINDS = ['background', 'sheet', 'sprite', 'cover', 'music', 'voiceRef'] as const
export const assetKindSchema = z.enum(ASSET_KINDS)
export type AssetKind = z.infer<typeof assetKindSchema>

export const assetVersionSchema = z.object({
  n: z.number().int().positive(),
  /** File name inside `assets/<id>/`. */
  file: z.string(),
  createdAt: z.string(),
  seed: z.number().nullable(),
  engine: z.string(),
  prompt: z.string(),
  /** Music from Chiptune Studio: where the loop starts and ends, in seconds. Ren'Py plays `<loop start>file` with it. */
  loopStartSec: z.number().nullable().optional(),
  loopEndSec: z.number().nullable().optional(),
  /** Chiptune Studio's native song file of this version (next to the audio), for "Open in Chiptune Studio". */
  songFile: z.string().optional(),
  /** Pixel Studio art: the PNG at the native pixel size (before the nearest-neighbour scale up), for "Open in Pixel Studio". */
  nativeFile: z.string().optional(),
  /** Non-fatal problems of making this version (Pixel Studio was down, so the built-in pixelate ran ...). */
  warnings: z.array(z.string()).optional(),
  /** Made by hand in a studio (the round trip): the pipeline never regenerates it. */
  custom: z.boolean().optional()
})
export type AssetVersion = z.infer<typeof assetVersionSchema>

export const assetEntrySchema = z.object({
  id: z.string(),
  kind: assetKindSchema,
  prompt: z.string(),
  negative: z.string().optional(),
  engine: z.string(),
  seed: z.number().nullable(),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).nullable(),
  /** Asset ids used as references (a sprite uses its character sheet). */
  refs: z.array(z.string()).optional(),
  versions: z.array(assetVersionSchema),
  /** The selected version number, or null when none is chosen yet. */
  selected: z.number().int().positive().nullable(),
  source: z.enum(['generated', 'custom']),
  /** The uploaded file, when `source` is `custom`. */
  customFile: z.string().optional(),
  /** Locked assets are never regenerated. */
  locked: z.boolean(),
  /** The prompt was set with `vno_asset_set`: the art-director and composer keep it. */
  promptByHand: z.boolean().optional(),
  review: z
    .object({
      status: z.enum(['pending', 'approved', 'rejected']),
      note: z.string().optional()
    })
    .optional()
})
export type AssetEntry = z.infer<typeof assetEntrySchema>

export const assetManifestSchema = z.object({ assets: z.array(assetEntrySchema) })
export type AssetManifest = z.infer<typeof assetManifestSchema>
