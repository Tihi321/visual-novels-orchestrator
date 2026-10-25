import { describe, expect, it } from 'vitest'
import { buildGameData } from '../src/engine/game/emit'
import type { Theme } from '../src/engine/themes/load'
import { buildBook, storyInputSchema } from '../src/engine/vn/story'
import { PLAYER_UI_KEYS, UI_STRINGS } from '../src/shared/ui-strings'

/** VNO-48: game-data.json ships the interface (menu) languages the player's Preferences screen offers. */

// The same minimal dark theme the other GameData tests use.
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

const story = (): ReturnType<typeof storyInputSchema.parse> =>
  storyInputSchema.parse({
    title: 'The Little Lighthouse',
    format: 'visual-novel',
    characters: [{ key: 'mira', name: 'Mira', looks: 'a girl with a lantern' }],
    places: [{ key: 'cliff', name: 'Cliff', looks: 'a windswept cliff above the sea' }],
    chapters: [
      {
        title: 'One',
        scenes: [
          {
            place: 'cliff',
            time: 'night',
            beats: [{ cast: ['mira'] }, { text: 'The lamp went out, and the sea was black.' }]
          }
        ]
      }
    ]
  })

describe('game data: interface languages', () => {
  const book = buildBook(story(), { slug: 'lighthouse', lang: 'en' }).book
  const uiLanguages = buildGameData({ book, theme: TEST_THEME }).uiLanguages!

  it('starts with English and ships only strings the player asks for', () => {
    expect(uiLanguages[0]).toEqual({ code: 'en', name: 'English', nativeName: 'English', ui: {} })

    const codes = uiLanguages.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.filter((c) => c === 'en')).toHaveLength(1)

    for (const lang of uiLanguages) {
      for (const key of Object.keys(lang.ui)) expect(PLAYER_UI_KEYS, `${lang.code}: ${key}`).toContain(key)
    }
    // English carries no table (the runtime shows the English literals); every other language has strings
    expect(uiLanguages[0]!.ui).toEqual({})
    for (const lang of uiLanguages.slice(1)) expect(Object.keys(lang.ui).length, lang.code).toBeGreaterThan(0)
  })

  it('ships Croatian with its filtered table, after English and sorted by English name', () => {
    const hr = uiLanguages.find((l) => l.code === 'hr')
    expect(hr).toMatchObject({ code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' })

    const expected: Record<string, string> = {}
    for (const key of PLAYER_UI_KEYS) {
      const value = UI_STRINGS.hr![key]
      if (value) expected[key] = value
    }
    expect(hr!.ui).toEqual(expected)
    expect(hr!.ui.Start).toBe('Započni')
    expect(hr!.ui['Interface Language']).toBe('Jezik sučelja')
    expect(hr!.ui['Story Text Size']).toBe('Veličina teksta priče')

    const names = uiLanguages.slice(1).map((l) => l.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('keeps the whole table small enough for game-data.json', () => {
    expect(JSON.stringify(uiLanguages).length).toBeLessThan(120_000)
  })
})
