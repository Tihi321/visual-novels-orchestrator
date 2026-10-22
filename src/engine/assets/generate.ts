import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { CHIPTUNE_ENGINE, resolveArtProvider, resolveMusicProvider, resolvePixel, resolvePixelProvider } from '../../shared/vn'
import type { AssetEntry, AssetManifest, AssetVersion, ProjectSettings, VnBook } from '../../shared/vn'
import type { ComfyClient, ComfyProgress, ComfyResult } from '../comfy/client'
import { randomSeed } from '../comfy/graphs'
import { renameRetry } from '../store/atomic'
import { fallbackNegative, fallbackPrompt, imageOfAsset, LANDSCAPE, PORTRAIT, SQUARE } from './derive'
import { addVersion, assetDir, getEntry, nextVersionN, replaceEntry, resolveFile, saveManifest } from './manifest'
import { loadPalette, type Rgb } from './palettes'
import { fitBackground, keepMainSubject, keyOutFlatBackground, pixelate, prepareSprite, toWebp, transparentShare } from './postprocess'
import { drawSpriteFromGrid, drawSpriteWithStudio } from '../studios/draw'
import type { ModelReply } from '../studios/draw'
import { fallbackChipPlan } from '../studios/chip-plan'
import type { ChipTrackPlan } from '../studios/chip-plan'
import type { ChiptuneClient } from '../studios/chiptune'
import { makeChiptuneTrack } from '../studios/music'
import { pixelateWithStudio } from '../studios/pixelate'
import type { PixelClient } from '../studios/pixel'

export interface GenerateOptions {
  /** Regenerate even when the asset is locked or custom. */
  force?: boolean
  /** Edits applied to the entry (and kept) before generating. */
  prompt?: string
  negative?: string
  engine?: string
  seed?: number
  /** Sprites: skip the edit and redo background removal on the selected version's raw edit output (`v<n>.raw.<ext>`). */
  reprocess?: boolean
}

/** The prompt of the Qwen-Image 2.1 background-removal edit (the user's `image_qwen_image_2_1_background_removal` workflow). */
export const QWEN_REMOVE_BG_PROMPT = 'Remove the background, and output a PNG image'

/** True when the image has a real alpha channel with transparent pixels (more than 1% of the area). */
export async function hasTransparency(png: Buffer): Promise<boolean> {
  return (await transparentShare(png)) > 0.01
}

export interface GenerateSizes {
  /** Final background size. Default 1920x1080. */
  background?: { w: number; h: number }
  /** Final cover size. Default: the background size (the cover is landscape). */
  cover?: { w: number; h: number }
  /** Sprite height after trimming. Default 972 (90% of 1080). */
  spriteHeight?: number
  /** Pixel mode: downscale factor. Default 4. */
  pixelScale?: number
  musicSeconds?: number
  /** Length of an ambience loop. Default 60. */
  ambienceSeconds?: number
  /** Length of a sound effect made by a custom workflow. Default 5. */
  sfxSeconds?: number
  musicFormat?: 'flac' | 'mp3' | 'opus' | 'wav'
}

export interface GenerateProgress {
  id: string
  stage: 'start' | 'comfy' | 'post' | 'done'
  message: string
}

export interface GenerateContext {
  book: VnBook
  settings: ProjectSettings
  /** `projects/<slug>` */
  projectDir: string
  comfy: ComfyClient
  /** Folder with `<name>.hex` palettes (for pixel mode with a palette). */
  palettesDir?: string
  /** The file of a referenced asset (a sprite's sheet). Default: none, so sprites fail with a clear error. */
  resolveRef?: (id: string) => string | null
  sizes?: GenerateSizes
  onProgress?: (e: GenerateProgress) => void
  signal?: AbortSignal
  now?: () => Date
  /** Pixel Studio, for `pixelProvider: pixel-studio` and `provider: pixel-studio-draw`. Without it the built-in pixelate runs. */
  pixel?: PixelClient
  /** Chiptune Studio, for music assets with the `chiptune` engine. */
  chiptune?: ChiptuneClient
  /** The composer's plan of this track; default: the deterministic plan. */
  chipPlan?: ChipTrackPlan
  /** The agent's model, for the drawing mode (`pixel-studio-draw`). Without it (or when it fails) the import path runs. */
  ask?: ModelReply
  /** How a sprite is drawn: the limits of the loop (`ms` may be Infinity), and the mode (default loop). */
  draw?: { steps: number; ms: number; mode?: 'loop' | 'grid' }
}

