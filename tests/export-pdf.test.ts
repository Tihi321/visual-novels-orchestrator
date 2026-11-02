import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPdf } from '../src/engine/export/pdf'
import type { ExportBook, ExportPicture, ExportSection } from '../src/engine/export/model'

/** HUB-25 / VNO-54 (plan test 4): the PDF read back as raw bytes (pdfkit has no parser; compress:false keeps objects, annotations and the font map as text). */

let dir = ''
let pic: ExportPicture
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pdf-test-'))
  const file = path.join(dir, 'a.png')
  await sharp({ create: { width: 1400, height: 700, channels: 3, background: '#336699' } }).png().toFile(file)
  pic = { assetId: 'a', file }
})
afterAll(() => rm(dir, { recursive: true, force: true }))

const raw = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')
const linkTargets = (pdf: string): string[] => [...pdf.matchAll(/\/S \/GoTo\s*\/D \((s\d+)\)/g)].map((m) => m[1]!)
const destinations = (pdf: string): Map<string, string> => new Map([...pdf.matchAll(/\((s\d+)\) \[(\d+) 0 R \/XYZ/g)].map((m) => [m[1]!, m[2]!]))

describe('gamebook PDF', () => {
  it('has a cover and a page start per section, a link per choice and restart to an existing section, and Croatian letters intact', async () => {
    const hr = 'Čovjek šapće: žaba, đak, ćevap, ŠĐŽČĆ.'
    const sec = (no: number, o: Partial<ExportSection> = {}): ExportSection => ({ no, chapter: no, paragraphs: [hr], ...o })
    const long = Array.from({ length: 40 }, (_, i) => `${hr} ${i}`) // takes several pages
    const book: ExportBook = {
      slug: 't',
      title: 'Test',
      lang: 'hr',
      mode: 'gamebook',
      cover: { title: 'Test', author: 'A. Writer', source: 'first-scene-background', picture: pic },
      sections: [
        sec(1, { paragraphs: long, picture: pic, choices: [{ text: 'Ako otvoriš vrata', toNo: 3 }, { text: 'Ako odeš', toNo: 2 }] }),
        sec(2, { ending: '' }),
        sec(3, { ending: '' })
      ],
      pages: [],
      warnings: []
    }
    const built = await buildPdf(book, { compress: false })
    const pdf = raw(built.bytes)
    expect(pdf.startsWith('%PDF-')).toBe(true)
    const pages = (pdf.match(/\/Type \/Page\b/g) ?? []).length
    expect(pages).toBe(built.pages)
    expect(pages).toBeGreaterThan(3 + 1) // cover + three sections, and section 1 alone runs over several pages
    expect(built.pictures).toBe(2)
    const dests = destinations(pdf)
    expect([...dests.keys()].sort()).toEqual(['s1', 's2', 's3'])
    expect(new Set(dests.values()).size).toBe(3) // a different page each
    // 2 choices + a restart link on each of the 2 endings, all to an existing destination
    expect((pdf.match(/\/Subtype \/Link/g) ?? []).length).toBe(4)
    expect(linkTargets(pdf).sort()).toEqual(['s1', 's1', 's2', 's3'])
    for (const t of linkTargets(pdf)) expect(dests.has(t)).toBe(true)
    expect(pdf).toContain('/Lang (hr)')
    expect(pdf).toContain('/FontFile2')
    const cmap = pdf.slice(pdf.indexOf('beginbfrange'), pdf.indexOf('endbfrange'))
    for (const ch of 'ČĆĐŠŽčćđšž') expect(cmap, ch).toContain(`<${ch.codePointAt(0)!.toString(16).padStart(4, '0')}>`)
  })
})
