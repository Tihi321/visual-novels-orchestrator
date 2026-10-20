import type { Lang } from './vn'

/**
 * The languages a project can use: the built-in table (the union of the VibeTTS Supertonic languages and the Book
 * Translator ones) and a registry that `config/languages.md` adds to or overrides.
 */

export type LanguageScript = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'devanagari' | 'han' | 'kana' | 'hangul' | 'thai' | 'other'

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
  /** The Ren'Py template's UI strings in this language (`old` -> `new`); without it the menus stay in English. */
  ui?: Record<string, string>
}

/** The languages that books and voice settings could use before the table existed. */
export const LEGACY_LANGS = ['en', 'hr']

const HR_UI: Record<string, string> = {
  Language: 'Jezik',
  'The End': 'Kraj',
  'Start again': 'Počni ispočetka',
  'Back to main menu': 'Natrag na glavni izbornik',
  Start: 'Započni',
  Load: 'Učitaj',
  Save: 'Spremi',
  Preferences: 'Postavke',
  Prefs: 'Postavke',
  About: 'O igri',
  Help: 'Pomoć',
  Quit: 'Izlaz',
  History: 'Povijest',
  Skip: 'Preskoči',
  Skipping: 'Preskakanje',
  Auto: 'Automatski',
  'Q.Save': 'Br.spremi',
  'Q.Load': 'Br.učitaj',
  Return: 'Povratak',
  Back: 'Natrag',
  Menu: 'Izbornik',
  'Main Menu': 'Glavni izbornik',
  Window: 'Prozor',
  Fullscreen: 'Cijeli zaslon',
  Display: 'Prikaz',
  'Unseen Text': 'Neviđeni tekst',
  'After Choices': 'Nakon izbora',
  Transitions: 'Prijelazi',
  'Text Speed': 'Brzina teksta',
  'Auto-Forward Time': 'Vrijeme automatskog prelaska',
  'Music Volume': 'Glasnoća glazbe',
  'Sound Volume': 'Glasnoća zvukova',
  'Voice Volume': 'Glasnoća glasa',
  'Mute All': 'Utišaj sve',
  Yes: 'Da',
  No: 'Ne',
  'empty slot': 'prazno mjesto',
  'Automatic saves': 'Automatska spremanja',
  'Quick saves': 'Brza spremanja',
  'Page {}': 'Stranica {}',
  'The dialogue history is empty.': 'Povijest dijaloga je prazna.',
  'Are you sure?': 'Jeste li sigurni?',
  'Are you sure you want to quit?': 'Jeste li sigurni da želite izaći?',
  'Are you sure you want to delete this save?': 'Jeste li sigurni da želite izbrisati ovo spremanje?',
  'Are you sure you want to overwrite your save?': 'Jeste li sigurni da želite prepisati svoje spremanje?',
  'Loading will lose unsaved progress.\\nAre you sure you want to do this?': 'Učitavanje će izgubiti nespremljeni napredak.\\nJeste li sigurni da to želite?',
  'Are you sure you want to return to the main menu?\\nThis will lose unsaved progress.':
    'Jeste li sigurni da se želite vratiti u glavni izbornik?\\nNespremljeni napredak će se izgubiti.',
  'Are you sure you want to begin skipping?': 'Jeste li sigurni da želite početi preskakati?',
  'Are you sure you want to skip to the next choice?': 'Jeste li sigurni da želite preskočiti do sljedećeg izbora?'
}

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
  if (code === 'hr') info.ui = HR_UI
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

/** Adds languages, or replaces the ones with the same code. A missing `renpy` comes from the name, a missing `script` is `other`. */
export function registerLanguages(list: readonly LanguageInput[]): void {
  for (const l of list) {
    const code = l.code.trim().toLowerCase()
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