export type GenerateResult =
  | { ok: true; skipped: false; entry: AssetEntry; version: AssetVersion; /** Non-fatal problems, for example a fallback to the flat-colour key. */ warnings?: string[] }
  | { ok: true; skipped: true; entry: AssetEntry; reason: string }
  | { ok: false; entry: AssetEntry; error: string }

async function writeFileAtomic(file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await fs.writeFile(tmp, bytes)
  await renameRetry(tmp, file)
}

/** The raw edit output of the selected version (`v<n>.raw.<ext>`), if it was kept. */
async function findRaw(projectDir: string, entry: AssetEntry): Promise<{ bytes: Buffer; ext: string } | null> {
  if (entry.selected == null) return null
  const dir = assetDir(projectDir, entry.id)
  for (const ext of ['png', 'webp', 'jpg', 'jpeg']) {
    try {
      return { bytes: await fs.readFile(path.join(dir, `v${entry.selected}.raw.${ext}`)), ext }
    } catch {
      /* try the next extension */
    }
  }
  return null
}

/**
 * Cuts the figure out of an edit result. `birefnet`: the BiRefNet model in ComfyUI. `qwen-edit`: a Qwen-Image 2.1 edit
 * pass first (its output is used as is when it carries real alpha, else BiRefNet runs on it). `key`: flat-colour keying.
 * Failures and a missing model fall back (qwen-edit -> birefnet -> key) and are reported through `warn`.
 */
export async function removeBackground(
  ctx: Pick<GenerateContext, 'comfy' | 'settings' | 'signal'>,
  image: Buffer,
  method: 'birefnet' | 'qwen-edit' | 'key',
  o: { seed: number; size: { w: number; h: number }; onProgress?: (p: ComfyProgress) => void },
  warn: (message: string) => void
): Promise<Buffer> {
  if (method === 'key') return keyOutFlatBackground(image)
  let source = image
  if (method === 'qwen-edit') {
    try {
      const q = await ctx.comfy.generate({
        engine: ctx.settings.art.editor,
        prompt: QWEN_REMOVE_BG_PROMPT,
        seed: o.seed,
        references: [image],
        width: o.size.w,
        height: o.size.h,
        onProgress: o.onProgress,
        signal: ctx.signal
      })
      if (await hasTransparency(q.bytes)) return q.bytes
      source = q.bytes // an isolated subject on a flat background: BiRefNet finishes the cut
    } catch (e) {
      if (ctx.signal?.aborted) throw e
      warn(`Qwen background-removal edit failed (${(e as Error).message}); using BiRefNet on the original`)
    }
  }
  try {
    const cut = await ctx.comfy.removeBackground(source, { onProgress: o.onProgress, signal: ctx.signal })
    if (cut) return cut
    warn('no BiRefNet background-removal model is installed in ComfyUI; used the flat-colour key')
  } catch (e) {
    if (ctx.signal?.aborted) throw e
    warn(`BiRefNet background removal failed (${(e as Error).message}); used the flat-colour key`)
  }
  return keyOutFlatBackground(image)
}

/** What `finishImage` needs of the generation context (an import has no model and no ComfyUI job of its own). */
export type FinishContext = Pick<GenerateContext, 'book' | 'settings' | 'projectDir' | 'comfy' | 'palettesDir' | 'sizes' | 'pixel' | 'ask' | 'draw' | 'signal'>

export interface FinishOptions {
  seed?: number
  /** The size the image was made at: the Qwen background-removal edit asks for it. Default: the image's own size. */
  size?: { w: number; h: number }
  /** The palette of a pixel project (loaded by the caller, which has to fail early when it cannot). */
  palette?: Rgb[]
  onProgress?: (p: ComfyProgress) => void
  progress?: (stage: GenerateProgress['stage'], message: string) => void
  /** Sprites: how the background is cut out. Default: `art.bgRemoval`, else `birefnet`. `none` keeps the image as it is. */
  removeBackground?: 'birefnet' | 'qwen-edit' | 'key' | 'none'
  /** Sprites: trim to the figure and scale to the sprite height (default). False: scale only. */
  trim?: boolean
  /** Pixel projects: turn the image into pixel art (default). */
  pixelate?: boolean
  /** Sprites of a `pixel-studio-draw` project: let the agent draw (default). An import never draws. */
  draw?: boolean
  /** The extension of a sheet, which is kept as it is. Default png. */
  ext?: string
  /** A CG: `full` is fitted to the screen like a background, `insert` keeps its size. Default full. */
  display?: 'full' | 'insert'
}

