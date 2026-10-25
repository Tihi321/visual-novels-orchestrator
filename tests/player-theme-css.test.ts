import { describe, expect, it } from 'vitest'
import type { Theme } from '../src/engine/themes/load'
import { contrastRatio, mixHex, parseHex, readableOn, relativeLuminance, renderThemeCss, themePreviewCss } from '../src/engine/themes/emit'

/** VNO-48: the player's interface tokens, computed from the theme so they read on light and dark themes. */

const FONTS = { text: 'DejaVuSans.ttf', name: 'DejaVuSans.ttf', interface: 'DejaVuSans.ttf', bold: null }

const base: Omit<Theme, 'name' | 'label' | 'light' | 'colors' | 'textbox' | 'namebox' | 'choice'> = {
  description: '',
  pixel: false,
  fonts: { text: 'DejaVuSans.ttf', name: 'DejaVuSans.ttf', interface: 'DejaVuSans.ttf' },
  sizes: { text: 32, name: 36, interface: 28, label: 28, title: 48, choice: 30 },
  transitions: { show: 0.2, fade: 0.5, dissolve: 0.2 },
  frames: {}
}

const cream: Theme = {
  ...base,
  name: 'storybook',
  label: 'Storybook',
  light: true,
  colors: { accent: '#e2703a', background: '#f9ecd7', text: '#3a2a1c', idle: '#6b4a33', hover: '#3a2a1c', selected: '#e2703a', insensitive: '#b7a28c', muted: '#8a735f' },
  textbox: { color: '#f9ecd7', opacity: 0.85, borderColor: null, radius: 8 },
  namebox: { color: '#3a2a1c', opacity: 0.9, radius: 6, textColor: null },
  choice: { color: '#f1e0c3', borderColor: null, radius: 6 }
}

const dark: Theme = {
  ...base,
  name: 'classic-dark',
  label: 'Classic Dark',
  light: false,
  colors: { accent: '#3b82f6', background: '#101018', text: '#ffffff', idle: '#aaaaaa', hover: '#ffffff', selected: '#3b82f6', insensitive: '#555555', muted: '#6b7280' },
  textbox: { color: '#000000', opacity: 0.8, borderColor: null, radius: 0 },
  namebox: { color: '#000000', opacity: 0.8, radius: 0, textColor: null },
  choice: { color: '#222222', borderColor: null, radius: 4 }
}

/** The value of a custom property in the emitted CSS. */
function token(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css)
  expect(match, `${name} is not in the stylesheet`).toBeTruthy()
  return match![1]!.trim()
}

const UI_TOKENS = [
  '--vno-ui-scrim',
  '--vno-ui-surface',
  '--vno-ui-surface-2',
  '--vno-ui-text',
  '--vno-ui-text-muted',
  '--vno-ui-border',
  '--vno-ui-control-bg',
  '--vno-ui-control-text',
  '--vno-ui-focus',
  '--vno-page-caption-size'
]

describe('renderThemeCss: the player interface tokens', () => {
  it.each([
    ['cream daylight theme', cream, true],
    ['classic dark theme', dark, false]
  ] as const)('%s emits every token, with readable text on its own surface', (_label, theme, light) => {
    const css = renderThemeCss(theme, FONTS)
    for (const name of UI_TOKENS) expect(css, name).toContain(`${name}: `)
    // the existing tokens are still there
    expect(css).toContain('--vno-color-accent: ')
    expect(css).toContain('--vno-textbox-bg: ')

    const surface = token(css, '--vno-ui-surface')
    const surface2 = token(css, '--vno-ui-surface-2')
    const text = token(css, '--vno-ui-text')
    const controlBg = token(css, '--vno-ui-control-bg')
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5)
    // light theme: dark interface text on a light surface; dark theme: light text on a dark surface
    expect(relativeLuminance(text) < 0.5).toBe(light)
    expect(relativeLuminance(surface) > 0.5).toBe(light)
    // surface-2 is one step further from the background than the surface
    if (light) expect(relativeLuminance(surface2)).toBeLessThan(relativeLuminance(surface))
    else expect(relativeLuminance(surface2)).toBeGreaterThan(relativeLuminance(surface))
    // secondary labels stay readable, controls read on their own background, focus has 3:1
    expect(contrastRatio(token(css, '--vno-ui-text-muted'), surface)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(token(css, '--vno-ui-control-text'), controlBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(token(css, '--vno-ui-focus'), surface)).toBeGreaterThanOrEqual(3)
    // the scrim is lighter on a light theme
    expect(token(css, '--vno-ui-scrim')).toBe(light ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.85)')
    expect(token(css, '--vno-page-caption-size')).toBe(`${Math.min(56, Math.max(40, Math.round(theme.sizes.text * 1.6)))}px`)
  })

  it('clamps the caption size to 40..56 px around 1.6x the theme text size', () => {
    const caption = (textSize: number): string =>
      token(renderThemeCss({ ...cream, sizes: { ...cream.sizes, text: textSize } }, FONTS), '--vno-page-caption-size')
    expect(caption(32)).toBe('51px') // 32 * 1.6 = 51.2
    expect(caption(25)).toBe('40px')
    expect(caption(30)).toBe('48px')
    expect(caption(60)).toBe('56px')
    expect(caption(80)).toBe('56px')
  })
})

describe('colour helpers', () => {
  it('mixHex interpolates the channels linearly, ignores alpha and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#112233', '#445566', 0.5)).toBe('#2b3c4d')
    expect(mixHex('#ffffff80', '#000000', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff')
  })

  it('relativeLuminance and contrastRatio follow WCAG', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
    expect(relativeLuminance('#808080')).toBeGreaterThan(0.2)
    expect(relativeLuminance('#808080')).toBeLessThan(0.25)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6)
  })

  it('readableOn keeps a preferred colour only when it reads, else picks black or white by the background', () => {
    expect(readableOn('#ffffff', '#333333')).toBe('#333333')
    expect(readableOn('#ffffff', '#eeeeee')).toBe('#000000')
    expect(readableOn('#000000', '#333333')).toBe('#ffffff')
    expect(readableOn('#000000', '#eeeeee')).toBe('#eeeeee')
  })

  it('themePreviewCss is untouched by the player tokens', () => {
    expect(themePreviewCss(cream)).not.toContain('--vno-ui-')
    expect(themePreviewCss(dark)).not.toContain('--vno-ui-')
  })

  it('accepts the #abc / #abcd shorthand without leaking NaN into the tokens', () => {
    // a theme file is validated to #rrggbb(aa), but a hand-made game-data or a fixture may use the short form
    expect(parseHex('#000')).toMatchObject({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseHex('#abcd')).toMatchObject({ r: 0xaa, g: 0xbb, b: 0xcc })
    expect(parseHex('#abcd').a).toBeCloseTo(0xdd / 255, 6)
    expect(mixHex('#000', '#fff', 0.5)).toBe('#808080')
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    const short = renderThemeCss({ ...cream, colors: { ...cream.colors, background: '#000', text: '#fff' } }, FONTS)
    expect(short).not.toContain('NaN')
    expect(token(short, '--vno-ui-surface')).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrastRatio(token(short, '--vno-ui-text'), token(short, '--vno-ui-surface'))).toBeGreaterThanOrEqual(4.5)
  })
})
