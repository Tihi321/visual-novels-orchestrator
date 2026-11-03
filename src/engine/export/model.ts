import path from 'node:path'
import { hasText, presentationOf } from '../../shared/vn'
import type { Edition, Lang, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { isRtlLang } from '../game/rtl'
import type { ProjectStore } from '../vn/project'
import { hasPhrases } from './phrases'
import { EXPORT_FILE, resolveSectionMap, sectionOf } from './sections'
import type { SectionMap, SectionOrder } from './sections'
import { beatTextOf, choiceCountWarnings, choiceTextOf, endingTextOf, titleTextOf, validateSectionMap, validateStory } from './validate'

/**
 * The book the EPUB and PDF writers print: one ordered `ExportBook` read from a `VnBook` plus one edition, so no writer reads vn.json itself.
 * Three modes: `gamebook` (kind `choice`: one section per chapter, shuffled numbers, "turn to section N"), `linear` (a linear visual novel,
 * one section per chapter in order) and `picture-book` (one page per scene). Everything a printed book cannot show becomes a warning.
 */

export type ExportMode = 'gamebook' | 'linear' | 'picture-book'

/** A picture on disk (the selected version of an asset). */
export interface ExportPicture {
  /** The asset id, for example `bg_roux_fils_horlogerie_morning`. */
  assetId: string
  /** The absolute file (png/webp/jpg); the writers convert it. */
  file: string
}

export interface ExportChoice {
  /** The choice text as the edition has it, never rewritten. */
  text: string
  /** The section this choice leads to. */
  toNo: number
  /** lang2 text of this choice; absent = no translation. */
  text2?: string
}

/** A section (gamebook, linear VN: one per chapter) or a page (picture book: one per scene). */
export interface ExportSection {
  /** The section number (gamebook: the shuffled number; linear: the chapter number; picture book: the page, from 1). */
  no: number
  /** The chapter this section comes from. */
  chapter: number
  /** The chapter title. Not set in a gamebook (a title would spoil the story); in a picture book only on the first page of a chapter. */
  title?: string
  /** The text, one paragraph per beat: a line is "Name: text", narration is plain. */
  paragraphs: string[]
  /** The chapter's first scene background (picture book: the scene's). Missing: a text page (and a warning). */
  picture?: ExportPicture
  /** The ways on (gamebook). */
  choices?: ExportChoice[]
  /** Set (possibly '' when the story gives no ending text) when the section is an ending. Test with `!== undefined`. */
  ending?: string
  /** Set only when the book has lang2: same length as `paragraphs`, index i is the lang2 text of paragraphs[i] (same "Name: text" form), null = no translation. */
  paragraphs2?: (string | null)[]
  /** lang2 chapter title; only where `title` is set and lang2 has one. */
  title2?: string
  /** lang2 ending text; only where `ending` is a non-empty string and lang2 has one. */
  ending2?: string
}

export interface ExportCover {
  title: string
  author?: string
  /** There is no cover asset: the cover is the first scene's background and the writer puts the title over it. */
  source: 'first-scene-background'
  picture?: ExportPicture
}

export interface ExportBook {
  slug: string
  title: string
  lang: Lang
  mode: ExportMode
  cover: ExportCover
  /** Gamebook and linear: sorted by section number (the file order gives nothing away). Empty for a picture book. */
  sections: ExportSection[]
  /** Picture book: the pages in reading order. Empty otherwise. */
  pages: ExportSection[]
  /** What was dropped or is odd; the tool returns these as they are. */
  warnings: string[]
  /** The second language printed under the main one. */
  lang2?: Lang
  /** Set with lang2. paired = lines with a translation; unpaired = ids of lines without one: beat ids, "<chapter>:<choiceIdx>", "title <chapter>", "ending <chapter>". */
  pairing?: { paired: number; unpaired: string[] }
}

export const modeOf = (book: VnBook): ExportMode => (book.kind === 'choice' ? 'gamebook' : presentationOf(book) === 'picture-book' ? 'picture-book' : 'linear')

const wordsOf = (s: ExportSection): number => s.paragraphs.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0)

export interface BuildInput {
  book: VnBook
  edition: Edition
  lang: Lang
  /** The second edition and its language (parallel text); both or neither. */
  edition2?: Edition
  lang2?: Lang
  /** The absolute file of the selected version of an asset, or null when it has none. */
  resolveAsset: (id: string) => string | null
  /** Gamebook only: the numbering (`resolveSectionMap`). */
  map?: SectionMap
  /** The project has voice on (clips are not exported: a warning). */
  voice?: boolean
  /** Warnings found before (the stale map ...), put first. */
  warnings?: string[]
}

