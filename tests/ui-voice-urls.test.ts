import { describe, expect, it } from 'vitest'
import { dirOf, projectAssetUrl, projectRel, relativeToData } from '../src/renderer/lib/urls'
import { toggleLang, ttsWorkflows, voiceSupport, workflowNameOf } from '../src/renderer/lib/voice'
import { applySettingsPatch } from '../src/renderer/lib/settings'
import { beatIndex, missingFromEdition } from '../src/renderer/lib/book'
import type { ProjectSettings, VnBook } from '../src/shared/vn'

const wfs = [
  { name: 'chatterbox', kind: 'audio' as const, languages: ['en'] },
  { name: 'song', kind: 'audio' as const, languages: [] },
  { name: 'img', kind: 'image' as const, languages: [] }
]

describe('voice support', () => {
  it('picks out the TTS workflows', () => {
    expect(ttsWorkflows(wfs).map((w) => w.name)).toEqual(['chatterbox'])
    expect(workflowNameOf('custom:chatterbox')).toBe('chatterbox')
    expect(workflowNameOf('qwen')).toBeNull()
  })
  it('says Croatian is not supported when the workflow lacks it', () => {
    const r = voiceSupport('custom:chatterbox', 'hr', wfs)
    expect(r.status).toBe('unsupported')
    expect(r.message).toContain('Croatian is not supported yet')
    expect(r.supported).toEqual(['en'])
  })
  it('accepts a supported language, and reports a missing or unknown engine', () => {
    expect(voiceSupport('custom:chatterbox', 'en', wfs).status).toBe('ok')
    expect(voiceSupport('', 'en', wfs).status).toBe('no-engine')
    expect(voiceSupport('custom:nope', 'en', wfs).status).toBe('unknown')
  })
  it('toggles a language in edition order', () => {
    expect(toggleLang(['hr'] as const, 'en', true, ['en', 'hr'] as const)).toEqual(['en', 'hr'])
    expect(toggleLang(['en', 'hr'] as const, 'en', false, ['en', 'hr'] as const)).toEqual(['hr'])
  })
})

describe('urls', () => {
  it('builds protocol URLs with an encoded path and a cache buster', () => {
    expect(projectAssetUrl('my-book', 'assets/bg_a b/v1.webp')).toBe('vnstudio-file://data/projects/my-book/assets/bg_a%20b/v1.webp')
    expect(projectAssetUrl('b', 'assets/x/custom.png', 3)).toBe('vnstudio-file://data/projects/b/assets/x/custom.png?v=3')
  })
  it('makes project-relative and data-relative paths', () => {
    expect(projectRel('b', 'game')).toBe('projects/b/game')
    expect(projectRel('b')).toBe('projects/b')
    expect(relativeToData('C:\\data', 'C:\\data\\projects\\b\\game')).toBe('projects/b/game')
    expect(relativeToData('C:\\data', 'D:\\other')).toBeNull()
    expect(dirOf('C:\\a\\b\\c.apk')).toBe('C:\\a\\b')
  })
})

describe('settings patch', () => {
  const base = {
    slug: 's',
    source: '',
    primaryLang: 'en',
    editions: ['en'],
    models: {},
    theme: null,
    art: { style: 'illustrated', generator: 'g', editor: 'e', review: false, bgRemoval: 'birefnet' },
    music: { engine: 'm', tracks: 3 },
    voice: { enabled: false, langs: [], provider: 'vibetts', engines: {}, voices: {} }
  } as ProjectSettings
  it('merges each part and replaces the theme', () => {
    const next = applySettingsPatch(base, { theme: 'noir', art: { style: 'pixel', stylePrompt: 'x' }, voice: { enabled: true } })
    expect(next.theme).toBe('noir')
    expect(next.art).toMatchObject({ style: 'pixel', generator: 'g', stylePrompt: 'x' })
    expect(next.voice).toMatchObject({ enabled: true, langs: [] })
    expect(applySettingsPatch(next, { theme: null }).theme).toBeNull()
    expect(applySettingsPatch(next, {}).theme).toBe('noir')
  })
})

describe('book beats', () => {
  const book = {
    chapters: [
      {
        n: 1,
        title: 't',
        choices: [],
        ending: null,
        scenes: [
          {
            id: 'ch01.s01',
            placeKey: null,
            placeText: '',
            time: null,
            backgroundId: '',
            description: '',
            breakBefore: false,
            beats: [
              { id: 'ch01.s01.b001', type: 'cast', cast: [] },
              { id: 'ch01.s01.b002', type: 'line', speakerKey: 'p', speakerLabel: 'Petra', expression: 'neutral', text: 'Hi' },
              { id: 'ch01.s01.b003', type: 'narration', text: 'Night.' }
            ]
          }
        ]
      }
    ]
  } as unknown as VnBook
  it('lists text beats and finds the ones an edition lacks', () => {
    expect([...beatIndex(book).keys()]).toEqual(['ch01.s01.b002', 'ch01.s01.b003'])
    expect(beatIndex(book).get('ch01.s01.b002')?.speaker).toBe('Petra')
    expect(missingFromEdition(book, { beats: { 'ch01.s01.b002': 'Bok' } })).toEqual(['ch01.s01.b003'])
  })
})
