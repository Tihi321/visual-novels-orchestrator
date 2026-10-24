import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGameData, type GameData } from '../src/engine/game/emit'
import { RTL_VARIABLES, renderRtl } from '../src/engine/game/rtl'
import { renderPlayerRuntime } from '../src/engine/game/player-runtime'
import { buildBook, storyInputSchema } from '../src/engine/vn/story'
import { puzzleCoreSchema, puzzleEntrySchema } from '../src/shared/puzzle'
import type { Edition, VnBook } from '../src/shared/vn'
import type { Theme } from '../src/engine/themes/load'

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

/**
 * Lightweight DOM harness to execute the generated `player.js` in Node without external browser deps.
 */
function createPlayerHarness(gameData: GameData) {
  const elementsById = new Map<string, FakeElement>()
  const allElements: FakeElement[] = []

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
    toString() {
      return [...this.set].join(' ')
    }
  }

  class FakeElement {
    tagName: string
    private _id = ''
    title = ''
    value = ''
    src = ''
    alt = ''
    loop = false
    selected = false
    paused = true
    currentTime = 0
    duration = 10
    volume = 1
    ontimeupdate: (() => void) | null = null
    onended: (() => void) | null = null
    onclick: ((e?: unknown) => void) | null = null
    style: Record<string, string> = {}
    attrs = new Map<string, string>()
    children: FakeElement[] = []
    parent: FakeElement | null = null
    classList = new ClassList()
    listeners = new Map<string, Array<(e: unknown) => void>>()
    private _textContent = ''
    private _innerHTML = ''

    constructor(tagName: string, id = '', classes = '') {
      this.tagName = tagName.toUpperCase()
      this.classList = new ClassList(classes)
      if (id) this.id = id
      allElements.push(this)
    }

    get id() {
      return this._id
    }
    set id(v: string) {
      this._id = String(v ?? '')
      if (this._id) elementsById.set(this._id, this)
    }

    get className() {
      return this.classList.toString()
    }
    set className(v: string) {
      this.classList = new ClassList(v)
    }

    get textContent(): string {
      if (this.children.length > 0 && !this._textContent) {
        return this.children.map((c) => c.textContent).join('')
      }
      return this._textContent
    }
    set textContent(v: string) {
      this._textContent = String(v ?? '')
      this._innerHTML = this._textContent
    }

    get innerHTML(): string {
      if (this.children.length > 0 && !this._innerHTML) {
        return this.children.map((c) => c.innerHTML || c.textContent).join('')
      }
      return this._innerHTML
    }
    set innerHTML(v: string) {
      this._innerHTML = String(v ?? '')
      this._textContent = this._innerHTML.replace(/<[^>]+>/g, '')
      if (v === '') {
        this.children = []
      }
    }

    setAttribute(k: string, v: string) {
      this.attrs.set(k, String(v))
      if (k === 'id') {
        this.id = String(v)
        elementsById.set(this.id, this)
      }
    }
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null
    }

    appendChild(child: FakeElement) {
      child.parent = this
      this.children.push(child)
      if (this.tagName === 'SELECT' && (child.selected || this.children.length === 1)) {
        this.value = child.value
      }
      return child
    }

    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }

    dispatchEvent(type: string, eventInit: Record<string, unknown> = {}) {
      let stopped = false
      const evt = {
        type,
        target: this,
        stopPropagation: () => {
          stopped = true
        },
        preventDefault: () => {},
        ...eventInit
      }
      for (const fn of this.listeners.get(type) ?? []) {
        fn(evt)
      }
      if (type === 'click' && this.onclick) {
        this.onclick(evt)
      }
      if (!stopped && this.parent) {
        this.parent.dispatchEvent(type, { ...eventInit, target: evt.target })
      }
      return !stopped
    }

    click() {
      return this.dispatchEvent('click')
    }

    change(newValue: string) {
      this.value = newValue
      return this.dispatchEvent('change')
    }

    play() {
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }

    querySelector(sel: string): FakeElement | null {
      if (sel === 'img') {
        return this.children.find((c) => c.tagName === 'IMG') ?? null
      }
      if (sel.startsWith('.')) {
        const cls = sel.slice(1)
        return this.querySelectorAll(`.${cls}`)[0] ?? null
      }
      return null
    }

    querySelectorAll(sel: string): FakeElement[] {
      const out: FakeElement[] = []
      const visit = (el: FakeElement) => {
        for (const ch of el.children) {
          if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) out.push(ch)
          else if (sel.toUpperCase() === ch.tagName) out.push(ch)
          visit(ch)
        }
      }
      visit(this)
      return out
    }
  }

  // Parse IDs and classes from generated index.html so the harness mirrors the real DOM
  const runtime = renderPlayerRuntime(gameData)
  const tagRegex = /<([a-zA-Z0-9]+)\b([^>]*)>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(runtime.html)) !== null) {
    const tag = match[1]!
    const attrStr = match[2]!
    const idMatch = /\bid="([^"]+)"/.exec(attrStr)
    const classMatch = /\bclass="([^"]+)"/.exec(attrStr)
    if (idMatch || (classMatch && classMatch[1]!.includes('vno-screen-close'))) {
      new FakeElement(tag, idMatch ? idMatch[1]! : '', classMatch ? classMatch[1]! : '')
    }
  }

  // Parent `#vno-lang-bar` and `#vno-chapter-card` under `#vno-stage` to test event propagation
  const stageEl = elementsById.get('vno-stage')!
  const langBarEl = elementsById.get('vno-lang-bar')!
  const stageSelectEl = elementsById.get('vno-stage-language')!
  stageEl.appendChild(langBarEl)
  langBarEl.appendChild(stageSelectEl)

  const docElement = new FakeElement('html')
  const storage = new Map<string, string>()
  let domLoadedHandler: (() => void) | null = null

  const fakeDocument = {
    title: gameData.title,
    fullscreenElement: null,
    documentElement: docElement,
    getElementById: (id: string) => elementsById.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
    querySelectorAll: (sel: string) => {
      if (sel === '.vno-screen-close') {
        return allElements.filter((e) => e.classList.contains('vno-screen-close'))
      }
      return []
    },
    addEventListener: (evt: string, fn: () => void) => {
      if (evt === 'DOMContentLoaded') domLoadedHandler = fn
    },
    exitFullscreen: () => Promise.resolve()
  }

  interface FakePlayerWindow {
    innerWidth: number
    innerHeight: number
    VNO_GAME_DATA: GameData
    VNOEngine: unknown
    addEventListener: (type: string, fn: (e: unknown) => void) => void
    dispatchEvent: (type: string, evt?: unknown) => void
  }

  const windowListeners = new Map<string, Array<(e: unknown) => void>>()
  const fakeWindow: FakePlayerWindow = {
    innerWidth: 1920,
    innerHeight: 1080,
    VNO_GAME_DATA: gameData,
    VNOEngine: null,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const list = windowListeners.get(type) ?? []
      list.push(fn)
      windowListeners.set(type, list)
    },
    dispatchEvent: (type: string, evt: unknown = {}) => {
      for (const fn of windowListeners.get(type) ?? []) fn(evt)
    }
  }

  const fakeLocalStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v)
  }

  const runner = new Function('window', 'document', 'localStorage', runtime.js)
  runner(fakeWindow, fakeDocument, fakeLocalStorage)
  if (domLoadedHandler) (domLoadedHandler as () => void)()

  // Set textSpeed to 100 so typewriter completes synchronously in tests unless testing mid-typewriter
  const speedInput = elementsById.get('vno-pref-text-speed')!
  speedInput.value = '100'
  speedInput.dispatchEvent('input')

  return {
    window: fakeWindow as FakePlayerWindow & {
      VNOEngine: {
        getState: () => { chapterIdx: number; sceneIdx: number; beatIdx: number; lang: string }
        getLanguages: () => Array<{ code: string; name: string; nativeName: string }>
        switchLanguage: (code: string) => void
        advance: () => void
      }
    },
    document: fakeDocument,
    getById: (id: string) => elementsById.get(id)!
  }
}

