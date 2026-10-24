import fs from 'node:fs'
import path from 'node:path'
import { languageInfo } from '../../shared/languages'
import type { LanguageInfo, LanguageScript } from '../../shared/languages'
import type { Lang } from '../../shared/vn'
import type { Theme } from '../themes/load'

/**
 * Fonts management for the web visual novel engine: font resolution per language/script,
 * system font probing, copying into game/fonts/, and generating @font-face CSS.
 */

export const DEJAVU_SCRIPTS: readonly LanguageScript[] = ['latin', 'cyrillic', 'greek', 'arabic', 'hebrew']

export interface FontFile {
  file: string
  index?: number
}

export interface FontPick {
  regular: FontFile
  bold: FontFile | null
  source: 'config' | 'data' | 'system' | 'dejavu'
}

export interface FontProbe {
  fontsDir?: string
  platform?: NodeJS.Platform
  exists?: (file: string) => boolean
  windowsFontsDir?: string
}

interface Candidate {
  file: string
  index?: number
  bold?: string
  boldIndex?: number
}

const WINDOWS: Partial<Record<LanguageScript, Candidate[]>> = {
  han: [{ file: 'msyh.ttc', index: 0, bold: 'msyhbd.ttc', boldIndex: 0 }, { file: 'simsun.ttc', index: 0 }],
  kana: [{ file: 'YuGothM.ttc', index: 0, bold: 'YuGothB.ttc', boldIndex: 0 }, { file: 'msgothic.ttc', index: 0 }],
  hangul: [{ file: 'malgun.ttf', bold: 'malgunbd.ttf' }],
  devanagari: [{ file: 'Nirmala.ttc', index: 0, bold: 'NirmalaB.ttc', boldIndex: 0 }, { file: 'Nirmala.ttf', bold: 'NirmalaB.ttf' }],
  thai: [{ file: 'LeelawUI.ttf', bold: 'LeelaUIb.ttf' }, { file: 'tahoma.ttf', bold: 'tahomabd.ttf' }]
}

const MAC: Partial<Record<LanguageScript, Candidate[]>> = {
  han: [{ file: '/System/Library/Fonts/PingFang.ttc', index: 0 }, { file: '/System/Library/Fonts/STHeiti Medium.ttc', index: 0 }],
  kana: [{ file: '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', index: 0, bold: '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', boldIndex: 0 }],
  hangul: [{ file: '/System/Library/Fonts/AppleSDGothicNeo.ttc', index: 0 }],
  devanagari: [{ file: '/System/Library/Fonts/Kohinoor.ttc', index: 0 }, { file: '/System/Library/Fonts/Supplemental/DevanagariMT.ttc', index: 0 }],
  thai: [{ file: '/System/Library/Fonts/Thonburi.ttc', index: 0 }, { file: '/System/Library/Fonts/Supplemental/Thonburi.ttc', index: 0 }]
}

const NOTO_CJK = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc']
const NOTO_CJK_BOLD = (f: string): string => f.replace('-Regular.ttc', '-Bold.ttc')
const cjk = (index: number): Candidate[] => NOTO_CJK.map((file) => ({ file, index, bold: NOTO_CJK_BOLD(file), boldIndex: index }))

const LINUX: Partial<Record<LanguageScript, Candidate[]>> = {
  han: [...cjk(2), { file: '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf' }],
  kana: [...cjk(0), { file: '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf' }],
  hangul: [...cjk(1), { file: '/usr/share/fonts/truetype/nanum/NanumGothic.ttf', bold: '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf' }],
  devanagari: [{ file: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf', bold: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf' }, { file: '/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf' }],
  thai: [{ file: '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf', bold: '/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf' }, { file: '/usr/share/fonts/truetype/tlwg/Garuda.ttf' }]
}

export const SYSTEM_FONTS = {
  windows: WINDOWS,
  darwin: MAC,
  linux: LINUX
}

