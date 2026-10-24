import { describe, expect, it } from 'vitest'
import { buildGameData, type GameData } from '../src/engine/game/emit'
import { renderPlayerRuntime } from '../src/engine/game/player-runtime'
import { defaultCues, planScene, type StageCues } from '../src/engine/game/stage'
import type { Theme } from '../src/engine/themes/load'
import { CANONICAL_EXPRESSIONS, type VnBook, type VnScene } from '../src/shared/vn'
import { isProjectFinished } from '../src/renderer/lib/pipeline'
import type { ProjectSummary } from '../src/shared/protocol'

const TEST_THEME: Theme = {
  name: 'classic-dark',
  label: 'Classic Dark',
  description: '',
  light: false,
  pixel: false,
  colors: {
    accent: '#3b82f6',
    background: '#000',
    text: '#fff',
    idle: '#aaa',
    hover: '#fff',
    selected: '#3b82f6',
    insensitive: '#555',
    muted: '#6b7280'
  },
  fonts: { text: 'DejaVuSans.ttf', name: 'DejaVuSans.ttf', interface: 'DejaVuSans.ttf' },
  sizes: { text: 32, name: 36, interface: 28, label: 28, title: 48, choice: 30 },
  transitions: { show: 0.2, fade: 0.5, dissolve: 0.2 },
  textbox: { color: '#000', opacity: 0.8, borderColor: null, radius: 0 },
  namebox: { color: '#000', opacity: 0.8, radius: 0, textColor: null },
  choice: { color: '#222', borderColor: null, radius: 4 },
  frames: {}
}

function makeLanternaBook(): VnBook {
  return {
    slug: 'the-trap-room-at-the-lanterna',
    title: 'The Trap Room at the Lanterna',
    format: 'mystery-puzzle-visual-novel',
    kind: 'linear',
    primaryLang: 'en',
    style: 'illustrative',
    warnings: [],
    characters: [
      { key: 'inspector_nada_ferluga', name: 'Inspector Nada Ferluga', aliases: [], looks: 'trenchcoat' },
      { key: 'luka_bencic', name: 'Luka Bencic', aliases: [], looks: 'vest' },
      { key: 'signora_livia_brandolin', name: 'Signora Livia Brandolin', aliases: [], looks: 'silk gown' }
    ],
    places: [{ key: 'parlor', name: 'Parlor', looks: 'dim parlor' }],
    chapters: [
      {
        n: 1,
        title: 'Chapter 1',
        choices: [],
        ending: null,
        scenes: [
          {
            id: 'ch01.s03',
            placeKey: 'parlor',
            placeText: 'Parlor',
            backgroundId: 'bg_parlor',
            time: 'night',
            description: 'In the parlor',
            breakBefore: false,
            beats: [
              {
                id: 'ch01.s03.b003',
                type: 'cast',
                cast: [
                  { charKey: 'inspector_nada_ferluga' },
                  { charKey: 'luka_bencic' }
                ]
              },
              {
                id: 'ch01.s03.b004',
                type: 'line',
                speakerKey: 'inspector_nada_ferluga',
                speakerLabel: 'Inspector Nada Ferluga',
                expression: 'thinking',
                text: 'Look at the lock.'
              },
              {
                id: 'ch01.s03.b011',
                type: 'cast',
                cast: [
                  { charKey: 'signora_livia_brandolin' },
                  { charKey: 'inspector_nada_ferluga' },
                  { charKey: 'luka_bencic' }
                ]
              },
              {
                id: 'ch01.s03.b012',
                type: 'line',
                speakerKey: 'signora_livia_brandolin',
                speakerLabel: 'Signora Livia Brandolin',
                expression: 'happy',
                text: 'Good evening, Inspector.'
              }
            ]
          },
          {
            id: 'ch01.s04',
            placeKey: 'parlor',
            placeText: 'Parlor',
            backgroundId: 'bg_parlor',
            time: 'night',
            description: 'Next scene with empty stage initially',
            breakBefore: true,
            beats: [
              {
                id: 'ch01.s04.b001',
                type: 'narration',
                text: 'The room fell silent after everyone left.'
              }
            ]
          }
        ]
      }
    ]
  }
}