/** Reads the book into an `ExportBook`. Throws when the story is broken (`validateStory`), the section map is not a bijection, or the language is right-to-left. */
export function buildExportBook(input: BuildInput): ExportBook {
  const { book, edition, lang } = input
  if (isRtlLang(lang)) throw new Error(`cannot export "${book.slug}" in ${lang}: right-to-left languages are not supported by the book export yet (the text would print in the wrong direction)`)
  const { edition2, lang2 } = input
  if (lang2) {
    if (lang2 === lang) throw new Error(`cannot export "${book.slug}": the second language must differ from the main one (${lang})`)
    if (isRtlLang(lang2)) throw new Error(`cannot export "${book.slug}" with second language ${lang2}: right-to-left languages are not supported by the book export yet (the text would print in the wrong direction)`)
  }
  const mode = modeOf(book)
  validateStory(book, edition, lang, mode === 'gamebook')
  const warnings = [...(input.warnings ?? [])]
  if (!hasPhrases(lang)) warnings.push(`no gamebook phrases for ${lang}: "turn to section N" is printed in English`)

  const chapters = [...book.chapters].sort((a, b) => a.n - b.n)
  if (mode === 'gamebook') {
    if (!input.map) throw new Error('a gamebook needs a section map')
    validateSectionMap(input.map, chapters.map((c) => c.n))
  }

  const pictureOf = (scene: VnScene | undefined, where: string): ExportPicture | undefined => {
    if (!scene) {
      warnings.push(`${where}: no scene, so no picture (text page)`)
      return undefined
    }
    const file = input.resolveAsset(scene.backgroundId)
    if (!file) {
      warnings.push(`${where}: picture ${scene.backgroundId} has no file (text page)`)
      return undefined
    }
    return { assetId: scene.backgroundId, file }
  }

  const titleOf = (c: VnChapter): string => {
    const t = edition.chapterTitles[c.n]?.trim()
    if (t) return t
    if (lang !== book.primaryLang) warnings.push(`chapter ${c.n}: no title in the ${lang} edition, using "${c.title}"`)
    return c.title
  }

  const linesOf = (scenes: readonly VnScene[], ed: Edition, l: Lang): { id: string; text: string }[] =>
    scenes
      .flatMap((s) => s.beats)
      .filter(hasText)
      .flatMap((b) => {
        const text = beatTextOf(book, ed, l, b)
        if (!text) return []
        if (b.type === 'narration') return [{ id: b.id, text }]
        const name = (b.speakerKey ? ed.characterNames[b.speakerKey]?.trim() : '') || b.speakerLabel
        return [{ id: b.id, text: name ? `${name}: ${text}` : text }]
      })
  const paragraphsOf = (scenes: readonly VnScene[]): string[] => linesOf(scenes, edition, lang).map((l) => l.text)

  // parallel text: pairing by id (beat id, "<chapter>:<choiceIdx>", "title <chapter>", "ending <chapter>"), lenient
  const pairing = { paired: 0, unpaired: [] as string[] }
  const pair2 = (id: string, tr: string | null | undefined): string | undefined => {
    if (tr) {
      pairing.paired++
      return tr
    }
    pairing.unpaired.push(id)
    return undefined
  }
  // a translated title identical to the main one (it fell back to the vn.json title) is no translation: unpaired
  const sameAs = (tr: string | undefined, main: string | undefined): string | undefined => (tr && tr === main ? undefined : tr)
  const paragraphs2Of = (scenes: readonly VnScene[]): (string | null)[] => {
    const tr = new Map(linesOf(scenes, edition2!, lang2!).map((l) => [l.id, l.text]))
    return linesOf(scenes, edition, lang).map((l) => pair2(l.id, tr.get(l.id)) ?? null)
  }

  const sections: ExportSection[] = []
  const pages: ExportSection[] = []
  for (const c of chapters) {
    if (mode === 'picture-book') {
      c.scenes.forEach((scene, i) => {
        const paragraphs = paragraphsOf([scene])
        const page: ExportSection = { no: pages.length + 1, chapter: c.n, paragraphs, picture: pictureOf(scene, `chapter ${c.n}, scene ${scene.id}`) }
        if (i === 0) page.title = titleOf(c)
        if (edition2) {
          page.paragraphs2 = paragraphs2Of([scene])
          if (page.title) {
            const t2 = pair2(`title ${c.n}`, sameAs(titleTextOf(book, edition2, lang2!, c), page.title))
            if (t2) page.title2 = t2
          }
        }
        if (!paragraphs.length) warnings.push(`chapter ${c.n}, scene ${scene.id}: no text for the caption`)
        pages.push(page)
      })
      continue
    }
    const section: ExportSection = {
      no: mode === 'gamebook' ? sectionOf(input.map!, c.n) : c.n,
      chapter: c.n,
      paragraphs: paragraphsOf(c.scenes),
      picture: pictureOf(c.scenes[0], `chapter ${c.n}`)
    }
    if (mode === 'linear') section.title = titleOf(c)
    if (edition2) {
      section.paragraphs2 = paragraphs2Of(c.scenes)
      if (section.title) {
        const t2 = pair2(`title ${c.n}`, sameAs(titleTextOf(book, edition2, lang2!, c), section.title))
        if (t2) section.title2 = t2
      }
    }
    if (mode === 'gamebook' && c.choices.length) {
      section.choices = c.choices.map((ch, i) => {
        const choice: ExportChoice = { text: choiceTextOf(book, edition, lang, c, i)!, toNo: sectionOf(input.map!, ch.to) }
        if (edition2) {
          const t2 = pair2(`${c.n}:${i}`, choiceTextOf(book, edition2, lang2!, c, i))
          if (t2) choice.text2 = t2
        }
        return choice
      })
    } else if (mode === 'gamebook' || c.ending !== null) {
      section.ending = endingTextOf(book, edition, lang, c)
      if (edition2 && section.ending) {
        const e2 = pair2(`ending ${c.n}`, endingTextOf(book, edition2, lang2!, c))
        if (e2) section.ending2 = e2
      }
    }
    sections.push(section)
  }
  sections.sort((a, b) => a.no - b.no)

  // what a printed book cannot show
  let cast = 0
  let cgs = 0
  let sfx = 0
  let ambience = 0
  let music = 0
  let lines = 0
  for (const c of chapters) {
    for (const s of c.scenes) {
      if (s.music) music++
      if (s.ambience) ambience++
      for (const b of s.beats) {
        if (b.type === 'cast') cast++
        if (b.type === 'line') lines++
        if (b.type === 'puzzle') warnings.push(`chapter ${c.n}: puzzle beat "${b.puzzle}" skipped (a puzzle cannot be printed)`)
        if (b.image) cgs++
        if (b.sfx) sfx++
        if (b.ambience) ambience++
      }
    }
  }
  if (presentationOf(book) === 'visual-novel' && (cast > 0 || lines > 0)) warnings.push(`sprites are not exported (${book.characters.length} character(s); ${cast} cast beat(s) dropped)`)
  else if (cast > 0) warnings.push(`${cast} cast beat(s) dropped`)
  if (cgs > 0) warnings.push(`${cgs} CG/insert picture cue(s) dropped: only the ${mode === 'picture-book' ? 'scene' : 'chapter first scene'} background is printed`)
  if (music > 0) warnings.push(`music is not exported (${music} scene(s) have a track)`)
  if (sfx + ambience > 0) warnings.push(`sound cues are not exported (${sfx} sound effect(s), ${ambience} ambience cue(s))`)
  if (input.voice) warnings.push('voice clips are not exported')
  if (mode === 'gamebook') warnings.push(...choiceCountWarnings(book))
  if (mode === 'picture-book' && lines > 0) warnings.push(`${lines} spoken line(s) are printed in the captions as "Name: text"`)

  const all = mode === 'picture-book' ? pages : sections
  const longest = all.reduce<ExportSection | undefined>((m, s) => (!m || wordsOf(s) > wordsOf(m) ? s : m), undefined)
  if (longest) warnings.push(`longest ${mode === 'picture-book' ? 'page' : 'section'}: ${wordsOf(longest)} words (${mode === 'gamebook' ? `section ${longest.no}, ` : ''}chapter ${longest.chapter})`)

  if (edition2 && pairing.unpaired.length) {
    const ids = pairing.unpaired
    warnings.push(`${ids.length} line(s) have no ${lang2} text and print without translation: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` (+${ids.length - 10} more)` : ''}`)
  }

  const first = chapters[0]?.scenes[0]
  const coverFile = first ? input.resolveAsset(first.backgroundId) : null
  const cover: ExportCover = {
    title: edition.title.trim() || book.title,
    ...(book.author ? { author: book.author } : {}),
    source: 'first-scene-background',
    ...(coverFile && first ? { picture: { assetId: first.backgroundId, file: coverFile } } : {})
  }
  if (!cover.picture) warnings.push('cover: no first-scene background file, so the cover is text only')

  return {
    slug: book.slug,
    title: cover.title,
    lang,
    mode,
    cover,
    sections: mode === 'picture-book' ? [] : sections,
    pages: mode === 'picture-book' ? pages : [],
    warnings,
    ...(edition2 && lang2 ? { lang2, pairing } : {})
  }
}

