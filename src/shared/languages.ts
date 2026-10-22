import { UI_STRINGS } from './ui-strings'
import type { Lang } from './vn'

/**
 * The languages a project can use: the built-in table (the union of the VibeTTS Supertonic languages and the Book
 * Translator ones) and a registry that `config/languages.md` adds to or overrides.
 */

export const LANGUAGE_SCRIPTS = ['latin', 'cyrillic', 'greek', 'arabic', 'hebrew', 'devanagari', 'han', 'kana', 'hangul', 'thai', 'other'] as const
export type LanguageScript = (typeof LANGUAGE_SCRIPTS)[number]

export interface LanguageInfo {
  /** Lowercase code such as `en`, `hr` or `pt-br`; the file name of its edition. */
  code: string
  /** English name. */
  name: string
  /** Name in the language itself (shown in the game's language picker). */
  native: string
  /** The Ren'Py language identifier (lowercase ascii and `_`), the folder `game/tl/<renpy>/`. */
  renpy: string
  rtl?: boolean
  script: LanguageScript
  /** VibeTTS Supertonic can read it. */
  supertonic?: boolean
  /** The Ren'Py template's UI strings in this language (`old` -> `new`): the built-in table (`ui-strings.ts`), with the `ui` of `config/languages.md` over it. Without it the menus stay in English. */
  ui?: Record<string, string>
  /** A font with the glyphs of the language: an absolute path, or a file name in `<data>/fonts/` (`font` in `config/languages.md`). */
  font?: string
  /** The bold face of `font`. Without it the regular face is used for bold text. */
  fontBold?: string
}

/** The languages that books and voice settings could use before the table existed. */
export const LEGACY_LANGS = ['en', 'hr']

type Row = [code: string, name: string, native: string, script: LanguageScript, flags: string]
// flags: s = Supertonic reads it, r = right to left
const ROWS: Row[] = [
  ['en', 'English', 'English', 'latin', 's'],
  ['hr', 'Croatian', 'Hrvatski', 'latin', 's'],
  ['ko', 'Korean', '한국어', 'hangul', 's'],
  ['ja', 'Japanese', '日本語', 'kana', 's'],
  ['ar', 'Arabic', 'العربية', 'arabic', 'sr'],
  ['bg', 'Bulgarian', 'Български', 'cyrillic', 's'],
  ['cs', 'Czech', 'Čeština', 'latin', 's'],
  ['da', 'Danish', 'Dansk', 'latin', 's'],
  ['de', 'German', 'Deutsch', 'latin', 's'],
  ['el', 'Greek', 'Ελληνικά', 'greek', 's'],
  ['es', 'Spanish', 'Español', 'latin', 's'],
  ['et', 'Estonian', 'Eesti', 'latin', 's'],
  ['fi', 'Finnish', 'Suomi', 'latin', 's'],
  ['fr', 'French', 'Français', 'latin', 's'],
  ['hi', 'Hindi', 'हिन्दी', 'devanagari', 's'],
  ['hu', 'Hungarian', 'Magyar', 'latin', 's'],
  ['id', 'Indonesian', 'Bahasa Indonesia', 'latin', 's'],
  ['it', 'Italian', 'Italiano', 'latin', 's'],
  ['lt', 'Lithuanian', 'Lietuvių', 'latin', 's'],
  ['lv', 'Latvian', 'Latviešu', 'latin', 's'],
  ['nl', 'Dutch', 'Nederlands', 'latin', 's'],
  ['pl', 'Polish', 'Polski', 'latin', 's'],
  ['pt', 'Portuguese', 'Português', 'latin', 's'],
  ['ro', 'Romanian', 'Română', 'latin', 's'],
  ['ru', 'Russian', 'Русский', 'cyrillic', 's'],
  ['sk', 'Slovak', 'Slovenčina', 'latin', 's'],
  ['sl', 'Slovenian', 'Slovenščina', 'latin', 's'],
  ['sv', 'Swedish', 'Svenska', 'latin', 's'],
  ['tr', 'Turkish', 'Türkçe', 'latin', 's'],
  ['uk', 'Ukrainian', 'Українська', 'cyrillic', 's'],
  ['vi', 'Vietnamese', 'Tiếng Việt', 'latin', 's'],
  ['sr', 'Serbian', 'Српски', 'cyrillic', ''],
  ['bs', 'Bosnian', 'Bosanski', 'latin', ''],
  ['no', 'Norwegian', 'Norsk', 'latin', ''],
  ['he', 'Hebrew', 'עברית', 'hebrew', 'r'],
  ['fa', 'Persian', 'فارسی', 'arabic', 'r'],
  ['zh', 'Chinese', '中文', 'han', '']
]

export const BUILTIN_LANGUAGES: readonly LanguageInfo[] = ROWS.map(([code, name, native, script, flags]) => {
  const info: LanguageInfo = { code, name, native, renpy: name.toLowerCase(), script }
  if (flags.includes('s')) info.supertonic = true
  if (flags.includes('r')) info.rtl = true
  const ui = UI_STRINGS[code]
  if (ui) info.ui = { ...ui }
  return info
})

const registry = new Map<string, LanguageInfo>()

/** Back to the built-in table (for tests, and before `config/languages.md` is read again). */
export function resetLanguages(): void {
  registry.clear()
  for (const l of BUILTIN_LANGUAGES) registry.set(l.code, l)
}
resetLanguages()

/** The Ren'Py identifier made from an English name: `Brazilian Portuguese` -> `brazilian_portuguese`. */
const renpyId = (name: string): string => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export type LanguageInput = Pick<LanguageInfo, 'code' | 'name'> & Partial<LanguageInfo>

/**
 * Adds languages. An entry for a code that exists (a built-in one) is merged into it: `ui` key by key, any other field given replaces the
 * built-in one. A new language gets `renpy` from its name when missing, and `script` `other`.
 */
export function registerLanguages(list: readonly LanguageInput[]): void {
  for (const l of list) {
    const code = l.code.trim().toLowerCase()
    const base = registry.get(code)
    const given = Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as Partial<LanguageInfo>
    if (base) {
      registry.set(code, { ...base, ...given, code, ui: base.ui || given.ui ? { ...base.ui, ...given.ui } : undefined })
      continue
    }
    registry.set(code, { ...l, code, native: l.native ?? l.name, renpy: l.renpy ?? (renpyId(l.name) || code.replace(/\W/g, '_')), script: l.script ?? 'other' })
  }
}

export const languages = (): LanguageInfo[] => [...registry.values()]
export const languageInfo = (code: string): LanguageInfo | undefined => registry.get(code)
export const isKnownLang = (code: string): boolean => registry.has(code)

/** The code if the language is known, else an error that lists the known ones. */
export function assertKnownLang(code: string): Lang {
  if (!registry.has(code)) throw new Error(`unknown language "${code}": use one of ${[...registry.keys()].join(', ')}, or add it in config/languages.md`)
  return code
}