describe('Web Game Engine player runtime', () => {
  const runtime = renderPlayerRuntime()

  it('renders the_end restart handler cleanly in HTML and JS', () => {
    expect(runtime.html).toContain('id="vno-ending-card"')
    expect(runtime.html).toContain('id="vno-btn-restart"')
    expect(runtime.js).toContain("document.getElementById('vno-btn-restart').addEventListener('click', startGame)")
  })

  it('emits persistent stage language dropdown (#vno-lang-bar / #vno-stage-language) above all screens', () => {
    expect(runtime.html).toContain('id="vno-lang-bar"')
    expect(runtime.html).toContain('id="vno-stage-language"')
    expect(runtime.html).toContain('id="vno-pref-language"')
    expect(runtime.css).toContain('.vno-lang-bar')
    expect(runtime.css).toContain('z-index: 200')
    expect(runtime.css).toContain('[dir="rtl"] .vno-lang-bar')
  })

  it('supports right-to-left layout in HTML, CSS, and direction attributes', () => {
    const rtlRuntime = renderPlayerRuntime({
      title: 'Arabic VN',
      slug: 'arabic-vn',
      primaryLang: 'ar',
      languages: [{ code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true }],
      rtlLangs: ['ar'],
      resolution: { w: 1920, h: 1080 },
      theme: TEST_THEME,
      characters: {},
      backgrounds: {},
      cgs: {},
      audio: { music: {}, sfx: {}, ambience: {} },
      chapters: [],
      editions: {},
      puzzles: {}
    } as unknown as GameData)
    expect(rtlRuntime.html).toContain('dir="rtl"')
    expect(rtlRuntime.css).toContain('direction: rtl')
  })

  it('supports puzzle screens for murdle, logic, knights, testimony, and quiz', () => {
    for (const kind of ['murdle', 'logic', 'knights', 'testimony', 'quiz']) {
      expect(runtime.js).toContain(kind)
    }
    expect(runtime.html).toContain('id="vno-puzzle-overlay"')
  })

  it('registers window.VNOEngine for extensibility, plugins, and language switching', () => {
    expect(runtime.js).toContain('window.VNOEngine =')
    expect(runtime.js).toContain('registerPuzzleKind')
    expect(runtime.js).toContain('registerBeatHandler')
    expect(runtime.js).toContain('switchLanguage: switchLanguage')
    expect(runtime.js).toContain('getLanguages:')
  })

  it('switches language live from any screen (Main Menu, Chapter Card, Dialogue + Alias, Choices, Puzzle, History, Ending) and continues in the selected language', () => {
    const baseBook = buildBook(
      storyInputSchema.parse({
        title: 'Das Laternenrätsel',
        kind: 'choice',
        characters: [
          {
            key: 'mara',
            name: 'Mara',
            aliases: ['Die Fremde'],
            looks: 'a sharp-eyed investigator',
            expressions: ['neutral']
          }
        ],
        places: [{ key: 'harbour', name: 'Hafen', looks: 'a misty harbour' }],
        chapters: [
          {
            title: 'Kapitel Eins: Der Nebel',
            choices: [
              { text: 'Frage den Hafenmeister', to: 2 },
              { text: 'Untersuche das Boot', to: 2 }
            ],
            scenes: [
              {
                place: 'harbour',
                beats: [
                  { speaker: 'Die Fremde', text: 'Guten Abend. Es ist **sehr** kalt.' },
                  { text: 'Der Nebel zog über den Kai.' },
                  { puzzle: 'case1' }
                ]
              }
            ]
          },
          {
            title: 'Kapitel Zwei: Das Urteil',
            ending: 'Der Fall wurde gelöst.',
            scenes: [
              {
                place: 'harbour',
                beats: [{ speaker: 'Mara', text: 'Wir haben die Wahrheit gefunden.' }]
              }
            ]
          }
        ]
      }),
      { slug: 'lantern-case', lang: 'de' }
    ).book

    const b1Id = baseBook.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'line')!.id
    const b2Id = baseBook.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'narration')!.id
    const b4Id = baseBook.chapters[1]!.scenes[0]!.beats.find((b) => b.type === 'line')!.id

    const fixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'fixtures', 'puzzles', 'murdle-medium-1.json'), 'utf8')
    ) as Record<string, unknown> & { names: Record<string, string>; text: Record<string, string> }

    const book: VnBook = {
      ...baseBook,
      puzzles: [
        puzzleEntrySchema.parse({
          key: 'case1',
          kind: 'murdle',
          data: puzzleCoreSchema.parse(fixture),
          names: { ...fixture.names, s1: 'Graf Viktor' },
          text: { ...fixture.text, murder: 'Der Mord geschah um Mitternacht.', c1: 'Graf Viktor war im Salon.' },
          verified: { unique: true, deducible: true, score: 37, textChecked: true, by: 'test' }
        })
      ]
    }

    const deEdition: Edition = {
      lang: 'de',
      title: 'Das Laternenrätsel',
      characterNames: { mara: 'Mara', 'mara#1': 'Die Fremde' },
      chapterTitles: { 1: 'Kapitel Eins: Der Nebel', 2: 'Kapitel Zwei: Das Urteil' },
      choiceTexts: { '1:0': 'Frage den Hafenmeister', '1:1': 'Untersuche das Boot' },
      endings: { 2: 'Der Fall wurde gelöst.' },
      beats: {
        [b1Id]: 'Guten Abend. Es ist **sehr** kalt.',
        [b2Id]: 'Der Nebel zog über den Kai.',
        [b4Id]: 'Wir haben die Wahrheit gefunden.'
      },
      puzzles: {
        case1: {
          names: { s1: 'Graf Viktor' },
          text: { murder: 'Der Mord geschah um Mitternacht.', c1: 'Graf Viktor war im Salon.' }
        }
      }
    }

    const enEdition: Edition = {
      lang: 'en',
      title: 'The Lantern Mystery',
      characterNames: { mara: 'Mara', 'mara#1': 'The Stranger' },
      chapterTitles: { 1: 'Chapter One: The Fog', 2: 'Chapter Two: The Verdict' },
      choiceTexts: { '1:0': 'Ask the harbourmaster', '1:1': 'Inspect the boat' },
      endings: { 2: 'The case was solved.' },
      beats: {
        [b1Id]: 'Good evening. It is **very** cold.',
        [b2Id]: 'The fog drifted across the quay.',
        [b4Id]: 'We have found the truth.'
      },
      puzzles: {
        case1: {
          names: { s1: 'Count Viktor' },
          text: { murder: 'The murder happened at midnight.', c1: 'Count Viktor was in the drawing room.' }
        }
      }
    }

    const hrEdition: Edition = {
      lang: 'hr',
      title: 'Zagonetka lanterne',
      characterNames: { mara: 'Mara', 'mara#1': 'Tuđinka' },
      chapterTitles: { 1: 'Prvo poglavlje: Magla', 2: 'Drugo poglavlje: Presuda' },
      choiceTexts: { '1:0': 'Pitaj lučkog kapetana', '1:1': 'Pregledaj čamac' },
      endings: { 2: 'Slučaj je riješen.' },
      beats: {
        [b1Id]: 'Dobra večer. **Jako** je hladno.',
        [b2Id]: 'Magla se spustila nad pristanište.',
        [b4Id]: 'Pronašli smo istinu.'
      },
      puzzles: {
        case1: {
          names: { s1: 'Grof Viktor' },
          text: { murder: 'Ubojstvo se dogodilo u ponoć.', c1: 'Grof Viktor bio je u salonu.' }
        }
      }
    }

    const gameData = buildGameData({
      book,
      theme: TEST_THEME,
      primaryEdition: deEdition,
      editions: [deEdition, enEdition, hrEdition]
    })

    // 1. Verify buildGameData deduplicates languages and sets speakerAliasKey
    expect(gameData.languages.map((l) => l.code)).toEqual(['de', 'en', 'hr'])
    expect(gameData.chapters[0]!.scenes[0]!.beats[0]!.speakerAliasKey).toBe('mara#1')

    const h = createPlayerHarness(gameData)
    const stageLang = h.getById('vno-stage-language')
    const prefLang = h.getById('vno-pref-language')

    // 2. Starts in primary language ('de') on Main Menu
    expect(h.window.VNOEngine.getState().lang).toBe('de')
    expect(stageLang.value).toBe('de')
    expect(prefLang.value).toBe('de')
    expect(h.getById('vno-mm-title').textContent).toBe('Das Laternenrätsel')
    expect(h.getById('vno-mm-start').textContent).toBe('Start')

    // 3. Switch language on Main Menu to Croatian ('hr') -> updates title & menu buttons immediately
    stageLang.change('hr')
    expect(h.window.VNOEngine.getState().lang).toBe('hr')
    expect(prefLang.value).toBe('hr')
    expect(h.getById('vno-mm-title').textContent).toBe('Zagonetka lanterne')
    expect(h.getById('vno-mm-start').textContent).toBe('Započni')
    // Switch back to German ('de') before starting
    stageLang.change('de')
    expect(h.getById('vno-mm-title').textContent).toBe('Das Laternenrätsel')

    // 4. Click Start -> Chapter 1 Title Card is shown in German
    h.getById('vno-mm-start').click()
    const chapterCard = h.getById('vno-chapter-card')
    const chapterCardText = h.getById('vno-chapter-card-text')
    expect(chapterCard.classList.contains('vno-hidden')).toBe(false)
    expect(chapterCardText.textContent).toBe('Kapitel Eins: Der Nebel')

    // Clicking the language bar does NOT dismiss the chapter card
    h.getById('vno-lang-bar').click()
    expect(chapterCard.classList.contains('vno-hidden')).toBe(false)

    // Switch language on Chapter Card to English ('en') -> updates chapter card text immediately
    stageLang.change('en')
    expect(chapterCardText.textContent).toBe('Chapter One: The Fog')

    // 5. Dismiss Chapter Card -> Beat 1 (Dialogue with alias) starts in English ('en', the language we switched to!)
    chapterCard.click()
    expect(chapterCard.classList.contains('vno-hidden')).toBe(true)
    expect(h.getById('vno-speaker-name').textContent).toBe('The Stranger')
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('Good evening. It is <strong>very</strong> cold.')

    // Switch language mid-dialogue to Croatian ('hr') -> immediately updates current line and alias name
    stageLang.change('hr')
    expect(h.getById('vno-speaker-name').textContent).toBe('Tuđinka')
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('Dobra večer. <strong>Jako</strong> je hladno.')

    // Switch to German ('de') and back to English ('en') on the same beat
    stageLang.change('de')
    expect(h.getById('vno-speaker-name').textContent).toBe('Die Fremde')
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('Guten Abend. Es ist <strong>sehr</strong> kalt.')
    stageLang.change('en')
    expect(h.getById('vno-speaker-name').textContent).toBe('The Stranger')
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('Good evening. It is <strong>very</strong> cold.')

    // 6. Advance to Beat 2 (Narration) -> continues in English ('en')!
    h.getById('vno-textbox-container').click()
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('The fog drifted across the quay.')
    // Switch to Croatian ('hr') on narration beat
    stageLang.change('hr')
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('Magla se spustila nad pristanište.')

    // 7. Open History screen and switch language while History is open -> all logged beats re-render in the chosen language
    h.getById('vno-qm-history').click()
    const historyScreen = h.getById('vno-screen-history')
    const historyList = h.getById('vno-history-list')
    expect(historyScreen.classList.contains('vno-hidden')).toBe(false)
    expect(historyList.innerHTML).toContain('Tuđinka')
    expect(historyList.innerHTML).toContain('Dobra večer.')
    stageLang.change('en')
    expect(historyList.innerHTML).toContain('The Stranger')
    expect(historyList.innerHTML).toContain('Good evening.')
    expect(historyList.innerHTML).toContain('The fog drifted across the quay.')
    h.getById('vno-screen-history').classList.add('vno-hidden')

    // 8. Advance to Beat 3 (Interactive Puzzle) -> opens in English ('en')
    h.getById('vno-textbox-container').click()
    const puzzleOverlay = h.getById('vno-puzzle-overlay')
    const puzzleBody = h.getById('vno-puzzle-body')
    expect(puzzleOverlay.classList.contains('vno-hidden')).toBe(false)
    const cluesEn = puzzleBody.querySelectorAll('.vno-clue-item')
    expect(cluesEn[0]!.textContent).toBe('Count Viktor was in the drawing room.')
    // Strike the first clue, then switch to German ('de') -> clue text updates and struck state is preserved!
    cluesEn[0]!.click()
    expect(cluesEn[0]!.classList.contains('struck')).toBe(true)
    stageLang.change('de')
    const cluesDe = puzzleBody.querySelectorAll('.vno-clue-item')
    expect(cluesDe[0]!.textContent).toBe('Graf Viktor war im Salon.')
    expect(cluesDe[0]!.classList.contains('struck')).toBe(true)
    const namesDe = puzzleBody.querySelectorAll('.vno-puzzle-name-item')
    expect(namesDe.map((n) => n.textContent)).toContain('Graf Viktor')
    // Switch to Croatian ('hr') on puzzle screen
    stageLang.change('hr')
    expect(puzzleBody.querySelectorAll('.vno-clue-item')[0]!.textContent).toBe('Grof Viktor bio je u salonu.')
    expect(puzzleBody.querySelectorAll('.vno-puzzle-name-item').map((n) => n.textContent)).toContain('Grof Viktor')

    // 9. Solve puzzle -> Chapter 1 ends with Branching Choices in Croatian ('hr')
    h.getById('vno-puzzle-btn-submit').click()
    const choiceOverlay = h.getById('vno-choice-overlay')
    const choiceContainer = h.getById('vno-choice-container')
    expect(choiceOverlay.classList.contains('vno-hidden')).toBe(false)
    expect(choiceContainer.children.map((b) => b.textContent)).toEqual([
      'Pitaj lučkog kapetana',
      'Pregledaj čamac'
    ])
    // Switch language on Choice screen to English ('en') -> choice labels update immediately
    stageLang.change('en')
    expect(choiceContainer.children.map((b) => b.textContent)).toEqual([
      'Ask the harbourmaster',
      'Inspect the boat'
    ])

    // 10. Pick Choice 0 -> jumps to Chapter 2 in English ('en')
    choiceContainer.children[0]!.click()
    expect(chapterCardText.textContent).toBe('Chapter Two: The Verdict')
    chapterCard.click()
    expect(h.getById('vno-dialogue-text').innerHTML).toBe('We have found the truth.')

    // 11. Advance past Chapter 2 -> Ending Card shown in English ('en'), switchable to German ('de') and Croatian ('hr')
    h.getById('vno-textbox-container').click()
    const endingCard = h.getById('vno-ending-card')
    const endingText = h.getById('vno-ending-card-text')
    expect(endingCard.classList.contains('vno-hidden')).toBe(false)
    expect(endingText.textContent).toBe('The case was solved.')
    stageLang.change('de')
    expect(endingText.textContent).toBe('Der Fall wurde gelöst.')
    expect(h.getById('vno-btn-restart').textContent).toBe('Von vorn beginnen')
    stageLang.change('hr')
    expect(endingText.textContent).toBe('Slučaj je riješen.')
    expect(h.getById('vno-btn-restart').textContent).toBe('Počni ispočetka')
  })
})

