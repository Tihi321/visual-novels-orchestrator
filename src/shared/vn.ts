import { z } from 'zod'

/**
 * The VN data contract: the book structure (`vn.json`), editions (`editions/<lang>.json`), the per-project settings
 * (`project.md` frontmatter) and the asset manifest (`assets.json`). Schemas first, types inferred from them.
 *
 * Structure and text are kept apart: `vn.json` holds the structure and the primary-language text; an edition holds
 * the words of another language keyed by beat id, so a new edition reuses every asset.
 */

export const LANGS = ['en', 'hr'] as const
export const langSchema = z.enum(LANGS)
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
      bgRemoval: z.enum(['birefnet', 'qwen-edit', 'key']).default('birefnet')
    })
    .default({ style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' }),
  music: z
    .object({
      engine: z.string().default('ace-step-v1-instrumental'),
      tracks: z.number().int().nonnegative().default(3)
    })
    .default({ engine: 'ace-step-v1-instrumental', tracks: 3 }),
  voice: z
    .object({
      enabled: z.boolean().default(false),
      langs: z.array(langSchema).default([]),
      /** Where clips come from: VibeTTS (OmniVoice over its local MCP server) or a ComfyUI TTS workflow. */
      provider: z.enum(['vibetts', 'comfy']).default('vibetts'),
      /** Language -> TTS engine id (ComfyUI custom workflow name), used when `provider` is `comfy`. */
      engines: z.record(z.string(), z.string()).default({}),
      /** Speaker key (character key or `narrator`) -> VibeTTS voice id such as `omni:petra`. */
      voices: z.record(z.string(), z.string()).default({})
    })
    .default({ enabled: false, langs: [], provider: 'vibetts', engines: {}, voices: {} })
})
export type ProjectSettings = z.infer<typeof projectSettingsSchema>

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
  prompt: z.string()
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