export interface FinishedImage {
  bytes: Buffer
  ext: string
  /** The pixel art at its native size (a PNG), when Pixel Studio made it: kept for "Open in Pixel Studio". */
  native?: Buffer
  /** Non-fatal problems, for example a fallback to the flat-colour key. */
  warnings: string[]
}

/**
 * The post-processing of an image asset, the same for a generated image and an imported one:
 * background (and cover): fitted to the project resolution, then pixel finishing; sprite: background removed, one figure kept, trimmed and
 * scaled to the sprite height, then pixel finishing; sheet: as it is. A cover whose shape is far from the screen's (a portrait one) is kept
 * whole: the build composes it (see `renpy/images.ts`).
 */
export async function finishImage(ctx: FinishContext, entry: AssetEntry, bytes: Buffer, o: FinishOptions = {}): Promise<FinishedImage> {
  const warnings: string[] = []
  const progress = o.progress ?? (() => undefined)
  const warn = (m: string) => {
    warnings.push(m)
    progress('post', `warning: ${m}`)
  }
  if (entry.kind === 'sheet') return { bytes, ext: o.ext ?? 'png', warnings }
  const pixel = ctx.settings.art.style === 'pixel'
  const sizes = ctx.sizes ?? {}
  const palette = o.palette
  const px = resolvePixel(ctx.settings.art)
  const bgSize = sizes.background ?? { w: 1920, h: 1080 }
  // the built-in pixelate keeps its legacy scale (4) unless the project sets a pixel grid
  const scale = sizes.pixelScale ?? (ctx.settings.art.pixel?.width !== undefined ? bgSize.w / px.width : 4)
  // every pixel of the art is a whole number of screen pixels: the final image is the grid times this factor (6 for 320x180 on 1920x1080)
  const factor = Math.max(1, Math.round(bgSize.w / px.width))
  const studioPixels = pixel && resolvePixelProvider(ctx.settings.art) === 'pixel-studio'
  const drawing = pixel && o.draw !== false && entry.kind === 'sprite' && resolveArtProvider(ctx.settings.art) === 'pixel-studio-draw'
  const tmpRoot = path.join(ctx.projectDir, '.vno-tmp')
  /** The pixel art of the pixel grid at its native size (a PNG), when Pixel Studio made it: kept for "Open in Pixel Studio". */
  let native: Buffer | undefined

  /**
   * Pixel art from an image (a PNG): drawn by the agent in Pixel Studio (sprites, `pixel-studio-draw`), converted by Pixel Studio
   * (`pixelProvider: pixel-studio`), or the built-in pixelate. When a studio was asked and fails, the built-in one runs and a warning is kept.
   */
  const finishPixel = async (png: Buffer): Promise<Buffer> => {
    const meta = await sharp(png).metadata()
    const raw = { w: meta.width ?? 1, h: meta.height ?? 1 }
    const grid = entry.kind === 'background' || (entry.kind === 'cg' && o.display !== 'insert') ? { w: px.width, h: px.height } : { w: Math.max(8, Math.round(raw.w / factor)), h: Math.max(8, Math.round(raw.h / factor)) }
    const out = { w: grid.w * factor, h: grid.h * factor }
    if (drawing && ctx.ask && ctx.pixel) {
      const dir = path.join(tmpRoot, `ref-${entry.id}`)
      try {
        progress('post', 'draw the sprite in Pixel Studio')
        // Pixel Studio draws at most 128 px: a bigger sprite is drawn on a grid k times smaller and scaled k times more (still whole pixels)
        const k = Math.ceil(Math.max(grid.w, grid.h) / 128)
        const drawGrid = { w: Math.max(8, Math.round(grid.w / k)), h: Math.max(8, Math.round(grid.h / k)) }
        const drawOut = { w: drawGrid.w * factor * k, h: drawGrid.h * factor * k }
        const pal = palette ?? (ctx.palettesDir ? await loadPalette(ctx.palettesDir, 'db16').catch(() => undefined) : undefined)
        if (!pal) throw new Error('no palette to draw with: choose one in the Look tab')
        await fs.mkdir(dir, { recursive: true })
        const reference = path.join(dir, 'reference.png')
        await fs.writeFile(reference, png)
        const common = { client: ctx.pixel, ask: ctx.ask, reference, grid: drawGrid, palette: pal, expression: entry.id.split('_').pop(), name: entry.id, out: drawOut, tmpRoot, signal: ctx.signal, log: (m: string) => progress('post', m) }
        if (ctx.draw?.mode === 'grid') {
          const g = await drawSpriteFromGrid(common)
          if (g.local) warn('Pixel Studio is not running: the sprite was built from the model rows here (Open in Pixel Studio is not available for it)')
          native = g.native
          return g.png
        }
        const d = await drawSpriteWithStudio({ ...common, maxSteps: ctx.draw?.steps ?? 12, maxMs: ctx.draw?.ms ?? 240_000 })
        native = d.native
        return d.png
      } catch (e) {
        if (ctx.signal?.aborted) throw e
        warn(`Pixel Studio drawing failed (${(e as Error).message}); used the import path`)
      } finally {
        await fs.rm(dir, { recursive: true, force: true })
      }
    } else if (drawing) {
      warn(ctx.ask ? 'Pixel Studio is not configured' : 'no model answered for the drawing agent; used the import path')
    }
    if (studioPixels || drawing) {
      if (ctx.pixel) {
        try {
          progress('post', 'pixel art with Pixel Studio')
          const r = await pixelateWithStudio(ctx.pixel, png, { tmpRoot, grid, out, palette, dither: px.dither, outline: px.outline, name: entry.id, signal: ctx.signal })
          native = r.native
          return r.png
        } catch (e) {
          if (ctx.signal?.aborted) throw e
          warn(`Pixel Studio could not convert the image (${(e as Error).message}); used the built-in pixelate`)
        }
      } else {
        warn('Pixel Studio is not configured; used the built-in pixelate')
      }
    }
    // the built-in pixelate: a whole-number scale, and the result is the grid times it
    const whole = studioPixels || drawing ? factor : Math.max(1, Math.round(scale))
    return pixelate(png, { scale: whole, palette, exactScale: true })
  }
  const finishPixelWebp = async (png: Buffer) => toWebp(await finishPixel(png), { lossless: true })
  const doPixel = pixel && o.pixelate !== false

  let out: Buffer
  if (entry.kind === 'cg' && o.display === 'insert') {
    // an insert (an object, a document) keeps its size: it is shown small, in the middle
    progress('post', 'keep the insert size')
    const kept = await sharp(bytes).webp(pixel ? { lossless: true } : { quality: 90 }).toBuffer()
    out = doPixel ? await finishPixelWebp(kept) : kept
  } else if (entry.kind === 'background' || entry.kind === 'cg' || entry.kind === 'cover') {
    progress('post', `fit ${entry.kind}`)
    const t = entry.kind === 'cover' ? (sizes.cover ?? bgSize) : bgSize
    const meta = await sharp(bytes).metadata()
    const ratio = (meta.width ?? 1) / (meta.height ?? 1) / (t.w / t.h)
    // a cover far from the screen's shape is kept whole (scaled into the frame): the build composes it instead of cutting a strip from it
    const keepShape = entry.kind === 'cover' && ratio < 0.85
    const fitted = keepShape ? await sharp(bytes).resize(t.w, t.h, { fit: 'inside' }).webp(pixel ? { lossless: true } : { quality: 90 }).toBuffer() : await fitBackground(bytes, t.w, t.h, { lossless: pixel })
    out = doPixel ? await finishPixelWebp(fitted) : fitted
  } else if (entry.kind === 'sprite') {
    progress('post', 'remove background')
    const meta = await sharp(bytes).metadata()
    const size = o.size ?? { w: meta.width ?? 1, h: meta.height ?? 1 }
    const method = o.removeBackground ?? ctx.settings.art.bgRemoval ?? 'birefnet'
    let cut = method === 'none' ? bytes : await removeBackground(ctx, bytes, method, { seed: o.seed ?? randomSeed(), size, onProgress: o.onProgress }, warn)
    cut = await keepMainSubject(cut) // one figure: stray islands and a second figure are dropped before the trim
    const height = sizes.spriteHeight ?? 972
    const sprite = o.trim === false ? await sharp(cut).resize({ height, fit: 'inside' }).webp({ quality: 90 }).toBuffer() : await prepareSprite(cut, { targetHeight: height })
    out = doPixel ? await finishPixelWebp(sprite) : sprite
  } else {
    throw new Error(`cannot finish ${entry.kind} assets`)
  }
  return { bytes: out, ext: 'webp', ...(native ? { native } : {}), warnings }
}

