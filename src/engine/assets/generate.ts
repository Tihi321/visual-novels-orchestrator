import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { CHIPTUNE_ENGINE, resolveArtProvider, resolveMusicProvider, resolvePixel, resolvePixelProvider } from '../../shared/vn'
import type { AssetEntry, AssetManifest, AssetVersion, ProjectSettings, VnBook } from '../../shared/vn'
import type { ComfyClient, ComfyProgress, ComfyResult } from '../comfy/client'
import { randomSeed } from '../comfy/graphs'
import { renameRetry } from '../store/atomic'
import { fallbackNegative, fallbackPrompt, LANDSCAPE, PORTRAIT } from './derive'
import { addVersion, assetDir, getEntry, nextVersionN, replaceEntry, resolveFile, saveManifest } from './manifest'
import { loadPalette, type Rgb } from './palettes'
import { fitBackground, keepMainSubject, keyOutFlatBackground, pixelate, prepareSprite, toWebp } from './postprocess'
import { drawSpriteWithStudio } from '../studios/draw'
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
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.channels < 4) return false
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 250) clear++
  return clear / (data.length / 4) > 0.01
}

export interface GenerateSizes {
  /** Final background size. Default 1920x1080. */
  background?: { w: number; h: number }
  /** Final cover size. Default 1080x1920. */
  cover?: { w: number; h: number }
  /** Sprite height after trimming. Default 972 (90% of 1080). */
  spriteHeight?: number
  /** Pixel mode: downscale factor. Default 4. */
  pixelScale?: number
  musicSeconds?: number
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
  /** Limits of the drawing loop. */
  draw?: { steps: number; ms: number }
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
    const size = edited.size ?? (edited.kind === 'background' ? LANDSCAPE : PORTRAIT)

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
    const px = resolvePixel(ctx.settings.art)
    const bgSize = sizes.background ?? { w: 1920, h: 1080 }
    // the built-in pixelate keeps its legacy scale (4) unless the project sets a pixel grid
    const scale = sizes.pixelScale ?? (ctx.settings.art.pixel?.width !== undefined ? bgSize.w / px.width : 4)
    // every pixel of the art is a whole number of screen pixels: the final image is the grid times this factor (6 for 320x180 on 1920x1080)
    const factor = Math.max(1, Math.round(bgSize.w / px.width))
    const studioPixels = pixel && resolvePixelProvider(ctx.settings.art) === 'pixel-studio'
    const drawing = pixel && edited.kind === 'sprite' && resolveArtProvider(ctx.settings.art) === 'pixel-studio-draw'
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
      const grid = edited.kind === 'background' ? { w: px.width, h: px.height } : { w: Math.max(8, Math.round(raw.w / factor)), h: Math.max(8, Math.round(raw.h / factor)) }
      const out = { w: grid.w * factor, h: grid.h * factor }
      if (drawing && ctx.ask && ctx.pixel) {
        const dir = path.join(tmpRoot, `ref-${edited.id}`)
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
          const d = await drawSpriteWithStudio({
            client: ctx.pixel,
            ask: ctx.ask,
            reference,
            grid: drawGrid,
            palette: pal,
            expression: edited.id.split('_').pop(),
            name: edited.id,
            out: drawOut,
            tmpRoot,
            maxSteps: ctx.draw?.steps ?? 12,
            maxMs: ctx.draw?.ms ?? 240_000,
            signal: ctx.signal,
            log: (m) => progress('post', m)
          })
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
            const r = await pixelateWithStudio(ctx.pixel, png, { tmpRoot, grid, out, palette, dither: px.dither, outline: px.outline, name: edited.id, signal: ctx.signal })
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

    let out: { bytes: Buffer; ext: string }
    let rawOut: { bytes: Buffer; ext: string } | undefined
    let chiptune: Awaited<ReturnType<typeof makeChiptuneTrack>> | undefined
    switch (edited.kind) {
      case 'background': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        progress('post', 'fit background')
        const t = sizes.background ?? { w: 1920, h: 1080 }
        const fitted = await fitBackground(r.bytes, t.w, t.h, { lossless: pixel })
        out = { bytes: pixel ? await finishPixelWebp(fitted) : fitted, ext: 'webp' }
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
        progress('post', 'remove background')
        let cut = await removeBackground(ctx, raw.bytes, ctx.settings.art.bgRemoval ?? 'birefnet', { seed, size, onProgress }, warn)
        cut = await keepMainSubject(cut) // one figure: stray islands and a second figure are dropped before the trim
        const sprite = await prepareSprite(cut, { targetHeight: sizes.spriteHeight ?? 972 })
        out = { bytes: pixel ? await finishPixelWebp(sprite) : sprite, ext: 'webp' }
        break
      }
      case 'cover': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        progress('post', 'fit cover')
        const t = sizes.cover ?? { w: 1080, h: 1920 }
        const fitted = await fitBackground(r.bytes, t.w, t.h, { lossless: pixel })
        out = { bytes: pixel ? await finishPixelWebp(fitted) : fitted, ext: 'webp' }
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
const KIND_ORDER: Record<string, number> = { sheet: 0, background: 1, cover: 2, sprite: 3, music: 4, voiceRef: 5 }

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
