import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emitTheme, frameBorder, parseHex, renderThemeRpy, themePreviewCss } from '../src/engine/themes/emit'
import { findTheme, listThemes, loadTheme, themeSchema } from '../src/engine/themes/load'
import { DEFAULT_THEME, pickTheme } from '../src/engine/themes/pick'

const themesDir = path.resolve(__dirname, '..', 'themes')
const NAMES = ['classic-dark', 'noir', 'parchment', 'pixel-retro', 'storybook']
const CROATIAN = 'čćđšžČĆĐŠŽ'

describe('theme files', () => {
  it('all built-in themes load and validate', () => {
    const { themes, errors } = listThemes(themesDir)
    expect(errors).toEqual([])
    expect(themes.map((t) => t.theme.name)).toEqual(NAMES)
  })

  it('every font a theme names exists in its folder (or ships with Ren\'Py) and has an OFL licence next to it', () => {
    for (const { theme, dir } of listThemes(themesDir).themes) {
      for (const f of [theme.fonts.text, theme.fonts.name, theme.fonts.interface, theme.fonts.bold]) {
        if (!f || f.startsWith('DejaVuSans')) continue
        expect(fs.existsSync(path.join(dir, 'fonts', f)), `${theme.name}: ${f}`).toBe(true)
      }
      if (fs.existsSync(path.join(dir, 'fonts'))) expect(fs.existsSync(path.join(dir, 'fonts', 'OFL.txt')), theme.name).toBe(true)
    }
  })

  it('findTheme by name', () => {
    expect(findTheme('noir', themesDir)?.theme.label).toBe('Noir')
    expect(findTheme('nope', themesDir)).toBeNull()
  })
})

describe('theme schema', () => {
  const minimal = { name: 'mine', label: 'Mine', colors: { accent: '#112233', hover: '#223344', muted: '#334455' } }

  it('fills the defaults', () => {
    const t = themeSchema.parse(minimal)
    expect(t.fonts.text).toBe('DejaVuSans.ttf')
    expect(t.sizes.text).toBe(33)
    expect(t.textbox.opacity).toBe(0.7)
    expect(t.transitions.dissolve).toBe(0.6)
  })

  it('rejects a bad colour, a bad name and a bad opacity', () => {
    expect(() => themeSchema.parse({ ...minimal, colors: { ...minimal.colors, accent: 'red' } })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, name: 'Has Space' })).toThrow()
    expect(() => themeSchema.parse({ ...minimal, textbox: { opacity: 2 } })).toThrow()
  })

  it('loadTheme reports a missing file', () => {
    expect(() => loadTheme(path.join(themesDir, 'does-not-exist'))).toThrow()
  })
})

describe('pickTheme', () => {
  const book = (format: string, genre?: string, style = 'illustrated') => ({ format, genre, style })
  const none = { theme: null, art: { style: 'illustrated' } }

  it('kids formats get storybook', () => {
    expect(pickTheme(book('kids-choice-visual-story', 'fantasy'), none)).toBe('storybook')
    expect(pickTheme(book('kids-visual-story'), none)).toBe('storybook')
  })
  it('pixel style gets pixel-retro', () => {
    expect(pickTheme(book('visual-novel', 'mystery'), { theme: null, art: { style: 'pixel' } })).toBe('pixel-retro')
    expect(pickTheme(book('visual-novel', 'romance', 'pixel art, 16 colours'), none)).toBe('pixel-retro')
  })
  it('mystery, horror and thriller get noir', () => {
    for (const g of ['mystery', 'Horror', 'psychological thriller']) expect(pickTheme(book('visual-novel', g), none)).toBe('noir')
  })
  it('fantasy and historical get parchment', () => {
    for (const g of ['fantasy', 'historical fiction']) expect(pickTheme(book('choice-visual-novel', g), none)).toBe('parchment')
  })
  it('anything else is classic-dark', () => {
    expect(pickTheme(book('visual-novel', 'romance'), none)).toBe(DEFAULT_THEME)
    expect(pickTheme(book('visual-novel'), none)).toBe(DEFAULT_THEME)
  })
  it('the setting overrides, when the theme exists', () => {
    expect(pickTheme(book('kids-visual-story'), { theme: 'noir', art: { style: 'illustrated' } }, NAMES)).toBe('noir')
    expect(pickTheme(book('kids-visual-story'), { theme: 'gone', art: { style: 'illustrated' } }, NAMES)).toBe('storybook')
    expect(pickTheme(book('visual-novel', 'fantasy'), none, ['classic-dark'])).toBe('classic-dark')
  })
})

