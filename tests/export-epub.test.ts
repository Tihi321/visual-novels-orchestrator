import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildEpub } from '../src/engine/export/epub'
import type { ExportBook, ExportPicture, ExportSection } from '../src/engine/export/model'

/** HUB-25 / VNO-53 (plan test 3): the EPUB's structure, read back from the zip. No Kindle, no engine. */

let dir = ''
let pic: ExportPicture
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'epub-test-'))
  const file = path.join(dir, 'a.png')
  await sharp({ create: { width: 1400, height: 700, channels: 3, background: '#336699' } }).png().toFile(file)
  pic = { assetId: 'a', file }
})
afterAll(() => rm(dir, { recursive: true, force: true }))

const sec = (no: number, o: Partial<ExportSection> = {}): ExportSection => ({ no, chapter: no, paragraphs: [`Text <${no}> & more.`], ...o })
const baseBook = (o: Partial<ExportBook>): ExportBook => ({
  slug: 't',
  title: 'Tom & "Jerry"',
  lang: 'hr',
  mode: 'gamebook',
  cover: { title: 'Tom & "Jerry"', source: 'first-scene-background' },
  sections: [],
  pages: [],
  warnings: [],
  ...o
})

/** Unzips and checks what every EPUB must hold; returns the xhtml texts by path and the manifest hrefs. */
async function open(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
  expect(names[0]).toBe('mimetype')
  // stored: the first local header has compression method 0 and the plain text follows the name
  expect(Buffer.from(bytes.subarray(30, 58)).toString()).toBe('mimetypeapplication/epub+zip')
  expect(bytes[8]).toBe(0)
  const opf = await zip.file('OEBPS/content.opf')!.async('string')
  const hrefs = [...opf.matchAll(/<item [^>]*href="([^"]+)"/g)].map((m) => m[1]!)
  for (const h of hrefs) expect(zip.file(`OEBPS/${h}`), `manifest file ${h}`).not.toBeNull()
  expect(opf).toContain('<dc:language>')
  const pages = new Map<string, string>()
  for (const n of names.filter((x) => x.endsWith('.xhtml'))) pages.set(n.replace('OEBPS/', ''), await zip.file(n)!.async('string'))
  // every href (file and #id) resolves to an existing id
  for (const [from, html] of pages) {
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const [file, frag] = m[1]!.split('#')
      const target = pages.get(file || from)
      expect(target, `${from} links to ${m[1]}`).toBeDefined()
      if (frag) expect(target!, `${from} links to ${m[1]}`).toContain(`id="${frag}"`)
    }
  }
  return { zip, opf, pages, hrefs }
}

describe('EPUB structure', () => {
  it('writes a gamebook whose links, "odlomak N" numbers and images all resolve', async () => {
    const book = baseBook({
      cover: { title: 'Tom & "Jerry"', author: 'A. Writer', source: 'first-scene-background', picture: pic },
      sections: [
        sec(1, { picture: pic, choices: [{ text: 'Ako otvoriš vrata', toNo: 3 }, { text: 'Ako ostaneš', toNo: 2 }] }),
        sec(2, { choices: [{ text: 'Ako se vratiš', toNo: 1 }] }),
        sec(3, { picture: pic, ending: '' })
      ]
    })
    const { opf, pages, zip } = await open((await buildEpub(book)).bytes)
    expect(opf).toContain('<dc:language>hr</dc:language>')
    expect(opf).toContain('properties="cover-image"')
    // files in number order
    expect([...pages.keys()].filter((k) => k.startsWith('section-'))).toEqual(['section-001.xhtml', 'section-002.xhtml', 'section-003.xhtml'])
    // every "odlomak N" link names an existing section; the ending offers section 1
    const nums = [...[...pages.values()].join('').matchAll(/<a [^>]*>odlomak (\d+)<\/a>/g)].map((m) => Number(m[1]))
    expect(nums.length).toBe(4)
    for (const n of nums) expect(pages.has(`section-${String(n).padStart(3, '0')}.xhtml`)).toBe(true)
    expect(pages.get('section-003.xhtml')).toContain('Kraj.')
    expect(pages.get('section-001.xhtml')).toContain('Ako otvoriš vrata, idi na <a href="section-003.xhtml#s3">odlomak 3</a>.')
    // numbers only in the nav, text escaped, every image in the file a JPEG
    expect(pages.get('nav.xhtml')).toContain('Početak: odlomak 1')
    expect(pages.get('nav.xhtml')).not.toContain('Text')
    expect(pages.get('section-001.xhtml')).toContain('Text &lt;1&gt; &amp; more.')
    expect(Object.keys(zip.files).filter((n) => n.startsWith('OEBPS/images/'))).toEqual(['OEBPS/images/cover.jpg', 'OEBPS/images/s001.jpg', 'OEBPS/images/s003.jpg'])
    const meta = await sharp(await zip.file('OEBPS/images/s001.jpg')!.async('nodebuffer')).metadata()
    expect([meta.format, meta.width]).toEqual(['jpeg', 1000])
  })

  it('writes a picture book with exactly one image per page, and a text-only cover without a picture', async () => {
    const pages = [1, 2, 3].map((n) => sec(n, { picture: pic, ...(n === 1 ? { title: 'One' } : {}) }))
    const { pages: files, zip, opf } = await open((await buildEpub(baseBook({ mode: 'picture-book', lang: 'en', pages }))).bytes)
    for (const n of [1, 2, 3]) expect([...files.get(`page-00${n}.xhtml`)!.matchAll(/<img /g)]).toHaveLength(1)
    expect(Object.keys(zip.files).filter((n) => n.endsWith('.jpg'))).toHaveLength(3)
    expect(opf).not.toContain('cover-image')
    expect(files.get('nav.xhtml')).toContain('One')
  })
})
