import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { ProjectStore } from '../vn/project'
import { loadExportBook } from './model'
import type { ExportBook, ExportOptions, ExportPicture, ExportSection } from './model'
import type { SectionMap } from './sections'
import { toBookJpeg, toCoverJpeg } from './images'
import type { BookJpeg } from './images'
import { endText, jumpParts, navWords, restartParts, startText } from './phrases'

/**
 * The reflowable EPUB 3 writer (HUB-25 / VNO-53): one `ExportBook` in, the bytes of an .epub out. No second reading of vn.json.
 * Layout: `mimetype` first and stored, `META-INF/container.xml`, `OEBPS/content.opf`, `nav.xhtml`, `cover.xhtml`, one xhtml per section/page
 * (`id="s<no>"` on its wrapper, so `section-056.xhtml#s56` resolves), `style.css`, `images/*.jpg`.
 * Gamebook: the files are in number order (the file order gives nothing away) and the nav lists numbers only plus "Start: section 1".
 * Linear and picture book: front to back, one picture per page, the caption below it, the nav lists the chapters.
 */

export interface EpubOptions {
  /** Grey JPEGs instead of colour. */
  grayscale?: boolean
  /** The dcterms:modified time. Default: now. */
  modified?: Date
}

export interface EpubResult {
  bytes: Uint8Array
  /** The size of `bytes`. */
  sizeBytes: number
  /** Images in the file (cover included). */
  pictures: number
  /** Problems met while writing (a picture that could not be read becomes a text page). */
  warnings: string[]
}

export const EPUB_WARN_BYTES = 40 * 1024 * 1024

