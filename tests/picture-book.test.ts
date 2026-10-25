import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { charactersOnPage, DEFAULT_NEGATIVE, deriveAssets, fallbackNegative, fallbackPrompt, PAGE_FRAMING } from '../src/engine/assets/derive'
import { buildGameData } from '../src/engine/game/emit'
import { lint } from '../src/engine/game/lint'
import { describeAsset, ensureFraming, mergeNegative } from '../src/engine/vn/agents/art-director'
import { backgroundId, backgroundIdFor, pictureBookBackgroundId } from '../src/engine/vn/ids'
import { importPackBook } from '../src/engine/vn/pack'
import { applyStoryOps, buildBook, storyInputSchema, storyOpSchema, storySummary } from '../src/engine/vn/story'
import type { Theme } from '../src/engine/themes/load'
import { isPictureBook, presentationForFormat, presentationOf, projectSettingsSchema, vnBookSchema } from '../src/shared/vn'

/** HUB-17 / VNO-47: picture books are a presentation of a book, one page (scene) per illustration. */

const fixture = path.join(__dirname, 'fixtures', 'books', 'picture-book')
const settings = () => projectSettingsSchema.parse({ slug: 'picture-book', source: '', primaryLang: 'en' })

const TEST_THEME: Theme = {
  name: 'classic-dark',
  label: 'Classic Dark',
  description: '',
  light: false,
  pixel: false,
  colors: { accent: '#3b82f6', background: '#000', text: '#fff', idle: '#aaa', hover: '#fff', selected: '#3b82f6', insensitive: '#555', muted: '#6b7280' },
  fonts: { text: 'DejaVuSans.ttf', name: 'DejaVuSans.ttf', interface: 'DejaVuSans.ttf' },
  sizes: { text: 32, name: 36, interface: 28, label: 28, title: 48, choice: 30 },
  transitions: { show: 0.2, fade: 0.5, dissolve: 0.2 },
  textbox: { color: '#000', opacity: 0.8, borderColor: null, radius: 0 },
  namebox: { color: '#000', opacity: 0.8, radius: 0, textColor: null },
  choice: { color: '#222', borderColor: null, radius: 4 },
  frames: {}
}

describe('presentation (D1)', () => {
  it('comes from the format for a new book, and an old vn.json without it is a visual novel', () => {
    expect(presentationForFormat('kids-picture-book')).toBe('picture-book')
    expect(presentationForFormat('visual-novel')).toBe('visual-novel')
    expect(presentationForFormat('kids-choice-visual-story')).toBe('visual-novel')
    expect(presentationForFormat(undefined)).toBe('visual-novel')
    expect(presentationOf({ format: 'kids-picture-book' })).toBe('picture-book')
    expect(presentationOf({ format: 'kids-picture-book', presentation: 'visual-novel' })).toBe('visual-novel')
    expect(presentationOf({ format: 'visual-novel' })).toBe('visual-novel')
    expect(isPictureBook('kids-picture-book')).toBe(true)
    expect(isPictureBook('visual-novel')).toBe(false)
    expect(isPictureBook({ format: 'kids-picture-book' })).toBe(true)
    expect(isPictureBook({ format: 'visual-novel', presentation: 'picture-book' })).toBe(true)
    // an old file parses and stays a visual novel
    const old = vnBookSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vn', 'linear.book.json'), 'utf8')))
    expect(old.presentation).toBeUndefined()
    expect(presentationOf(old)).toBe('visual-novel')
  })
})

describe('page ids (D3)', () => {
  it('a picture book has one page id per scene; a visual novel keeps place and time', () => {
    expect(pictureBookBackgroundId('ch01.s01')).toBe('bg_ch01_s01')
    expect(pictureBookBackgroundId('ch12.s03')).toBe('bg_ch12_s03')
    expect(backgroundIdFor('picture-book', 'ch01.s02', 'hill', 'The Hill', 'morning')).toBe('bg_ch01_s02')
    expect(backgroundIdFor('visual-novel', 'ch01.s02', 'hill', 'The Hill', 'morning')).toBe('bg_hill_morning')
    expect(backgroundIdFor(undefined, 'ch01.s02', 'hill', 'The Hill', 'morning')).toBe(backgroundId('hill', 'The Hill', 'morning'))
  })
})

