import fs from 'node:fs'
import path from 'node:path'
import { languageInfo } from '../../shared/languages'
import type { LanguageInfo, LanguageScript } from '../../shared/languages'
import type { Lang } from '../../shared/vn'
import type { Theme } from '../themes/load'
import { renpyLanguage } from './tl'

/**
 * Fonts per language. The theme's text font covers some scripts (`fonts.scripts` in `theme.yaml`); a language written in another script gets
 * a font of its own, set for that language only with a `translate <language> python:` block in `game/vno_fonts.rpy`.
 *
 * Where the font of a language comes from, first match wins:
 *   1. `font` (and `fontBold`) of the language in `config/languages.md`: an absolute path, or a file name in `<data>/fonts/`;
 *   2. `<data>/fonts/<script>.ttf` (`.otf`, `.ttc`), a file you dropped there (`<script>-bold.ttf` is its bold face);
 *   3. an installed system font of the script (Windows, macOS, Linux);
 *   4. DejaVuSans, which ships with Ren'Py, for Cyrillic, Greek, Arabic and Hebrew.
 */

/** The scripts DejaVuSans (the Ren'Py default font) has glyphs for. */
export const DEJAVU_SCRIPTS: readonly LanguageScript[] = ['latin', 'cyrillic', 'greek', 'arabic', 'hebrew']

/** The scripts the theme's text font covers: `fonts.scripts`, else DejaVuSans's for a DejaVu font, else Latin only. */
export function themeTextScripts(theme: Pick<Theme, 'fonts'>): readonly LanguageScript[] {
  if (theme.fonts.scripts) return theme.fonts.scripts
  return theme.fonts.text.startsWith('DejaVu') ? DEJAVU_SCRIPTS : ['latin']
}

/** A font file. `index` picks a face of a collection (`.ttc`): Ren'Py writes it `0@file.ttc`. */
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
  /** `<data>/fonts`. */
  fontsDir?: string
  platform?: NodeJS.Platform
  exists?: (file: string) => boolean
  /** Windows' font folder. Default: `%WINDIR%/Fonts`. */
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

// Noto Sans CJK collections order the faces JP, KR, SC, TC, HK.
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

const EXTENSIONS = ['.ttf', '.otf', '.ttc']

/** Installed fonts of a script on this OS, best first. Paths are absolute. */
export function systemFontCandidates(script: LanguageScript, platform: NodeJS.Platform, windowsFontsDir?: string): Candidate[] {
  if (platform === 'win32') {
    const dir = windowsFontsDir ?? path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts')
    return (WINDOWS[script] ?? []).map((c) => ({ ...c, file: path.join(dir, c.file), bold: c.bold ? path.join(dir, c.bold) : undefined }))
  }
  if (platform === 'darwin') return MAC[script] ?? []
  return LINUX[script] ?? []
}

const withIndex = (file: string, index: number | undefined): FontFile => (index === undefined ? { file } : { file, index })

/** Resolves the font file of a language for a script the theme font lacks. Null when there is none. */
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

  // 2. a file in the data folder's fonts folder, named after the script
  if (fontsDir) {
    for (const ext of EXTENSIONS) {
      const file = path.join(fontsDir, `${script}${ext}`)
      if (!exists(file)) continue
      const bold = EXTENSIONS.map((e) => path.join(fontsDir, `${script}-bold${e}`)).find((f) => exists(f))
      return { regular: { file }, bold: bold ? { file: bold } : null, source: 'data' }
    }
  }

  // 3. an installed font
  for (const c of systemFontCandidates(script, probe.platform ?? process.platform, probe.windowsFontsDir)) {
    if (!exists(c.file)) continue
    return { regular: withIndex(c.file, c.index), bold: c.bold && exists(c.bold) ? withIndex(c.bold, c.boldIndex) : null, source: 'system' }
  }

  // 4. DejaVuSans ships with Ren'Py
  if (DEJAVU_SCRIPTS.includes(script)) return { regular: { file: 'DejaVuSans.ttf' }, bold: { file: 'DejaVuSans-Bold.ttf' }, source: 'dejavu' }
  return null
}

/** The font as Ren'Py writes it: `fonts/lang/x.ttf`, or `0@fonts/lang/x.ttc` for a face of a collection. */
export const renpyFontSpec = (rel: string, index: number | undefined): string => (index === undefined ? rel : `${index}@${rel}`)

export interface LanguageFontsInput {
  /** The Ren'Py `game/` folder (`<project>/game/game`): fonts are copied to `fonts/lang/` in it. */
  gameSubdir: string
  /** The languages of the game. */
  langs: readonly Lang[]
  theme: Pick<Theme, 'fonts'>
  probe?: FontProbe
}

export interface LanguageFontsResult {
  /** The text of `game/vno_fonts.rpy`, or null when no language needs a font. */
  rpy: string | null
  warnings: string[]
  /** The font each language got. */
  used: Record<string, FontPick['source']>
}

/**
 * Picks a font for every language of the game whose script the theme's text font lacks (or that sets `font` itself), copies it into the
 * game and writes the `translate <language> python:` blocks that use it.
 */
export function languageFonts(inp: LanguageFontsInput): LanguageFontsResult {
  const covered = themeTextScripts(inp.theme)
  const warnings: string[] = []
  const used: Record<string, FontPick['source']> = {}
  const blocks: string[] = []
  const copied = new Map<string, string>() // source file -> name in game/fonts/lang
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
    const q = (s: string): string => JSON.stringify(s)
    blocks.push(
      [
        `translate ${renpyLanguage(code)} python:`,
        `    gui.text_font = ${q(regular)}`,
        `    gui.name_text_font = ${q(regular)}`,
        `    gui.interface_text_font = ${q(regular)}`,
        `    gui.button_text_font = ${q(regular)}`,
        `    gui.choice_button_text_font = ${q(regular)}`,
        `    config.font_replacement_map[${q(regular)}, True, False] = (${q(bold)}, False, False)`,
        ''
      ].join('\n')
    )
  }
  const rpy = blocks.length ? ['# Generated by VN Studio: a font with the glyphs of each language the theme font lacks.', '', ...blocks].join('\n') : null
  return { rpy, warnings, used }
}