describe('right-to-left layout', () => {
  it('the table holds the template values: each ltr value has its mirrored counterpart', () => {
    for (const v of RTL_VARIABLES) {
      expect(typeof v.name).toBe('string')
      expect(typeof v.ltr).toBe('number')
      expect(typeof v.mirrored(1920)).toBe('number')
    }
  })

  it('mirrors the layout for Arabic at 1920x1080', () => {
    const rpy = renderRtl(['arabic'], ['None', 'croatian'], 1920)
    expect(rpy).toContain('define config.rtl = True')
    const arabic = rpy.slice(rpy.indexOf('translate arabic python:'), rpy.indexOf('translate None python:'))
    expect(arabic).toContain('    gui.name_xpos = 1560\n')
    expect(arabic).toContain('    gui.name_xalign = 1.0\n')
    expect(arabic).toContain('    gui.dialogue_text_xalign = 1.0\n')
    expect(arabic).toContain('    gui.navigation_xpos = 1860\n')
    expect(arabic).toContain('    gui.navigation_xanchor = 1.0\n')
    expect(arabic).toContain('    gui.main_menu_text_xalign = 0.0\n')
    expect(arabic).toContain('    gui.history_name_xpos = 1687\n')
    expect(arabic).toContain('    gui.history_text_xalign = 1.0\n')
    expect(arabic).not.toContain('choice_button_text_xalign')
    // the other languages of the game get the template values back, so switching language mirrors and unmirrors
    const none = rpy.slice(rpy.indexOf('translate None python:'), rpy.indexOf('translate croatian python:'))
    expect(none).toContain('    gui.name_xpos = 360\n')
    expect(none).toContain('    gui.navigation_xanchor = 0.0\n')
    expect(rpy).toContain('translate croatian python:')
  })

  it('uses the screen width for the positions (1280x720)', () => {
    const rpy = renderRtl(['hebrew'], [], 1280)
    expect(rpy).toContain('    gui.name_xpos = 920\n')
    expect(rpy).toContain('    gui.navigation_xpos = 1220\n')
    expect(rpy).toContain('    gui.history_name_xpos = 1047\n')
    expect(rpy).not.toContain('translate None')
  })
})

