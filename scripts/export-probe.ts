/**
 * Writes the 3-section probe gamebook EPUB for the Kindle link check (HUB-25 live check step 1). No engine, no project, no model call.
 *
 *   yarn tsx scripts/export-probe.ts [out.epub] [en|hr]
 *
 * Default output: .claude/temp/kindle-probe/probe-gamebook.epub. Send it with Send to Kindle, then check: does "turn to section N" jump,
 * does Back return, does the picture show, does the back link to section 1 work.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { buildEpub } from '../src/engine/export/epub'
import type { ExportBook } from '../src/engine/export/model'

async function main(): Promise<void> {
const out = path.resolve(process.argv[2] ?? '.claude/temp/kindle-probe/probe-gamebook.epub')
const lang = (process.argv[3] ?? 'en') as 'en' | 'hr'
const dir = path.dirname(out)
await fs.mkdir(dir, { recursive: true })

// one small coloured picture with a diagonal, so a wrong colour or contrast shows
const pic = path.join(dir, 'probe-picture.png')
await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3b6ea5' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect x="0" y="560" width="1200" height="240" fill="#d9a441"/><circle cx="900" cy="220" r="110" fill="#f2e394"/><path d="M0 560 L300 300 L560 560 Z" fill="#2d3a4a"/></svg>') }])
  .png()
  .toFile(pic)
const picture = { assetId: 'probe', file: pic }

const book: ExportBook = {
  slug: 'probe-gamebook',
  title: lang === 'hr' ? 'Probna igra-knjiga' : 'Probe Gamebook',
  lang,
  mode: 'gamebook',
  cover: { title: lang === 'hr' ? 'Probna igra-knjiga' : 'Probe Gamebook', source: 'first-scene-background', picture },
  sections: [
    {
      no: 1,
      chapter: 1,
      picture,
      paragraphs: ['This is section 1, the start. Tap the first link to jump to section 3; tap Back (or the previous-page gesture) to return here.'],
      choices: [
        { text: 'If you take the left path', toNo: 3 },
        { text: 'If you take the right path', toNo: 2 }
      ]
    },
    {
      no: 2,
      chapter: 2,
      paragraphs: ['This is section 2, the right path. The link below goes back to section 1.'],
      choices: [{ text: 'If you want to go back', toNo: 1 }]
    },
    { no: 3, chapter: 3, paragraphs: ['This is section 3, the left path, an ending.'], ending: 'You reached the end of the probe.' }
  ],
  pages: [],
  warnings: []
}

const r = await buildEpub(book, { modified: new Date('2026-11-02T00:00:00Z') })
await fs.writeFile(out, r.bytes)
console.log(`${out} (${r.sizeBytes} bytes, ${r.pictures} pictures)`)
  for (const w of r.warnings) console.log(`warning: ${w}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