const EXTENSIONS = ['.ttf', '.otf', '.ttc', '.woff2']

/** Installed fonts of a script on this OS, best first. Paths are absolute. */
export function systemFontCandidates(script: LanguageScript, platform: NodeJS.Platform, windowsFontsDir?: string): Candidate[] {
  if (platform === 'win32') {
    const dir = windowsFontsDir ?? path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts')
    return (WINDOWS[script] ?? []).map((c) => ({ ...c, file: path.join(dir, c.file), bold: c.bold ? path.join(dir, c.bold) : undefined }))
  }
  if (platform === 'darwin') return MAC[script] ?? []
  return LINUX[script] ?? []
}

export function themeTextScripts(theme: Pick<Theme, 'fonts'>): readonly LanguageScript[] {
  if (theme.fonts.scripts) return theme.fonts.scripts
  return theme.fonts.text.startsWith('DejaVu') ? DEJAVU_SCRIPTS : ['latin']
}

export function coversScript(fontName: string, script: LanguageScript): boolean {
  if (fontName.startsWith('DejaVu')) return DEJAVU_SCRIPTS.includes(script)
  return script === 'latin'
}

const withIndex = (file: string, index: number | undefined): FontFile => (index === undefined ? { file } : { file, index })

/** Resolves the font file of a language for a script the theme font lacks. */
export function resolveLanguageFont(lang: Pick<LanguageInfo, 'code' | 'font' | 'fontBold'>, script: LanguageScript, probe: FontProbe = {}): FontPick | null {
  const exists = probe.exists ?? ((f: string) => fs.existsSync(f))
  const fontsDir = probe.fontsDir
  const inFonts = (name: string | undefined): string | null => {
    if (!name) return null
    if (path.isAbsolute(name)) return name
    return fontsDir ? path.join(fontsDir, name) : null
  }

  // 1. config/languages.md
  const configured = inFonts(lang.font)
  if (configured && exists(configured)) {
    const bold = inFonts(lang.fontBold)
    return { regular: { file: configured }, bold: bold && exists(bold) ? { file: bold } : null, source: 'config' }
  }

  // 2. data fonts directory
  if (fontsDir) {
    for (const ext of EXTENSIONS) {
      const file = path.join(fontsDir, `${script}${ext}`)
      if (!exists(file)) continue
      const bold = EXTENSIONS.map((e) => path.join(fontsDir, `${script}-bold${e}`)).find((f) => exists(f))
      return { regular: { file }, bold: bold ? { file: bold } : null, source: 'data' }
    }
  }

  // 3. system fonts
  for (const c of systemFontCandidates(script, probe.platform ?? process.platform, probe.windowsFontsDir)) {
    if (!exists(c.file)) continue
    return { regular: withIndex(c.file, c.index), bold: c.bold && exists(c.bold) ? withIndex(c.bold, c.boldIndex) : null, source: 'system' }
  }

  // 4. DejaVu fallback
  if (DEJAVU_SCRIPTS.includes(script)) {
    return { regular: { file: 'DejaVuSans.ttf' }, bold: { file: 'DejaVuSans-Bold.ttf' }, source: 'dejavu' }
  }
  return null
}

export const renpyFontSpec = (rel: string, index: number | undefined): string => (index === undefined ? rel : `${index}@${rel}`)

export interface LanguageFontsInput {
  gameSubdir: string
  langs: readonly Lang[]
  theme: Pick<Theme, 'fonts'>
  probe?: FontProbe
}

export interface LanguageFontsResult {
  rpy: string | null
  warnings: string[]
  used: Record<string, FontPick['source']>
}

