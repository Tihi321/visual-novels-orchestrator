import sharp from 'sharp'

/**
 * Pictures for the printed book (EPUB, and the PDF writer after it): any picture on disk becomes a JPEG about 1000 px wide, never upscaled.
 * Colour is kept (Kindle Colour and the apps show it); a mild contrast lift keeps a grey rendering on e-ink legible. `grayscale: true`
 * writes a grey JPEG instead.
 */

export interface JpegOptions {
  /** Width in px; a smaller picture is not enlarged. Default 1000. */
  width?: number
  /** JPEG quality. Default 80. */
  quality?: number
  /** A grey JPEG instead of colour. Default false. */
  grayscale?: boolean
}

export interface BookJpeg {
  data: Buffer
  width: number
  height: number
}

export const BOOK_PICTURE_WIDTH = 1000
export const BOOK_JPEG_QUALITY = 80

/** The contrast lift: out = in * 1.1 - 12.8, a light stretch around mid grey. */
const LIFT = { a: 1.1, b: -12.8 }

/** Converts a picture file (png/webp/jpg) or its bytes to a book JPEG. Transparency is flattened on white. */
export async function toBookJpeg(input: string | Buffer, opts: JpegOptions = {}): Promise<BookJpeg> {
  let img = sharp(input).rotate().flatten({ background: '#ffffff' }).resize({ width: opts.width ?? BOOK_PICTURE_WIDTH, withoutEnlargement: true }).linear(LIFT.a, LIFT.b)
  if (opts.grayscale) img = img.grayscale()
  const { data, info } = await img.jpeg({ quality: opts.quality ?? BOOK_JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Splits a title into lines of at most `max` characters, at spaces (a long word stays whole). */
export function wrapTitle(text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line)
      line = word
    } else line = line ? line + ' ' + word : word
  }
  if (line) lines.push(line)
  return lines
}

/** The SVG laid over a cover picture: a dark band across the middle with the title (and the author) in white. All text is XML-escaped. */
export function coverOverlaySvg(width: number, height: number, title: string, author?: string): string {
  const titleSize = Math.round(width * 0.075)
  const authorSize = Math.round(width * 0.04)
  const lines = wrapTitle(title, Math.max(8, Math.floor((width * 0.84) / (titleSize * 0.55))))
  const lineH = Math.round(titleSize * 1.2)
  const bandH = lines.length * lineH + (author ? authorSize * 2 : 0) + titleSize
  const top = Math.max(0, Math.round((height - bandH) / 2))
  const font = `font-family="Georgia, 'Times New Roman', serif" text-anchor="middle" fill="#ffffff"`
  const parts = lines.map((l, i) => `<text x="${width / 2}" y="${top + titleSize + i * lineH}" font-size="${titleSize}" font-weight="bold" ${font}>${escapeXml(l)}</text>`)
  if (author?.trim()) parts.push(`<text x="${width / 2}" y="${top + titleSize + lines.length * lineH + authorSize * 0.6}" font-size="${authorSize}" ${font}>${escapeXml(author.trim())}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="0" y="${top}" width="${width}" height="${bandH}" fill="#000000" fill-opacity="0.6"/>${parts.join('')}</svg>`
}

/** The cover JPEG: the picture with the title (and author) drawn over it. */
export async function toCoverJpeg(input: string | Buffer, title: string, author?: string, opts: JpegOptions = {}): Promise<BookJpeg> {
  const base = await toBookJpeg(input, { ...opts, quality: 92 })
  const svg = coverOverlaySvg(base.width, base.height, title, author)
  let img = sharp(base.data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  if (opts.grayscale) img = img.grayscale()
  const { data, info } = await img.jpeg({ quality: opts.quality ?? BOOK_JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
