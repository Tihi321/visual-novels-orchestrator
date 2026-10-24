import fs from 'node:fs'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { VnBook } from '../../shared/vn'

/**
 * Images for the web game engine: resolutions, formatting, placeholder generation,
 * sprite & background processing, and cover generation.
 */

export const RESOLUTIONS = {
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '4k': { w: 3840, h: 2160 }
} as const

export type ResolutionKey = keyof typeof RESOLUTIONS

export interface Resolution {
  w: number
  h: number
}

export const IMAGE_FORMATS = ['webp', 'png'] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]

export const SPRITE_HEIGHT_RATIO = 0.85
export const INSERT_WIDTH_RATIO = 0.5
export const INSERT_HEIGHT_RATIO = 0.7

export interface UsedImages {
  /** Background asset ids (`bg_<place>_<time|any>`). */
  backgrounds: string[]
  sprites: { charKey: string; expression: string }[]
  /** The CGs and inserts the script shows (keys of the book's `images`). */
  cgs?: { key: string; display: 'full' | 'insert' }[]
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, '_')

/** `bg_harbour_wall_dusk` -> `bg harbour_wall_dusk`. */
export function bgImageName(backgroundId: string): string {
  const rest = backgroundId.replace(/^bg_/, '')
  return `bg ${safe(rest)}`
}

/** `ledger_page` -> `cg ledger_page`. */
export function cgImageName(key: string): string {
  return `cg ${safe(key)}`
}

/** `mara`, `worried` -> `mara worried`. */
export function spriteImageName(charKey: string, expression: string): string {
  return `${safe(charKey)} ${safe(expression)}`
}

/** The file the image lives in, relative to project/game folder. */
export function imageFile(imageName: string, format: ImageFormat): string {
  return `images/${imageName}.${format}`
}

const COLORS = ['#3b5b8a', '#8a3b5b', '#3b8a6a', '#8a6a3b', '#6a3b8a', '#3b7f8a', '#8a523b', '#5b8a3b']

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const pickColor = (key: string): string => COLORS[hashString(key) % COLORS.length]!

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A solid-colour background with the place and time written on it. */
export async function placeholderBackground(label: string, res: Resolution, format: ImageFormat = 'webp', lossless = false): Promise<Buffer> {
  const color = pickColor(label)
  const fontSize = Math.round(res.h / 14)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res.w}" height="${res.h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#101018"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" fill="#ffffffcc">${xml(label)}</text>
  <text x="50%" y="${Math.round(res.h * 0.58)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(fontSize / 2.4)}" fill="#ffffff80">placeholder</text>
</svg>`
  return encode(sharp(Buffer.from(svg)), format, lossless)
}

/** A coloured silhouette with the name and expression written on it. Transparent around it. */
export async function placeholderSprite(name: string, expression: string, res: Resolution, format: ImageFormat = 'webp', lossless = false): Promise<Buffer> {
  const h = Math.round(res.h * SPRITE_HEIGHT_RATIO)
  const w = Math.round(h * 0.45)
  const color = pickColor(name)
  const fs = Math.round(w / 8)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <circle cx="${w / 2}" cy="${h * 0.14}" r="${w * 0.2}" fill="${color}" stroke="#ffffffaa" stroke-width="4"/>
  <rect x="${w * 0.1}" y="${h * 0.3}" width="${w * 0.8}" height="${h * 0.7}" rx="${w * 0.18}" fill="${color}" stroke="#ffffffaa" stroke-width="4"/>
  <text x="50%" y="${h * 0.6}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs}" fill="#ffffff">${xml(name)}</text>
  <text x="50%" y="${h * 0.6 + fs * 1.4}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(fs * 0.8)}" fill="#ffffffcc">${xml(expression)}</text>
</svg>`
  return encode(sharp(Buffer.from(svg)), format, lossless)
}

/** The main menu background used when the book has no cover yet. */
export async function placeholderCover(title: string, res: Resolution): Promise<Buffer> {
  return placeholderBackground(title, res, 'png')
}

