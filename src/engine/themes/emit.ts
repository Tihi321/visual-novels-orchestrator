import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Theme } from './load'

/**
 * Writes a theme into a Ren'Py project: `game/theme.rpy` (gui variables, transitions, style blocks), the fonts and
 * the frame images (textbox, namebox, choice buttons). The frames are drawn with sharp from the theme colours
 * unless the theme brings its own PNGs.
 *
 * `theme.rpy` runs at init priority -2: after the template's `gui.rpy` (-3) and before `screens.rpy` (-1), so the
 * screens pick up the theme values. The `small` (phone) variant of the template is re-applied with the theme sizes.
 */

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export function parseHex(hex: string): RGBA {
  // `#abc` and `#abcd` are shorthand for `#aabbcc` / `#aabbccdd`; a theme file is validated to the long form, but a
  // hand-made game-data or a test fixture may use the short one, and a `NaN` channel would leak into `rgb(...)` CSS.
  const raw = hex.replace('#', '')
  const h = raw.length === 3 || raw.length === 4 ? raw.replace(/./g, (ch) => ch + ch) : raw
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  }
}

const rgb = (c: RGBA): string => `rgb(${c.r},${c.g},${c.b})`

/** Ren'Py wants `#rrggbb` or `#rrggbbaa`. */
const rpyColor = (hex: string): string => `'${hex.toLowerCase()}'`

export interface FrameSizes {
  textboxH: number
  phoneTextboxH: number
}

const DEFAULT_SIZES: FrameSizes = { textboxH: 278, phoneTextboxH: 360 }