describe('the picture-book pack fixture (D1, D3, D4, D5)', () => {
  it('imports as a picture book with a page id per scene and no sprite or CG assets', async () => {
    const { book } = await importPackBook(fixture)
    expect(book).toMatchObject({ slug: 'picture-book', format: 'kids-picture-book', presentation: 'picture-book' })
    const scenes = book.chapters.flatMap((c) => c.scenes)
    expect(scenes.map((s) => s.id)).toEqual(['ch01.s01', 'ch01.s02', 'ch01.s03'])
    expect(scenes.map((s) => s.backgroundId)).toEqual(['bg_ch01_s01', 'bg_ch01_s02', 'bg_ch01_s03'])
    expect(book.chapters[0]!.scenes[0]!.beats[0]).toMatchObject({ type: 'cast', cast: [{ charKey: 'luna' }, { charKey: 'pero' }] })
    expect(charactersOnPage(book, scenes[0]!)).toEqual(['luna', 'pero'])
    expect(charactersOnPage(book, scenes[1]!)).toEqual(['pero'])
    expect(charactersOnPage(book, scenes[2]!)).toEqual([])

    const assets = deriveAssets(book, settings())
    expect(assets.map((a) => a.id)).toEqual(['bg_ch01_s01', 'bg_ch01_s02', 'bg_ch01_s03', 'sheet_luna', 'sheet_pero', 'cover', 'music_01', 'music_02', 'music_03'])
    expect(assets.some((a) => a.id.startsWith('sprite_'))).toBe(false)
    expect(assets.some((a) => a.id.startsWith('cg_'))).toBe(false)
    const by = (id: string) => assets.find((a) => a.id === id)!
    // a page with characters is made by the edit engine from their sheets; a page without them by the generator
    expect(by('bg_ch01_s01')).toMatchObject({ kind: 'background', engine: 'qwen-image-2.1-edit', refs: ['sheet_luna', 'sheet_pero'], size: { w: 1664, h: 928 } })
    expect(by('bg_ch01_s02')).toMatchObject({ engine: 'qwen-image-2.1-edit', refs: ['sheet_pero'] })
    expect(by('bg_ch01_s03')).toMatchObject({ engine: 'qwen-image-2.1' })
    expect(by('bg_ch01_s03').refs).toBeUndefined()
    // the sheets stay as internal references
    expect(by('sheet_luna')).toMatchObject({ kind: 'sheet', size: { w: 928, h: 1664 } })
  })

  it('page prompts draw the characters into the illustration, and the negatives no longer ban people', async () => {
    const { book } = await importPackBook(fixture)
    const page1 = fallbackPrompt({ id: 'bg_ch01_s01', kind: 'background' }, book)
    // the style keeps its character words, and neither the place nor the scene description loses its people
    expect(page1).toContain('soft watercolor illustration')
    expect(page1).toContain('cute friendly characters')
    expect(page1).toContain('A green hill with tall grass and one crooked apple tree.')
    expect(page1).toContain('Luna runs up the green hill')
    expect(page1).toContain('two different people')
    expect(page1).toContain('on the left: Luna')
    expect(page1).toContain('on the right: Pero')
    expect(page1).toContain('A small girl with two dark braids')
    expect(page1).toContain('A round grey cat with green eyes')
    expect(page1).not.toMatch(/empty environment|no people|no characters|no creatures|no animals/i)
    expect(page1).toContain("children's picture book illustration")
    expect(page1).toContain('no text')
    expect(PAGE_FRAMING).toContain('full-bleed')
    // one person: named with their looks, no "different people" clause
    const page2 = fallbackPrompt({ id: 'bg_ch01_s02', kind: 'background' }, book)
    expect(page2).toContain('Pero (A round grey cat with green eyes and a red scarf)')
    expect(page2).not.toContain('different people')
    // no one in the landscape page
    const page3 = fallbackPrompt({ id: 'bg_ch01_s03', kind: 'background' }, book)
    expect(page3).not.toContain('different people')
    expect(page3).toContain('A warm kitchen with a stove and a round window.')
    // sheets keep their own framing
    expect(fallbackPrompt({ id: 'sheet_luna', kind: 'sheet' }, book)).toContain('single character, one full-body figure only')

    // negatives: a page keeps people, a visual-novel background keeps its people ban, byte for byte
    const pageNegative = fallbackNegative('background', { pictureBook: true })
    expect(pageNegative).toContain('watermark')
    expect(pageNegative).not.toMatch(/\b(person|people|characters?|creatures?|animals?)\b/i)
    expect(pageNegative).toContain(DEFAULT_NEGATIVE)
    expect(fallbackNegative('background')).toBe(`${DEFAULT_NEGATIVE}, person, people, character, creature, animal`)
    expect(fallbackNegative('background', {})).toBe(fallbackNegative('background'))
  })

  it('the art-director is told the page shows people and cannot reintroduce an empty background', async () => {
    const { book } = await importPackBook(fixture)
    const described = describeAsset(book, { id: 'bg_ch01_s01', kind: 'background' })
    expect(String(described.kind)).toContain('picture-book page')
    expect(String(described.kind)).toContain('not an empty background')
    expect(String(described.placeLooks)).toContain('tall grass')
    expect(described.people).toEqual([
      { name: 'Luna', looks: 'A small girl with two dark braids, a red coat and yellow boots' },
      { name: 'Pero', looks: 'A round grey cat with green eyes and a red scarf' }
    ])
    expect(described.framing).toBe(PAGE_FRAMING)

    // an agent that wrote the old empty-background words gets them taken out, the cast named and the page framing added
    const fixed = ensureFraming('background', 'bg_ch01_s01', 'empty environment, no people, a green hill', book)
    expect(fixed).not.toMatch(/empty environment|no people/i)
    expect(fixed).toContain('two different people')
    expect(fixed).toContain("children's picture book illustration")
    // a visual-novel background still gets the empty-place framing
    expect(ensureFraming('background', 'bg_x_any', 'a cave')).toContain('empty environment')
    const negative = mergeNegative('extra limbs', 'background', { pictureBook: true })
    expect(negative).not.toMatch(/\bpeople\b/i)
    expect(mergeNegative('extra limbs', 'background')).toContain('people')
  })

  it('buildGameData reports the presentation, one background per page, and no sprites or CGs', async () => {
    const { book, edition } = await importPackBook(fixture)
    const gd = buildGameData({ book, theme: TEST_THEME, primaryEdition: edition })
    expect(gd.presentation).toBe('picture-book')
    const scenes = gd.chapters.flatMap((c) => c.scenes)
    expect(scenes.map((s) => s.bgPath)).toEqual(['images/bg ch01_s01.webp', 'images/bg ch01_s02.webp', 'images/bg ch01_s03.webp'])
    expect(Object.keys(gd.backgrounds).sort()).toEqual(['bg_ch01_s01', 'bg_ch01_s02', 'bg_ch01_s03'])
    expect(gd.cgs).toEqual({})
    for (const c of Object.values(gd.characters)) expect(c.sprites).toEqual({})
    // the text is on the beats (there is no per-page text field)
    expect(scenes.map((s) => s.beats.filter((b) => b.type === 'narration').map((b) => b.text))).toEqual([
      ['Luna ran up the hill, and Pero ran after her.'],
      ['**Pero** climbed the crooked apple tree.'],
      ['Then they went home for breakfast.']
    ])
    expect(scenes[0]!.beats.some((b) => (b.html ?? '').includes('<strong>'))).toBe(false)
    expect(scenes[1]!.beats.find((b) => b.type === 'narration')!.html).toContain('<strong>Pero</strong>')
  })
})

