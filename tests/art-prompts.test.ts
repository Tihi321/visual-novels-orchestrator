import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { defaultStylePrompt, fallbackNegative, fallbackPrompt, peopleClause, resolveStylePrompt, visualLooks, withoutCharacterSentences } from '../src/engine/assets/derive'
import { keepMainSubject } from '../src/engine/assets/postprocess'
import { describeAsset, ensureFraming } from '../src/engine/vn/agents/art-director'
import { importBook } from '../src/engine/vn/import'
import { projectSettingsSchema } from '../src/shared/vn'

const soother = () => importBook(path.resolve(__dirname, 'fixtures/books/soother'))

describe('a CG with two or three characters names each person (VNO-34)', () => {
  const book = {
    characters: [
      { key: 'mara', name: 'Mara', looks: 'A girl of fourteen with red braids and a huge yellow raincoat.' },
      { key: 'ivka', name: 'Ivka', looks: 'An old woman with a grey bun and an orange life jacket.' },
      { key: 'dino', name: 'Dino', looks: 'A stocky man in a collared jacket.' }
    ],
    images: [
      { key: 'two', description: 'Mara reading the sheet aloud, Ivka very still beside her', display: 'full', characters: ['mara', 'ivka'] },
      { key: 'three', description: 'the three walk the causeway', display: 'full', characters: ['mara', 'ivka', 'dino'] },
      { key: 'one', description: 'Mara at the rail', display: 'full', characters: ['mara'] },
      { key: 'sheet', description: 'a sheet headed FOR IVKA', display: 'insert', characters: ['mara', 'ivka'] }
    ],
    format: 'novel',
    style: '',
    places: [],
    chapters: []
  } as never

  it('the clause says how many different people, who is where, and which reference image is whom, in the order of the characters', () => {
    const c = peopleClause(book, ['mara', 'ivka'])
    expect(c).toMatch(/^two different people/)
    expect(c).toContain('on the left: Mara (A girl of fourteen with red braids')
    expect(c).toContain('on the right: Ivka (An old woman')
    expect(c).toContain('image 1 is Mara, image 2 is Ivka')
    expect(c.indexOf('Mara')).toBeLessThan(c.indexOf('Ivka'))
    const three = peopleClause(book, ['mara', 'ivka', 'dino'])
    expect(three).toMatch(/^three different people/)
    expect(three).toContain('in the middle: Ivka')
    expect(three).toContain('on the right: Dino')
    expect(three).toContain('image 3 is Dino')
    expect(peopleClause(book, ['mara'])).toBe('')
    expect(peopleClause(book, [])).toBe('')
  })

  it('an agent prompt for a CG with two characters gets the clause once; one character, an insert and a prompt that has it are left alone', () => {
    const a = ensureFraming('cg', 'cg_two', 'Mara reading, Ivka beside her', book)
    expect(a).toContain('two different people')
    expect(a).toContain('image 2 is Ivka')
    expect(ensureFraming('cg', 'cg_two', a, book)).toBe(a)
    expect(ensureFraming('cg', 'cg_one', 'Mara at the rail', book)).toBe('Mara at the rail')
    expect(ensureFraming('cg', 'cg_sheet', 'a sheet, close-up', book)).toBe('a sheet, close-up')
  })

  it('the fallback prompt of a CG with several characters has the clause instead of the bare looks', () => {
    const p = fallbackPrompt({ id: 'cg_three', kind: 'cg' }, book)
    expect(p).toContain('three different people')
    expect(p).toContain('on the left: Mara')
    expect(fallbackPrompt({ id: 'cg_one', kind: 'cg' }, book)).not.toContain('different people')
  })
})

