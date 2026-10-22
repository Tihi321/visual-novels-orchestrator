import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import type { ToolResult } from '../src/engine/mcp/tools'
import { applyStoryOps, buildBook, storyInputSchema, storyOpSchema, syncEdition, validateBook } from '../src/engine/vn/story'
import type { StoryInput } from '../src/engine/vn/story'
import type { VnBook } from '../src/shared/vn'
import { failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/** A small book with choices: two characters, two places, three chapters, two endings. */
const input = (): StoryInput =>
  storyInputSchema.parse({
    title: 'The Harbour Light',
    author: 'A. Writer',
    characters: [
      { name: 'Mara', looks: 'a girl with a red raincoat and short black hair' },
      { key: 'tom', name: 'Old Tom', looks: 'an old fisherman with a white beard' }
    ],
    places: [
      { key: 'harbour', name: 'The Harbour', looks: 'small stone harbour with boats' },
      { name: 'Lighthouse', looks: 'a tall white lighthouse' }
    ],
    coverBrief: 'a girl at a lighthouse',
    chapters: [
      {
        title: 'The Harbour',
        scenes: [
          {
            place: 'the harbour',
            time: 'dusk',
            description: 'Boats rock in the evening light.',
            beats: [
              { cast: ['mara', 'Old Tom'] },
              { speaker: 'Mara', expression: 'happy', text: 'Hello, Tom!' },
              { speaker: 'tom', expression: 'grinning', text: 'Hello there, little one.' },
              { text: 'The sea was calm.' },
              { speaker: 'Gull', text: 'Squawk.' }
            ]
          }
        ],
        choices: [
          { text: 'Climb the lighthouse', to: 2 },
          { text: 'Stay by the boats', to: 3 }
        ]
      },
      { title: 'The Light', scenes: [{ place: 'lighthouse', time: 'night', beats: [{ speaker: 'mara', text: 'It is so bright.' }] }], ending: 'Mara found the light.' },
      { title: 'The Boats', scenes: [{ place: 'on a small boat', beats: [{ text: 'The tide came in.' }] }] }
    ]
  })

const make = (): VnBook => buildBook(input(), { slug: 'harbour', lang: 'en' }).book

describe('buildBook', () => {
  it('makes keys, ids, matches places and speakers and maps expressions', () => {
    const { book, warnings } = buildBook(input(), { slug: 'harbour', lang: 'en' })
    expect(book.characters.map((c) => c.key)).toEqual(['mara', 'tom'])
    expect(book.places.map((p) => p.key)).toEqual(['harbour', 'lighthouse'])
    expect(book.chapters.map((c) => c.n)).toEqual([1, 2, 3])
    const s1 = book.chapters[0]!.scenes[0]!
    expect(s1).toMatchObject({ id: 'ch01.s01', placeKey: 'harbour', placeText: 'The Harbour', time: 'dusk', backgroundId: 'bg_harbour_dusk' })
    expect(s1.beats.map((b) => b.id)).toEqual(['ch01.s01.b001', 'ch01.s01.b002', 'ch01.s01.b003', 'ch01.s01.b004', 'ch01.s01.b005'])
    expect(s1.beats[0]).toMatchObject({ type: 'cast', cast: [{ charKey: 'mara' }, { charKey: 'tom' }] })
    expect(s1.beats[1]).toMatchObject({ type: 'line', speakerKey: 'mara', speakerLabel: 'Mara', expression: 'happy' })
    expect(s1.beats[2]).toMatchObject({ speakerKey: 'tom', speakerLabel: 'Old Tom', expression: 'happy', rawExpression: 'grinning' })
    expect(s1.beats[3]).toMatchObject({ type: 'narration' })
    expect(s1.beats[4]).toMatchObject({ speakerKey: null, speakerLabel: 'Gull', expression: 'neutral' })
    const boat = book.chapters[2]!.scenes[0]!
    expect(boat).toMatchObject({ placeKey: null, placeText: 'on a small boat', backgroundId: 'bg_on_a_small_boat_any' })
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('Gull'), expect.stringContaining('1 scene(s) have a place')]))
    expect(book.warnings).toEqual(warnings)
  })

  it('decides the kind, the format and the endings', () => {
    const { book } = buildBook(input(), { slug: 'x', lang: 'en' })
    expect(book).toMatchObject({ kind: 'choice', format: 'choice-visual-novel', primaryLang: 'en', author: 'A. Writer' })
    expect(book.chapters.map((c) => c.ending)).toEqual([null, 'Mara found the light.', 'The End'])
    expect(book.warnings.join('\n')).toContain('chapter 3 has no choices and no ending text')

    const linear = buildBook({ ...input(), chapters: [{ title: 'One', scenes: [], ending: 'x' }, { title: 'Two', scenes: [] }] }, { slug: 'x', lang: 'en' }).book
    expect(linear).toMatchObject({ kind: 'linear', format: 'visual-novel' })
    expect(linear.chapters.map((c) => c.ending)).toEqual([null, ''])
    expect(() => buildBook({ ...input(), kind: 'linear' }, { slug: 'x', lang: 'en' })).toThrow(/kind is "linear"/)
    expect(() => buildBook({ ...input(), kind: 'choice', chapters: [{ title: 'One', scenes: [] }] }, { slug: 'x', lang: 'en' })).toThrow(/no chapter has choices/)
  })

  it('rejects bad keys, repeated keys, a bad choice and an unknown cast member', () => {
    const build = (patch: Partial<StoryInput>) => () => buildBook({ ...input(), ...patch }, { slug: 'x', lang: 'en' })
    expect(build({ characters: [{ name: 'A', key: 'mara' }, { name: 'B', key: 'mara' }] })).toThrow(/two characters have the key "mara"/)
    expect(build({ characters: [{ name: 'A', key: 'Mara!' }] })).toThrow(/must be lowercase/)
    expect(build({ chapters: [{ title: 'A', scenes: [], choices: [{ text: 'go', to: 9 }] }] })).toThrow(/leads to chapter 9/)
    expect(build({ chapters: [{ title: 'A', scenes: [{ place: 'p', beats: [{ cast: ['nobody'] }] }] }] })).toThrow(/cast member "nobody"/)
    expect(build({ chapters: [{ n: 1, title: 'A', scenes: [] }, { n: 1, title: 'B', scenes: [] }] })).toThrow(/chapter number "1" is used twice/)
    expect(build({ chapters: [{ title: 'A', scenes: [{ place: 'p', beats: [{ speaker: 'Mara' }] }] }] })).toThrow(/needs text/)
    expect(build({ chapters: [{ title: 'A', choices: [{ text: 'go', to: 1 }], ending: 'The end', scenes: [] }] })).toThrow(/choices and an ending/)
  })

  it('warns about unreachable chapters, empty scenes and a book that never ends', () => {
    const v = validateBook({ ...make(), chapters: make().chapters.map((c) => ({ ...c, choices: c.n === 1 ? [{ text: 'a', to: 2 }] : c.choices })) })
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual(expect.arrayContaining(['chapter 3 is not reached by any choice']))
    const b = make()
    b.chapters.forEach((c) => (c.choices = [{ text: 'again', to: 1 }]))
    b.chapters.forEach((c) => (c.ending = null))
    b.chapters[1]!.scenes[0]!.beats = []
    expect(validateBook(b).warnings).toEqual(expect.arrayContaining(['no chapter ends the game: every chapter has choices', 'ch02.s01 has no beats']))
  })
})