describe('story operations for a picture book (D1, D3)', () => {
  const story = () =>
    storyInputSchema.parse({
      title: 'Pip and the Puddle',
      format: 'kids-picture-book',
      characters: [{ key: 'pip', name: 'Pip', looks: 'a small duck with a blue hat' }],
      places: [
        { key: 'pond', name: 'Pond', looks: 'a quiet pond' },
        { key: 'barn', name: 'Barn', looks: 'a red barn' }
      ],
      chapters: [
        {
          title: 'One',
          scenes: [
            { place: 'pond', time: 'morning', beats: [{ cast: ['pip'] }, { text: 'Pip found a puddle.' }] },
            { place: 'pond', time: 'morning', beats: [{ text: 'It was cold.' }] }
          ]
        }
      ]
    })

  it('a book made from JSON gets page ids, and the summary reports the presentation', () => {
    const book = buildBook(story(), { slug: 'pip', lang: 'en' }).book
    expect(book.presentation).toBe('picture-book')
    expect(book.chapters[0]!.scenes.map((s) => s.backgroundId)).toEqual(['bg_ch01_s01', 'bg_ch01_s02'])
    expect(storySummary(book)).toMatchObject({ presentation: 'picture-book', format: 'kids-picture-book', scenes: 2 })
    // an explicit presentation overrides the format
    const visual = buildBook(storyInputSchema.parse({ ...story(), presentation: 'visual-novel' }), { slug: 'pip2', lang: 'en' }).book
    expect(visual.presentation).toBe('visual-novel')
    expect(visual.chapters[0]!.scenes.map((s) => s.backgroundId)).toEqual(['bg_pond_morning', 'bg_pond_morning'])
  })

  it('book.update changes the presentation and recomputes every page id; scene updates keep the page id', () => {
    const book = buildBook(story(), { slug: 'pip', lang: 'en' }).book
    // a place change inside a picture book does not change the page picture
    const moved = applyStoryOps(book, [storyOpSchema.parse({ op: 'scene.update', sceneId: 'ch01.s02', place: 'barn' })]).book
    expect(moved.chapters[0]!.scenes[1]).toMatchObject({ placeKey: 'barn', backgroundId: 'bg_ch01_s02' })

    const visual = applyStoryOps(book, [storyOpSchema.parse({ op: 'book.update', presentation: 'visual-novel' })])
    expect(visual.book.presentation).toBe('visual-novel')
    expect(visual.book.chapters[0]!.scenes.map((s) => s.backgroundId)).toEqual(['bg_pond_morning', 'bg_pond_morning'])
    // every new background id is in the affected set, so their prompts are planned again
    expect(visual.affected.backgrounds).toEqual(expect.arrayContaining(['bg_pond_morning']))
    // and back: one page per scene again
    const back = applyStoryOps(visual.book, [storyOpSchema.parse({ op: 'book.update', presentation: 'picture-book' })])
    expect(back.book.chapters[0]!.scenes.map((s) => s.backgroundId)).toEqual(['bg_ch01_s01', 'bg_ch01_s02'])
    expect(back.affected.backgrounds).toEqual(expect.arrayContaining(['bg_ch01_s01', 'bg_ch01_s02']))
    // the format alone can turn a book into a picture book
    const byFormat = applyStoryOps(book, [storyOpSchema.parse({ op: 'book.update', format: 'visual-novel', presentation: 'visual-novel' })])
    expect(byFormat.book.presentation).toBe('visual-novel')
    expect(storySummary(byFormat.book).presentation).toBe('visual-novel')
  })
})