export const EPUB_CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; margin: 5%; }
h1, h2 { font-family: Georgia, serif; text-align: center; }
h2.section-no { font-size: 3em; font-weight: bold; margin: 0.6em 0 0.6em; }
h2.chapter { font-size: 1.4em; margin: 0.6em 0 0.8em; }
p { margin: 0 0 0.9em; text-indent: 0; }
div.pic { text-align: center; margin: 0 0 1.2em; }
div.pic img { max-width: 100%; height: auto; }
p.caption { text-align: center; font-style: italic; }
div.choices { margin: 2em 0 1em; padding: 0.8em 1em; border: 1px solid #999; }
div.choices p { margin: 0.5em 0; }
div.the-end { text-align: center; margin: 2.5em 0 1em; }
div.the-end p.end { font-variant: small-caps; letter-spacing: 0.1em; font-size: 1.3em; }
div.the-end p.again { font-size: 0.95em; }
div.cover { text-align: center; }
div.cover img { max-width: 100%; max-height: 100%; height: auto; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage .author { font-size: 1.2em; margin-top: 1.5em; }
`

/** Appended to the CSS only for a parallel-text book (VNO-58). */
export const EPUB_TR_CSS = `div.pair { margin: 0 0 0.9em; page-break-inside: avoid; break-inside: avoid; }
div.pair p { margin: 0; }
div.pair p.tr { margin-top: 0.2em; }
p.tr { font-size: 0.85em; font-style: italic; color: #555; }
p.caption.tr { font-style: normal; }
p.title-tr { text-align: center; }
div.choices div.pair { margin: 0.5em 0; }
`

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pad = (n: number): string => String(n).padStart(3, '0')
const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The xhtml file of a section (gamebook), chapter (linear) or page (picture book). */
export const sectionFileOf = (mode: ExportBook['mode'], no: number): string => `${mode === 'gamebook' ? 'section' : mode === 'linear' ? 'chapter' : 'page'}-${pad(no)}.xhtml`

/** A stable identifier for a book and edition (the same book and language keep their id, so a reader replaces the old copy). */
const bookId = (b: ExportBook): string => {
  const h = createHash('sha1').update(`vn-studio:${b.slug}:${b.lang}${b.lang2 ? `:${b.lang2}` : ''}`).digest('hex')
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const xhtml = (title: string, lang: string, body: string, epubType?: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body${epubType ? ` epub:type="${epubType}"` : ''}>
${body}
</body>
</html>
`

/** Builds the EPUB of an `ExportBook`. */
export async function buildEpub(book: ExportBook, opts: EpubOptions = {}): Promise<EpubResult> {
  const lang = book.lang
  const warnings: string[] = []
  const zip = new JSZip()
  const put = (name: string, data: string | Uint8Array, o: JSZip.JSZipFileOptions = {}): void => {
    zip.file(name, data, { createFolders: false, ...o })
  }
  put('mimetype', 'application/epub+zip', { compression: 'STORE' })
  put(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  )
  put('OEBPS/style.css', book.lang2 ? EPUB_CSS + EPUB_TR_CSS : EPUB_CSS)
  const lang2 = book.lang2
  /** The original followed by its translation in one wrapper; the original alone when there is no translation. */
  const pair = (originalHtml: string, tr: string | null | undefined, cls: string): string =>
    lang2 && tr ? `<div class="pair">${originalHtml}<p class="${cls}" lang="${esc(lang2)}" xml:lang="${esc(lang2)}">${esc(tr)}</p></div>` : originalHtml

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'
  ]
  const spine: string[] = ['<itemref idref="cover"/>']
  let pictures = 0

  const readPicture = async (pic: ExportPicture | undefined, where: string, make: (f: string) => Promise<BookJpeg>): Promise<BookJpeg | undefined> => {
    if (!pic) return undefined
    try {
      return await make(pic.file)
    } catch (e) {
      warnings.push(`${where}: picture ${pic.assetId} could not be read (${e instanceof Error ? e.message : String(e)}), text page instead`)
      return undefined
    }
  }

  // the cover: the first scene's background with the title over it, else a title-only page
  const coverJpeg = await readPicture(book.cover.picture, 'cover', (f) => toCoverJpeg(f, book.cover.title, book.cover.author, { grayscale: opts.grayscale }))
  if (coverJpeg) {
    put('OEBPS/images/cover.jpg', coverJpeg.data)
    manifest.push('<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>')
    put('OEBPS/cover.xhtml', xhtml(book.title, lang, `<div class="cover"><img src="images/cover.jpg" alt="${esc(book.title)}"/></div>`, 'cover'))
    pictures++
  } else {
    put('OEBPS/cover.xhtml', xhtml(book.title, lang, `<div class="titlepage"><h1>${esc(book.title)}</h1>${book.cover.author ? `<p class="author">${esc(book.cover.author)}</p>` : ''}</div>`, 'cover'))
  }

  const items: ExportSection[] = book.mode === 'picture-book' ? book.pages : book.sections
  const navItems: string[] = []
  for (const s of items) {
    const file = sectionFileOf(book.mode, s.no)
    const image = await readPicture(s.picture, `${book.mode === 'picture-book' ? 'page' : 'section'} ${s.no}`, (f) => toBookJpeg(f, { grayscale: opts.grayscale }))
    const parts: string[] = []
    if (book.mode === 'gamebook') parts.push(`<h2 class="section-no">${s.no}</h2>`)
    else if (s.title) parts.push(pair(`<h2 class="chapter">${esc(s.title)}</h2>`, s.title2, 'tr title-tr'))
    if (image) {
      const img = `images/s${pad(s.no)}.jpg`
      put(`OEBPS/${img}`, image.data)
      manifest.push(`<item id="img-s${s.no}" href="${img}" media-type="image/jpeg"/>`)
      parts.push(`<div class="pic"><img src="${img}" alt=""/></div>`)
      pictures++
    }
    const cls = book.mode === 'picture-book' ? ' class="caption"' : ''
    s.paragraphs.forEach((p, i) => parts.push(pair(`<p${cls}>${esc(p)}</p>`, s.paragraphs2?.[i], book.mode === 'picture-book' ? 'caption tr' : 'tr')))
    if (s.choices?.length) {
      const lines = s.choices.map((c) => {
        const j = jumpParts(lang, c.text, c.toNo)
        return pair(`<p>${esc(j.before)}<a href="${sectionFileOf(book.mode, c.toNo)}#s${c.toNo}">${esc(j.label)}</a>${esc(j.after)}</p>`, c.text2, 'tr')
      })
      parts.push(`<div class="choices">\n${lines.join('\n')}\n</div>`)
    } else if (s.ending !== undefined) {
      if (s.ending) parts.push(pair(`<p>${esc(s.ending)}</p>`, s.ending2, 'tr'))
      if (book.mode === 'gamebook') {
        const r = restartParts(lang, 1)
        parts.push(`<div class="the-end">\n<p class="end">${esc(endText(lang))}</p>\n<p class="again">${esc(r.before)}<a href="${sectionFileOf(book.mode, 1)}#s1">${esc(r.label)}</a>${esc(r.after)}</p>\n</div>`)
      }
    }
    const heading = book.mode === 'gamebook' ? String(s.no) : (s.title ?? String(s.no))
    put(`OEBPS/${file}`, xhtml(heading, lang, `<div class="sec" id="s${s.no}">\n${parts.join('\n')}\n</div>`, 'chapter'))
    manifest.push(`<item id="s${s.no}" href="${file}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="s${s.no}"/>`)
    // gamebook: numbers only (a title would spoil); the others list the chapters
    if (book.mode === 'gamebook') navItems.push(`<li><a href="${file}#s${s.no}">${s.no}</a></li>`)
    else if (s.title) navItems.push(`<li><a href="${file}#s${s.no}">${esc(s.title)}</a></li>`)
  }

  const words = navWords(lang)
  const first = items[0]
  const startNo = book.mode === 'gamebook' ? 1 : (first?.no ?? 1)
  put(
    'OEBPS/nav.xhtml',
    xhtml(
      words.contents,
      lang,
      `<nav epub:type="toc" id="toc">
<h2>${esc(words.contents)}</h2>
<ol>
<li><a href="cover.xhtml">${esc(words.cover)}</a></li>
${book.mode === 'gamebook' ? `<li><a href="${sectionFileOf(book.mode, 1)}#s1">${esc(startText(lang, 1))}</a></li>\n` : ''}${navItems.join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
<li><a epub:type="cover" href="cover.xhtml">${esc(words.cover)}</a></li>${first ? `\n<li><a epub:type="bodymatter" href="${sectionFileOf(book.mode, startNo)}#s${startNo}">${esc(book.mode === 'gamebook' ? startText(lang, 1) : words.contents)}</a></li>` : ''}
</ol>
</nav>`
    )
  )

  put(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${esc(bookId(book))}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>${book.cover.author ? `\n    <dc:creator>${esc(book.cover.author)}</dc:creator>` : ''}
    <dc:language>${esc(lang)}</dc:language>
    <meta property="dcterms:modified">${iso(opts.modified ?? new Date())}</meta>${coverJpeg ? '\n    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
    <itemref idref="nav" linear="no"/>
  </spine>
</package>
`
  )
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
  return { bytes, sizeBytes: bytes.length, pictures, warnings }
}

export interface EpubFileOptions extends ExportOptions, EpubOptions {
  /** The output file. Default: projects/<slug>/export/<slug>-<lang>.epub */
  out?: string
}

export interface EpubFileResult {
  path: string
  bytes: number
  pictures: number
  book: ExportBook
  map?: SectionMap
  warnings: string[]
}

/** Loads a project, stores its numbering, and writes the EPUB. Refuses (nothing written) when the stored numbering no longer fits the chapters. */
export async function writeEpubFile(store: ProjectStore, slug: string, opts: EpubFileOptions = {}): Promise<EpubFileResult> {
  const r = await loadExportBook(store, slug, { lang: opts.lang, lang2: opts.lang2, order: opts.order, seed: opts.seed, renumber: opts.renumber, persist: true })
  if (r.stale.length) throw new Error(`the stored section numbers (${path.basename(r.mapFile)}) no longer fit "${slug}": ${r.stale.join('; ')}. Nothing was written; pass renumber: true to number the sections again (a copy already sent to a reader then differs)`)
  const built = await buildEpub(r.book, { grayscale: opts.grayscale, modified: opts.modified })
  const file = path.resolve(opts.out ?? store.file(slug, 'export', `${slug}-${r.book.lang}${r.book.lang2 ? `-${r.book.lang2}` : ''}.epub`))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, built.bytes)
  const warnings = [...r.book.warnings, ...built.warnings]
  if (built.sizeBytes > EPUB_WARN_BYTES) warnings.push(`the EPUB is ${(built.sizeBytes / 1048576).toFixed(1)} MB: above 40 MB (Send to Kindle takes 200 MB on the web page but only 50 MB in the apps)`)
  return { path: file, bytes: built.sizeBytes, pictures: built.pictures, book: { ...r.book, warnings }, map: r.map, warnings }
}
