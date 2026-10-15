import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { AssetEntry, AssetManifest, AssetVersion, ProjectSettings, VnBook } from '../../shared/vn'
import type { ComfyClient, ComfyProgress, ComfyResult } from '../comfy/client'
import { randomSeed } from '../comfy/graphs'
import { renameRetry } from '../store/atomic'
import { fallbackNegative, fallbackPrompt, LANDSCAPE, PORTRAIT } from './derive'
import { addVersion, assetDir, getEntry, nextVersionN, replaceEntry, resolveFile, saveManifest } from './manifest'
import { loadPalette, type Rgb } from './palettes'
import { fitBackground, keepMainSubject, keyOutFlatBackground, pixelate, prepareSprite, toWebp } from './postprocess'

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
    const scale = sizes.pixelScale ?? 4
    const finishPixel = async (png: Buffer) => toWebp(await pixelate(png, { scale, palette }), { lossless: true })

    let out: { bytes: Buffer; ext: string }
    let rawOut: { bytes: Buffer; ext: string } | undefined
    const warnings: string[] = []
    const warn = (m: string) => {
      warnings.push(m)
      progress('post', `warning: ${m}`)
    }
    switch (edited.kind) {
      case 'background': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        progress('post', 'fit background')
        const t = sizes.background ?? { w: 1920, h: 1080 }
        const fitted = await fitBackground(r.bytes, t.w, t.h, { lossless: pixel })
        out = { bytes: pixel ? await finishPixel(fitted) : fitted, ext: 'webp' }
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
        out = { bytes: pixel ? await finishPixel(sprite) : sprite, ext: 'webp' }
        break
      }
      case 'cover': {
        const r = await ctx.comfy.generate({ ...base, width: size.w, height: size.h })
        progress('post', 'fit cover')
        const t = sizes.cover ?? { w: 1080, h: 1920 }
        const fitted = await fitBackground(r.bytes, t.w, t.h, { lossless: pixel })
        out = { bytes: pixel ? await finishPixel(fitted) : fitted, ext: 'webp' }
        break
      }
      case 'music': {
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
    const file = `v${n}.${out.ext}`
    await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), file), out.bytes)
    // The raw edit output stays next to the version so background removal can be redone without regenerating.
    if (rawOut) await writeFileAtomic(path.join(assetDir(ctx.projectDir, edited.id), `v${n}.raw.${rawOut.ext}`), rawOut.bytes)
    const version: AssetVersion = { n, file, createdAt: (ctx.now?.() ?? new Date()).toISOString(), seed, engine: edited.engine, prompt }
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