function createStageHarness(gameData: GameData) {
  const elementsById = new Map<string, FakeEl>()

  class ClassList {
    private set = new Set<string>()
    constructor(initial = '') {
      initial
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this.set.add(c))
    }
    add(...cls: string[]) {
      cls.forEach((c) => this.set.add(c))
    }
    remove(...cls: string[]) {
      cls.forEach((c) => this.set.delete(c))
    }
    contains(c: string) {
      return this.set.has(c)
    }
    toggle(c: string) {
      if (this.set.has(c)) {
        this.set.delete(c)
        return false
      }
      this.set.add(c)
      return true
    }
  }

  class FakeEl {
    tagName: string
    id: string
    classList: ClassList
    style: Record<string, string> = {}
    attrs = new Map<string, string>()
    listeners = new Map<string, Array<(e: unknown) => void>>()
    children: FakeEl[] = []
    onclick: ((e?: unknown) => void) | null = null
    textContent = ''
    value = ''
    src = ''
    alt = ''
    paused = true
    private _innerHTML = ''

    constructor(tagName: string, id = '', classes = '') {
      this.tagName = tagName.toUpperCase()
      this.id = id
      this.classList = new ClassList(classes)
      if (id) elementsById.set(id, this)
    }

    get innerHTML() {
      return this._innerHTML
    }
    set innerHTML(v: string) {
      this._innerHTML = String(v ?? '')
      this.children = []
      const imgMatch = /<img\b([^>]*)>/i.exec(this._innerHTML)
      if (imgMatch) {
        const img = new FakeEl('img')
        const attrs = imgMatch[1]!
        const srcM = /\bsrc="([^"]*)"/.exec(attrs)
        const altM = /\balt="([^"]*)"/.exec(attrs)
        const dcM = /\bdata-char="([^"]*)"/.exec(attrs)
        if (srcM) img.src = srcM[1]!
        if (altM) img.alt = altM[1]!
        if (dcM) img.setAttribute('data-char', dcM[1]!)
        this.children.push(img)
      }
    }

    setAttribute(k: string, v: string) {
      this.attrs.set(k, String(v))
    }
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null
    }
    appendChild(child: FakeEl) {
      this.children.push(child)
      return child
    }
    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }
    dispatchEvent(type: string, evt: unknown = {}) {
      for (const fn of this.listeners.get(type) ?? []) fn(evt)
      if (type === 'click' && this.onclick) this.onclick(evt)
    }
    click() {
      this.dispatchEvent('click')
    }
    querySelector(sel: string): FakeEl | null {
      if (sel === 'img') return this.children.find((c) => c.tagName === 'IMG') ?? null
      return null
    }
    querySelectorAll(): FakeEl[] {
      return []
    }
    play() {
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }

  const runtime = renderPlayerRuntime(gameData)
  const tagRegex = /<([a-zA-Z0-9]+)\b([^>]*)>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(runtime.html)) !== null) {
    const tag = match[1]!
    const attrStr = match[2]!
    const idMatch = /\bid="([^"]+)"/.exec(attrStr)
    const classMatch = /\bclass="([^"]+)"/.exec(attrStr)
    if (idMatch) {
      new FakeEl(tag, idMatch[1]!, classMatch ? classMatch[1]! : '')
    }
  }

  let domLoaded: (() => void) | null = null
  const fakeDoc = {
    title: '',
    documentElement: new FakeEl('html'),
    getElementById: (id: string) => elementsById.get(id) ?? null,
    querySelectorAll: () => [],
    createElement: (tag: string) => new FakeEl(tag),
    addEventListener: (evt: string, fn: () => void) => {
      if (evt === 'DOMContentLoaded') domLoaded = fn
    }
  }
  const fakeWin: Record<string, unknown> = {
    VNO_GAME_DATA: gameData,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  }

  const fn = new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', runtime.js)
  fn(
    fakeWin,
    fakeDoc,
    fakeWin.localStorage,
    (cb: () => void) => {
      cb()
      return 1
    },
    () => {},
    () => 1,
    () => {}
  )
  if (domLoaded) (domLoaded as () => void)()

  return {
    elementsById,
    startGame: () => elementsById.get('vno-mm-start')!.click(),
    advance: () => (fakeWin.VNOEngine as { advance: () => void }).advance()
  }
}