async function textboxPng(theme: Theme, w: number, h: number): Promise<Buffer> {
  const c = parseHex(theme.textbox.color)
  const opacity = theme.textbox.opacity * c.a
  const r = theme.textbox.radius
  const margin = r > 0 ? 36 : 0
  const bottom = r > 0 ? 20 : 0
  const bw = theme.textbox.borderColor ? 4 : 0
  const border = theme.textbox.borderColor ? parseHex(theme.textbox.borderColor) : null
  const x = margin + bw / 2
  const y = (r > 0 ? 8 : 0) + bw / 2
  const rw = w - 2 * margin - bw
  const rh = h - y - bottom - bw / 2
  // Radius 0 with a border: draw only the top line so the box stays full-bleed.
  const rect =
    r === 0
      ? `<rect x="0" y="0" width="${w}" height="${h}" fill="${rgb(c)}" fill-opacity="${opacity}"/>` +
        (border ? `<rect x="0" y="0" width="${w}" height="${bw}" fill="${rgb(border)}"/>` : '')
      : `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${r}" ry="${r}" fill="${rgb(c)}" fill-opacity="${opacity}"` +
        (border ? ` stroke="${rgb(border)}" stroke-width="${bw}"` : '') +
        '/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rect}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** The namebox is a Frame: corner size must cover the radius (see `nameBorder`). */
async function nameboxPng(theme: Theme): Promise<Buffer> {
  const w = 450
  const h = 54
  const c = parseHex(theme.namebox.color)
  const r = Math.min(theme.namebox.radius, h / 2 - 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${rgb(c)}" fill-opacity="${theme.namebox.opacity * c.a}"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Border (corner size) in pixels for a Frame with rounded corners of radius `r`. */
export const frameBorder = (r: number, min = 5): number => Math.max(min, Math.ceil(r) + 2)

async function choicePng(theme: Theme, hover: boolean): Promise<{ png: Buffer; vb: number }> {
  const w = 1185
  const r = Math.min(theme.choice.radius, 26)
  const vb = frameBorder(r, 8)
  const h = Math.max(52, 2 * vb + 8)
  const base = parseHex(hover ? (theme.choice.hoverColor ?? theme.colors.muted) : theme.choice.color)
  const border = theme.choice.borderColor ? parseHex(theme.choice.borderColor) : null
  const bw = border ? (hover ? 4 : 2) : 0
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${bw / 2}" y="${bw / 2}" width="${w - bw}" height="${h - bw}" rx="${r}" ry="${r}" fill="${rgb(base)}" fill-opacity="${base.a}"${
    border ? ` stroke="${rgb(border)}" stroke-width="${bw}"` : ''
  }/></svg>`
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), vb }
}

export interface ThemeEmitInput {
  theme: Theme
  /** The theme folder (fonts and frame PNGs are read from here). */
  themeDir: string
  /** The `game/` folder of the Ren'Py project. */
  gameSubdir: string
  sizes?: FrameSizes
}

export interface ThemeEmitResult {
  files: string[]
  warnings: string[]
  /** The theme sets one colour for every character name (so characters.rpy must not set its own). */
  uniformNames: boolean
}

function copyFont(themeDir: string, gameSubdir: string, file: string | undefined, warnings: string[]): string | null {
  if (!file) return null
  const src = path.join(themeDir, 'fonts', file)
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.join(gameSubdir, 'fonts'), { recursive: true })
    fs.copyFileSync(src, path.join(gameSubdir, 'fonts', file))
    return `fonts/${file}`
  }
  // A font that ships with Ren'Py (DejaVuSans.ttf ...): used by name.
  if (!/^(DejaVuSans|DejaVuSans-Bold)\.ttf$/.test(file)) warnings.push(`theme font ${file} not found in ${path.join(themeDir, 'fonts')}; using it by name`)
  return file
}

function frameFile(themeDir: string, name: string | undefined, warnings: string[]): Buffer | null {
  if (!name) return null
  const p = path.join(themeDir, name)
  if (!fs.existsSync(p)) {
    warnings.push(`theme frame ${name} not found; drawing one from the colours`)
    return null
  }
  return fs.readFileSync(p)
}

export function renderThemeRpy(theme: Theme, fonts: { text: string; name: string; interface: string; bold: string | null }, borders: { name: number; choice: number }): string {
  const t = theme
  const c = t.colors
  const s = t.sizes
  const L: string[] = []
  const p = (x: string): void => void L.push(x)
  // The template's gui.rpy `define`s every gui.* value; a second `define` is a lint error, so the theme assigns them
  // in a python block that runs right after (same init priority, later in the file order of the priority).
  const g = (name: string, value: string): void => p(`    gui.${name} = ${value}`)
  p('# Generated by VN Studio from the theme. Do not edit: the next build overwrites this file.')
  p(`# Theme: ${t.name} (${t.label})`)
  p('')
  p('init offset = -2')
  p('')
  p('init python:')
  g('accent_color', rpyColor(c.accent))
  g('idle_color', rpyColor(c.idle))
  g('idle_small_color', rpyColor(c.idle))
  g('hover_color', rpyColor(c.hover))
  g('selected_color', rpyColor(c.selected))
  g('insensitive_color', rpyColor(c.insensitive))
  g('muted_color', rpyColor(c.muted))
  g('hover_muted_color', rpyColor(c.muted))
  g('text_color', rpyColor(c.text))
  g('interface_text_color', rpyColor(c.text))
  p('')
  g('text_font', JSON.stringify(fonts.text))
  g('name_text_font', JSON.stringify(fonts.name))
  g('interface_text_font', JSON.stringify(fonts.interface))
  g('button_text_font', 'gui.interface_text_font')
  g('choice_button_text_font', 'gui.text_font')
  if (fonts.bold) p(`    config.font_replacement_map[${JSON.stringify(fonts.text)}, True, False] = (${JSON.stringify(fonts.bold)}, False, False)`)
  p('')
  g('text_size', String(s.text))
  g('name_text_size', String(s.name))
  g('interface_text_size', String(s.interface))
  g('button_text_size', String(s.interface))
  g('label_text_size', String(s.label))
  g('title_text_size', String(s.title))
  g('choice_button_text_size', String(s.choice))
  p('')
  g('button_text_idle_color', 'gui.idle_color')
  g('button_text_hover_color', 'gui.hover_color')
  g('button_text_selected_color', 'gui.selected_color')
  g('button_text_insensitive_color', 'gui.insensitive_color')
  g('quick_button_text_idle_color', 'gui.idle_small_color')
  g('quick_button_text_selected_color', 'gui.accent_color')
  g('choice_button_text_idle_color', rpyColor(t.choice.textColor ?? c.idle))
  g('choice_button_text_hover_color', rpyColor(t.choice.hoverTextColor ?? c.selected))
  g('choice_button_text_insensitive_color', rpyColor(c.insensitive))
  p('')
  g('namebox_borders', `Borders(${borders.name}, ${borders.name}, ${borders.name}, ${borders.name})`)
  g('choice_button_borders', `Borders(150, ${borders.choice}, 150, ${borders.choice})`)
  p('')
  p('    ## Phones (the template\'s "small" variant) get bigger text: the same ratios as the template.')
  p('    @gui.variant')
  p('    def small():')
  p(`        gui.text_size = ${Math.round((s.text * 45) / 33)}`)
  p(`        gui.name_text_size = ${Math.round((s.name * 54) / 45)}`)
  p(`        gui.interface_text_size = ${Math.round((s.interface * 45) / 33)}`)
  p(`        gui.button_text_size = ${Math.round((s.interface * 45) / 33)}`)
  p(`        gui.label_text_size = ${Math.round((s.label * 51) / 36)}`)
  p(`        gui.choice_button_text_size = ${Math.round((s.choice * 45) / 33)}`)
  p('')
  p('## Transitions used by the generated chapters.')
  p(`define vn_dissolve = Dissolve(${t.transitions.dissolve})`)
  p(`define vn_show = Dissolve(${t.transitions.show})`)
  p(`define vn_fade = Fade(${t.transitions.fade}, 0.1, ${t.transitions.fade})`)
  if (t.pixel) {
    p('')
    p('## Pixel art: scale images with nearest-neighbour.')
    p('define config.nearest_neighbor = True')
  }
  p('')
  p('## Style tweaks: after the screens (priority 1) so they win over the template styles.')
  p('init offset = 1')
  p('')
  if (t.namebox.textColor) {
    p('style say_label:')
    p(`    color ${rpyColor(t.namebox.textColor)}`)
    p('')
  }
  p('style say_dialogue:')
  p(`    color ${rpyColor(c.text)}`)
  p('')
  return L.join('\n')
}

export async function emitTheme(inp: ThemeEmitInput): Promise<ThemeEmitResult> {
  const { theme, themeDir, gameSubdir } = inp
  const sizes = inp.sizes ?? DEFAULT_SIZES
  const warnings: string[] = []
  const files: string[] = []
  const guiDir = path.join(gameSubdir, 'gui')
  fs.mkdirSync(path.join(guiDir, 'button'), { recursive: true })
  fs.mkdirSync(path.join(guiDir, 'phone', 'button'), { recursive: true })

  const text = copyFont(themeDir, gameSubdir, theme.fonts.text, warnings) ?? 'DejaVuSans.ttf'
  const name = copyFont(themeDir, gameSubdir, theme.fonts.name ?? theme.fonts.text, warnings) ?? text
  const iface = copyFont(themeDir, gameSubdir, theme.fonts.interface ?? theme.fonts.text, warnings) ?? text
  const bold = copyFont(themeDir, gameSubdir, theme.fonts.bold, warnings)

  const write = (rel: string, data: Buffer | string): void => {
    fs.mkdirSync(path.dirname(path.join(gameSubdir, rel)), { recursive: true })
    fs.writeFileSync(path.join(gameSubdir, rel), data)
    files.push(rel)
  }

  write('gui/textbox.png', frameFile(themeDir, theme.frames.textbox, warnings) ?? (await textboxPng(theme, 1920, sizes.textboxH)))
  write('gui/phone/textbox.png', frameFile(themeDir, theme.frames.textbox, warnings) ?? (await textboxPng(theme, 1920, sizes.phoneTextboxH)))
  write('gui/namebox.png', frameFile(themeDir, theme.frames.namebox, warnings) ?? (await nameboxPng(theme)))

  const idle = await choicePng(theme, false)
  const hover = await choicePng(theme, true)
  const idleBuf = frameFile(themeDir, theme.frames.choiceIdle, warnings) ?? idle.png
  const hoverBuf = frameFile(themeDir, theme.frames.choiceHover, warnings) ?? hover.png
  for (const dir of ['gui/button', 'gui/phone/button']) {
    write(`${dir}/choice_idle_background.png`, idleBuf)
    write(`${dir}/choice_hover_background.png`, hoverBuf)
  }

  const rpy = renderThemeRpy(theme, { text, name, interface: iface, bold }, { name: frameBorder(Math.min(theme.namebox.radius, 25)), choice: idle.vb })
  write('theme.rpy', rpy)
  return { files, warnings, uniformNames: !!theme.namebox.textColor }
}

/**
 * CSS for a live preview of the textbox and a menu in the renderer. Class names: `.vnp-stage` (the picture area),
 * `.vnp-textbox`, `.vnp-name`, `.vnp-text`, `.vnp-choice` (and `:hover`). Fonts are `"vnp-<theme>"` / `"vnp-<theme>-bold"`;
 * the renderer loads them with `@font-face` from the theme's `fonts/` folder. Sizes are for a 1920x1080 stage; scale it with
 * `zoom` or `transform: scale()`.
 */
export function themePreviewCss(theme: Theme): string {
  const c = theme.colors
  const css = (hex: string): string => {
    const x = parseHex(hex)
    return `rgba(${x.r},${x.g},${x.b},${+x.a.toFixed(3)})`
  }
  const tb = parseHex(theme.textbox.color)
  const nb = parseHex(theme.namebox.color)
  const family = (suffix = ''): string => `"vnp-${theme.name}${suffix}", "DejaVu Sans", sans-serif`
  const textFont = theme.fonts.text.startsWith('DejaVu') ? '"DejaVu Sans", sans-serif' : family()
  const ch = theme.choice
  const choiceBg = parseHex(ch.color)
  const choiceHover = parseHex(ch.hoverColor ?? c.muted)
  return `
.vnp-stage { position: relative; width: 1920px; height: 1080px; background: ${css(c.background)}; color: ${css(c.text)}; font-family: ${textFont};${theme.pixel ? ' image-rendering: pixelated;' : ''} }
.vnp-textbox { position: absolute; left: ${theme.textbox.radius > 0 ? 36 : 0}px; right: ${theme.textbox.radius > 0 ? 36 : 0}px; bottom: ${theme.textbox.radius > 0 ? 20 : 0}px; height: 278px; box-sizing: border-box;
  background: rgba(${tb.r},${tb.g},${tb.b},${+(theme.textbox.opacity * tb.a).toFixed(3)});
  border-radius: ${theme.textbox.radius}px;${
    theme.textbox.borderColor ? ` ${theme.textbox.radius > 0 ? 'border' : 'border-top'}: 4px solid ${css(theme.textbox.borderColor)};` : ''
  } }
.vnp-name { position: absolute; left: 360px; top: -27px; min-width: 300px; padding: 4px 24px; box-sizing: border-box; text-align: center;
  background: rgba(${nb.r},${nb.g},${nb.b},${+(theme.namebox.opacity * nb.a).toFixed(3)}); border-radius: ${theme.namebox.radius}px;
  color: ${css(theme.namebox.textColor ?? c.accent)}; font-family: ${theme.fonts.name ? (theme.fonts.name.startsWith('DejaVu') ? '"DejaVu Sans"' : family('-name')) : textFont}; font-size: ${theme.sizes.name}px; }
.vnp-text { position: absolute; left: 402px; top: 75px; width: 1116px; font-size: ${theme.sizes.text}px; line-height: 1.3; color: ${css(c.text)}; }
.vnp-menu { position: absolute; left: 0; right: 0; top: 260px; display: flex; flex-direction: column; align-items: center; gap: 33px; }
.vnp-choice { width: 1185px; box-sizing: border-box; padding: 12px 150px; text-align: center; font-size: ${theme.sizes.choice}px; font-family: ${textFont};
  color: ${css(ch.textColor ?? c.idle)}; background: rgba(${choiceBg.r},${choiceBg.g},${choiceBg.b},${+choiceBg.a.toFixed(3)});
  border-radius: ${ch.radius}px;${ch.borderColor ? ` border: 2px solid ${css(ch.borderColor)};` : ''} transition: background .15s; }
.vnp-choice:hover { color: ${css(ch.hoverTextColor ?? c.selected)}; background: rgba(${choiceHover.r},${choiceHover.g},${choiceHover.b},${+choiceHover.a.toFixed(3)}); }
`.trim()
}

/**
 * `@font-face` rules for the live preview: the families `vnp-<theme>` (text), `vnp-<theme>-name` and `vnp-<theme>-bold`, loaded
 * from `vnstudio-file://data/themes/<folder>/fonts/<file>` (the app's file protocol serves a theme's `fonts/` folder). Fonts that
 * ship with Ren'Py (`DejaVu*`) and fonts a theme does not set are left out.
 */
export function themeFontFaces(theme: Theme, folder: string): string {
  const face = (family: string, file: string | undefined): string =>
    !file || file.startsWith('DejaVu')
      ? ''
      : `@font-face { font-family: "${family}"; src: url("vnstudio-file://data/themes/${encodeURIComponent(folder)}/fonts/${encodeURIComponent(file)}"); }\n`
  return (
    face(`vnp-${theme.name}`, theme.fonts.text) + face(`vnp-${theme.name}-name`, theme.fonts.name) + face(`vnp-${theme.name}-bold`, theme.fonts.bold)
  )
}


/**
 * Linear mix of two `#rrggbb`/`#rrggbbaa` colours at `t` (0..1): the red, green and blue channels are interpolated
 * independently (`t = 0` is `a`, `t = 1` is `b`). The alpha channels are ignored: the result is `#rrggbb`.
 */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a)
  const y = parseHex(b)
  const k = Math.min(1, Math.max(0, t))
  const channel = (p: number, q: number): string => Math.round(p + (q - p) * k).toString(16).padStart(2, '0')
  return `#${channel(x.r, y.r)}${channel(x.g, y.g)}${channel(x.b, y.b)}`
}

