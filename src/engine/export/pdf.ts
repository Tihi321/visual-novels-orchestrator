import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { findAppDirs } from '../vn/appdirs'
import type { ProjectStore } from '../vn/project'
import { loadExportBook } from './model'
import type { ExportBook, ExportOptions, ExportPicture, ExportSection } from './model'
import type { SectionMap } from './sections'
import { toBookJpeg, toCoverJpeg } from './images'
import type { BookJpeg } from './images'
import { endText, jumpParts, restartParts, sectionWord, startText } from './phrases'

/**
 * The PDF writer (HUB-25 / VNO-54): one `ExportBook` in, the bytes of an A5 .pdf out. No second reading of vn.json.
 * Gamebook: every section starts a new page with its number in large type, then the picture, the text and the choices
 * `{before}{label}{after}` where only the label ("section 56") is a link to the named destination `s56` at the top of that section's page;
 * an ending shows "The End." and a link to section 1. The footer carries the section number (the word "section"/"odlomak", never "page").
 * The only bookmark is "Start: section 1" (no spoilers). Picture book: one page per page entry, the picture and the caption below it.
 * Linear: one chapter after another, its picture at the chapter start; the bookmarks are the chapter titles.
 * pdfkit (^0.20) and the font Lora (SIL OFL, `themes/parchment/fonts/`) were chosen by the VNO-54 spike (HUB-25); the twin of Scriptorium's
 * `src/engine/publish/pdf.ts`, so both PDFs look alike.
 */

export interface PdfOptions {
  /** Grey JPEGs instead of colour. */
  grayscale?: boolean
  /** Folder with Lora-Regular.ttf and Lora-Bold.ttf. Default: `pdfFontDir()`. */
  fontDir?: string
  /** pdfkit compresses streams by default; tests turn it off to read the bytes. */
  compress?: boolean
  /** Called after each section or page is laid out (done of total), so a UI can show progress. */
  onProgress?: (done: number, total: number) => void
}

export interface PdfResult {
  bytes: Uint8Array
  /** The size of `bytes`. */
  sizeBytes: number
  /** Pages in the file (cover included). */
  pages: number
  /** Images in the file (cover included). */
  pictures: number
  /** Problems met while writing (a picture that could not be read becomes a text page). */
  warnings: string[]
}

export const PDF_WARN_BYTES = 40 * 1024 * 1024

/**
 * The folder with the bundled fonts: `themes/parchment/fonts` of the app themes folder, found as the rest of the app finds it
 * (`VNO_THEMES`, which the packaged app sets to its `resources/themes`, else walking up from this code to the repo's `themes/`).
 */
export function pdfFontDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = path.join(findAppDirs(env).themes, 'parchment', 'fonts')
  if (!existsSync(path.join(dir, 'Lora-Regular.ttf')) || !existsSync(path.join(dir, 'Lora-Bold.ttf'))) {
    throw new Error(`the PDF font (Lora-Regular.ttf and Lora-Bold.ttf) was not found in ${dir}; set VNO_THEMES to the themes folder`)
  }
  return dir
}

const A5: [number, number] = [419.53, 595.28]
const MARGIN = { top: 48, bottom: 56, left: 42, right: 42 }
const WIDTH = A5[0] - MARGIN.left - MARGIN.right