describe('Phase 1: Duplicate Character Sprites & Stage Transitions', () => {
  it('buildGameData includes all canonical expressions when book.expressions is undefined, plus any used expressions', () => {
    const book = makeLanternaBook()
    expect(book.expressions).toBeUndefined()

    const gameData = buildGameData({
      book,
      theme: TEST_THEME,
      used: {
        backgrounds: ['bg_parlor'],
        sprites: [
          { charKey: 'signora_livia_brandolin', expression: 'neutral' },
          { charKey: 'signora_livia_brandolin', expression: 'happy' },
          { charKey: 'inspector_nada_ferluga', expression: 'neutral' },
          { charKey: 'inspector_nada_ferluga', expression: 'thinking' },
          { charKey: 'luka_bencic', expression: 'neutral' }
        ],
        cgs: []
      }
    })

    expect(gameData.characters.signora_livia_brandolin?.sprites.neutral).toBe('images/signora_livia_brandolin neutral.webp')
    expect(gameData.characters.signora_livia_brandolin?.sprites.happy).toBe('images/signora_livia_brandolin happy.webp')
    expect(gameData.characters.inspector_nada_ferluga?.sprites.thinking).toBe('images/inspector_nada_ferluga thinking.webp')

    // Without `used` filter, all 8 canonical expressions are emitted
    const unfiltered = buildGameData({ book, theme: TEST_THEME })
    for (const expr of CANONICAL_EXPRESSIONS) {
      expect(unfiltered.characters.signora_livia_brandolin?.sprites[expr]).toBe(
        `images/signora_livia_brandolin ${expr}.webp`
      )
    }
  })

  it('planScene deduplicates beat.cast by charKey and resolves slot collisions in cues.casts', () => {
    const scene: VnScene = {
      id: 'ch01.s01',
      placeKey: 'parlor',
      placeText: 'Parlor',
      backgroundId: 'bg_parlor',
      time: 'night',
      description: '',
      breakBefore: false,
      beats: [
        {
          id: 'ch01.s01.b001',
          type: 'cast',
          cast: [
            { charKey: 'inspector_nada_ferluga' },
            { charKey: 'inspector_nada_ferluga' },
            { charKey: 'luka_bencic' }
          ]
        }
      ]
    }

    const cues: StageCues = {
      menuMusic: null,
      chapters: {},
      scenes: {},
      casts: {
        'ch01.s01.b001': {
          inspector_nada_ferluga: 'left',
          luka_bencic: 'left'
        }
      }
    }

    const plan = planScene(scene, cues)
    const shows = plan.beats['ch01.s01.b001']?.shows ?? []
    expect(shows).toHaveLength(2)
    expect(shows[0]).toEqual({
      charKey: 'inspector_nada_ferluga',
      expression: 'neutral',
      slot: 'left'
    })
    expect(shows[1]).toEqual({
      charKey: 'luka_bencic',
      expression: 'neutral',
      slot: 'center'
    })
  })

  it('player-runtime clears previous slot when a character shifts from left to center and clears all slots on scene change', () => {
    const book = makeLanternaBook()
    const cues = defaultCues(book)
    const gameData = buildGameData({ book, theme: TEST_THEME, cues })
    // Simulate a missing 'happy' sprite on Livia to also verify fallback to 'neutral'
    delete gameData.characters.signora_livia_brandolin!.sprites.happy

    const { elementsById, startGame, advance } = createStageHarness(gameData)
    const slotLeft = elementsById.get('vno-slot-left')!
    const slotCenter = elementsById.get('vno-slot-center')!
    const slotRight = elementsById.get('vno-slot-right')!

    // Start game -> runs chapter card (auto-resolved by synchronous setTimeout in harness) -> scene 1, beat b003 (cast) -> auto-advances to b004 (line)
    startGame()

    // On b004: Nada is at left, Luka is at right, center is empty
    expect(slotLeft.querySelector('img')?.getAttribute('data-char')).toBe('inspector_nada_ferluga')
    expect(slotCenter.querySelector('img')).toBeNull()
    expect(slotRight.querySelector('img')?.getAttribute('data-char')).toBe('luka_bencic')

    // Advance to b011 (cast: Livia left, Nada center, Luka right) -> auto-advances to b012 (line)
    advance()

    // Nada moved to center; left now has Livia (using fallback neutral sprite), never a duplicate Nada!
    expect(slotLeft.querySelector('img')?.getAttribute('data-char')).toBe('signora_livia_brandolin')
    expect(slotCenter.querySelector('img')?.getAttribute('data-char')).toBe('inspector_nada_ferluga')
    expect(slotRight.querySelector('img')?.getAttribute('data-char')).toBe('luka_bencic')

    // Advance to next scene (ch01.s04) which has no cast beat -> all 3 stage slots must be cleared!
    advance()
    expect(slotLeft.innerHTML).toBe('')
    expect(slotCenter.innerHTML).toBe('')
    expect(slotRight.innerHTML).toBe('')
  })

  it('isProjectFinished returns true only when build step is done', () => {
    const base: ProjectSummary = {
      slug: 'test',
      title: 'Test',
      format: 'visual-novel',
      kind: 'linear',
      primaryLang: 'en',
      editions: [],
      theme: null,
      chapters: 1,
      characters: 1,
      places: 1,
      voice: false,
      assets: { total: 5, ready: 5, missing: 0, locked: 0, custom: 0 },
      warnings: 0,
      pipeline: null,
      updatedAt: '2026-10-24T00:00:00Z'
    }
    expect(isProjectFinished(base)).toBe(false)
    expect(
      isProjectFinished({
        ...base,
        pipeline: {
          run: 1,
          from: 'import',
          startedAt: '2026-10-24T00:00:00Z',
          steps: { build: { status: 'running', message: 'building', at: '2026-10-24T00:00:00Z' } }
        }
      })
    ).toBe(false)
    expect(
      isProjectFinished({
        ...base,
        pipeline: {
          run: 1,
          from: 'import',
          startedAt: '2026-10-24T00:00:00Z',
          steps: { build: { status: 'done', message: 'built', at: '2026-10-24T00:00:00Z' } }
        }
      })
    ).toBe(true)
  })
})