/**
 * Generates one asset and records the new version (selected) on the returned entry. Never throws for a failed asset:
 * it returns `{ ok: false, error }` with the entry unchanged. Locked and custom assets are skipped unless `force`.
 * The manifest is not saved here (see `generateAll`).
 */
export async function generateAsset(ctx: GenerateContext, entry: AssetEntry, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const progress = (stage: GenerateProgress['stage'], message: string) => ctx.onProgress?.({ id: entry.id, stage, message })
  if (!opts.force && (entry.locked || entry.source === 'custom')) {
    return { ok: true, skipped: true, entry, reason: entry.locked ? 'locked' : 'custom file' }
  }
  if (entry.kind === 'voiceRef') {
    return { ok: true, skipped: true, entry, reason: 'voice references are uploaded, not generated' }
  }
  // The entry the edits were applied to; returned on success, and the base for the new version.
  const edited: AssetEntry = {
    ...entry,
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.negative !== undefined ? { negative: opts.negative } : {}),
    ...(opts.engine !== undefined ? { engine: opts.engine } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {})
  }
  // Music follows the project's provider: an unlocked generated track is made by Chiptune Studio or by the configured ComfyUI engine,
  // whatever made its earlier versions. An engine given for this one run, a locked track and a custom file keep theirs.
  if (edited.kind === 'music' && opts.engine === undefined && !edited.locked && edited.source === 'generated') {
    edited.engine = resolveMusicProvider(ctx.settings) === 'chiptune' ? CHIPTUNE_ENGINE : edited.engine === CHIPTUNE_ENGINE ? ctx.settings.music.engine : edited.engine
  }
  try {
    progress('start', `${entry.kind} with ${edited.engine}`)
    const pixel = ctx.settings.art.style === 'pixel'
    const prompt = edited.prompt.trim() || fallbackPrompt(edited, ctx.book, { pixel, stylePrompt: ctx.settings.art.stylePrompt })
    const negative = edited.negative ?? fallbackNegative(edited.kind)
    const seed = edited.seed ?? randomSeed()
    const sizes = ctx.sizes ?? {}
    const onProgress = (p: ComfyProgress) => progress('comfy', `${p.stage}: ${p.message}`)
    const base = { engine: edited.engine, prompt, negative, seed, onProgress, signal: ctx.signal }
    const display = edited.kind === 'cg' ? (imageOfAsset(ctx.book, edited.id)?.display ?? 'full') : undefined
    const size = edited.size ?? (edited.kind === 'cg' && display === 'insert' ? SQUARE : edited.kind === 'background' || edited.kind === 'cg' || edited.kind === 'cover' ? LANDSCAPE : PORTRAIT)

    let palette: Rgb[] | undefined
    if (pixel && ctx.settings.art.palette) {
      if (!ctx.palettesDir) throw new Error('pixel mode with a palette needs palettesDir')
      palette = await loadPalette(ctx.palettesDir, ctx.settings.art.palette)
    }
    const warnings: string[] = []
    const warn = (m: string) => {
      warnings.push(m)
      progress('post', `warning: ${m}`)
    }
    /** The pixel art at its native size (a PNG), when Pixel Studio made it: kept for "Open in Pixel Studio". */
    let native: Buffer | undefined
    const finishOpts = { seed, palette, onProgress, progress, size, display }

    let out: { bytes: Buffer; ext: string }
    let rawOut: { bytes: Buffer; ext: string } | undefined
    let chiptune: Awaited<ReturnType<typeof makeChiptuneTrack>> | undefined
    switch (edited.kind) {
      case 'background': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        const fin = await finishImage(ctx, edited, r.bytes, finishOpts)
        warnings.push(...fin.warnings)
        native = fin.native
        out = { bytes: fin.bytes, ext: fin.ext }
        break
      }
      case 'sheet': {
        // The sheet is the identity reference for the sprites: kept as generated.
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        out = { bytes: r.bytes, ext: r.ext }
        break
      }
      case 'sprite': {
        const sheetId = edited.refs?.[0]
        const sheetFile = sheetId ? (ctx.resolveRef?.(sheetId) ?? null) : null
        if (!sheetId || !sheetFile) throw new Error(`character sheet ${sheetId ?? '(none)'} has no file yet: generate it first`)
        let raw: { bytes: Buffer; ext: string }
        if (opts.reprocess) {
          const found = await findRaw(ctx.projectDir, edited)
          if (!found) throw new Error(`${edited.id} has no raw edit output to reprocess: generate it first`)
          raw = found
        } else {
          const r = await ctx.comfy.generate({ ...base, references: [sheetFile], width: size.w, height: size.h })
          raw = { bytes: r.bytes, ext: r.ext }
        }
        rawOut = raw
        const fin = await finishImage(ctx, edited, raw.bytes, finishOpts)
        warnings.push(...fin.warnings)
        native = fin.native
        out = { bytes: fin.bytes, ext: fin.ext }
        break
      }
      case 'cover': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        const fin = await finishImage(ctx, edited, r.bytes, finishOpts)
        warnings.push(...fin.warnings)
        native = fin.native
        out = { bytes: fin.bytes, ext: fin.ext }
        break
      }
      case 'cg': {
        // a picture with characters is edited from their sheets (as many as have a file); one without is generated
        const refFiles = (edited.refs ?? []).flatMap((id) => ctx.resolveRef?.(id) ?? [])
        if ((edited.refs?.length ?? 0) > 0 && refFiles.length === 0) throw new Error(`the character sheets of ${edited.id} (${edited.refs!.join(', ')}) have no file yet: generate them first`)
        const r = await ctx.comfy.generate({ ...base, ...(refFiles.length ? { references: refFiles } : {}), width: size.w, height: size.h })
        const fin = await finishImage(ctx, edited, r.bytes, finishOpts)
        warnings.push(...fin.warnings)
        native = fin.native
        out = { bytes: fin.bytes, ext: fin.ext }
        break
      }
      case 'ambience': {
        const r: ComfyResult = await ctx.comfy.generate({ engine: edited.engine, prompt, seed, seconds: sizes.ambienceSeconds ?? 60, format: sizes.musicFormat, onProgress, signal: ctx.signal })
        out = { bytes: r.bytes, ext: r.ext }
        break
      }
      case 'sfx': {
        // there is no sound-effect engine by default: a custom ComfyUI workflow (sound.sfxEngine) makes it, else the file is imported
        if (!edited.engine.startsWith('custom:')) return { ok: true, skipped: true, entry, reason: 'no SFX engine: import a file (vno_asset_import)' }
        const r: ComfyResult = await ctx.comfy.generate({ engine: edited.engine, prompt, seed, seconds: sizes.sfxSeconds ?? 5, format: sizes.musicFormat, onProgress, signal: ctx.signal })
        out = { bytes: r.bytes, ext: r.ext }
        break
      }
      case 'music': {
        if (edited.engine === CHIPTUNE_ENGINE) {
          if (!ctx.chiptune) throw new Error('Chiptune Studio is not configured')
          progress('comfy', 'compose with Chiptune Studio')
          const plan = ctx.chipPlan ?? fallbackChipPlan(edited.id, { genreText: `${ctx.book.genre ?? ''} ${ctx.book.format} ${ctx.book.style}`, chip: ctx.settings.music.chip, palette: ctx.settings.art.palette, seconds: sizes.musicSeconds })
          chiptune = await makeChiptuneTrack(ctx.chiptune, { dir: assetDir(ctx.projectDir, edited.id), n: nextVersionN(edited), plan, seed: edited.seed ?? undefined, name: `${ctx.book.title} ${edited.id}`, signal: ctx.signal })
          for (const w of chiptune.warnings) warn(w)
          out = { bytes: Buffer.alloc(0), ext: path.extname(chiptune.file).slice(1) }
          break
        }
        const r: ComfyResult = await ctx.comfy.generate({
          engine: edited.engine,
          prompt,
          seed,
          seconds: sizes.musicSeconds ?? 100,
          format: sizes.musicFormat,
          onProgress,
          signal: ctx.signal
        })
        out = { bytes: r.bytes, ext: r.ext }
        break
      }
      default:
        throw new Error(`cannot generate ${edited.kind} assets`)
    }

    const n = nextVersionN(edited)
    const file = chiptune ? chiptune.file : `v${n}.${out.ext}`
    // Chiptune Studio writes its own files (in the asset folder); the others are written here.
    if (!chiptune) await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), file), out.bytes)
    // The raw edit output stays next to the version so background removal can be redone without regenerating.
    if (rawOut) await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), `v${n}.raw.${rawOut.ext}`), rawOut.bytes)
    // The pixel art at its native size: what "Open in Pixel Studio" edits.
    let nativeFile: string | undefined
    if (native) {
      nativeFile = `v${n}.px.png`
      await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), nativeFile), native)
    }
    const version: AssetVersion = {
      n,
      file,
      createdAt: (ctx.now?.() ?? new Date()).toISOString(),
      seed: chiptune ? chiptune.seed : seed,
      engine: edited.engine,
      prompt,
      ...(chiptune ? { loopStartSec: chiptune.loopStartSec, loopEndSec: chiptune.loopEndSec, ...(chiptune.songFile ? { songFile: chiptune.songFile } : {}) } : {}),
      ...(nativeFile ? { nativeFile } : {}),
      ...(warnings.length ? { warnings } : {})
    }
    const updated = addVersion({ ...edited, seed: edited.seed }, version)
    progress('done', file)
    return { ok: true, skipped: false, entry: updated, version, ...(warnings.length ? { warnings } : {}) }
  } catch (e) {
    return { ok: false, entry, error: (e as Error).message }
  }
}

