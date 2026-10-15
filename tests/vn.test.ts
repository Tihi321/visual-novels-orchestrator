import { describe, expect, it } from 'vitest'
import { providersSchema } from '../src/shared/schemas'
import { assetManifestSchema, editionSchema, projectSettingsSchema, vnBookSchema, vnBeatSchema } from '../src/shared/vn'
import type { AssetManifest, Edition, VnBook } from '../src/shared/vn'

describe('VN contract schemas', () => {
  it('parses a small book with all three beat types and rejects a bad expression', () => {
    const book: VnBook = {
      slug: 'demo',
      title: 'Demo',
      format: 'choice-visual-novel',
      kind: 'choice',
      primaryLang: 'en',
      style: 'soft watercolour',
      characters: [{ key: 'mara', name: 'Mara', looks: 'red scarf' }],
      places: [{ key: 'harbour', name: 'Harbour', looks: 'stone wall' }],
      warnings: [],
      chapters: [
        {
          n: 1,
          title: 'Start',
          choices: [{ text: 'Go left', to: 2 }],
          ending: null,
          scenes: [
            {
              id: 'ch01.s01',
              placeKey: 'harbour',
              placeText: 'Harbour wall',
              time: 'dusk',
              backgroundId: 'bg.harbour.dusk',
              description: 'Gulls cry.',
              breakBefore: false,
              beats: [
                { id: 'ch01.s01.b001', type: 'cast', cast: [{ charKey: 'mara' }] },
                { id: 'ch01.s01.b002', type: 'line', speakerKey: 'mara', speakerLabel: 'Mara', expression: 'worried', text: 'Hello?' },
                { id: 'ch01.s01.b003', type: 'narration', text: 'The tide came in.' }
              ]
            }
          ]
        }
      ]
    }
    expect(vnBookSchema.parse(book)).toEqual(book)
    const bad = { id: 'x', type: 'line', speakerKey: null, speakerLabel: 'A', expression: 'smug', text: 't' }
    expect(vnBeatSchema.safeParse(bad).success).toBe(false)
  })

  it('an edition has numeric chapter keys', () => {
    const e: Edition = { lang: 'hr', title: 'Demo', chapterTitles: { 1: 'Početak' }, choiceTexts: { '1:0': 'Idi lijevo' }, endings: {}, characterNames: { mara: 'Mara' }, beats: { 'ch01.s01.b003': 'Plima je došla.' } }
    const parsed = editionSchema.parse(JSON.parse(JSON.stringify(e)))
    expect(parsed.chapterTitles[1]).toBe('Početak')
  })

  it('project settings get the defaults', () => {
    const p = projectSettingsSchema.parse({ slug: 'demo', source: 'C:/books/demo', primaryLang: 'hr' })
    expect(p.art).toEqual({ style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' })
    expect(p.music).toEqual({ engine: 'ace-step-v1-instrumental', tracks: 3 })
    expect(p.voice).toEqual({ enabled: false, langs: [], provider: 'vibetts', engines: {}, voices: {} })
    expect(p.editions).toEqual([])
    expect(p.theme).toBeNull()
  })

  it('an asset manifest round-trips', () => {
    const m: AssetManifest = {
      assets: [
        {
          id: 'bg.harbour.dusk',
          kind: 'background',
          prompt: 'a harbour wall at dusk',
          engine: 'qwen-image-2.1',
          seed: null,
          size: { w: 1920, h: 1080 },
          versions: [{ n: 1, file: 'v1.png', createdAt: '2026-10-15T10:00:00Z', seed: 7, engine: 'qwen-image-2.1', prompt: 'a harbour wall at dusk' }],
          selected: 1,
          source: 'generated',
          locked: false,
          review: { status: 'pending' }
        }
      ]
    }
    expect(assetManifestSchema.parse(m)).toEqual(m)
  })
})

describe('provider schema', () => {
  it('a model may be marked vision, and defaults to false', () => {
    const p = providersSchema.parse({ kind: 'providers', providers: [{ id: 'x', kind: 'openai-compat', models: [{ id: 'a', vision: true }, { id: 'b' }] }] })
    expect(p.providers[0]!.models.map((m) => m.vision)).toEqual([true, false])
  })
})