/** Builds the PDF of an `ExportBook`. */
export async function buildPdf(book: ExportBook, opts: PdfOptions = {}): Promise<PdfResult> {
  const dir = opts.fontDir ?? pdfFontDir()
  const regular = path.join(dir, 'Lora-Regular.ttf')
  const bold = path.join(dir, 'Lora-Bold.ttf')
  const lang = book.lang
  const warnings: string[] = []
  let pictures = 0

  const doc = new PDFDocument({
    size: A5,
    margins: MARGIN,
    bufferPages: true,
    compress: opts.compress !== false,
    lang,
    displayTitle: true,
    font: regular,
    info: { Title: book.title, ...(book.cover.author ? { Author: book.cover.author } : {}), Creator: 'VN Studio', Producer: 'VN Studio (pdfkit)' }
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })

  /** The footer text of each page (first page is index 0); '' = none (the cover). pdfkit opens page 1 (the cover) in its constructor, before
   * this listener exists, so its entry is pushed by hand. */
  const footers: string[] = ['']
  let footer = ''
  doc.on('pageAdded', () => footers.push(footer))

  const readPicture = async (pic: ExportPicture | undefined, where: string, make: (f: string) => Promise<BookJpeg>): Promise<BookJpeg | undefined> => {
    if (!pic) return undefined
    try {
      return await make(pic.file)
    } catch (e) {
      warnings.push(`${where}: picture ${pic.assetId} could not be read (${e instanceof Error ? e.message : String(e)}), text page instead`)
      return undefined
    }
  }

  /** A choice or restart line: `before`, then the linked label, then `after`. The link must not leak onto the next fragment (`goTo: null`). */
  const jump = (parts: { before: string; label: string; after: string }, no: number, opts2: PDFKit.Mixins.TextOptions): void => {
    doc.font(regular).fontSize(11.5).fillColor('#000')
    if (opts2.align === 'center') {
      // pdfkit misplaces centred `continued` fragments (they overprint): centre a one-line jump by hand, else set it left
      const { align: _align, ...rest } = opts2
      const line = doc.widthOfString(parts.before + parts.label + parts.after)
      if (line < WIDTH) doc.x = MARGIN.left + (WIDTH - line) / 2
      opts2 = { ...rest, width: Math.min(WIDTH, line + 1) }
    }
    doc.text(parts.before, { ...opts2, continued: true })
    doc.text(parts.label, { ...opts2, continued: true, goTo: `s${no}`, underline: true })
    doc.text(parts.after, { ...opts2, continued: false, goTo: null as unknown as string, underline: false })
    doc.x = MARGIN.left
  }

  // cover: the first scene's background with the title over it, else a title page
  footer = ''
  const cover = await readPicture(book.cover.picture, 'cover', (f) => toCoverJpeg(f, book.cover.title, book.cover.author, { grayscale: opts.grayscale }))
  if (cover) {
    doc.image(cover.data, 0, 0, { fit: A5, align: 'center', valign: 'center' })
    pictures++
  } else {
    doc.font(bold).fontSize(28).fillColor('#000').text(book.title, MARGIN.left, A5[1] * 0.32, { width: WIDTH, align: 'center' })
    if (book.cover.author) doc.moveDown(1.2).font(regular).fontSize(14).text(book.cover.author, { width: WIDTH, align: 'center' })
  }

  const items: ExportSection[] = book.mode === 'picture-book' ? book.pages : book.sections
  for (const [i, s] of items.entries()) {
    footer = book.mode === 'gamebook' ? `${sectionWord(lang)} ${s.no}` : String(s.no)
    doc.addPage()
    doc.addNamedDestination(`s${s.no}`)
    // the outline entry targets the current page, so it is added while on the page it leads to
    if (book.mode === 'gamebook') {
      if (i === 0 && s.no === 1) doc.outline.addItem(startText(lang, 1))
    } else if (s.title) doc.outline.addItem(s.title)

    if (book.mode === 'gamebook') {
      doc.font(bold).fontSize(46).fillColor('#000').text(String(s.no), { width: WIDTH, align: 'center' })
      doc.moveDown(0.4)
    } else if (s.title) {
      doc.font(bold).fontSize(book.mode === 'linear' ? 20 : 14).fillColor('#000').text(s.title, { width: WIDTH, align: 'center', paragraphGap: 8 })
    }

    const image = await readPicture(s.picture, `${book.mode === 'picture-book' ? 'page' : 'section'} ${s.no}`, (f) => toBookJpeg(f, { grayscale: opts.grayscale }))
    if (image) {
      doc.image(image.data, { fit: [WIDTH, book.mode === 'picture-book' ? 300 : 210], align: 'center' })
      doc.moveDown(0.8)
      pictures++
    }

    doc.font(regular).fontSize(book.mode === 'picture-book' ? 12 : 11.5).fillColor('#000')
    for (const p of s.paragraphs) {
      doc.text(p, { width: WIDTH, align: book.mode === 'picture-book' ? 'center' : 'left', lineGap: 2, paragraphGap: 7 })
    }

    if (s.choices?.length) {
      doc.moveDown(0.6)
      for (const c of s.choices) jump(jumpParts(lang, c.text, c.toNo), c.toNo, { width: WIDTH, lineGap: 2, paragraphGap: 8 })
    } else if (s.ending !== undefined) {
      if (s.ending) doc.font(regular).fontSize(11.5).text(s.ending, { width: WIDTH, lineGap: 2, paragraphGap: 7 })
      if (book.mode === 'gamebook') {
        doc.moveDown(0.6)
        doc.font(bold).fontSize(14).text(endText(lang), { width: WIDTH, align: 'center', paragraphGap: 8 })
        jump(restartParts(lang, 1), 1, { width: WIDTH, align: 'center', lineGap: 2 })
      }
    }
    opts.onProgress?.(i + 1, items.length)
  }

  // footers on every page except the cover, without letting pdfkit add a page for text under the bottom margin
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    const text = footers[i]
    if (!text) continue
    doc.switchToPage(range.start + i)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font(regular).fontSize(9).fillColor('#555').text(text, MARGIN.left, A5[1] - 34, { width: WIDTH, align: 'center', lineBreak: false })
    doc.page.margins.bottom = bottom
  }
  const pages = range.count
  doc.flushPages()
  doc.end()
  await done
  const bytes = new Uint8Array(Buffer.concat(chunks))
  return { bytes, sizeBytes: bytes.length, pages, pictures, warnings }
}

export interface PdfFileOptions extends ExportOptions, PdfOptions {
  /** The output file. Default: projects/<slug>/export/<slug>-<lang>.pdf */
  out?: string
}

export interface PdfFileResult {
  path: string
  bytes: number
  pages: number
  pictures: number
  book: ExportBook
  map?: SectionMap
  warnings: string[]
}

/** Loads a project, stores its numbering, and writes the PDF. Refuses (nothing written) when the stored numbering no longer fits the chapters. */
export async function writePdfFile(store: ProjectStore, slug: string, opts: PdfFileOptions = {}): Promise<PdfFileResult> {
  const r = await loadExportBook(store, slug, { lang: opts.lang, order: opts.order, seed: opts.seed, renumber: opts.renumber, persist: true })
  if (r.stale.length) throw new Error(`the stored section numbers (${path.basename(r.mapFile)}) no longer fit "${slug}": ${r.stale.join('; ')}. Nothing was written; pass renumber: true to number the sections again (a copy already sent to a reader then differs)`)
  const built = await buildPdf(r.book, { grayscale: opts.grayscale, fontDir: opts.fontDir, compress: opts.compress, onProgress: opts.onProgress })
  const file = path.resolve(opts.out ?? store.file(slug, 'export', `${slug}-${r.book.lang}.pdf`))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, built.bytes)
  const warnings = [...r.book.warnings, ...built.warnings]
  if (built.sizeBytes > PDF_WARN_BYTES) warnings.push(`the PDF is ${(built.sizeBytes / 1048576).toFixed(1)} MB: above 40 MB`)
  return { path: file, bytes: built.sizeBytes, pages: built.pages, pictures: built.pictures, book: { ...r.book, warnings }, map: r.map, warnings }
}
