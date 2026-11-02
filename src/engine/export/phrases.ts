import type { Lang } from '../../shared/vn'

/**
 * The words of a printed gamebook, in one place: the EPUB and PDF writers build every "turn to section N" from here, so a link can wrap
 * just the label ("section 56") and the choice text is never rewritten. HUB-25 "Shared section algorithm": en is
 * "{choice text} - turn to section N."; hr is the user's "idi na odlomak N" (2026-11-01 answer 1, e.g. "Ako ..., idi na odlomak 56.").
 * A language without a table here uses English (`phraseLang`, and the model warns).
 */

export interface JumpParts {
  /** Text before the link: the choice text and the joining words. */
  before: string
  /** The linked words ("section 56"). */
  label: string
  /** Text after the link. */
  after: string
}

interface PhraseTable {
  jump(choiceText: string, no: number): JumpParts
  end: string
  restart(no: number): JumpParts
  /** The word for a section, for a section number heading or a footer ("section 12"). */
  section: string
  /** The label of the start entry in a table of contents ("Start: section 1"). */
  start: string
}

const TABLES: Record<string, PhraseTable> = {
  en: {
    jump: (text, no) => ({ before: `${text} - turn to `, label: `section ${no}`, after: '.' }),
    end: 'The End.',
    restart: (no) => ({ before: 'Turn to ', label: `section ${no}`, after: ' to start again.' }),
    section: 'section',
    start: 'Start'
  },
  hr: {
    // the hr ending wording is inferred (the user only gave the jump phrase): "Kraj." / "Idi na odlomak 1 za novi početak."
    jump: (text, no) => ({ before: `${text}, idi na `, label: `odlomak ${no}`, after: '.' }),
    end: 'Kraj.',
    restart: (no) => ({ before: 'Idi na ', label: `odlomak ${no}`, after: ' za novi početak.' }),
    section: 'odlomak',
    start: 'Početak'
  }
}

/** The language whose table is used for `lang` (a regional code such as pt-br uses its base language; unknown: en). */
export function phraseLang(lang: Lang): 'en' | 'hr' {
  const base = lang.toLowerCase().split('-')[0]!
  return base in TABLES ? (base as 'en' | 'hr') : 'en'
}

/** True when `lang` has its own table (else the English one is used and a writer should warn). */
export const hasPhrases = (lang: Lang): boolean => lang.toLowerCase().split('-')[0]! in TABLES

const table = (lang: Lang): PhraseTable => TABLES[phraseLang(lang)]!

/** A choice: the choice text, then the link phrase. `before + label + after` is the whole sentence. */
export const jumpParts = (lang: Lang, choiceText: string, no: number): JumpParts => table(lang).jump(choiceText.trim(), no)

/** "The End." */
export const endText = (lang: Lang): string => table(lang).end

/** "Turn to section 1 to start again." */
export const restartParts = (lang: Lang, startNo = 1): JumpParts => table(lang).restart(startNo)

/** "section" / "odlomak". */
export const sectionWord = (lang: Lang): string => table(lang).section

/** "Start" / "Početak": the table of contents entry that leads to section 1 reads "Start: section 1". */
export const startLabel = (lang: Lang): string => table(lang).start

/** A part set as plain text. */
export const joinParts = (p: JumpParts): string => p.before + p.label + p.after

/** The nav entry that opens a gamebook: "Start: section 1" / "Početak: odlomak 1". */
export const startText = (lang: Lang, no = 1): string => `${startLabel(lang)}: ${sectionWord(lang)} ${no}`

/** The navigation words of an EPUB (the contents list and the cover entry). */
export const navWords = (lang: Lang): { contents: string; cover: string } => (phraseLang(lang) === 'hr' ? { contents: 'Sadržaj', cover: 'Naslovnica' } : { contents: 'Contents', cover: 'Cover' })
