import { z } from 'zod'
import { BUILTIN_LANGUAGES, LEGACY_LANGS } from './languages'
import { editionPuzzleSchema, puzzleEntrySchema } from './puzzle'

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

/** An expression of a sprite: a standard word or one the book defines (`smug`). No underscore: a sprite id is split at its last one. */
export const EXPRESSION_RE = /^[a-z][a-z0-9]{0,23}$/
export const expressionSchema = z.string().regex(EXPRESSION_RE, 'lowercase letters and digits, starting with a letter, at most 24 characters')
/** Any expression: the standard ones are a subset (so a vn.json from before expression sets still parses). */
export type Expression = string

// ---- presentation ----

/** How the game presents the book: as a visual novel (sprites, a text box), or as a children's picture book. */
export const PRESENTATIONS = ['visual-novel', 'picture-book'] as const
export const presentationSchema = z.enum(PRESENTATIONS)
export type Presentation = z.infer<typeof presentationSchema>

/** The Scriptorium formats whose books are children's picture books: one illustration and a short caption per scene, no sprites. */
export const PICTURE_BOOK_FORMATS: readonly string[] = ['kids-picture-book']

/** The presentation a new book of this format gets: a picture book for the picture-book formats, else a visual novel. */
export function presentationForFormat(format: string | null | undefined): Presentation {
  return format && PICTURE_BOOK_FORMATS.includes(format) ? 'picture-book' : 'visual-novel'
}

/**
 * The presentation of a book: its own `presentation` field (which `book.update` may change), else the one its format implies.
 * Old `vn.json` files without the field are visual novels (or picture books, if their format says so).
 */
export function presentationOf(book: Pick<VnBook, 'format'> & { presentation?: Presentation }): Presentation {
  return book.presentation ?? presentationForFormat(book.format)
}

/** Whether a book (or a format id) is presented as a children's picture book. */
export function isPictureBook(bookOrFormat: (Pick<VnBook, 'format'> & { presentation?: Presentation }) | string | null | undefined): boolean {
  if (bookOrFormat === null || bookOrFormat === undefined || typeof bookOrFormat === 'string') return presentationForFormat(bookOrFormat) === 'picture-book'
  return presentationOf(bookOrFormat) === 'picture-book'
}

/**
 * What a beat may carry besides its own content (a cast, a line or narration): a picture shown from this beat on (`cg_<key>`, null hides it), a
 * sound effect played when it starts (`sfx_<key>`), an ambience started or, with null, stopped (`amb_<key>`). Values are catalogue keys.
 */
const beatCues = {
  image: z.string().nullable().optional(),
  sfx: z.string().optional(),
  ambience: z.string().nullable().optional()
}

// ---- beats ----

/** Who is on screen from this beat on. */
export const castBeatSchema = z.object({
  /** `ch01.s01.b001` */
  id: z.string(),
  type: z.literal('cast'),
  cast: z.array(z.object({ charKey: z.string(), look: z.string().optional() })),
  ...beatCues
})

/** A spoken line. */
export const lineBeatSchema = z.object({
  id: z.string(),
  type: z.literal('line'),
  /** The character key, or null for a speaker that is not in the bible. */
  speakerKey: z.string().nullable(),
  /** The name as written in the script. */
  speakerLabel: z.string(),
  expression: expressionSchema,
  /** The expression as written, when it was not one of the book's own words. */
  rawExpression: z.string().optional(),
  text: z.string(),
  ...beatCues
})

export const narrationBeatSchema = z.object({
  id: z.string(),
  type: z.literal('narration'),
  text: z.string(),
  ...beatCues
})

/** A puzzle the player solves here (a key of the book's `puzzles`). The story goes on when it is solved (or given up, or failed: see the puzzle's `onFail`). */
export const puzzleBeatSchema = z.object({
  id: z.string(),
  type: z.literal('puzzle'),
  puzzle: z.string(),
  ...beatCues
})

export const vnBeatSchema = z.discriminatedUnion('type', [castBeatSchema, lineBeatSchema, narrationBeatSchema, puzzleBeatSchema])
export type VnBeat = z.infer<typeof vnBeatSchema>
/** A beat with words: a line or a narration (a cast and a puzzle have none). */
export type TextBeat = Extract<VnBeat, { text: string }>
export const hasText = (b: VnBeat): b is TextBeat => b.type === 'line' || b.type === 'narration'

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
  breakBefore: z.boolean(),
  /** Music for this scene: a track id (`music_02`), null for silence. Missing: the chapter's music goes on. */
  music: z.string().nullable().optional(),
  /** An ambience for this scene (a sound key, started looped), null to stop it. Missing: what plays goes on. */
  ambience: z.string().nullable().optional()
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

/** An extra picture of the book: a CG (shown over the scene) or an insert (an object or a document shown small in the middle). */
export const imageEntrySchema = z.object({
  /** Lowercase key: the asset is `cg_<key>`. */
  key: z.string(),
  description: z.string(),
  display: z.enum(['full', 'insert']),
  /** Characters in the picture: their sheets are references when it is made. */
  characters: z.array(z.string()).optional()
})
export type ImageEntry = z.infer<typeof imageEntrySchema>

