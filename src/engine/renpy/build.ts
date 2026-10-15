import fs from 'node:fs'
import path from 'node:path'
import type { Edition, Lang, ProjectSettings, VnBook } from '../../shared/vn'
import { emitTheme } from '../themes/emit'
import { defaultThemesDir, findTheme, listThemes } from '../themes/load'
import { DEFAULT_THEME, pickTheme } from '../themes/pick'
import { emitScripts, voicePath, type LineMapEntry, type VoiceSource } from './emit'
import { escapeRenpy } from './escape'
import { buildImages, type ImageFormat, type Resolution } from './images'
import { generateTranslations, RENPY_LANG, LANG_NAMES, writeUiStrings } from './tl'
import { defaultCues, type StageCues } from './stage'
import { generateGuiImages } from './gui'
import { sdkExists } from './run'

/**
 * Builds the Ren'Py project for a book. The project folder is `<projectDir>/game`; the Ren'Py `game/` folder inside
 * it is regenerated on every build (copy of the template, then theme, images, audio, scripts and translations), so a
 * rebuild is idempotent. Saves live outside the project (Ren'Py puts them under the user's profile), so they survive.
 */

export interface BuildGameInput {
  projectDir: string
  book: VnBook
  /** Primary first. Editions other than the primary are translated into `tl/<language>/`. */
  editions: Edition[]
  settings: ProjectSettings
  /** The absolute file of the selected version of an asset, or null when it has none yet (a placeholder is made). */
  resolveAsset: (id: string) => string | null
  /** Voice clips, only when the book has voice on. Omit for no voice at all. */
  voice?: VoiceSource
  /** Stage cues (the stage-director's); the default heuristic is used when omitted. */
  cues?: StageCues
  sdkPath: string
  resolution?: Resolution
  imageFormat?: ImageFormat
  /** The Ren'Py project template. Default: `templates/renpy` next to the working directory (`VNO_TEMPLATES` overrides). */
  templateDir?: string
  themesDir?: string
  /** Regenerate the menu images in the theme colours with the SDK (a few seconds). Default: true when the SDK exists. */
  tintGui?: boolean
}

export interface BuildGameResult {
  /** The Ren'Py project folder (contains `game/`). */
  gameDir: string
  warnings: string[]
  /** Where each say statement lives: file, line, beat id. */
  lineMap: LineMapEntry[]
  theme: string
  /** The Ren'Py languages that got a `tl/<language>/` folder. */
  translated: string[]
  /** Asset ids that used a placeholder. */
  placeholders: string[]
}