/** Write placeholder PNG directly to disk. */
export async function writePlaceholderPng(destPath: string, label: string, res: Resolution): Promise<void> {
  const buf = await placeholderBackground(label, res, 'png')
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
}

/** Write cover PNG directly to disk. */
export async function writeCoverPng(destPath: string, title: string, res: Resolution): Promise<void> {
  const buf = await placeholderCover(title, res)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
}

/**
 * The main menu picture from the cover. A cover about as wide as the screen fills it (cut to fit).
 * A narrower one is centered with blurred background fill.
 */
export async function menuImage(file: string, res: Resolution, pixel = false): Promise<Buffer> {
  const kernel = pixel ? ('nearest' as const) : undefined
  const meta = await sharp(file).metadata()
  const ratio = (meta.width ?? 1) / (meta.height ?? 1) / (res.w / res.h)
  if (ratio >= 0.85) return sharp(file).resize(res.w, res.h, { fit: 'cover', ...(kernel ? { kernel } : {}) }).png().toBuffer()
  let fill: Buffer
  if (pixel) {
    const mean = (await sharp(file).removeAlpha().stats()).channels.map((c) => Math.round(c.mean))
    fill = await sharp({ create: { width: res.w, height: res.h, channels: 3, background: { r: mean[0] ?? 0, g: mean[1] ?? 0, b: mean[2] ?? 0 } } }).png().toBuffer()
  } else {
    fill = await sharp(file).resize(res.w, res.h, { fit: 'cover' }).blur(40).modulate({ brightness: 0.55 }).removeAlpha().png().toBuffer()
  }
  const front = await sharp(file).resize({ height: res.h, width: res.w, fit: 'inside', ...(kernel ? { kernel } : {}) }).png().toBuffer()
  const fw = (await sharp(front).metadata()).width ?? res.w
  const left = Math.max(0, Math.min(res.w - fw, Math.round(res.w * 0.62 - fw / 2)))
  return sharp(fill).composite([{ input: front, left, top: 0 }]).png().toBuffer()
}

/** Encode Sharp image to target format. */
function encode(img: Sharp, format: ImageFormat, lossless = false): Promise<Buffer> {
  return format === 'png' ? img.png().toBuffer() : img.webp(lossless ? { lossless: true } : { quality: 88 }).toBuffer()
}

/** Process an arbitrary image asset using Sharp and write to destPath. */
export async function processImage(
  srcPath: string,
  destPath: string,
  opts: {
    fit?: 'cover' | 'contain' | 'inside'
    width?: number
    height?: number
    format?: ImageFormat
    pixel?: boolean
    lossless?: boolean
  } = {}
): Promise<Buffer> {
  const kernel = opts.pixel ? ('nearest' as const) : undefined
  let s = sharp(srcPath)
  if (opts.width || opts.height) {
    s = s.resize(opts.width, opts.height, {
      fit: opts.fit ?? 'cover',
      withoutEnlargement: opts.fit === 'inside',
      ...(kernel ? { kernel } : {})
    })
  }
  const format = opts.format ?? (destPath.endsWith('.png') ? 'png' : 'webp')
  const buf = await encode(s, format, opts.lossless || opts.pixel)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
  return buf
}