/** A sound of the book: a one-shot effect (`sfx_<key>`) or a looped ambience (`amb_<key>`). */
export const soundEntrySchema = z.object({
  key: z.string(),
  kind: z.enum(['sfx', 'ambience']),
  description: z.string()
})
export type SoundEntry = z.infer<typeof soundEntrySchema>

export const vnBookSchema = z.object({
  slug: z.string(),
  title: z.string(),
  author: z.string().optional(),
  genre: z.string().optional(),
  /** The Scriptorium format id, for example `choice-visual-novel`. */
  format: z.string(),
  /**
   * How the game shows the book: `visual-novel` (sprites and a text box) or `picture-book` (one illustration and a caption per scene). Optional so an
   * old `vn.json` still parses; missing follows the format (`presentationForFormat`). New imports store it.
   */
  presentation: presentationSchema.optional(),
  kind: z.enum(['linear', 'choice']),
  primaryLang: langSchema,
  /** The art style from the bible's Style section. */
  style: z.string(),
  characters: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      looks: z.string(),
      voice: z.string().optional(),
      /** Other names the story calls the character by (`the bald man`). A line spoken under one shows that name, so the reader is not told early. */
      aliases: z.array(z.string()).optional(),
      /** Expressions of this character beyond the book's set (`smug`): each gets a sprite. */
      expressions: z.array(expressionSchema).optional()
    })
  ),
  places: z.array(z.object({ key: z.string(), name: z.string(), looks: z.string() })),
  /** The expression set of the book: the words a line may use and each character gets a sprite for. Missing: the standard eight. Includes `neutral`. */
  expressions: z.array(expressionSchema).optional(),
  /** CGs and inserts the story shows (`cg_<key>`). */
  images: z.array(imageEntrySchema).optional(),
  /** Sound effects and ambiences the story plays (`sfx_<key>`, `amb_<key>`). */
  sounds: z.array(soundEntrySchema).optional(),
  /** Logic puzzles between story scenes (a `puzzle` beat plays one). */
  puzzles: z.array(puzzleEntrySchema).optional(),
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
  beats: z.record(z.string(), z.string()),
  /** Puzzle key -> the names and clue texts in this language. */
  puzzles: z.record(z.string(), editionPuzzleSchema).optional(),
  /** Scene id -> the title shown for the scene, when an edition (a pack catalogue) carries one. Missing: the scene's place text. */
  sceneTitles: z.record(z.string(), z.string()).optional()
})
export type Edition = z.infer<typeof editionSchema>

// ---- project settings (project.md frontmatter) ----

export const ART_PROVIDERS = ['comfy', 'pixel-studio-draw', 'hand', 'flow'] as const
export const PIXEL_PROVIDERS = ['vno', 'pixel-studio'] as const
export const MUSIC_PROVIDERS = ['comfy', 'chiptune', 'flow'] as const
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
  /** A project imported from a VN Studio pack (HUB-16): the pack hash the project was imported with, its format version and the authored source hash. Missing: a legacy folder import. */
  packHash: z.string().optional(),
  packVersion: z.number().int().optional(),
  sourceHash: z.string().optional(),
  /** Where `vn/pack.json` and `vn/text/*.json` live (the source book folder). Empty: no pack. */
  packDir: z.string().optional(),
  /** The game theme, or null to pick one from the format, genre and style. */
  theme: z.string().nullable().default(null),
  /** Models this project uses, per role (`art-director: client/claude-code`): they go before the agent's model and the role's list in config/roles.md, which stay as the fallback. */
  models: z.record(z.string(), z.string()).default({}),
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
      /** Who makes the sprites: ComfyUI (the default), or `pixel-studio-draw`: an agent draws small pixel sprites in Pixel Studio, or `hand`: every image is made outside VN Studio and set with vno_asset_replace (ComfyUI is never called for an image). Missing: `comfy`. */
      provider: z.enum(ART_PROVIDERS).optional(),
      /** `flow` only: the image model as Flow's menu shows it (`Nano Banana Pro`). Missing: Flow's newest Nano Banana. */
      flowModel: z.string().optional(),
      /** `flow` only: the Flow project the images are made in. Missing: `vno-<slug>`. */
      flowProject: z.string().optional(),
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
      provider: z.enum(['vibetts', 'comfy', 'flow']).default('vibetts'),
      /** `flow` only: a delivery note per speaker (character key or `narrator`) for the Gemini voice, e.g. "gruffly, tired". */
      flowStyles: z.record(z.string(), z.string()).optional(),
      /** Language -> TTS engine id (ComfyUI custom workflow name), used when `provider` is `comfy`. */
      engines: z.record(z.string(), z.string()).default({}),
      /** Which engine reads English: the Kokoro voices (the default) or the Supertonic ones. Other languages always use Supertonic. Missing: `kokoro`. */
      englishEngine: z.enum(['kokoro', 'supertonic']).optional(),
      /** Speaker key (character key or `narrator`) -> language -> VibeTTS voice id such as `af_heart` (en) or `supertonic:F2`. */
      voices: z.preprocess(legacyVoices, z.record(z.string(), z.record(langSchema, z.string()))).default({})
    })
    .default({ enabled: false, langs: [], provider: 'vibetts', engines: {}, voices: {} }),
  /**
   * Sound effects and ambiences. `ambienceEngine` is a ComfyUI music engine (the default) or `chiptune` (Chiptune Studio's `compose_sfx` ambience loops).
   * `sfxEngine` names the engine of a sound effect: an audio engine, `chiptune` (Chiptune Studio's `compose_sfx`) or a `custom:<workflow>`.
   * Missing: the music provider's engine (Chiptune Studio for a pixel book) or else `ambienceEngine`. `"none"` keeps sound effects import-only
   * (`vno_asset_import`).
   */
  sound: z
    .object({
      ambienceEngine: z.string().default('ace-step-v1-instrumental'),
      sfxEngine: z.string().optional()
    })
    .default({ ambienceEngine: 'ace-step-v1-instrumental' })
})
export type ProjectSettings = z.infer<typeof projectSettingsSchema>