export function languageFonts(inp: LanguageFontsInput): LanguageFontsResult {
  const covered = themeTextScripts(inp.theme)
  const warnings: string[] = []
  const used: Record<string, FontPick['source']> = {}
  const blocks: string[] = []
  const copied = new Map<string, string>()
  const dir = path.join(inp.gameSubdir, 'fonts', 'lang')

  const bring = (code: string, f: FontFile, pick: FontPick): string => {
    if (pick.source === 'dejavu') return f.file
    let name = copied.get(f.file)
    if (!name) {
      name = path.basename(f.file)
      if ([...copied.values()].includes(name)) name = `${code}-${name}`
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(f.file, path.join(dir, name))
      copied.set(f.file, name)
    }
    return renpyFontSpec(`fonts/lang/${name}`, f.index)
  }

  for (const code of inp.langs) {
    const info = languageInfo(code)
    if (!info) continue
    const needs = !!info.font || (info.script !== 'latin' && info.script !== 'other' && !covered.includes(info.script))
    if (!needs) continue
    const pick = resolveLanguageFont(info, info.script, inp.probe)
    if (!pick) {
      warnings.push(`no font with ${info.script} glyphs for ${info.name}: set font for ${code} in config/languages.md, put a font in <data>/fonts/, or run vno_fonts_fetch {script: ${info.script}}`)
      continue
    }
    if (pick.source === 'system') {
      warnings.push(`copied the system font ${path.basename(pick.regular.file)} for ${info.name}: fine to play, check its license before you share the game (vno_fonts_fetch gets a free Noto font)`)
    }
    used[code] = pick.source
    const regular = bring(code, pick.regular, pick)
    const bold = pick.bold ? bring(code, pick.bold, pick) : regular
    const lines = [
      `translate ${info.renpy} python:`,
      `    gui.text_font = ${JSON.stringify(regular)}`,
      `    gui.name_text_font = ${JSON.stringify(regular)}`,
      `    gui.choice_button_text_font = ${JSON.stringify(regular)}`
    ]
    if (pick.bold) {
      lines.push(`config.font_replacement_map[${JSON.stringify(regular)}, True, False] = (${JSON.stringify(bold)}, False, False)`)
    }
    blocks.push(lines.join('\n'))
  }
  const rpy = blocks.length ? blocks.join('\n\n') : null
  return { rpy, warnings, used }
}

// ---------------------------------------------------------------------------------------------------------------------
// Web Game Engine Font Resolution & @font-face CSS
// ---------------------------------------------------------------------------------------------------------------------

export interface ResolvedFont {
  family: string
  regularPath?: string
  boldPath?: string
  source: 'theme' | 'data' | 'system' | 'builtin' | 'config'
  format?: 'truetype' | 'opentype' | 'woff2'
}

export interface ResolveFontsInput {
  gameDir: string
  theme: Pick<Theme, 'fonts'>
  themeDir?: string
  langs: readonly Lang[]
  dataFontsDir?: string
  probe?: FontProbe
  sdkFontsDir?: string
}

export interface ResolveFontsResult {
  fonts: Record<string, ResolvedFont>
  copied: string[]
  css: string
  warnings: string[]
}

export function renderFontsCss(fonts: Record<string, ResolvedFont>, baseUrl = 'fonts/'): string {
  const rules: string[] = []
  for (const font of Object.values(fonts)) {
    if (font.regularPath) {
      const regFile = path.basename(font.regularPath)
      const ext = path.extname(regFile).toLowerCase()
      const fmt = ext === '.woff2' ? 'woff2' : ext === '.otf' ? 'opentype' : 'truetype'
      rules.push(`@font-face {
  font-family: "${font.family}";
  src: url("${baseUrl}${regFile}") format("${fmt}");
  font-weight: normal;
  font-style: normal;
}`)
    }
    if (font.boldPath) {
      const boldFile = path.basename(font.boldPath)
      const ext = path.extname(boldFile).toLowerCase()
      const fmt = ext === '.woff2' ? 'woff2' : ext === '.otf' ? 'opentype' : 'truetype'
      rules.push(`@font-face {
  font-family: "${font.family}";
  src: url("${baseUrl}${boldFile}") format("${fmt}");
  font-weight: bold;
  font-style: normal;
}`)
    }
  }
  return rules.join('\n\n')
}