export function defaultTemplateDir(): string {
  return process.env.VNO_TEMPLATES ? path.resolve(process.env.VNO_TEMPLATES) : path.resolve(process.cwd(), 'templates', 'renpy')
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/** The languages of the book: the primary first, then the other editions. */
export function bookLanguages(primary: Lang, editions: Lang[]): Lang[] {
  return [primary, ...editions.filter((l, i) => l !== primary && editions.indexOf(l) === i)]
}

/** `vn_languages` and `config.default_language` for options.rpy (see docs in the README of the renpy template). */
export function languageTable(primary: Lang, langs: Lang[]): { list: string; defaultLanguage: string } {
  // Ren'Py's source language (None) holds the primary text. An English UI is the template's, so an English primary
  // is `None`; a Croatian primary is the `croatian` language (UI strings from tl/croatian/ui.rpy) and is the default.
  const code = (l: Lang): string => (primary === 'en' && l === 'en' ? 'None' : JSON.stringify(RENPY_LANG[l]))
  const list = '[' + langs.map((l) => `(${code(l)}, ${JSON.stringify(LANG_NAMES[l])})`).join(', ') + ']'
  return { list, defaultLanguage: primary === 'hr' ? JSON.stringify('croatian') : 'None' }
}

export async function buildGame(inp: BuildGameInput): Promise<BuildGameResult> {
  const { projectDir, book, settings } = inp
  const warnings: string[] = [...book.warnings.map((w) => `book: ${w}`)]
  const resolution = inp.resolution ?? { w: 1920, h: 1080 }
  const format: ImageFormat = inp.imageFormat ?? 'webp'
  const templateDir = inp.templateDir ?? defaultTemplateDir()
  const themesDir = inp.themesDir ?? defaultThemesDir()
  const gameDir = path.join(path.resolve(projectDir), 'game')
  const sub = path.join(gameDir, 'game')

  if (!fs.existsSync(path.join(templateDir, 'game'))) throw new Error(`Ren'Py template not found at ${templateDir}`)
  if (resolution.w !== 1920 || resolution.h !== 1080) warnings.push(`the template is made for 1920x1080; ${resolution.w}x${resolution.h} scales the screen but not the layout`)

  // 1. A clean copy of the template.
  fs.rmSync(sub, { recursive: true, force: true })
  fs.mkdirSync(gameDir, { recursive: true })
  copyDir(path.join(templateDir, 'game'), sub)
  for (const d of ['images', 'audio']) fs.mkdirSync(path.join(sub, d), { recursive: true })

  // 2. Which theme.
  const available = listThemes(themesDir).themes.map((t) => t.theme.name)
  const themeName = pickTheme(book, settings, available)
  const loaded = findTheme(themeName, themesDir) ?? findTheme(DEFAULT_THEME, themesDir)
  if (!loaded) throw new Error(`No theme found in ${themesDir}`)
  if (settings.theme && settings.theme !== loaded.theme.name) warnings.push(`theme "${settings.theme}" not found; using ${loaded.theme.name}`)

  // 3. Menu images in the theme colours (the frames of the theme are drawn over them next).
  const canTint = (inp.tintGui ?? true) && sdkExists(inp.sdkPath)
  if (canTint) {
    try {
      await generateGuiImages({ sdkPath: inp.sdkPath, theme: loaded.theme, gameSubdir: sub, tmpDir: path.join(gameDir, '.vno-tmp'), resolution, warnings })
    } catch (e) {
      warnings.push(`could not tint the menu images (${(e as Error).message}); using the template ones`)
    }
  }

  // 4. Theme.
  const themed = await emitTheme({ theme: loaded.theme, themeDir: loaded.dir, gameSubdir: sub })
  warnings.push(...themed.warnings)

  // 5. Music and voice files.
  const music: Record<string, string> = {}
  const musicIds: string[] = []
  for (let i = 1; i <= Math.max(0, settings.music.tracks); i++) {
    const id = `music_${String(i).padStart(2, '0')}`
    const src = inp.resolveAsset(id)
    if (!src || !fs.existsSync(src)) continue
    const rel = `audio/${id}${path.extname(src) || '.ogg'}`
    fs.copyFileSync(src, path.join(sub, rel))
    music[id] = rel
    musicIds.push(id)
  }

  // Only the clips a statement was emitted for are copied (after the translations, which ask too).
  const usedVoice = new Map<string, string>()
  let voice: VoiceSource | undefined
  if (inp.voice) {
    const src = inp.voice
    voice = {
      has: (lang, beatId) => {
        const f = src.has(lang, beatId)
        if (!f || !fs.existsSync(f)) return null
        usedVoice.set(voicePath(lang, beatId, f), f)
        return f
      }
    }
  }

  // 6. Scripts.
  const cues = inp.cues ?? defaultCues(book, { musicIds, warn: (m) => warnings.push(m) })
  const emitted = emitScripts({ book, editions: inp.editions, cues, voice, music, lightTheme: loaded.theme.light, uniformNames: themed.uniformNames })
  warnings.push(...emitted.warnings)
  for (const [name, content] of Object.entries(emitted.files)) fs.writeFileSync(path.join(sub, name), content, 'utf8')

  // 7. Images.
  const images = await buildImages({ gameSubdir: sub, book, used: emitted.used, resolveAsset: inp.resolveAsset, resolution, format, warnings })

  // 8. Languages: options.rpy tokens.
  const langs = bookLanguages(book.primaryLang, [book.primaryLang, ...settings.editions, ...inp.editions.map((e) => e.lang)])
  const table = languageTable(book.primaryLang, langs)
  const buildName = book.slug.replace(/[^A-Za-z0-9_-]/g, '_') || 'game'
  const options = fs
    .readFileSync(path.join(sub, 'options.rpy'), 'utf8')
    .replace(/\{\{TITLE\}\}/g, escapeRenpy(book.title))
    .replace(/\{\{VERSION\}\}/g, '1.0')
    .replace(/\{\{BUILD_NAME\}\}/g, buildName)
    .replace(/\{\{SAVE_DIR\}\}/g, `vno-${buildName}`)
    .replace(/\{\{HAS_VOICE\}\}/g, inp.voice ? 'True' : 'False')
    .replace(/\{\{LANGUAGES\}\}/g, table.list)
    .replace(/\{\{DEFAULT_LANGUAGE\}\}/g, table.defaultLanguage)
  fs.writeFileSync(path.join(sub, 'options.rpy'), options, 'utf8')
  if (resolution.w !== 1920 || resolution.h !== 1080) {
    const g = fs.readFileSync(path.join(sub, 'gui.rpy'), 'utf8').replace('gui.init(1920, 1080)', `gui.init(${resolution.w}, ${resolution.h})`)
    fs.writeFileSync(path.join(sub, 'gui.rpy'), g, 'utf8')
  }

  // 10. Translations.
  const translated: string[] = []
  const primaryEdition = inp.editions.find((e) => e.lang === book.primaryLang)
  if (book.primaryLang === 'hr') writeUiStrings(sub, 'croatian')
  for (const ed of inp.editions) {
    if (ed.lang === book.primaryLang) continue
    const tl = await generateTranslations({
      gameDir,
      sdkPath: inp.sdkPath,
      book,
      primaryEdition,
      edition: ed,
      lineMap: emitted.lineMap,
      voice,
      warnings
    })
    translated.push(tl.language)
  }

  // 11. Voice clips that were used.
  for (const [rel, from] of usedVoice) {
    fs.mkdirSync(path.dirname(path.join(sub, rel)), { recursive: true })
    fs.copyFileSync(from, path.join(sub, rel))
  }

  fs.rmSync(path.join(gameDir, '.vno-tmp'), { recursive: true, force: true })
  return { gameDir, warnings, lineMap: emitted.lineMap, theme: loaded.theme.name, translated, placeholders: images.placeholders }
}