/** The pictures an export holds: the section/page pictures plus the cover. */
export function pictureCount(b: ExportBook): number {
  return [...b.sections, ...b.pages].filter((s) => s.picture).length + (b.cover.picture ? 1 : 0)
}

export interface ExportOptions {
  /** The edition to print. Default: the project's primary language. */
  lang?: Lang
  /** A second edition printed under the main one (parallel text); must differ from `lang`. */
  lang2?: Lang
  order?: SectionOrder
  /** Default: the stored seed, else the slug. */
  seed?: string
  renumber?: boolean
  /** Write the numbering to `export.json` when it is new (the file formats; the `plan` dry run writes nothing). */
  persist?: boolean
}

export interface PreparedExport {
  book: ExportBook
  /** Gamebook only. */
  map?: SectionMap
  /** Where the numbering is stored. */
  mapFile: string
  /** The stored map was used as it is. */
  reused: boolean
  /** Why the stored map did not fit (empty: it fits, or there was none). A caller that writes a file must refuse when this is not empty. */
  stale: string[]
}

/** Loads a project and builds its `ExportBook` (and, for a gamebook, its numbering). Nothing is written unless `persist` is set and the numbering is new. */
export async function loadExportBook(store: ProjectStore, slug: string, opts: ExportOptions = {}): Promise<PreparedExport> {
  const { settings } = await store.loadSettings(slug)
  const book = await store.loadBook(slug)
  const lang = opts.lang ?? book.primaryLang
  const lang2 = opts.lang2
  if (lang2 && lang2 === lang) throw new Error(`cannot export "${slug}": the second language must differ from the main one (${lang})`)
  /** `project "<slug>" has no <l> edition (editions: <primary>, <others>)`. */
  const noEdition = async (l: Lang): Promise<Error> => {
    const others = (await store.editionLangs(slug).catch(() => [] as Lang[])).filter((x) => x !== book.primaryLang)
    return new Error(`project "${slug}" has no ${l} edition (editions: ${[book.primaryLang, ...others].join(', ')})`)
  }
  const load = async (l: Lang): Promise<Edition> =>
    (await store.loadEdition(slug, l).catch(async (e: unknown) => {
      if (l === book.primaryLang) return null // the primary text is in vn.json
      if (e instanceof Error && /has no .+ edition$/.test(e.message)) throw await noEdition(l)
      throw e
    })) ?? { lang: l, title: book.title, chapterTitles: {}, choiceTexts: {}, endings: {}, characterNames: {}, beats: {} }
  const edition = await load(lang)
  const edition2 = lang2 ? await load(lang2) : undefined
  const assets = new Map((await store.loadAssets(slug).catch(() => ({ assets: [] }))).assets.map((a) => [a.id, a]))
  const mapFile = store.file(slug, EXPORT_FILE)
  const warnings: string[] = []
  let resolved: Awaited<ReturnType<typeof resolveSectionMap>> | undefined
  if (modeOf(book) === 'gamebook') {
    validateStory(book, edition, lang, true) // fail on a broken story before a number is stored
    resolved = await resolveSectionMap({ file: mapFile, slug, chapters: book.chapters.map((c) => c.n), seed: opts.seed, order: opts.order, renumber: opts.renumber, persist: opts.persist })
    if (resolved.stale.length) warnings.push(`the stored section numbers (${path.basename(mapFile)}) are stale: ${resolved.stale.join('; ')}. The numbers shown are what renumber: true would give; nothing was changed`)
    else if (resolved.reused) warnings.push(`section numbers reused from ${path.basename(mapFile)} (seed "${resolved.map.seed}", ${resolved.map.order})`)
  }
  const built = buildExportBook({
    book,
    edition,
    lang,
    ...(edition2 && lang2 ? { edition2, lang2 } : {}),
    resolveAsset: (id) => {
      const entry = assets.get(id)
      return entry ? store.resolveAsset(slug, entry) : null
    },
    map: resolved?.map,
    voice: settings.voice.enabled,
    warnings
  })
  return { book: built, map: resolved?.map, mapFile, reused: resolved?.reused ?? false, stale: resolved?.stale ?? [] }
}
