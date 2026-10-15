import fs from 'node:fs'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { VnBook } from '../../shared/vn'

/**
 * Images for the game: the naming (Ren'Py auto-image names), the placeholders used when an asset has no file yet,
 * and the copy into `game/images`. Backgrounds are cover-cropped to the game resolution; sprites keep their alpha.
 */

export type ImageFormat = 'webp' | 'png'

export interface Resolution {
  w: number
  h: number
}

export interface UsedImages {
  /** Background asset ids (`bg_<place>_<time|any>`). */
  backgrounds: string[]
  sprites: { charKey: string; expression: string }[]
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, '_')

/** `bg_harbour_wall_dusk` -> `bg harbour_wall_dusk` (the Ren'Py image name). */
export function bgImageName(backgroundId: string): string {
  const rest = backgroundId.replace(/^bg_/, '')
  return `bg ${safe(rest)}`
}

/** `mara`, `worried` -> `mara worried`. */
export function spriteImageName(charKey: string, expression: string): string {
  return `${safe(charKey)} ${safe(expression)}`
}

/** The file the image lives in, relative to `game/`. */
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
export async function placeholderBackground(label: string, res: Resolution, format: ImageFormat = 'webp'): Promise<Buffer> {
  const color = pickColor(label)
  const fontSize = Math.round(res.h / 14)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${res.w}" height="${res.h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#101018"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" fill="#ffffffcc">${xml(label)}</text>
  <text x="50%" y="${Math.round(res.h * 0.58)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(fontSize / 2.4)}" fill="#ffffff80">placeholder</text>
</svg>`
  return encode(sharp(Buffer.from(svg)), format)
}

/** A coloured silhouette with the name and expression written on it. Transparent around it. */
export async function placeholderSprite(name: string, expression: string, res: Resolution, format: ImageFormat = 'webp'): Promise<Buffer> {
  const h = Math.round(res.h * 0.9)
  const w = Math.round(h * 0.45)
  const color = pickColor(name)
  const fs = Math.round(w / 8)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <circle cx="${w / 2}" cy="${h * 0.14}" r="${w * 0.2}" fill="${color}" stroke="#ffffffaa" stroke-width="4"/>
  <rect x="${w * 0.1}" y="${h * 0.3}" width="${w * 0.8}" height="${h * 0.7}" rx="${w * 0.18}" fill="${color}" stroke="#ffffffaa" stroke-width="4"/>
  <text x="50%" y="${h * 0.6}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs}" fill="#ffffff">${xml(name)}</text>
  <text x="50%" y="${h * 0.6 + fs * 1.4}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(fs * 0.8)}" fill="#ffffffcc">${xml(expression)}</text>
</svg>`
  return encode(sharp(Buffer.from(svg)), format)
}

/** The main menu background used when the book has no cover yet. */
export async function placeholderCover(title: string, res: Resolution): Promise<Buffer> {
  return placeholderBackground(title, res, 'png')
}

function encode(img: Sharp, format: ImageFormat): Promise<Buffer> {
  return format === 'png' ? img.png().toBuffer() : img.webp({ quality: 88 }).toBuffer()
}

export interface BuildImagesInput {
  /** The `game/` folder of the Ren'Py project. */
  gameSubdir: string
  book: VnBook
  used: UsedImages
  resolveAsset: (id: string) => string | null
  resolution: Resolution
  format: ImageFormat
  warnings: string[]
}

export interface BuildImagesResult {
  /** Image files written, relative to `game/`. */
  written: string[]
  /** Asset ids that had no file and got a placeholder. */
  placeholders: string[]
}

/** Copy the selected assets into `game/images` (and `gui/main_menu.png`), making placeholders for missing ones. */
export async function buildImages(inp: BuildImagesInput): Promise<BuildImagesResult> {
  const { gameSubdir, book, used, resolveAsset, resolution, format } = inp
  const written: string[] = []
  const placeholders: string[] = []
  fs.mkdirSync(path.join(gameSubdir, 'images'), { recursive: true })

  for (const id of used.backgrounds) {
    const name = bgImageName(id)
    const rel = imageFile(name, format)
    const src = resolveAsset(id)
    let buf: Buffer
    if (src && fs.existsSync(src)) {
      buf = await encode(sharp(src).resize(resolution.w, resolution.h, { fit: 'cover' }), format)
    } else {
      const place = id.replace(/^bg_/, '').replace(/_/g, ' ')
      buf = await placeholderBackground(place, resolution, format)
      placeholders.push(id)
    }
    fs.writeFileSync(path.join(gameSubdir, rel), buf)
    written.push(rel)
  }

  const names = new Map(book.characters.map((c) => [c.key, c.name]))
  for (const s of used.sprites) {
    const id = `sprite_${s.charKey}_${s.expression}`
    const rel = imageFile(spriteImageName(s.charKey, s.expression), format)
    const src = resolveAsset(id)
    let buf: Buffer
    if (src && fs.existsSync(src)) {
      buf = await encode(sharp(src).ensureAlpha(), format)
    } else {
      buf = await placeholderSprite(names.get(s.charKey) ?? s.charKey, s.expression, resolution, format)
      placeholders.push(id)
    }
    fs.writeFileSync(path.join(gameSubdir, rel), buf)
    written.push(rel)
  }

  // The main menu background comes from the cover.
  const coverSrc = resolveAsset('cover')
  let cover: Buffer
  if (coverSrc && fs.existsSync(coverSrc)) {
    cover = await sharp(coverSrc).resize(resolution.w, resolution.h, { fit: 'cover' }).png().toBuffer()
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