/** Search for an asset across given directories. */
export function resolveAssetPath(assetId: string, searchDirs: string[]): string | null {
  const extensions = ['.png', '.webp', '.jpg', '.jpeg', '.svg']
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const p = path.join(dir, `${assetId}${ext}`)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

export interface BuildImagesInput {
  gameSubdir: string
  book: VnBook
  used: UsedImages
  resolveAsset: (id: string) => string | null
  resolution: Resolution
  format: ImageFormat
  warnings: string[]
  pixel?: boolean
}

export interface BuildImagesResult {
  written: string[]
  placeholders: string[]
}

/** Copy the selected assets into images/ (and gui/main_menu.png), creating placeholders for missing ones. */
export async function buildImages(inp: BuildImagesInput): Promise<BuildImagesResult> {
  const { gameSubdir, book, used, resolveAsset, resolution, format } = inp
  const kernel = inp.pixel ? ('nearest' as const) : undefined
  const written: string[] = []
  const placeholders: string[] = []
  fs.mkdirSync(path.join(gameSubdir, 'images'), { recursive: true })

  // 1. Backgrounds
  for (const id of used.backgrounds) {
    const name = bgImageName(id)
    const rel = imageFile(name, format)
    const src = resolveAsset(id)
    let buf: Buffer
    if (src && fs.existsSync(src)) {
      buf = await encode(sharp(src).resize(resolution.w, resolution.h, { fit: 'cover', ...(kernel ? { kernel } : {}) }), format, !!inp.pixel)
    } else {
      const place = id.replace(/^bg_/, '').replace(/_/g, ' ')
      buf = await placeholderBackground(place, resolution, format, !!inp.pixel)
      placeholders.push(id)
    }
    fs.writeFileSync(path.join(gameSubdir, rel), buf)
    written.push(rel)
  }

  // 2. CGs and inserts
  for (const g of used.cgs ?? []) {
    const id = `cg_${g.key}`
    const rel = imageFile(cgImageName(g.key), format)
    const src = resolveAsset(id)
    let buf: Buffer
    if (src && fs.existsSync(src)) {
      buf =
        g.display === 'insert'
          ? await encode(sharp(src).ensureAlpha().resize({ height: Math.round(resolution.h * INSERT_HEIGHT_RATIO), width: resolution.w, fit: 'inside', withoutEnlargement: true, ...(kernel ? { kernel } : {}) }), format, !!inp.pixel)
          : await encode(sharp(src).resize(resolution.w, resolution.h, { fit: 'cover', ...(kernel ? { kernel } : {}) }), format, !!inp.pixel)
    } else {
      const size = g.display === 'insert' ? { w: Math.round(resolution.h * INSERT_WIDTH_RATIO), h: Math.round(resolution.h * INSERT_WIDTH_RATIO) } : resolution
      buf = await placeholderBackground(g.key.replace(/_/g, ' '), size, format, !!inp.pixel)
      placeholders.push(id)
    }
    fs.writeFileSync(path.join(gameSubdir, rel), buf)
    written.push(rel)
  }

  // 3. Sprites
  const names = new Map(book.characters.map((c) => [c.key, c.name]))
  for (const s of used.sprites) {
    const id = `sprite_${s.charKey}_${s.expression}`
    const rel = imageFile(spriteImageName(s.charKey, s.expression), format)
    const src = resolveAsset(id)
    let buf: Buffer
    if (src && fs.existsSync(src)) {
      buf = await encode(sharp(src).ensureAlpha(), format, !!inp.pixel)
    } else {
      buf = await placeholderSprite(names.get(s.charKey) ?? s.charKey, s.expression, resolution, format, !!inp.pixel)
      placeholders.push(id)
    }
    fs.writeFileSync(path.join(gameSubdir, rel), buf)
    written.push(rel)
  }

  // 4. Main Menu / Cover
  const coverSrc = resolveAsset('cover')
  let cover: Buffer
  if (coverSrc && fs.existsSync(coverSrc)) {
    cover = await menuImage(coverSrc, resolution, !!inp.pixel)
  } else {
    cover = await placeholderCover(book.title, resolution)
    placeholders.push('cover')
  }
  fs.mkdirSync(path.join(gameSubdir, 'gui'), { recursive: true })
  fs.writeFileSync(path.join(gameSubdir, 'gui', 'main_menu.png'), cover)
  written.push('gui/main_menu.png')

  if (placeholders.length) inp.warnings.push(`${placeholders.length} asset(s) have no file yet and use a placeholder: ${placeholders.join(', ')}`)
  return { written, placeholders }
}