/** Generation order: sheets before the sprites that reference them. */
const KIND_ORDER: Record<string, number> = { sheet: 0, background: 1, cover: 2, sprite: 3, cg: 4, music: 5, ambience: 6, sfx: 7, voiceRef: 8 }

export interface GenerateAllOptions {
  /** Only these ids; default all entries. */
  ids?: string[]
  /** Regenerate assets that already have a selected version (and locked/custom ones). Default false: resumable. */
  force?: boolean
  /** Skip these (for example orphaned) ids. */
  exclude?: Iterable<string>
}

export interface GenerateAllResult {
  manifest: AssetManifest
  generated: string[]
  skipped: string[]
  failed: Array<{ id: string; error: string }>
}

/**
 * Generates every asset that has no usable file yet, saving `assets.json` after each one so a stopped run resumes where
 * it left off. A failed asset is reported and the run continues.
 */
export async function generateAll(ctx: Omit<GenerateContext, 'resolveRef'>, manifest: AssetManifest, opts: GenerateAllOptions = {}): Promise<GenerateAllResult> {
  let current = manifest
  const excluded = new Set(opts.exclude ?? [])
  const wanted = opts.ids ? new Set(opts.ids) : null
  const todo = current.assets
    .filter((e) => !excluded.has(e.id) && (!wanted || wanted.has(e.id)))
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
  const result: GenerateAllResult = { manifest: current, generated: [], skipped: [], failed: [] }
  const resolveRef = (id: string) => {
    const e = getEntry(current, id)
    return e ? resolveFile(ctx.projectDir, e) : null
  }
  for (const entry of todo) {
    if (ctx.signal?.aborted) break
    const live = getEntry(current, entry.id) ?? entry
    if (!opts.force && resolveFile(ctx.projectDir, live)) {
      result.skipped.push(live.id)
      continue
    }
    const r = await generateAsset({ ...ctx, resolveRef }, live, { force: opts.force && !live.locked ? true : false })
    if (!r.ok) {
      result.failed.push({ id: live.id, error: r.error })
    } else if (r.skipped) {
      result.skipped.push(live.id)
    } else {
      current = replaceEntry(current, r.entry)
      await saveManifest(ctx.projectDir, current)
      result.generated.push(live.id)
    }
  }
  result.manifest = current
  return result
}
