import { describe, expect, it } from 'vitest'
import type { GameData } from '../src/engine/game/emit'
import { RTL_VARIABLES, renderRtl } from '../src/engine/game/rtl'
import { renderPlayerRuntime } from '../src/engine/game/player-runtime'

describe('Web Game Engine player runtime', () => {
  const runtime = renderPlayerRuntime()

  it('renders the_end restart handler cleanly in HTML and JS', () => {
    expect(runtime.html).toContain('id="vno-ending-card"')
    expect(runtime.html).toContain('id="vno-btn-restart"')
    expect(runtime.js).toContain("document.getElementById('vno-btn-restart').addEventListener('click', startGame)")
  })

  it('supports right-to-left layout in HTML, CSS, and direction attributes', () => {
    const rtlRuntime = renderPlayerRuntime({
      title: 'Arabic VN',
      slug: 'arabic-vn',
      primaryLang: 'ar',
      languages: [{ code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true }],
      rtlLangs: ['ar'],
      resolution: { w: 1920, h: 1080 },
      theme: {
        name: 'classic-dark',
        label: 'Classic Dark',
        description: '',
        light: false,
        pixel: false,
        colors: { accent: '#3b82f6', background: '#000', text: '#fff', idle: '#aaa', hover: '#fff', selected: '#3b82f6', insensitive: '#555', muted: '#6b7280' },
        fonts: { text: 'DejaVuSans.ttf' },
        sizes: { text: 32, name: 36, choice: 30 },
        transitions: { show: 0.2, fade: 0.5 },
        textbox: { color: '#000', opacity: 0.8, radius: 0 },
        namebox: { color: '#000', opacity: 0.8, radius: 0 },
        choice: { color: '#222', radius: 4 },
        frames: {}
      },
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

  it('registers window.VNOEngine for extensibility and plugins', () => {
    expect(runtime.js).toContain('window.VNOEngine =')
    expect(runtime.js).toContain('registerPuzzleKind')
    expect(runtime.js).toContain('registerBeatHandler')
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