describe('lint of a picture book (D9 checks)', () => {
  function bundle(data: Record<string, unknown>, images: string[] = []): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-pb-lint-'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html>')
    fs.writeFileSync(path.join(dir, 'player.js'), '// player')
    fs.writeFileSync(path.join(dir, 'player.css'), '/* css */')
    fs.writeFileSync(path.join(dir, 'game-data.json'), JSON.stringify(data))
    for (const rel of images) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), 'img')
    }
    return dir
  }

  const pageScene = (id: string, text: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    label: id,
    title: 'A page',
    locationKey: null,
    bgPath: `images/bg ${id.replace(/\./g, '_')}.webp`,
    transition: 'fade',
    music: null,
    ambience: null,
    beats: text === null ? [{ id: `${id}.b001`, type: 'narration' }] : [{ id: `${id}.b001`, type: 'narration', text }],
    ...extra
  })

  it('a clean picture book lints clean and its statistics say pages', async () => {
    const scenes = [pageScene('ch01.s01', 'Pip found a puddle.'), pageScene('ch01.s02', 'It was cold.')]
    const dir = bundle(
      { title: 'Pip', presentation: 'picture-book', characters: {}, cgs: {}, chapters: [{ number: 1, title: 'One', scenes }], audio: { music: {}, sfx: {}, ambience: {} } },
      scenes.map((s) => s.bgPath)
    )
    try {
      const res = await lint(dir)
      expect(res.ok).toBe(true)
      expect(res.messages).toEqual([])
      expect(res.warnings).toEqual([])
      expect(res.statistics).toContain('The game contains 2 pages')
      expect(res.statistics).toContain('per page')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a page without an illustration is an error; a page without text, left-over sprites and CGs are warnings', async () => {
    const scenes = [
      pageScene('ch01.s01', 'Pip found a puddle.', { bgPath: null }),
      pageScene('ch01.s02', null),
      {
        ...pageScene('ch01.s03', 'The barn was warm.'),
        beats: [{ id: 'ch01.s03.b001', type: 'narration', text: 'The barn was warm.', stage: { cg: 'sunset' } }]
      }
    ]
    const dir = bundle(
      {
        title: 'Pip',
        presentation: 'picture-book',
        characters: { pip: { id: 'pip', varName: 'pip', displayName: 'Pip', color: '#fff', expressions: ['neutral'], sprites: { neutral: 'images/pip neutral.webp' } } },
        cgs: { sunset: { path: 'images/cg sunset.webp', display: 'full' } },
        chapters: [{ number: 1, title: 'One', scenes }],
        audio: { music: {}, sfx: {}, ambience: {} }
      },
      ['images/bg ch01_s02.webp', 'images/bg ch01_s03.webp']
    )
    try {
      const res = await lint(dir)
      expect(res.ok).toBe(false)
      expect(res.messages.join('\n')).toContain('Page ch01.s01: no illustration')
      expect(res.warnings.join('\n')).toContain('Page ch01.s02: no text')
      expect(res.warnings.join('\n')).toContain('Page ch01.s03: shows a CG or insert cue')
      expect(res.warnings.join('\n')).toContain('1 sprite(s)')
      expect(res.warnings.join('\n')).toContain('CG(s)')
      expect(res.statistics).toContain('The game contains 3 pages')
      // the warnings are in the lint output but do not fail the run by themselves
      expect(res.output).toContain('warning: Page ch01.s02: no text')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a visual-novel bundle keeps its dialogue-block statistics', async () => {
    const dir = bundle({
      title: 'VN',
      chapters: [{ number: 1, title: 'One', scenes: [{ id: 'ch01.s01', beats: [{ id: 'ch01.s01.b001', type: 'narration', text: 'Once upon a time.' }] }] }]
    })
    try {
      const res = await lint(dir)
      expect(res.ok).toBe(true)
      expect(res.statistics).toContain('1 dialogue blocks')
      expect(res.statistics).not.toContain('pages')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