describe('art prompts', () => {
  it('keeps only the visual sentences of a bible entry', async () => {
    const { book } = await soother()
    const petra = book.characters.find((c) => c.key === 'petra')!
    const v = visualLooks(petra.looks)
    expect(v).toContain('yellow raincoat')
    expect(v).toContain('green eyes')
    expect(v).not.toMatch(/brave|favourite|loves|baby brother/i)
    expect(visualLooks('She is brave, quick to fix mistakes. He loves shiny things. Tall, with a red coat.')).toBe('Tall, with a red coat')
    expect(visualLooks(undefined)).toBe('')
  })

  it('the style comes from the format, genre and art mode, never from the bible Style note', async () => {
    const { book } = await soother()
    expect(book.style).toMatch(/SCENE/)
    const settings = projectSettingsSchema.parse({ slug: 'x', source: 'x', primaryLang: 'en' })
    expect(resolveStylePrompt(book, settings)).toBe('soft watercolor illustration, gentle warm colors, clean simple shapes, cute friendly characters')
    expect(defaultStylePrompt({ format: 'visual-novel', genre: 'mystery' })).toMatch(/moody/)
    expect(defaultStylePrompt({ format: 'visual-novel' }, true)).toMatch(/pixel art/)
    const custom = projectSettingsSchema.parse({ slug: 'x', source: 'x', primaryLang: 'en', art: { stylePrompt: 'ink wash' } })
    expect(resolveStylePrompt(book, custom)).toBe('ink wash')
    for (const a of ['sheet_petra', 'bg_golden_cave_afternoon', 'cover']) {
      const kind = a === 'cover' ? 'cover' : a.startsWith('sheet') ? 'sheet' : 'background'
      const p = fallbackPrompt({ id: a, kind }, book)
      expect(p, a).not.toMatch(/SCENE|ON SCREEN|short sentences|ages 6-9/)
      expect(p, a).toContain('soft watercolor illustration')
      expect(fallbackPrompt({ id: a, kind }, book, { stylePrompt: 'ink wash' }), a).toContain('ink wash')
    }
  })

  it('sheet, sprite and background prompts keep to one figure or an empty place', async () => {
    const { book } = await soother()
    const sheet = fallbackPrompt({ id: 'sheet_petra', kind: 'sheet' }, book)
    expect(sheet).toContain('single character, one full-body figure only, front view, standing, centered, plain white background')
    expect(sheet).not.toMatch(/design sheet|brave/i)
    expect(fallbackNegative('sheet')).toMatch(/character sheet, turnaround, model sheet, multiple views, collage, panels, labels, captions/)
    const sprite = fallbackPrompt({ id: 'sprite_petra_happy', kind: 'sprite' }, book)
    expect(sprite).toContain('Show only this one character as a single full-body figure, centered, facing the viewer, happy facial expression, plain pure white background, nothing else')
    const bg = fallbackPrompt({ id: 'bg_golden_cave_afternoon', kind: 'background' }, book)
    expect(bg).toContain('empty environment, no people, no characters, no creatures, no animals')
    for (const c of book.characters) expect(bg.toLowerCase()).not.toContain(c.name.toLowerCase())
    expect(bg).not.toContain('cute friendly characters') // the style words for a background leave the characters out
    expect(fallbackNegative('background')).toMatch(/person.*character.*creature.*animal/)
    // an agent's prompt that forgot the framing gets it
    expect(ensureFraming('sheet', 'sheet_petra', 'a girl in a yellow raincoat')).toContain('one full-body figure only')
    expect(ensureFraming('background', 'bg_x', 'a cave')).toContain('no people')
    expect(ensureFraming('sprite', 'sprite_petra_sad', 'same character, sad')).toContain('sad facial expression')
  })

  it('a place description with a character name in it keeps the rest of the place (VNO-31)', async () => {
    const { book } = await soother()
    const people = { characters: [{ key: 'moreau', name: 'Moreau' }, { key: 'ines', name: 'Inès' }] } as never
    // one long sentence whose head names a character as part of the place ("the Moreau house", "Inès's atelier")
    const salon = 'Indoors, a long salon in the Moreau house: cream panelled walls covered with clocks, a crystal chandelier, rows of gold chairs; tall windows onto a snowy courtyard. Warm golden light.'
    expect(withoutCharacterSentences(salon, people)).toBe('cream panelled walls covered with clocks, a crystal chandelier, rows of gold chairs; tall windows onto a snowy courtyard. Warm golden light.')
    const atelier = "Indoors, Inès's restoration atelier on a top floor: a big slanted skylight with night sky, easels, a worktable of brushes; plaster walls, warm lamplight."
    expect(withoutCharacterSentences(atelier, people)).toBe('a big slanted skylight with night sky, easels, a worktable of brushes; plaster walls, warm lamplight.')
    // a sentence about a person and no colon is still left out whole, and a clause naming one is cut
    expect(withoutCharacterSentences('A tall hall. Moreau stands at the lectern, gloved. Snow at the windows.', people)).toBe('A tall hall. Snow at the windows.')
    expect(withoutCharacterSentences('A cellar: Inès sits on a crate; barrels along the wall.', people)).toBe('A cellar: barrels along the wall.')
    // the art-director's task carries the place's looks
    const b = { ...book, characters: [...book.characters, { ...book.characters[0]!, key: 'moreau', name: 'Moreau' }], places: [{ key: 'salon', name: 'Salon', looks: salon }], chapters: [{ ...book.chapters[0]!, scenes: [{ ...book.chapters[0]!.scenes[0]!, backgroundId: 'bg_salon_any', placeKey: 'salon', description: '' }] }] }
    expect(describeAsset(b, { id: 'bg_salon_any', kind: 'background' }).placeLooks).toContain('cream panelled walls')
  })

  it('keepMainSubject drops stray islands and a second figure but keeps pieces next to the figure', async () => {
    const W = 200
    const H = 300
    const box = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const png = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: await box(60, 200), left: 70, top: 60 }, // the figure
        { input: await box(20, 14), left: 100, top: 44 }, // a hat just above it, inside the grown box
        { input: await box(12, 12), left: 5, top: 5 }, // a stray island far away
        { input: await box(40, 50), left: 150, top: 240 } // a second blob, outside, not small enough to ignore by area alone
      ])
      .png()
      .toBuffer()
    const out = await keepMainSubject(png)
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!
    expect(alpha(100, 150)).toBe(255) // figure
    expect(alpha(105, 50)).toBe(255) // hat
    expect(alpha(8, 8)).toBe(0) // island
    expect(alpha(170, 260)).toBe(0) // second blob
  })
})