describe('VNO-42: Web Player Audio Continuity and Responsive Stage Scaling', () => {
  function getSampleBook() {
    return buildBook(
      storyInputSchema.parse({
        title: 'Scaling Test',
        kind: 'linear',
        characters: [{ key: 'alex', name: 'Alex', looks: 'a person' }],
        places: [
          { key: 'studio', name: 'Studio', looks: 'a studio' },
          { key: 'street', name: 'Street', looks: 'a street' }
        ],
        chapters: [
          {
            title: 'Chapter 1',
            scenes: [
              {
                place: 'studio',
                beats: [{ speaker: 'Alex', text: 'Hello world.' }]
              }
            ]
          }
        ]
      }),
      { slug: 'scaling-case', lang: 'en' }
    ).book
  }

  it('responsive stage scaling computes translate(-50%, -50%) scale(...) and 50% left/top across aspect ratios', () => {
    const book = getSampleBook()
    const gd = buildGameData({ book, theme: TEST_THEME })
    const h = createPlayerHarness(gd)
    const stage = h.getById('vno-stage')

    // Standard 1920x1080 -> scale(1)
    expect(stage.style.left).toBe('50%')
    expect(stage.style.top).toBe('50%')
    expect(stage.style.transform).toBe('translate(-50%, -50%) scale(1)')

    // Ultrawide (1024x380) -> scale = min(1024/1920, 380/1080) = 380/1080
    h.window.innerWidth = 1024
    h.window.innerHeight = 380
    h.window.dispatchEvent('resize')
    const ultrawideScale = Math.min(1024 / 1920, 380 / 1080)
    expect(stage.style.left).toBe('50%')
    expect(stage.style.top).toBe('50%')
    expect(stage.style.transform).toBe(`translate(-50%, -50%) scale(${ultrawideScale})`)

    // Tall mobile viewport (800x1200) -> scale = min(800/1920, 1200/1080) = 800/1920
    h.window.innerWidth = 800
    h.window.innerHeight = 1200
    h.window.dispatchEvent('resize')
    const tallScale = Math.min(800 / 1920, 1200 / 1080)
    expect(stage.style.left).toBe('50%')
    expect(stage.style.top).toBe('50%')
    expect(stage.style.transform).toBe(`translate(-50%, -50%) scale(${tallScale})`)
  })

  it('music loops infinitely by default when loopStart is not specified', () => {
    const book = getSampleBook()
    const gd = buildGameData({
      book,
      theme: TEST_THEME,
      music: { music_01: 'audio/bgm.ogg' }
    })
    const h = createPlayerHarness(gd)
    const audio = h.getById('vno-audio-music')

    // Start game
    h.getById('vno-mm-start').click()
    expect(audio.src).toContain('audio/bgm.ogg')
    expect(audio.loop).toBe(true)
    expect(audio.ontimeupdate).toBeNull()
    expect(audio.onended).toBeNull()
  })

  it('music with loopStartSec > 0 sets loop=false and rewinds via ontimeupdate and onended', () => {
    const book = getSampleBook()
    const gd = buildGameData({
      book,
      theme: TEST_THEME,
      music: { music_01: 'audio/bgm.ogg' },
      musicLoops: { music_01: 4.5 }
    })
    const h = createPlayerHarness(gd)
    const audio = h.getById('vno-audio-music')

    h.getById('vno-mm-start').click()
    expect(audio.loop).toBe(false)
    expect(typeof audio.ontimeupdate).toBe('function')
    expect(typeof audio.onended).toBe('function')

    // Simulate ontimeupdate threshold rewind
    audio.currentTime = audio.duration - 0.1
    audio.ontimeupdate!()
    expect(audio.currentTime).toBe(4.5)

    // Simulate onended handler rewind
    audio.currentTime = audio.duration
    audio.onended!()
    expect(audio.currentTime).toBe(4.5)
    expect(audio.paused).toBe(false)
  })

  it('first user interaction unlocks deferred background music', () => {
    const book = getSampleBook()
    const gd = buildGameData({
      book,
      theme: TEST_THEME,
      music: { music_01: 'audio/bgm.ogg' }
    })
    const h = createPlayerHarness(gd)
    const audio = h.getById('vno-audio-music')

    // Start game, then simulate browser pausing due to autoplay deferral
    h.getById('vno-mm-start').click()
    audio.paused = true

    // Trigger user click on window
    h.window.dispatchEvent('click')
    expect(audio.paused).toBe(false)
  })

  it('buildGameData falls back to chapter music when scene music is omitted, and flags explicit null', () => {
    const book = buildBook(
      storyInputSchema.parse({
        title: 'Music Fallback Test',
        kind: 'linear',
        characters: [{ key: 'alex', name: 'Alex', looks: 'a person' }],
        places: [
          { key: 'studio', name: 'Studio', looks: 'a studio' },
          { key: 'street', name: 'Street', looks: 'a street' }
        ],
        chapters: [
          {
            title: 'Chapter 1',
            scenes: [
              {
                place: 'studio',
                beats: [{ speaker: 'Alex', text: 'Scene 1 with chapter music.' }]
              },
              {
                place: 'street',
                beats: [{ speaker: 'Alex', text: 'Scene 2 with silent override.' }]
              }
            ]
          }
        ]
      }),
      { slug: 'music-fallback', lang: 'en' }
    ).book

    const cues = {
      menuMusic: 'music_01',
      chapters: {
        1: { music: 'music_01' }
      },
      scenes: {
        [book.chapters[0]!.scenes[1]!.id]: {
          transition: 'fade' as const,
          music: null
        }
      },
      casts: {}
    }
    const gd = buildGameData({
      book,
      theme: TEST_THEME,
      cues,
      music: { music_01: 'audio/chapter.ogg' }
    })

    const ch = gd.chapters[0]!
    expect(ch.music).toBe('music_01')

    // Scene 0 inherits chapter theme
    expect(ch.scenes[0]!.music).toBe('music_01')
    expect(ch.scenes[0]!.musicExplicitNull).toBe(false)

    // Scene 1 explicitly silences music
    expect(ch.scenes[1]!.music).toBeNull()
    expect(ch.scenes[1]!.musicExplicitNull).toBe(true)
  })
})
