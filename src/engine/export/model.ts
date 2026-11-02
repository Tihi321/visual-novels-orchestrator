import path from 'node:path'
import { hasText, presentationOf } from '../../shared/vn'
import type { Edition, Lang, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { isRtlLang } from '../game/rtl'
import type { ProjectStore } from '../vn/project'
import { hasPhrases } from './phrases'
import { EXPORT_FILE, resolveSectionMap, sectionOf } from './sections'
import type { SectionMap, SectionOrder } from './sections'
import { beatTextOf, choiceCountWarnings, choiceTextOf, endingTextOf, validateSectionMap, validateStory } from './validate'

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
}

export const modeOf = (book: VnBook): ExportMode => (book.kind === 'choice' ? 'gamebook' : presentationOf(book) === 'picture-book' ? 'picture-book' : 'linear')

const wordsOf = (s: ExportSection): number => s.paragraphs.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0)

export interface BuildInput {
  book: VnBook
  edition: Edition
  lang: Lang
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

  const paragraphsOf = (scenes: readonly VnScene[]): string[] =>
    scenes
      .flatMap((s) => s.beats)
      .filter(hasText)
      .flatMap((b) => {
        const text = beatTextOf(book, edition, lang, b)
        if (!text) return []
        if (b.type === 'narration') return [text]
        const name = (b.speakerKey ? edition.characterNames[b.speakerKey]?.trim() : '') || b.speakerLabel
        return [name ? `${name}: ${text}` : text]
      })

  const sections: ExportSection[] = []
  const pages: ExportSection[] = []
  for (const c of chapters) {
    if (mode === 'picture-book') {
      c.scenes.forEach((scene, i) => {
        const paragraphs = paragraphsOf([scene])
        const page: ExportSection = { no: pages.length + 1, chapter: c.n, paragraphs, picture: pictureOf(scene, `chapter ${c.n}, scene ${scene.id}`) }
        if (i === 0) page.title = titleOf(c)
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
    if (mode === 'gamebook' && c.choices.length) {
      section.choices = c.choices.map((ch, i) => ({ text: choiceTextOf(book, edition, lang, c, i)!, toNo: sectionOf(input.map!, ch.to) }))
    } else if (mode === 'gamebook' || c.ending !== null) {
      section.ending = endingTextOf(book, edition, lang, c)
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

  const first = chapters[0]?.scenes[0]
  const coverFile = first ? input.resolveAsset(first.backgroundId) : null
  const cover: ExportCover = {
    title: edition.title.trim() || book.title,
    ...(book.author ? { author: book.author } : {}),
    source: 'first-scene-background',
    ...(coverFile && first ? { picture: { assetId: first.backgroundId, file: coverFile } } : {})
  }
  if (!cover.picture) warnings.push('cover: no first-scene background file, so the cover is text only')

  return { slug: book.slug, title: cover.title, lang, mode, cover, sections: mode === 'picture-book' ? [] : sections, pages: mode === 'picture-book' ? pages : [], warnings }
}

/** The pictures an export holds: the section/page pictures plus the cover. */
export function pictureCount(b: ExportBook): number {
  return [...b.sections, ...b.pages].filter((s) => s.picture).length + (b.cover.picture ? 1 : 0)
}

export interface ExportOptions {
  /** The edition to print. Default: the project's primary language. */
  lang?: Lang
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
  const edition: Edition =
    (await store.loadEdition(slug, lang).catch((e: unknown) => {
      if (lang === book.primaryLang) return null // the primary text is in vn.json
      throw e
    })) ?? { lang, title: book.title, chapterTitles: {}, choiceTexts: {}, endings: {}, characterNames: {}, beats: {} }
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