describe('applyStoryOps', () => {
  const apply = (ops: object[], book = make()) => applyStoryOps(book, ops.map((o) => storyOpSchema.parse(o)))

  it('adds beats and scenes with the next free id, wherever they go', () => {
    const r = apply([
      { op: 'beat.add', sceneId: 'ch01.s01', after: 'ch01.s01.b001', beats: [{ speaker: 'mara', text: 'Inserted.' }] },
      { op: 'beat.add', sceneId: 'ch01.s01', at: 0, beats: [{ text: 'First.' }, { text: 'Second.' }] },
      { op: 'scene.add', chapter: 1, at: 0, scene: { place: 'harbour', beats: [{ text: 'Before.' }] } }
    ])
    const ch = r.book.chapters[0]!
    expect(ch.scenes.map((s) => s.id)).toEqual(['ch01.s02', 'ch01.s01'])
    expect(ch.scenes[1]!.beats.map((b) => b.id)).toEqual(['ch01.s01.b007', 'ch01.s01.b008', 'ch01.s01.b001', 'ch01.s01.b006', 'ch01.s01.b002', 'ch01.s01.b003', 'ch01.s01.b004', 'ch01.s01.b005'])
    expect(r.created).toEqual(['ch01.s01.b006', 'ch01.s01.b007', 'ch01.s01.b008', 'ch01.s02', 'ch01.s02.b001'])
    // removing the last one and adding again never changes the others
    const r2 = applyStoryOps(r.book, [{ op: 'beat.remove', beatIds: ['ch01.s01.b003'] }, { op: 'beat.add', sceneId: 'ch01.s01', beats: [{ text: 'End.' }] }])
    expect(r2.book.chapters[0]!.scenes[1]!.beats.map((b) => b.id)).toContain('ch01.s01.b009')
    expect(r2.book.chapters[0]!.scenes[1]!.beats.map((b) => b.id)).not.toContain('ch01.s01.b003')
  })

  it('makes the background follow the place and the time', () => {
    const r = apply([{ op: 'scene.update', sceneId: 'ch01.s01', place: 'Lighthouse', time: 'night' }])
    expect(r.book.chapters[0]!.scenes[0]).toMatchObject({ placeKey: 'lighthouse', placeText: 'Lighthouse', time: 'night', backgroundId: 'bg_lighthouse_night' })
    expect(r.affected.backgrounds).toEqual(['bg_lighthouse_night'])
    expect(apply([{ op: 'scene.update', sceneId: 'ch01.s01', time: null }]).book.chapters[0]!.scenes[0]!.backgroundId).toBe('bg_harbour_any')
    expect(apply([{ op: 'scene.update', sceneId: 'ch01.s01', description: 'Rain.' }]).book.chapters[0]!.scenes[0]!.backgroundId).toBe('bg_harbour_dusk')
  })

  it('upserts characters and places, and keeps lines in step', () => {
    const r = apply([
      { op: 'character.set', key: 'tom', name: 'Tom the Fisher', looks: 'a fisherman' },
      { op: 'character.set', name: 'Gull', looks: 'a grey gull' },
      { op: 'place.set', name: 'On a small boat', looks: 'a wooden boat' },
      { op: 'beat.update', beatId: 'ch01.s01.b003', expression: 'angry', text: 'Go away.' }
    ])
    expect(r.book.characters.map((c) => [c.key, c.name])).toEqual([['mara', 'Mara'], ['tom', 'Tom the Fisher'], ['gull', 'Gull']])
    const beats = r.book.chapters[0]!.scenes[0]!.beats
    expect(beats[2]).toMatchObject({ speakerLabel: 'Tom the Fisher', expression: 'angry', text: 'Go away.' })
    expect(beats[4]).toMatchObject({ speakerKey: 'gull', speakerLabel: 'Gull' }) // it spoke before it existed
    expect(r.book.chapters[2]!.scenes[0]).toMatchObject({ placeKey: 'on_a_small_boat', backgroundId: 'bg_on_a_small_boat_any' })
    expect(r.created).toEqual(['character gull', 'place on_a_small_boat'])
    expect(r.affected.chars).toEqual(['tom', 'gull'])
    expect(r.affected.backgrounds).toEqual(['bg_on_a_small_boat_any'])
    expect(() => apply([{ op: 'character.set', key: 'zed' }])).toThrow(/give a name to create it/)
  })

  it('guards removals and lets force through', () => {
    expect(() => apply([{ op: 'character.remove', key: 'tom' }])).toThrow(/operation 1 \(character\.remove\): character "tom" is used by 2 beat/)
    expect(() => apply([{ op: 'place.remove', key: 'harbour' }])).toThrow(/used by 1 scene\(s\) \(ch01\.s01\)/)
    expect(() => apply([{ op: 'chapter.remove', n: 2 }])).toThrow(/a choice in chapter 1 still leads to chapter 2/)
    const r = apply([
      { op: 'character.remove', key: 'tom', force: true },
      { op: 'place.remove', key: 'harbour', force: true },
      { op: 'chapter.update', n: 1, choices: [{ text: 'Stay', to: 3 }] },
      { op: 'chapter.remove', n: 2 }
    ])
    const beats = r.book.chapters[0]!.scenes[0]!.beats
    expect(beats[0]).toMatchObject({ cast: [{ charKey: 'mara' }] })
    expect(beats[2]).toMatchObject({ speakerKey: null, speakerLabel: 'Old Tom' })
    expect(r.book.chapters[0]!.scenes[0]).toMatchObject({ placeKey: null, placeText: 'The Harbour', backgroundId: 'bg_the_harbour_dusk' })
    expect(r.book.chapters.map((c) => c.n)).toEqual([1, 3])
    expect(validateBook(r.book).errors).toEqual([])
  })

  it('adds and changes chapters: numbers, endings, kind', () => {
    const r = apply([
      { op: 'chapter.add', chapter: { title: 'Epilogue', ending: 'Home.', scenes: [{ place: 'harbour', beats: [{ text: 'Done.' }] }] } },
      { op: 'chapter.add', n: 10, after: 1, chapter: { title: 'Side', scenes: [] } },
      { op: 'chapter.update', n: 2, title: 'The Bright Light' }
    ])
    expect(r.book.chapters.map((c) => c.n)).toEqual([1, 10, 2, 3, 4])
    expect(r.book.chapters[4]!.scenes[0]!.id).toBe('ch04.s01')
    expect(r.book.chapters[2]!.title).toBe('The Bright Light')
    expect(() => apply([{ op: 'chapter.add', n: 2, chapter: { title: 'x', scenes: [] } }])).toThrow(/chapter 2 already exists/)

    // choices removed everywhere: the book becomes linear and only the last chapter ends
    const lin = apply([{ op: 'chapter.update', n: 1, choices: [] }])
    expect(lin.book).toMatchObject({ kind: 'linear', format: 'visual-novel' })
    expect(lin.book.chapters.map((c) => c.ending)).toEqual([null, null, 'The End'])
    // choices added to a linear book make it a choice book
    const back = applyStoryOps(lin.book, [{ op: 'chapter.update', n: 1, choices: [{ text: 'a', to: 2 }, { text: 'b', to: 3 }] }])
    expect(back.book).toMatchObject({ kind: 'choice', format: 'choice-visual-novel' })
  })

  it('edits books, scenes and cast beats, and refuses a field the beat has not', () => {
    const r = apply([
      { op: 'book.update', title: 'New Title', genre: 'adventure', author: null, coverBrief: 'a storm' },
      { op: 'beat.update', beatId: 'ch01.s01.b001', cast: ['mara'] },
      { op: 'scene.remove', sceneId: 'ch03.s01' }
    ])
    expect(r.book).toMatchObject({ title: 'New Title', genre: 'adventure', coverBrief: 'a storm' })
    expect(r.book.author).toBeUndefined()
    expect(r.book.chapters[0]!.scenes[0]!.beats[0]).toMatchObject({ type: 'cast', cast: [{ charKey: 'mara' }] })
    expect(r.book.chapters[2]!.scenes).toEqual([])
    expect(r.affected.cover).toBe(true)
    expect(() => apply([{ op: 'beat.update', beatId: 'ch01.s01.b004', speaker: 'mara' }])).toThrow(/a narration beat has no speaker/)
    expect(() => apply([{ op: 'beat.update', beatId: 'ch01.s01.b999', text: 'x' }])).toThrow(/no beat "ch01.s01.b999"/)
  })

  it('does not change the book it is given', () => {
    const book = make()
    const before = JSON.stringify(book)
    apply([{ op: 'chapter.update', n: 1, choices: [{ text: 'a', to: 2 }] }, { op: 'chapter.remove', n: 3 }], book)
    expect(JSON.stringify(book)).toBe(before)
  })

  it('syncs another edition: drops removed text, keeps the rest, adds new names', () => {
    const book = make()
    const ed = { lang: 'hr' as const, title: 'Luka', chapterTitles: { 1: 'Luka', 2: 'Svjetlo', 3: 'Brodovi', 9: 'x' }, choiceTexts: { '1:0': 'Gore', '1:1': 'Ostani', '1:2': 'extra' }, endings: { 2: 'Kraj', 3: 'Kraj 3', 9: 'x' }, characterNames: { mara: 'Mara', gone: 'x' }, beats: { 'ch01.s01.b002': 'Bok, Tom!', 'ch01.s01.b999': 'gone' } }
    const out = syncEdition(ed, applyStoryOps(book, [{ op: 'chapter.update', n: 3, ending: null, choices: [{ text: 'back', to: 1 }] }]).book)
    expect(out.beats).toEqual({ 'ch01.s01.b002': 'Bok, Tom!' })
    expect(out.chapterTitles).toEqual({ 1: 'Luka', 2: 'Svjetlo', 3: 'Brodovi' })
    expect(out.choiceTexts).toEqual({ '1:0': 'Gore', '1:1': 'Ostani' })
    expect(out.endings).toEqual({ 2: 'Kraj' })
    expect(out.characterNames).toEqual({ mara: 'Mara', tom: 'Old Tom' })
  })
})