/**
 * Resolves fonts for the web game engine.
 * DejaVuSans is treated as a built-in/system sans-serif fallback so sdkFontsDir is optional and never emits a missing-font warning.
 */
export function resolveFonts(inp: ResolveFontsInput): ResolveFontsResult {
  const { gameDir, theme, themeDir, langs, dataFontsDir, probe } = inp
  const destFontsDir = path.join(gameDir, 'fonts')
  fs.mkdirSync(destFontsDir, { recursive: true })

  const warnings: string[] = []
  const copied: string[] = []
  const fonts: Record<string, ResolvedFont> = {}

  // Helper to copy font file into gameDir/fonts
  const copyFileToFonts = (src: string): string => {
    const base = path.basename(src)
    const dst = path.join(destFontsDir, base)
    if (!fs.existsSync(dst)) {
      try {
        fs.copyFileSync(src, dst)
        copied.push(`fonts/${base}`)
      } catch {
        // Ignored if can't copy
      }
    }
    return `fonts/${base}`
  }

  // 1. Theme text font
  const themeFontName = theme.fonts.text
  if (themeFontName && !themeFontName.startsWith('DejaVu')) {
    const themeFontSrc = themeDir ? path.join(themeDir, 'fonts', themeFontName) : null
    if (themeFontSrc && fs.existsSync(themeFontSrc)) {
      const rel = copyFileToFonts(themeFontSrc)
      const boldSrc = theme.fonts.bold && themeDir ? path.join(themeDir, 'fonts', theme.fonts.bold) : null
      const boldRel = boldSrc && fs.existsSync(boldSrc) ? copyFileToFonts(boldSrc) : undefined
      fonts['theme_text'] = {
        family: path.basename(themeFontName, path.extname(themeFontName)),
        regularPath: rel,
        boldPath: boldRel,
        source: 'theme'
      }
    } else {
      warnings.push(`theme font ${themeFontName} not found in theme/fonts; using system sans-serif fallback`)
      fonts['theme_text'] = {
        family: 'sans-serif',
        source: 'builtin'
      }
    }
  } else {
    // DejaVuSans or default
    fonts['theme_text'] = {
      family: 'DejaVu Sans',
      source: 'builtin'
    }
  }

  // 2. Language-specific fonts
  const covered = themeTextScripts(theme)
  for (const lang of langs) {
    const info = languageInfo(lang)
    if (!info) continue
    const needs = !!info.font || (info.script !== 'latin' && info.script !== 'other' && !covered.includes(info.script))
    if (!needs) continue

    const pick = resolveLanguageFont(info, info.script, { ...probe, fontsDir: dataFontsDir })
    if (!pick) {
      if (!DEJAVU_SCRIPTS.includes(info.script)) {
        warnings.push(`no font with ${info.script} glyphs for ${info.name}: set font for ${lang} in config/languages.md or put a font in <data>/fonts/`)
      }
      continue
    }

    if (pick.source === 'dejavu') {
      fonts[lang] = {
        family: 'DejaVu Sans',
        source: 'builtin'
      }
    } else {
      const regDst = copyFileToFonts(pick.regular.file)
      const boldDst = pick.bold ? copyFileToFonts(pick.bold.file) : undefined
      fonts[lang] = {
        family: `Font_${lang}`,
        regularPath: regDst,
        boldPath: boldDst,
        source: pick.source === 'config' ? 'config' : pick.source === 'data' ? 'data' : 'system'
      }
      if (pick.source === 'system') {
        warnings.push(`copied the system font ${path.basename(pick.regular.file)} for ${info.name}`)
      }
    }
  }

  const css = renderFontsCss(fonts)
  if (css) {
    fs.writeFileSync(path.join(destFontsDir, 'fonts.css'), css, 'utf8')
  }

  return { fonts, copied, css, warnings }
}