/** One sRGB channel as WCAG relative luminance. */
function channelLuminance(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const c = parseHex(hex)
  return 0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b)
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** `preferred` when it reads on `background` (contrast 4.5:1), else black or white by the background's luminance. */
export function readableOn(background: string, preferred: string): string {
  if (contrastRatio(background, preferred) >= 4.5) return preferred
  return relativeLuminance(background) > 0.5 ? '#000000' : '#ffffff'
}

/**
 * CSS stylesheet variables and styling rules for the HTML5 web player runtime.
 */
export function renderThemeCss(theme: Theme, fonts: { text: string; name: string; interface: string; bold: string | null }): string {
  const c = theme.colors
  const css = (hex: string): string => {
    const x = parseHex(hex)
    return `rgba(${x.r},${x.g},${x.b},${+x.a.toFixed(3)})`
  }
  const tb = parseHex(theme.textbox.color)
  const nb = parseHex(theme.namebox.color)
  const ch = theme.choice
  const choiceBg = parseHex(ch.color)
  const choiceHover = parseHex(ch.hoverColor ?? c.muted)

  const fontText = fonts.text.includes('/') || fonts.text.endsWith('.ttf') || fonts.text.endsWith('.otf') || fonts.text.endsWith('.woff2')
    ? `"${fonts.text.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}", "DejaVu Sans", sans-serif`
    : `"${fonts.text}", "DejaVu Sans", sans-serif`
  const fontName = fonts.name.includes('/') || fonts.name.endsWith('.ttf') || fonts.name.endsWith('.otf') || fonts.name.endsWith('.woff2')
    ? `"${fonts.name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}", ${fontText}`
    : `"${fonts.name}", ${fontText}`
  const fontIface = fonts.interface.includes('/') || fonts.interface.endsWith('.ttf') || fonts.interface.endsWith('.otf') || fonts.interface.endsWith('.woff2')
    ? `"${fonts.interface.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}", sans-serif`
    : `"${fonts.interface}", sans-serif`

  // Player interface tokens, computed from the theme colours so light and dark themes both stay readable.
  const surface = mixHex(c.background, c.text, 0.06)
  const surface2 = mixHex(c.background, c.text, 0.1)
  const uiText = readableOn(surface, c.text)
  const controlBg = mixHex(c.background, c.text, 0.12)
  const controlText = readableOn(controlBg, uiText)
  let uiMuted = uiText
  for (const amount of [0.35, 0.3, 0.25]) {
    const candidate = mixHex(uiText, surface, amount)
    if (contrastRatio(candidate, surface) >= 3) {
      uiMuted = candidate
      break
    }
  }
  const uiFocus = contrastRatio(c.accent, surface) >= 3 ? c.accent : uiText
  const captionSize = Math.min(56, Math.max(40, Math.round(theme.sizes.text * 1.6)))

  return `
:root {
  --vno-color-accent: ${css(c.accent)};
  --vno-color-bg: ${css(c.background)};
  --vno-color-text: ${css(c.text)};
  --vno-color-idle: ${css(c.idle)};
  --vno-color-hover: ${css(c.hover)};
  --vno-color-selected: ${css(c.selected)};
  --vno-color-insensitive: ${css(c.insensitive)};
  --vno-color-muted: ${css(c.muted)};
  
  --vno-textbox-bg: rgba(${tb.r},${tb.g},${tb.b},${+(theme.textbox.opacity * tb.a).toFixed(3)});
  --vno-textbox-radius: ${theme.textbox.radius}px;
  --vno-textbox-border: ${theme.textbox.borderColor ? `4px solid ${css(theme.textbox.borderColor)}` : 'none'};
  --vno-textbox-border-color: ${theme.textbox.borderColor ? css(theme.textbox.borderColor) : 'transparent'};

  --vno-namebox-bg: rgba(${nb.r},${nb.g},${nb.b},${+(theme.namebox.opacity * nb.a).toFixed(3)});
  --vno-namebox-radius: ${theme.namebox.radius}px;
  --vno-namebox-text-color: ${theme.namebox.textColor ? css(theme.namebox.textColor) : 'inherit'};

  --vno-choice-bg: rgba(${choiceBg.r},${choiceBg.g},${choiceBg.b},${+choiceBg.a.toFixed(3)});
  --vno-choice-hover-bg: rgba(${choiceHover.r},${choiceHover.g},${choiceHover.b},${+choiceHover.a.toFixed(3)});
  --vno-choice-radius: ${ch.radius}px;
  --vno-choice-border: ${ch.borderColor ? `2px solid ${css(ch.borderColor)}` : 'none'};
  --vno-choice-text-color: ${css(ch.textColor ?? c.idle)};
  --vno-choice-hover-text-color: ${css(ch.hoverTextColor ?? c.selected)};

  --vno-font-text: ${fontText};
  --vno-font-name: ${fontName};
  --vno-font-interface: ${fontIface};

  --vno-size-text: ${theme.sizes.text}px;
  --vno-size-name: ${theme.sizes.name}px;
  --vno-size-interface: ${theme.sizes.interface}px;
  --vno-size-label: ${theme.sizes.label}px;
  --vno-size-title: ${theme.sizes.title}px;
  --vno-size-choice: ${theme.sizes.choice}px;

  --vno-transition-dissolve: ${theme.transitions.dissolve}s;
  --vno-transition-show: ${theme.transitions.show}s;
  --vno-transition-fade: ${theme.transitions.fade}s;
  --vno-pixelated: ${theme.pixel ? 'pixelated' : 'auto'};

  --vno-ui-scrim: ${theme.light ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.85)'};
  --vno-ui-surface: ${surface};
  --vno-ui-surface-2: ${surface2};
  --vno-ui-text: ${uiText};
  --vno-ui-text-muted: ${uiMuted};
  --vno-ui-border: ${mixHex(c.background, c.text, 0.28)};
  --vno-ui-control-bg: ${controlBg};
  --vno-ui-control-text: ${controlText};
  --vno-ui-focus: ${uiFocus};
  --vno-page-caption-size: ${captionSize}px;
}
`.trim()
}
