import { hasText } from '../../shared/vn'
import type { Edition, Lang, TextBeat, VnBook, VnChapter } from '../../shared/vn'
import { MAX_CHOICES } from '../vn/branches'
import type { SectionMap } from './sections'

/**
 * Checks a story before it is printed, and fails loudly with one message that names every chapter and choice at fault. The branch graph is
 * not assumed to be a DAG (`vn/branches.ts` drops back-links and only warns, the exporter must not renumber around a broken story): a choice
 * to a missing chapter, a chapter no path from the first chapter reaches, an ending that has choices, a chapter without text in the edition.
 */

/** The words of a beat in this edition: the edition's text, else (the primary language only) the text in vn.json. */
export function beatTextOf(book: VnBook, edition: Edition, lang: Lang, beat: TextBeat): string | undefined {
  const t = edition.beats[beat.id]?.trim() || (lang === book.primaryLang ? beat.text.trim() : '')
  return t || undefined
}

/** The chapter title in this edition, else (the primary language only) the title in vn.json; undefined when neither has one. */
export function titleTextOf(book: VnBook, edition: Edition, lang: Lang, chapter: VnChapter): string | undefined {
  const t = edition.chapterTitles[chapter.n]?.trim() || (lang === book.primaryLang ? chapter.title.trim() : '')
  return t || undefined
}

/** The text of choice `i` of chapter `n`. */
export function choiceTextOf(book: VnBook, edition: Edition, lang: Lang, chapter: VnChapter, i: number): string | undefined {
  const t = edition.choiceTexts[`${chapter.n}:${i}`]?.trim() || (lang === book.primaryLang ? chapter.choices[i]?.text.trim() : '')
  return t || undefined
}

/** The ending text of a chapter in this edition ('' when the story has none). */
export function endingTextOf(book: VnBook, edition: Edition, lang: Lang, chapter: VnChapter): string {
  return (edition.endings[chapter.n]?.trim() || (lang === book.primaryLang ? chapter.ending?.trim() : '') || '').trim()
}

/** The chapter numbers reachable from the first chapter along the choices (a graph walk, cycles allowed). */
export function reachableChapters(chapters: readonly VnChapter[]): Set<number> {
  const byN = new Map(chapters.map((c) => [c.n, c]))
  const seen = new Set<number>()
  const todo = chapters.length ? [Math.min(...chapters.map((c) => c.n))] : []
  while (todo.length) {
    const n = todo.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    for (const ch of byN.get(n)?.choices ?? []) if (byN.has(ch.to)) todo.push(ch.to)
  }
  return seen
}

/** Throws one error naming every problem. `gamebook`: also checks the choices. */
export function validateStory(book: VnBook, edition: Edition, lang: Lang, gamebook: boolean): void {
  const problems: string[] = []
  if (book.chapters.length === 0) problems.push('the book has no chapters')
  const known = new Set(book.chapters.map((c) => c.n))
  if (known.size !== book.chapters.length) problems.push('two chapters have the same number')

  for (const c of book.chapters) {
    const beats = c.scenes.flatMap((s) => s.beats).filter(hasText)
    const missing = beats.filter((b) => !beatTextOf(book, edition, lang, b))
    if (beats.length === 0) problems.push(`chapter ${c.n} ("${c.title}") has no text`)
    else if (missing.length === beats.length) problems.push(`chapter ${c.n} ("${c.title}") has no text in the ${lang} edition`)
    else if (missing.length) problems.push(`chapter ${c.n} ("${c.title}"): ${missing.length} beat(s) have no text in the ${lang} edition (first: ${missing[0]!.id})`)
    if (!gamebook) continue
    if (c.ending !== null && c.choices.length > 0) problems.push(`chapter ${c.n} is an ending but has ${c.choices.length} choice(s)`)
    c.choices.forEach((ch, i) => {
      const label = `chapter ${c.n}, choice ${i + 1}`
      if (!known.has(ch.to)) problems.push(`${label} ("${choiceTextOf(book, edition, lang, c, i) ?? ch.text}") leads to chapter ${ch.to}, which does not exist`)
      if (!choiceTextOf(book, edition, lang, c, i)) problems.push(`${label} has no text in the ${lang} edition`)
    })
  }
  if (gamebook && book.chapters.length) {
    const reached = reachableChapters(book.chapters)
    for (const c of book.chapters) if (!reached.has(c.n)) problems.push(`chapter ${c.n} ("${c.title}") cannot be reached from chapter ${Math.min(...known)}`)
  }
  if (problems.length) throw new Error(`cannot export "${book.slug}" (${lang}): ${problems.join('; ')}`)
}

/** Choices beyond `MAX_CHOICES` are legal (the exporter keeps them) but unusual: a warning for the chapter. */
export function choiceCountWarnings(book: VnBook): string[] {
  return book.chapters.filter((c) => c.choices.length > MAX_CHOICES).map((c) => `chapter ${c.n}: ${c.choices.length} choices (a gamebook page usually has at most ${MAX_CHOICES})`)
}

/** The numbers of a map must be a bijection onto 1..N over exactly these chapters, and the first chapter must be section 1. Throws otherwise. */
export function validateSectionMap(map: SectionMap, chapters: readonly number[]): void {
  const problems: string[] = []
  const nos = chapters.map((n) => map.sections[String(n)])
  chapters.forEach((n, i) => {
    if (nos[i] === undefined) problems.push(`chapter ${n} has no section number`)
  })
  const seen = new Map<number, number>()
  chapters.forEach((n, i) => {
    const no = nos[i]
    if (no === undefined) return
    if (no < 1 || no > chapters.length) problems.push(`chapter ${n} has section number ${no}, outside 1..${chapters.length}`)
    const other = seen.get(no)
    if (other !== undefined) problems.push(`chapters ${other} and ${n} both have section number ${no}`)
    seen.set(no, n)
  })
  const first = Math.min(...chapters)
  if (chapters.length && map.sections[String(first)] !== 1) problems.push(`the start (chapter ${first}) is not section 1`)
  if (problems.length) throw new Error(`bad section map: ${problems.join('; ')}`)
}