describe('the service and the tools', () => {
  let env: VnEnv
  const svc = () => env.engine.vn
  const tools = () => buildTools(svc())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Data = Record<string, any>
  const data = (r: ToolResult): Data => {
    if (r.isError) throw new Error(r.content[0]?.text)
    return r.structuredContent as Data
  }
  const call = async (name: string, args: object) => data(await callTool(tools(), name, args))
  const fails = async (name: string, args: object) => {
    const r = await callTool(tools(), name, args)
    expect(r.isError).toBe(true)
    return r.content[0]!.text
  }
  const asset = async (slug: string, id: string) => (await svc().store.loadAssets(slug)).assets.find((a) => a.id === id)!

  beforeEach(async () => {
    env = await makeVnEnv({ sdk: false })
  })
  afterEach(async () => {
    await env.cleanup()
  })

  it('creates a project with its files and its asset list', async () => {
    const r = await call('vno_create_project', { book: input(), settings: { music: { tracks: 2 } } })
    expect(r).toMatchObject({ slug: 'the-harbour-light', lang: 'en', assets: { background: 3, sheet: 2, sprite: 4, cover: 1, music: 2 } })
    expect(r.warnings.join('\n')).toContain('Gull')
    const slug = r.slug as string
    const { settings } = await svc().store.loadSettings(slug)
    expect(settings).toMatchObject({ source: '', primaryLang: 'en', editions: ['en'] })
    expect((await svc().store.loadBook(slug)).chapters).toHaveLength(3)
    expect((await svc().store.loadEdition(slug, 'en')).beats['ch01.s01.b002']).toBe('Hello, Tom!')
    expect(await svc().store.loadUncertain(slug)).toEqual([])
    expect(await svc().store.readJson(slug, 'import.json')).toMatchObject({ source: 'mcp', created: true })
    expect((await svc().listProjects()).map((p) => p.slug)).toEqual([slug])
    // the same title again: a numbered slug
    expect((await call('vno_create_project', { book: input(), lang: 'hr' })).slug).toBe('the-harbour-light-2')
    expect((await svc().store.loadSettings('the-harbour-light-2')).settings.primaryLang).toBe('hr')
    expect(await fails('vno_create_project', { book: { ...input(), chapters: [{ title: 'A', scenes: [], choices: [{ text: 'x', to: 5 }] }] } })).toContain('leads to chapter 5')
    expect(await fails('vno_create_project', { book: { title: 'No chapters', chapters: [] } })).toContain('invalid arguments')
  })

  it('detects the language of the text when none is given', async () => {
    const hr = storyInputSchema.parse({
      title: 'Svjetionik',
      characters: [{ name: 'Mara' }],
      chapters: [{ title: 'Luka', scenes: [{ place: 'luka', beats: [{ speaker: 'Mara', text: 'Dobar dan, kako ste danas? Ja sam se vratila iz škole i mislim da će kiša.' }, { text: 'More je bilo mirno, a ribari su se vraćali kući.' }] }] }]
    })
    expect((await svc().createProject(hr)).lang).toBe('hr')
  })

  it('edits: prompts of unplanned assets are cleared, planned and locked ones are handled apart', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    // give assets prompts and states
    await svc().store.updateAsset(slug, 'sheet_mara', (e) => ({ ...e, prompt: 'old mara' }))
    await svc().store.updateAsset(slug, 'sheet_tom', (e) => ({ ...e, prompt: 'old tom', locked: true }))
    await svc().store.updateAsset(slug, 'bg_harbour_dusk', (e) => ({ ...e, prompt: 'old harbour', versions: [{ n: 1, file: 'v1.png', createdAt: 'x', seed: 1, engine: 'e', prompt: 'old harbour' }], selected: 1 }))
    await svc().store.updateAsset(slug, 'bg_lighthouse_night', (e) => ({ ...e, prompt: 'old light' }))
    await svc().store.updateAsset(slug, 'cover', (e) => ({ ...e, prompt: 'old cover' }))

    const r = await call('vno_character_set', { slug, key: 'mara', looks: 'a girl in a blue coat' })
    expect(r.assets.cleared).toEqual(['sheet_mara'])
    expect(r.next).toContain('vno_build')
    expect((await asset(slug, 'sheet_mara')).prompt).toBe('')
    expect((await asset(slug, 'sprite_mara_happy')).prompt).toBe('')

    const r2 = await call('vno_story_edit', {
      slug,
      ops: [
        { op: 'character.set', key: 'tom', looks: 'a very old fisherman' },
        { op: 'place.set', key: 'harbour', looks: 'a busy harbour' },
        { op: 'place.set', key: 'lighthouse', looks: 'a red lighthouse' },
        { op: 'book.update', coverBrief: 'a storm' }
      ]
    })
    expect(r2.assets).toMatchObject({ keptLocked: ['sheet_tom'], stale: ['bg_harbour_dusk'], cleared: expect.arrayContaining(['bg_lighthouse_night', 'cover']) })
    expect((await asset(slug, 'sheet_tom')).prompt).toBe('old tom')
    expect((await asset(slug, 'bg_harbour_dusk')).prompt).toBe('old harbour')
    expect((await asset(slug, 'bg_lighthouse_night')).prompt).toBe('')
    expect(r2.next).toContain('stale')
  })

  it('follows edits: the primary edition, another edition and the asset list', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    await svc().store.saveEdition(slug, { lang: 'hr', title: 'Svjetionik', chapterTitles: { 1: 'Luka', 2: 'Svjetlo', 3: 'Brodovi' }, choiceTexts: { '1:0': 'Penji se', '1:1': 'Ostani' }, endings: { 2: 'Kraj' }, characterNames: { mara: 'Mara', tom: 'Stari Tom' }, beats: { 'ch01.s01.b002': 'Bok, Tome!', 'ch01.s01.b004': 'More je mirno.' } })

    const r = await call('vno_story_edit', {
      slug,
      ops: [
        { op: 'beat.update', beatId: 'ch01.s01.b002', text: 'Good evening, Tom!' },
        { op: 'beat.remove', beatIds: ['ch01.s01.b004'] },
        { op: 'character.set', name: 'Captain', looks: 'a captain in a blue hat' },
        { op: 'beat.add', sceneId: 'ch01.s01', beats: [{ speaker: 'Captain', expression: 'surprised', text: 'Ahoy!' }] }
      ]
    })
    expect(r.created).toEqual(['character captain', 'ch01.s01.b006'])
    expect(r.book).toMatchObject({ chapters: 3, characters: 3, beats: 7 })
    expect(r.assets.added).toEqual(expect.arrayContaining(['sheet_captain', 'sprite_captain_surprised']))
    const primary = await svc().store.loadEdition(slug, 'en')
    expect(primary.beats['ch01.s01.b002']).toBe('Good evening, Tom!')
    expect(primary.beats['ch01.s01.b004']).toBeUndefined()
    expect(primary.beats['ch01.s01.b006']).toBe('Ahoy!')
    expect(primary.characterNames).toMatchObject({ captain: 'Captain' })
    expect((await svc().store.loadBook(slug)).chapters[0]!.scenes[0]!.beats.find((b) => b.id === 'ch01.s01.b002')).toMatchObject({ text: 'Good evening, Tom!' })
    const hr = await svc().store.loadEdition(slug, 'hr')
    expect(hr.beats).toEqual({ 'ch01.s01.b002': 'Bok, Tome!' })
    expect(hr.characterNames).toEqual({ mara: 'Mara', tom: 'Stari Tom', captain: 'Captain' })

    // a removed speaker leaves its assets in the manifest but they no longer count
    const gone = await call('vno_character_remove', { slug, key: 'captain', force: true })
    expect(gone.assets.orphaned).toEqual(expect.arrayContaining(['sheet_captain']))
    expect((await svc().listAssets(slug)).find((a) => a.id === 'sheet_captain')?.orphaned).toBe(true)
  })

  it('keeps hand-set prompts and prunes cues.json and music.json', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    await svc().store.updateAsset(slug, 'sheet_mara', (e) => ({ ...e, prompt: 'by hand', promptByHand: true }))
    await svc().store.writeJson(slug, 'cues.json', { menuMusic: null, chapters: { 1: { music: null }, 3: { music: null } }, scenes: { 'ch01.s01': {}, 'ch03.s01': {} }, casts: { 'ch01.s01.b001': { mara: 'left' }, 'ch01.s01.b999': {} }, byHand: true })
    await svc().store.writeJson(slug, 'music.json', { menu: null, chapters: { 1: 'music_01', 3: 'music_02' }, seconds: {}, byHand: true })
    await svc().store.updateAsset(slug, 'sheet_tom', (e) => ({ ...e, prompt: 'x' }))
    const r = await call('vno_story_edit', { slug, ops: [{ op: 'character.set', key: 'mara', looks: 'new looks' }, { op: 'chapter.update', n: 1, choices: [{ text: 'a', to: 2 }] }, { op: 'chapter.remove', n: 3 }] })
    expect(r.assets.keptByHand).toEqual(['sheet_mara'])
    expect((await asset(slug, 'sheet_mara')).prompt).toBe('by hand')
    expect(await svc().store.readJson(slug, 'cues.json')).toMatchObject({ chapters: { 1: {} }, scenes: { 'ch01.s01': {} }, casts: { 'ch01.s01.b001': {} }, byHand: true })
    const cues = (await svc().store.readJson(slug, 'cues.json')) as { chapters: object; scenes: object; casts: object }
    expect(Object.keys(cues.chapters)).toEqual(['1'])
    expect(Object.keys(cues.scenes)).toEqual(['ch01.s01'])
    expect(Object.keys(cues.casts)).toEqual(['ch01.s01.b001'])
    expect(await svc().store.readJson(slug, 'music.json')).toMatchObject({ chapters: { 1: 'music_01' }, byHand: true })
  })

  it('saves nothing when an edit is invalid', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    const before = await readFile(svc().store.file(slug, 'vn.json'), 'utf8')
    expect(await fails('vno_story_edit', { slug, ops: [{ op: 'beat.add', sceneId: 'ch01.s01', beats: [{ text: 'Fine.' }] }, { op: 'chapter.update', n: 1, choices: [{ text: 'x', to: 42 }] }] })).toContain('leads to chapter 42')
    expect(await fails('vno_story_edit', { slug, ops: [{ op: 'beat.add', sceneId: 'ch01.s01', beats: [{ cast: ['ghost'] }] }] })).toContain('cast member "ghost"')
    expect(await fails('vno_chapter_remove', { slug, n: 2 })).toContain('still leads to chapter 2')
    expect(await fails('vno_story_edit', { slug, ops: [] })).toContain('invalid arguments')
    expect(await readFile(svc().store.file(slug, 'vn.json'), 'utf8')).toBe(before)
  })

  it('reads the story, the whole book or one chapter', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    expect((await call('vno_get_story', { slug })).book.chapters).toHaveLength(3)
    const ch = await call('vno_get_story', { slug, chapter: 2 })
    expect(ch.chapter).toMatchObject({ n: 2, title: 'The Light' })
    expect(ch.summary).toMatchObject({ chapters: 3 })
    expect(await fails('vno_get_story', { slug, chapter: 7 })).toContain('no chapter 7')
  })

  it('has one tool per operation', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    const names = tools().map((t) => t.name)
    for (const n of ['vno_create_project', 'vno_get_story', 'vno_story_edit', 'vno_book_update', 'vno_character_set', 'vno_character_remove', 'vno_place_set', 'vno_place_remove', 'vno_chapter_add', 'vno_chapter_update', 'vno_chapter_remove', 'vno_scene_add', 'vno_scene_update', 'vno_scene_remove', 'vno_beat_add', 'vno_beat_update', 'vno_beat_remove', 'vno_edition_set']) expect(names).toContain(n)
    await call('vno_book_update', { slug, title: 'Harbour Light 2' })
    await call('vno_place_set', { slug, name: 'Cave', looks: 'a dark cave' })
    await call('vno_chapter_add', { slug, chapter: { title: 'The Cave', ending: 'Lost.', scenes: [] } })
    await call('vno_scene_add', { slug, chapter: 4, scene: { place: 'cave', time: 'night', beats: [{ text: 'Dark.' }] } })
    await call('vno_scene_update', { slug, sceneId: 'ch04.s01', description: 'Drips.' })
    await call('vno_beat_add', { slug, sceneId: 'ch04.s01', at: 0, beats: [{ cast: [] }] })
    await call('vno_beat_update', { slug, beatId: 'ch04.s01.b001', text: 'Very dark.' })
    await call('vno_beat_remove', { slug, beatIds: ['ch04.s01.b002'] })
    await call('vno_place_remove', { slug, key: 'cave', force: true })
    await call('vno_scene_remove', { slug, sceneId: 'ch04.s01' })
    await call('vno_chapter_update', { slug, n: 4, title: 'Gone' })
    await call('vno_character_set', { slug, name: 'Pip' })
    await call('vno_character_remove', { slug, key: 'pip' })
    const book = await svc().store.loadBook(slug)
    expect(book.title).toBe('Harbour Light 2')
    expect(book.chapters[3]).toMatchObject({ n: 4, title: 'Gone', scenes: [] })
    expect(book.characters.map((c) => c.key)).toEqual(['mara', 'tom'])
  })

  it('writes another edition as JSON: merged, checked, listed in the settings', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    const r = await call('vno_edition_set', { slug, lang: 'de', title: 'Das Hafenlicht', beats: { 'ch01.s01.b002': 'Hallo, Tom!' }, characterNames: { tom: 'Alter Tom' } })
    expect(r).toMatchObject({ lang: 'de', title: 'Das Hafenlicht', beats: 1 })
    expect(r.missing.beats).toBeGreaterThan(0)
    expect(r.missing.other).toContain('chapter 1 title')
    await call('vno_edition_set', { slug, lang: 'de', chapterTitles: { '1': 'Der Hafen' } })
    const ed = await svc().store.loadEdition(slug, 'de')
    expect(ed).toMatchObject({ title: 'Das Hafenlicht', chapterTitles: { 1: 'Der Hafen' }, beats: { 'ch01.s01.b002': 'Hallo, Tom!' }, characterNames: { tom: 'Alter Tom' } })
    expect((await svc().store.loadSettings(slug)).settings.editions).toEqual(['de', 'en'])
    expect(await fails('vno_edition_set', { slug, lang: 'de', beats: { 'ch09.s01.b001': 'x' } })).toContain('no text beat ch09.s01.b001')
    expect(await fails('vno_edition_set', { slug, lang: 'en', beats: {} })).toContain('primary language')
    expect(await fails('vno_edition_set', { slug, lang: 'xx', beats: {} })).toMatch(/xx/)
    expect((await call('vno_edition_set', { slug, lang: 'de', replace: true, title: 'Neu' })).beats).toBe(0)
  })

  it('builds a game from a project made only through the tools', async () => {
    const slug = (await call('vno_create_project', { book: input() })).slug as string
    await call('vno_beat_add', { slug, sceneId: 'ch02.s01', beats: [{ speaker: 'Old Tom', expression: 'worried', text: 'Careful up there.' }] })
    await svc().enqueueBuild(slug)
    expect((await waitIdle(env, slug)).failed, (await failures(env)).join(' | ')).toEqual([])
    const game = path.join(svc().store.dir(slug), 'game', 'game')
    const ch1 = await readFile(path.join(game, 'ch01.rpy'), 'utf8')
    expect(ch1).toContain('menu:')
    expect(ch1).toContain('Climb the lighthouse')
    expect(ch1).toContain('jump ch_02')
    expect(ch1).toContain('# beat:ch01.s01.b002')
    const ch2 = await readFile(path.join(game, 'ch02.rpy'), 'utf8')
    expect(ch2).toContain('Mara found the light.')
    expect(ch2).toContain('Careful up there.')
    expect(await readFile(path.join(game, 'ch03.rpy'), 'utf8')).toContain('the_end')
    expect((await svc().detail(slug)).build).toMatchObject({ slug })
  }, 60_000)

  it('a Japanese title gets a romaji slug, a Han title a hash slug, and the keys are ASCII', async () => {
    const jp = await call('vno_create_project', { book: { title: 'さくらの手紙', characters: [{ name: 'さくら', looks: 'a girl' }], chapters: [{ title: '一', scenes: [{ place: '桜の庭', beats: [{ speaker: 'さくら', text: 'こんにちは' }] }] }] } })
    expect(jp.slug).toMatch(/^sakurano-[0-9a-f]{6}$/)
    const story = (await call('vno_get_story', { slug: jp.slug as string })).book as VnBook
    expect(story.characters[0]!.key).toBe('sakura')
    expect(story.chapters[0]!.scenes[0]!.beats[0]).toMatchObject({ speakerKey: 'sakura', speakerLabel: 'さくら' })
    const han = await call('vno_create_project', { book: { title: '红楼梦', chapters: [{ title: 'A', scenes: [] }] } })
    expect(han.slug).toMatch(/^book-[0-9a-f]{6}$/)
    const ru = await call('vno_create_project', { book: { title: 'Война и мир', characters: [{ name: 'Наташа' }], chapters: [{ title: 'A', scenes: [{ place: 'Причал', beats: [{ speaker: 'Наташа', text: 'Привет' }] }] }] } })
    expect(ru.slug).toBe('voina-i-mir')
    expect(((await call('vno_get_story', { slug: 'voina-i-mir' })).book as VnBook).characters[0]!.key).toBe('natasha')
  })

  it('vno_edition_set takes the translated name of an alias under <key>#<n>, and a story edit keeps it', async () => {
    const slug = (await call('vno_create_project', { book: { title: 'The Clock', characters: [{ name: 'Kessler', aliases: ['the bald man'] }], chapters: [{ title: 'A', scenes: [{ place: 'workshop', beats: [{ speaker: 'the bald man', text: 'Hello.' }] }] }] } })).slug as string
    const r = await call('vno_edition_set', { slug, lang: 'fr', characterNames: { kessler: 'Kessler', 'kessler#1': "l'homme chauve" }, beats: { 'ch01.s01.b001': 'Bonjour.' } })
    expect(r.lang).toBe('fr')
    const bad = await fails('vno_edition_set', { slug, lang: 'fr', characterNames: { 'kessler#2': 'x' } })
    expect(bad).toContain('no character kessler#2')
    await call('vno_character_set', { slug, key: 'kessler', looks: 'a bald man' })
    const ed = JSON.parse(await readFile(path.join(svc().store.dir(slug), 'editions', 'fr.json'), 'utf8')) as { characterNames: Record<string, string> }
    expect(ed.characterNames['kessler#1']).toBe("l'homme chauve")
    // removing the alias drops its name
    await call('vno_character_set', { slug, key: 'kessler', aliases: null })
    const after = JSON.parse(await readFile(path.join(svc().store.dir(slug), 'editions', 'fr.json'), 'utf8')) as { characterNames: Record<string, string> }
    expect(after.characterNames['kessler#1']).toBeUndefined()
  })
})