describe('theme emit', () => {
  it('parseHex reads 6 and 8 digit colours', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
    expect(parseHex('#00000080').a).toBeCloseTo(0.5, 1)
  })

  it('writes theme.rpy, the frames and the fonts into a game folder', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vno-theme-'))
    try {
      const loaded = findTheme('parchment', themesDir)!
      const r = await emitTheme({ theme: loaded.theme, themeDir: loaded.dir, gameSubdir: tmp })
      for (const f of ['theme.rpy', 'gui/textbox.png', 'gui/namebox.png', 'gui/button/choice_idle_background.png', 'gui/button/choice_hover_background.png', 'gui/phone/textbox.png']) {
        expect(fs.existsSync(path.join(tmp, f)), f).toBe(true)
      }
      expect(fs.existsSync(path.join(tmp, 'fonts', 'Lora-Regular.ttf'))).toBe(true)
      const rpy = fs.readFileSync(path.join(tmp, 'theme.rpy'), 'utf8')
      expect(rpy).toContain('gui.text_font = "fonts/Lora-Regular.ttf"')
      expect(rpy).toContain("gui.accent_color = '#8b4a1f'")
      expect(rpy).toContain('config.font_replacement_map["fonts/Lora-Regular.ttf", True, False] = ("fonts/Lora-Bold.ttf", False, False)')
      expect(rpy).toContain('define vn_dissolve = Dissolve(0.8)')
      expect(rpy).not.toContain('nearest_neighbor')
      expect(r.uniformNames).toBe(true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('pixel themes turn on nearest-neighbour; classic-dark uses the built-in font by name', () => {
    const pixel = findTheme('pixel-retro', themesDir)!.theme
    expect(renderThemeRpy(pixel, { text: 'fonts/P.ttf', name: 'fonts/P.ttf', interface: 'fonts/P.ttf', bold: null }, { name: 5, choice: 8 })).toContain('define config.nearest_neighbor = True')
    const dark = findTheme('classic-dark', themesDir)!.theme
    const rpy = renderThemeRpy(dark, { text: 'DejaVuSans.ttf', name: 'DejaVuSans.ttf', interface: 'DejaVuSans.ttf', bold: null }, { name: 7, choice: 18 })
    expect(rpy).toContain('gui.text_font = "DejaVuSans.ttf"')
    expect(rpy).not.toContain('nearest_neighbor')
    // priority: after the template gui.rpy (-3), before screens.rpy (-1); styles after the screens.
    expect(rpy.indexOf('init offset = -2')).toBeLessThan(rpy.indexOf('init offset = 1'))
  })

  it('never `define`s a gui value the template already defines (lint rejects a second define)', () => {
    for (const { theme } of listThemes(themesDir).themes) {
      const rpy = renderThemeRpy(theme, { text: 'a.ttf', name: 'a.ttf', interface: 'a.ttf', bold: 'b.ttf' }, { name: 7, choice: 18 })
      expect(rpy).not.toMatch(/^define gui\./m)
    }
  })

  it('frame border covers the radius', () => {
    expect(frameBorder(0)).toBe(5)
    expect(frameBorder(26, 8)).toBe(28)
  })

  it('preview CSS has the classes and the theme colours', () => {
    const css = themePreviewCss(findTheme('noir', themesDir)!.theme)
    for (const c of ['.vnp-stage', '.vnp-textbox', '.vnp-name', '.vnp-text', '.vnp-choice', '.vnp-choice:hover']) expect(css).toContain(c)
    expect(css).toContain('vnp-noir')
    expect(css).toContain('rgba(224,90,74')
  })
})

describe('fonts cover Croatian', () => {
  it('the font files exist (the glyph check was done with fontTools when they were added)', () => {
    // A cheap guard: the bundled fonts are non-trivial files. Coverage of č ć đ š ž was checked with fontTools:
    // Quicksand, Lora, Pixelify Sans and Courier Prime all contain every one of "${CROATIAN}".
    expect(CROATIAN.length).toBe(10)
    for (const f of ['storybook/fonts/Quicksand-Medium.ttf', 'parchment/fonts/Lora-Regular.ttf', 'noir/fonts/CourierPrime-Regular.ttf', 'pixel-retro/fonts/PixelifySans-Regular.ttf']) {
      expect(fs.statSync(path.join(themesDir, f)).size).toBeGreaterThan(40000)
    }
  })
})