// The newer settings are optional, so a project.md from before them still parses (and is saved unchanged). These give their values.

export function resolvePixel(art: Pick<ProjectSettings['art'], 'pixel'>): { width: number; height: number; dither: Dither; outline: boolean } {
  const p = art.pixel ?? {}
  return { width: p.width ?? PIXEL_DEFAULTS.width, height: p.height ?? PIXEL_DEFAULTS.height, dither: p.dither ?? PIXEL_DEFAULTS.dither, outline: p.outline ?? PIXEL_DEFAULTS.outline }
}

export const resolvePixelProvider = (art: Pick<ProjectSettings['art'], 'pixelProvider'>): (typeof PIXEL_PROVIDERS)[number] => art.pixelProvider ?? 'vno'
export const resolveArtProvider = (art: Pick<ProjectSettings['art'], 'provider'>): (typeof ART_PROVIDERS)[number] => art.provider ?? 'comfy'
/** The asset kinds that are images. */
export const IMAGE_KINDS: ReadonlySet<string> = new Set(['background', 'sheet', 'sprite', 'cover', 'cg'])
/** The asset kinds that are audio, made by a model or imported (a voice reference is audio too, but only ever uploaded). */
export const AUDIO_KINDS: ReadonlySet<string> = new Set(['music', 'sfx', 'ambience'])
/** Hand-made art: VN Studio never generates an image (any art style). */
export const isHandArt = (art: Pick<ProjectSettings['art'], 'provider'>): boolean => art.provider === 'hand'

/** The music provider: the chosen one, else Chiptune Studio for pixel-style books and ComfyUI for the rest. */
export function resolveMusicProvider(settings: Pick<ProjectSettings, 'art' | 'music'>): (typeof MUSIC_PROVIDERS)[number] {
  return settings.music.provider ?? (settings.art.style === 'pixel' ? 'chiptune' : 'comfy')
}

/** The pseudo engine id of a music asset made by Chiptune Studio. */
export const CHIPTUNE_ENGINE = 'chiptune'
/** The pseudo engine id of an image made by Google Flow (through flow-music-mcp). */
export const FLOW_ENGINE = 'flow'
/** The pseudo engine id of a track made by Flow Music (spends Flow Music credits). */
export const FLOW_MUSIC_ENGINE = 'flow-music'
/** `sound.sfxEngine` set to this: sound effects are imported by hand, never generated. */
export const SFX_IMPORT_ONLY = 'none'

/**
 * The engine that makes a sound effect: `sound.sfxEngine` when set (`chiptune`, an audio engine or `custom:<workflow>`;
 * `"none"` keeps effects import-only), else the music provider's engine (Chiptune Studio for a pixel book) or the ambience engine.
 */
export function resolveSfxEngine(settings: Pick<ProjectSettings, 'art' | 'music' | 'sound'>): string {
  const chosen = settings.sound.sfxEngine?.trim()
  if (chosen === SFX_IMPORT_ONLY) return SFX_IMPORT_ONLY
  if (chosen) return chosen
  return resolveMusicProvider(settings) === 'chiptune' ? CHIPTUNE_ENGINE : settings.sound.ambienceEngine
}

// ---- assets (assets.json) ----

export const ASSET_KINDS = ['background', 'sheet', 'sprite', 'cover', 'cg', 'music', 'sfx', 'ambience', 'voiceRef'] as const
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
  /** Made by Google Flow / Flow Music: the Flow media id (images) or song id, so a later image can use it as a reference. */
  remote: z.object({ provider: z.enum(['flow', 'flow-music']), id: z.string(), project: z.string().optional() }).optional(),
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

/** The expressions a character has sprites for: the book's set (default: the standard eight) plus its own. */
export function expressionsOf(book: Pick<VnBook, 'expressions'>, char?: { expressions?: string[] }): Expression[] {
  return [...new Set([...(book.expressions ?? CANONICAL_EXPRESSIONS), ...(char?.expressions ?? [])])]
}
