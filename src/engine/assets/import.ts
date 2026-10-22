import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { IMAGE_KINDS, isHandArt } from '../../shared/vn'
import type { AssetEntry, AssetVersion } from '../../shared/vn'
import { finishImage } from './generate'
import type { FinishContext } from './generate'
import { addVersion, assetDir, lock, nextVersionN } from './manifest'
import { loadPalette } from './palettes'
import type { Rgb } from './palettes'
import { transparentShare } from './postprocess'

/**
 * Importing a file you made yourself (or got from somewhere) as an asset, with the post-processing a generated image gets: a sprite on a plain
 * background is cut out, trimmed and scaled to the sprite height, a background is fitted to the screen, a pixel project gets pixel art.
 * The result is a locked version (`custom:import`), and the original file is kept next to it.
 */

export const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.opus', '.flac']
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff']

/** A sprite whose image has at least this share of pixels that are clearly transparent already has a cut-out background. */
export const TRANSPARENT_SHARE = 0.02

export interface ImportOptions {
  /** `none`: keep the file as it is (the same pixels as vno_asset_replace). `auto` (default): post-process by kind. */
  process?: 'auto' | 'none'
  /**
   * Sprites: how the background is cut out. `auto` (default): an image that is transparent already is left alone; in hand-made art
   * mode the flat-colour key (ComfyUI is never called for an image there); else the project's background removal.
   */
  removeBackground?: 'auto' | 'birefnet' | 'key' | 'none'
  /** Sprites: trim to the figure and scale to the sprite height (default true). */
  trim?: boolean
  /** Pixel projects: make pixel art of it (default true). */
  pixelate?: boolean
}

export interface ImportedAsset {
  entry: AssetEntry
  version: AssetVersion
}

/** The share of pixels of an image file that are transparent (alpha under 250), 0 to 1. */
export async function transparentShareOf(file: string): Promise<number> {
  return transparentShare(await fs.readFile(file))
}

/**
 * Imports `file` into `entry` as a new locked version. Images are post-processed per kind (see `finishImage`); music (and other audio) is copied as
 * it is. `ctx` has the project, its settings and the palette folder; no model and no ComfyUI job are needed unless a background is cut with BiRefNet.
 */
export async function importAssetFile(ctx: FinishContext, entry: AssetEntry, file: string, opts: ImportOptions = {}): Promise<ImportedAsset> {
  const ext = path.extname(file).toLowerCase()
  const dir = assetDir(ctx.projectDir, entry.id)
  const n = nextVersionN(entry)
  const warnings: string[] = []
  const base = path.basename(file)
  await fs.mkdir(dir, { recursive: true })

  let written: string
  let native: string | undefined
  if (entry.kind === 'voiceRef') throw new Error('voice references are uploaded (setVoiceRef), not imported here')
  if (!IMAGE_KINDS.has(entry.kind)) {
    if (!AUDIO_EXTENSIONS.includes(ext)) throw new Error(`${entry.id} is audio: use a ${AUDIO_EXTENSIONS.join(', ')} file (got ${ext || 'no extension'})`)
    written = `v${n}${ext}`
    await fs.copyFile(file, path.join(dir, written))
  } else {
    if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error(`${entry.id} is an image: use a ${IMAGE_EXTENSIONS.join(', ')} file (got ${ext || 'no extension'})`)
    const bytes = await fs.readFile(file)
    await sharp(bytes).metadata() // a file that is not an image fails here, with sharp's own message
    await fs.copyFile(file, path.join(dir, `import-${n}${ext}`)) // the original stays
    if (opts.process === 'none') {
      written = `v${n}${ext}`
      await fs.copyFile(file, path.join(dir, written))
    } else {
      let palette: Rgb[] | undefined
      if (ctx.settings.art.style === 'pixel' && ctx.settings.art.palette && ctx.palettesDir) palette = await loadPalette(ctx.palettesDir, ctx.settings.art.palette)
      let removeBackground: 'birefnet' | 'qwen-edit' | 'key' | 'none' | undefined
      if (entry.kind === 'sprite') {
        const method = opts.removeBackground ?? 'auto'
        if (method !== 'auto') removeBackground = method
        else if ((await transparentShare(bytes)) > TRANSPARENT_SHARE) removeBackground = 'none'
        else removeBackground = isHandArt(ctx.settings.art) ? 'key' : undefined // undefined: the project's own setting
      }
      const fin = await finishImage(ctx, entry, bytes, { palette, removeBackground, trim: opts.trim, pixelate: opts.pixelate, draw: false, ext })
      warnings.push(...fin.warnings)
      written = `v${n}.${fin.ext}`
      await fs.writeFile(path.join(dir, written), fin.bytes)
      if (fin.native) {
        native = `v${n}.px.png`
        await fs.writeFile(path.join(dir, native), fin.native)
      }
    }
  }
  const version: AssetVersion = {
    n,
    file: written,
    createdAt: new Date().toISOString(),
    seed: null,
    engine: 'custom:import',
    prompt: `imported from ${base}`,
    custom: true,
    ...(native ? { nativeFile: native } : {}),
    ...(warnings.length ? { warnings } : {})
  }
  return { entry: lock(addVersion(entry, version)), version }
}