describe('media cues and expression sets in the story', () => {
  /** The small book with a picture, a sound effect, an ambience, scene music and a `smug` expression for Old Tom only. */
  const media = (): StoryInput => {
    const i = input()
    i.characters[1]!.expressions = ['smug']
    i.images = [{ key: 'ledger', description: 'an open ledger', display: 'insert', characters: ['mara'] }]
    i.sounds = [
      { key: 'gulls', kind: 'sfx', description: 'gulls cry' },
      { key: 'waves', kind: 'ambience', description: 'waves on stone' }
    ]
    const scene = i.chapters[0]!.scenes[0]!
    scene.music = 'music_02'
    scene.ambience = 'waves'
    scene.beats[1] = { ...scene.beats[1]!, image: 'ledger', sfx: 'gulls' }
    scene.beats[2] = { ...scene.beats[2]!, expression: 'smug' }
    scene.beats[3] = { ...scene.beats[3]!, image: null, ambience: null }
    return i
  }
  const apply = (ops: object[], book: VnBook) => applyStoryOps(book, ops.map((o) => storyOpSchema.parse(o)))

  it('a story with images, sounds, cues, scene music and a character expression builds', () => {
    const { book } = buildBook(media(), { slug: 'harbour', lang: 'en' })
    expect(book.images).toEqual([{ key: 'ledger', description: 'an open ledger', display: 'insert', characters: ['mara'] }])
    expect(book.sounds?.map((s) => `${s.kind}:${s.key}`)).toEqual(['sfx:gulls', 'ambience:waves'])
    expect(book.characters[1]).toMatchObject({ key: 'tom', expressions: ['smug'] })
    const scene = book.chapters[0]!.scenes[0]!
    expect(scene).toMatchObject({ music: 'music_02', ambience: 'waves' })
    expect(scene.beats[1]).toMatchObject({ image: 'ledger', sfx: 'gulls' })
    expect(scene.beats[2]).toMatchObject({ speakerKey: 'tom', expression: 'smug' })
    expect(scene.beats[3]).toMatchObject({ image: null, ambience: null })
    expect(validateBook(book).errors).toEqual([])
  })

  it('refuses an unknown cue key, an expression outside the set, a cue-only beat and music that is not a track', () => {
    const build = (change: (i: StoryInput) => void) => () => {
      const i = media()
      change(i)
      return buildBook(i, { slug: 'harbour', lang: 'en' })
    }
    expect(build((i) => (i.chapters[0]!.scenes[0]!.beats[1]!.image = 'nope'))).toThrow(/image "nope" is not in images/)
    expect(build((i) => (i.chapters[0]!.scenes[0]!.beats[1]!.sfx = 'waves'))).toThrow(/sfx "waves" is not in sounds as a sound effect/)
    expect(build((i) => (i.chapters[0]!.scenes[0]!.ambience = 'gulls'))).toThrow(/ambience "gulls" is not in sounds/)
    expect(build((i) => (i.chapters[0]!.scenes[0]!.music = 'loud'))).toThrow(/music "loud" is not a track id/)
    expect(build((i) => i.chapters[0]!.scenes[0]!.beats.push({ sfx: 'gulls' }))).toThrow(/cannot stand alone/)
    // smug belongs to Old Tom: Mara's smug line is mapped to the nearest word of the book set, never kept as smug
    const { book } = buildBook({ ...media(), chapters: [{ title: 'A', scenes: [{ place: 'harbour', beats: [{ speaker: 'Mara', expression: 'smug', text: 'Hm.' }] }] }] }, { slug: 'harbour', lang: 'en' })
    expect(book.chapters[0]!.scenes[0]!.beats[0]).not.toMatchObject({ expression: 'smug' })
    const bad = structuredClone(book)
    const line = bad.chapters[0]!.scenes[0]!.beats[0]!
    if (line.type === 'line') line.expression = 'smug'
    expect(validateBook(bad).errors.join('\n')).toMatch(/smug/)
    expect(() => buildBook({ ...media(), expressions: ['happy', 'sad'] }, { slug: 'harbour', lang: 'en' })).toThrow(/neutral/)
  })

  it('image.remove and sound.remove refuse a used entry, and with force clear its cues', () => {
    const { book } = buildBook(media(), { slug: 'harbour', lang: 'en' })
    expect(() => apply([{ op: 'image.remove', key: 'ledger' }], book)).toThrow(/shown by 1 beat/)
    expect(() => apply([{ op: 'sound.remove', key: 'waves' }], book)).toThrow(/ambience "waves" is played by 1 cue/)
    const r = apply(
      [
        { op: 'image.remove', key: 'cg_ledger', force: true },
        { op: 'sound.remove', key: 'amb_waves', force: true },
        { op: 'sound.remove', key: 'gulls', kind: 'sfx', force: true }
      ],
      book
    )
    expect(r.book.images).toBeUndefined()
    expect(r.book.sounds).toBeUndefined()
    const scene = r.book.chapters[0]!.scenes[0]!
    expect(scene.ambience).toBeUndefined()
    expect(scene.beats.some((b) => b.image !== undefined && b.image !== null)).toBe(false)
    expect(scene.beats.some((b) => b.sfx !== undefined || (b.ambience !== undefined && b.ambience !== null))).toBe(false)
    expect(validateBook(r.book).errors).toEqual([])
  })

  it('image.set and sound.set make and change entries; book.update and character.set change the expression sets', () => {
    const { book } = buildBook(media(), { slug: 'harbour', lang: 'en' })
    const r = apply(
      [
        { op: 'image.set', key: 'ledger', display: 'full', characters: ['mara', 'tom'] },
        { op: 'image.set', key: 'map', description: 'an old sea map' },
        { op: 'sound.set', key: 'bell', kind: 'sfx', description: 'a ship bell' },
        { op: 'book.update', expressions: ['neutral', 'happy', 'grim'] },
        { op: 'character.set', key: 'tom', expressions: null }
      ],
      buildBook({ ...media(), chapters: [{ title: 'A', scenes: [{ place: 'harbour', beats: [{ text: 'x' }] }] }] }, { slug: 'harbour', lang: 'en' }).book
    )
    expect(r.book.images).toEqual([
      { key: 'ledger', description: 'an open ledger', display: 'full', characters: ['mara', 'tom'] },
      { key: 'map', description: 'an old sea map', display: 'full' }
    ])
    expect(r.book.sounds?.map((s) => s.key)).toEqual(['gulls', 'waves', 'bell'])
    expect(r.book.expressions).toEqual(['neutral', 'happy', 'grim'])
    expect(r.book.characters[1]!.expressions).toBeUndefined()
    expect(() => apply([{ op: 'sound.set', key: 'horn' }], book)).toThrow(/give its kind/)
    expect(() => apply([{ op: 'image.set', key: 'horn' }], book)).toThrow(/give a description/)
  })
})
