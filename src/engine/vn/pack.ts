import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { languageInfo } from '../../shared/languages'
import { editionSchema, hasText, langSchema, presentationForFormat, vnBookSchema } from '../../shared/vn'
import type { Edition, ImageEntry, Lang, SoundEntry, VnBeat, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { puzzleCoreSchema, puzzleEntityIds, puzzleTextIds } from '../../shared/puzzle'
import type { PuzzleEntry } from '../../shared/puzzle'
import type { LangDetection } from './lang'
import { mapExpression } from './expressions'
import { backgroundIdFor, beatId, sceneId, slugKey } from './ids'
import { charactersInText, cueKey, detectTime, matchPlace } from './script'
import type { AliasMerge } from './aliases'
import type { Uncertain } from './script'

/**
 * The VN pack v2 reader (HUB-16 / VNO-46).
 *
 * `vn/pack.json` is the language-independent template: structure, ids and art fields. `vn/text/<lang>.json` is a catalogue:
 * the same shape as an `Edition` plus format/version/lang/packHash and the optional `blurb` and `sceneTitles`. The pack
 * reader validates both and builds the project's `VnBook` and primary `Edition` exactly as the legacy folder importer
 * would for the same book — asset ids come only from the template (`backgroundId`, `cueKey`), never from catalogue text.
 */

export const PACK_FORMAT = 'vn-pack'
export const PACK_VERSION = 2
export const TEXT_FORMAT = 'vn-text'
export const BUNDLE_FORMAT = 'vn-edition-bundle'

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'a hash such as sha256:ab12… (64 lowercase hex digits)')

/** SHA-256 as `sha256:<hex>`. */
export function sha256(data: string | Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/** Canonical JSON: object keys sorted recursively, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(v as Record<string, unknown>).sort()) out[key] = sort((v as Record<string, unknown>)[key])
      return out
    }
    return v
  }
  return JSON.stringify(sort(value))
}

/** The pack hash: canonical JSON of the pack object without its `packHash` key. */
export function packHashOf(pack: Record<string, unknown>): string {
  const rest = { ...pack }
  delete rest.packHash
  return sha256(canonicalJson(rest))
}

/**
 * The source hash: each authored file as `relpath + "\0" + bytes + "\0"`, in contract order (`outline.md`,
 * `bible/bible.md`, `bible/puzzles.md` when present, `cover-brief.md` when present, then `chapters/*.md` sorted by the
 * first number of the file name). `book.md` is not in the hash: publishing writes cover fields into it after the pack
 * is built, which would make every pack stale by design. Null when the folder has no authored script files (a bundle).
 */
export async function sourceHashOf(folder: string): Promise<string | null> {
  const read = async (rel: string): Promise<Buffer | null> => {
    try {
      return await fs.readFile(path.join(folder, rel))
    } catch {
      return null
    }
  }
  const outline = await read('outline.md')
  const files: { rel: string; bytes: Buffer }[] = []
  if (outline) files.push({ rel: 'outline.md', bytes: outline })
  for (const rel of ['bible/bible.md', 'bible/puzzles.md', 'cover-brief.md']) {
    const bytes = await read(rel)
    if (bytes) files.push({ rel, bytes })
  }
  let chapters: string[] = []
  try {
    chapters = (await fs.readdir(path.join(folder, 'chapters'), { withFileTypes: true })).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name)
  } catch {
    /* no chapters folder */
  }
  if (!files.length && !chapters.length) return null
  const pos = (name: string): number => {
    const m = /(\d+)/.exec(name)
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
  }
  chapters.sort((a, b) => pos(a) - pos(b) || a.localeCompare(b))
  for (const name of chapters) {
    const bytes = await read(path.join('chapters', name))
    if (bytes) files.push({ rel: `chapters/${name}`, bytes })
  }
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(f.rel.split(path.sep).join('/'))
    hash.update('\0')
    hash.update(f.bytes)
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

// ---- the template ----

const cueImageSchema = z.object({ display: z.enum(['full', 'insert']).default('full'), text: z.string(), key: z.string().optional() })
const cueSoundSchema = z.object({ text: z.string() })
const beatBase = {
  id: z.string(),
  image: cueImageSchema.nullable().optional(),
  sfx: cueSoundSchema.nullable().optional(),
  ambience: cueSoundSchema.nullable().optional()
}
const packBeatSchema = z.discriminatedUnion('type', [
  z.object({ ...beatBase, type: z.literal('cast'), cast: z.array(z.object({ charKey: z.string(), look: z.string().optional() })).default([]) }),
  z.object({ ...beatBase, type: z.literal('line'), speakerKey: z.string(), expression: z.string().optional(), aliasKey: z.string().optional() }),
  z.object({ ...beatBase, type: z.literal('narration') }),
  z.object({ ...beatBase, type: z.literal('puzzle'), puzzle: z.string() })
])
export type PackBeat = z.infer<typeof packBeatSchema>

const packSceneSchema = z.object({
  id: z.string(),
  placeKey: z.string().nullable().optional(),
  placeText: z.string().optional(),
  time: z.string().nullable().optional(),
  description: z.string().optional(),
  breakBefore: z.boolean().optional(),
  beats: z.array(packBeatSchema)
})

const packChapterSchema = z.object({
  n: z.number().int().positive(),
  isEnding: z.boolean().optional(),
  choices: z.array(z.object({ index: z.number().int().nonnegative(), to: z.number().int().positive() })).optional(),
  scenes: z.array(packSceneSchema)
})

const packCharacterSchema = z.object({
  key: z.string(),
  looks: z.string().optional(),
  voice: z.string().optional(),
  aliasKeys: z.array(z.string()).optional()
})

const packPlaceSchema = z.object({ key: z.string(), name: z.string().optional(), looks: z.string().optional() })

const packPuzzleSchema = z.object({
  key: z.string(),
  kind: z.enum(['murdle', 'knights', 'testimony', 'logic', 'quiz']),
  data: z.record(z.string(), z.unknown()),
  chapter: z.number().int().positive().optional(),
  clueAt: z.record(z.string(), z.string()).optional(),
  links: z.record(z.string(), z.object({ type: z.enum(['character', 'place', 'image']), key: z.string() })).optional(),
  onFail: z.object({ mode: z.enum(['retry', 'continue', 'chapter']), to: z.number().int().positive().optional(), maxTries: z.number().int().positive().optional() }).optional(),
  hints: z.boolean().optional(),
  verified: z.object({ unique: z.boolean(), deducible: z.boolean(), score: z.number(), textChecked: z.boolean(), by: z.string() }).optional()
})

export const packSchema = z.object({
  format: z.literal(PACK_FORMAT),
  version: z.literal(PACK_VERSION),
  packHash: hashSchema,
  book: z.object({
    slug: z.string().min(1),
    format: z.string().default('visual-novel'),
    kind: z.enum(['linear', 'choice']),
    primaryLang: langSchema,
    genre: z.string().optional(),
    style: z.string().optional(),
    author: z.string().optional(),
    coverBrief: z.string().optional(),
    sourceHash: hashSchema.optional()
  }),
  characters: z.array(packCharacterSchema).default([]),
  places: z.array(packPlaceSchema).default([]),
  expressions: z.array(z.string()).optional(),
  chapters: z.array(packChapterSchema),
  puzzles: z.array(packPuzzleSchema).optional()
})
export type Pack = z.infer<typeof packSchema>

// ---- the catalogue ----

export const catalogSchema = z.object({
  format: z.literal(TEXT_FORMAT),
  version: z.literal(PACK_VERSION),
  lang: langSchema,
  packHash: hashSchema,
  title: z.string(),
  blurb: z.string().optional(),
  chapterTitles: z.record(z.string(), z.string()).default({}),
  sceneTitles: z.record(z.string(), z.string()).optional(),
  choiceTexts: z.record(z.string(), z.string()).default({}),
  endings: z.record(z.string(), z.string()).default({}),
  characterNames: z.record(z.string(), z.string()).default({}),
  beats: z.record(z.string(), z.string()).default({}),
  puzzles: z.record(z.string(), z.object({ names: z.record(z.string(), z.string()).default({}), text: z.record(z.string(), z.string()).default({}) })).default({})
})
export type Catalog = z.infer<typeof catalogSchema>

/** The metadata of an edition bundle's `edition.json`. */
export const bundleMetaSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(PACK_VERSION),
  lang: langSchema,
  packHash: hashSchema,
  sourceSlug: z.string().optional()
})

// ---- reading and validating ----

export interface LoadedPack {
  folder: string
  packPath: string
  catalogPath: string
  /** The parsed (and validated) template. */
  pack: Pack
  /** The template object as written, for the canonical hash. */
  raw: Record<string, unknown>
  /** The declared `packHash`. */
  packHash: string
  /** The hash computed from the content (equals `packHash` unless the file was edited). */
  computedHash: string
  /** The authored source hash found on disk (null when the folder has no authored files). */
  sourceHash: string | null
  warnings: string[]
}

/** True for a source folder that carries a pack (`vn/pack.json`). */
export function isPackFolder(folder: string): boolean {
  return existsSync(path.join(folder, 'vn', 'pack.json'))
}

/** Reads and validates `vn/pack.json` of a book folder (or the pack file itself). */
export async function readPack(folderOrFile: string): Promise<LoadedPack> {
  const folder = path.basename(folderOrFile) === 'pack.json' ? path.dirname(path.dirname(folderOrFile)) : folderOrFile
  const packPath = path.basename(folderOrFile) === 'pack.json' ? folderOrFile : path.join(folder, 'vn', 'pack.json')
  let text: string
  try {
    text = await fs.readFile(packPath, 'utf8')
  } catch {
    throw new Error(`no vn/pack.json in ${folder}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`${packPath} is not valid JSON: ${(e as Error).message}`, { cause: e })
  }
  const parsed = packSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`${packPath}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  const obj = raw as Record<string, unknown>
  const warnings: string[] = []
  const computedHash = packHashOf(obj)
  if (parsed.data.packHash !== computedHash) {
    warnings.push(`vn/pack.json declares ${parsed.data.packHash} but its content hashes to ${computedHash}: the pack was edited after it was written`)
  }
  const sourceHash = await sourceHashOf(folder)
  if (parsed.data.book.sourceHash && sourceHash && parsed.data.book.sourceHash !== sourceHash) {
    warnings.push(`the pack is stale: sourceHash ${parsed.data.book.sourceHash} does not match the authored files (${sourceHash}); compile the pack again`)
  }
  const catalogPath = path.join(folder, 'vn', 'text', `${parsed.data.book.primaryLang}.json`)
  return { folder, packPath, catalogPath, pack: parsed.data, raw: obj, packHash: parsed.data.packHash, computedHash, sourceHash, warnings }
}

/** Reads and validates a `vn/text/<lang>.json` catalogue file. */
export async function readCatalog(file: string): Promise<Catalog> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    throw new Error(`no catalogue at ${file}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`, { cause: e })
  }
  const parsed = catalogSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  return parsed.data
}

/** What a pack import produces, in the shape the legacy importer returns. */
export interface PackImportResult {
  book: VnBook
  edition: Edition
  detected: LangDetection
  uncertain: Uncertain[]
  aliases: AliasMerge[]
  warnings: string[]
  packHash: string
  packVersion: number
  sourceHash?: string
  /** The source folder and catalogue it was read from. */
  folder: string
  catalogPath: string
}

const SINGLE_LINE = /[\r\n]/
const STRUCTURAL = /^\s*(?:scene|on screen|narration|cg|insert|sfx|ambience|clue|evidence|puzzle|testimony)\s*:/i
const STRUCTURAL_ID = /\bch\d{2}\.s\d{2}(?:\.b\d{3})?\b/i

/** Every catalogue key the book expects, by section. */
export interface ExpectedCatalogKeys {
  chapterTitles: Set<string>
  choiceTexts: Set<string>
  endings: Set<string>
  characterNames: Set<string>
  beats: Set<string>
  scenes: Set<string>
  puzzles: Map<string, { names: Set<string>; text: Set<string> }>
}

/** The catalogue keys a `VnBook` expects: beats, chapter titles, choice texts, endings, names (aliases as `key#n`), scenes and puzzle ids. */
export function expectedCatalogKeys(book: VnBook): ExpectedCatalogKeys {
  const out: ExpectedCatalogKeys = {
    chapterTitles: new Set(),
    choiceTexts: new Set(),
    endings: new Set(),
    characterNames: new Set(),
    beats: new Set(),
    scenes: new Set(),
    puzzles: new Map()
  }
  for (const ch of book.chapters) {
    out.chapterTitles.add(String(ch.n))
    ch.choices.forEach((_c, i) => out.choiceTexts.add(`${ch.n}:${i}`))
    if (ch.ending !== null && ch.ending.trim() !== '') out.endings.add(String(ch.n))
    for (const sc of ch.scenes) {
      out.scenes.add(sc.id)
      for (const b of sc.beats) if (hasText(b)) out.beats.add(b.id)
    }
  }
  for (const c of book.characters) {
    out.characterNames.add(c.key)
    for (const i of (c.aliases ?? []).keys()) out.characterNames.add(`${c.key}#${i + 1}`)
  }
  for (const p of book.puzzles ?? []) {
    out.puzzles.set(p.key, { names: new Set(Object.keys(p.names)), text: new Set(Object.keys(p.text)) })
  }
  return out
}

export interface CatalogDiff {
  /** Expected keys the catalogue leaves out, as readable labels (`beat ch01.s01.b002`). */
  missing: string[]
  /** Catalogue keys the book does not have, as readable labels. */
  extra: string[]
  /** The missing beat ids alone (the build falls back to the primary text for them). */
  missingBeats: string[]
}

const diffKeys = (what: string, expected: Set<string>, actual: Record<string, string>): { missing: string[]; extra: string[] } => {
  const missing = [...expected].filter((k) => !(k in actual)).map((k) => `${what} ${k}`)
  const extra = Object.keys(actual).filter((k) => !expected.has(k)).map((k) => `${what} ${k}`)
  return { missing, extra }
}

/** Compares a catalogue key set with the book's expected set (and the puzzle id sets). Optional scene titles must still name real scenes. */
export function compareCatalogKeys(book: VnBook, catalog: Catalog): CatalogDiff {
  const expected = expectedCatalogKeys(book)
  const parts = [
    diffKeys('chapter title', expected.chapterTitles, catalog.chapterTitles),
    diffKeys('choice', expected.choiceTexts, catalog.choiceTexts),
    diffKeys('ending', expected.endings, catalog.endings),
    diffKeys('character name', expected.characterNames, catalog.characterNames),
    diffKeys('beat', expected.beats, catalog.beats),
    // scene titles are optional: a catalogue may omit any scene; an unknown scene id is still an error
    catalog.sceneTitles ? { missing: [], extra: Object.keys(catalog.sceneTitles).filter((k) => !expected.scenes.has(k)).map((k) => `scene title ${k}`) } : { missing: [], extra: [] }
  ]
  const puzzleKeys = Object.keys(catalog.puzzles)
  for (const key of puzzleKeys) {
    const p = expected.puzzles.get(key)
    if (!p) {
      parts.push({ missing: [], extra: [`puzzle ${key}`] })
      continue
    }
    parts.push(diffKeys(`puzzle ${key} name`, p.names, catalog.puzzles[key]!.names))
    parts.push(diffKeys(`puzzle ${key} clue`, p.text, catalog.puzzles[key]!.text))
  }
  for (const key of expected.puzzles.keys()) if (!puzzleKeys.includes(key)) parts.push({ missing: [`puzzle ${key}`], extra: [] })
  return {
    missing: parts.flatMap((p) => p.missing),
    extra: parts.flatMap((p) => p.extra),
    missingBeats: parts.flatMap((p) => p.missing).filter((k) => k.startsWith('beat ')).map((k) => k.slice(5))
  }
}

/** Problems with the values themselves: empty, multi-line, or a structural label an editor could have pasted in. */
export function catalogValueProblems(catalog: Catalog): string[] {
  const out: string[] = []
  const check = (what: string, value: string) => {
    if (!value || !value.trim()) out.push(`${what} is empty`)
    else if (SINGLE_LINE.test(value)) out.push(`${what} is not a single line`)
    else if (STRUCTURAL.test(value)) out.push(`${what} starts with a structural label: "${value.slice(0, 40)}"`)
    else if (STRUCTURAL_ID.test(value)) out.push(`${what} contains a beat or scene id: "${value.slice(0, 60)}"`)
  }
  check('the title', catalog.title)
  if (catalog.blurb !== undefined) check('the blurb', catalog.blurb)
  for (const [k, v] of Object.entries(catalog.chapterTitles)) check(`chapter ${k} title`, v)
  for (const [k, v] of Object.entries(catalog.sceneTitles ?? {})) check(`scene ${k} title`, v)
  for (const [k, v] of Object.entries(catalog.choiceTexts)) check(`choice ${k}`, v)
  for (const [k, v] of Object.entries(catalog.endings)) check(`ending ${k}`, v)
  for (const [k, v] of Object.entries(catalog.characterNames)) check(`name of ${k}`, v)
  for (const [k, v] of Object.entries(catalog.beats)) check(`beat ${k}`, v)
  for (const [key, words] of Object.entries(catalog.puzzles)) {
    for (const [id, v] of Object.entries(words.names)) check(`puzzle ${key} name ${id}`, v)
    for (const [id, v] of Object.entries(words.text)) check(`puzzle ${key} clue ${id}`, v)
  }
  return out
}

/** The `Edition` of a catalogue (metadata stripped, optional `sceneTitles` kept). */
export function editionFromCatalog(catalog: Catalog): Edition {
  return editionSchema.parse({
    lang: catalog.lang,
    title: catalog.title,
    chapterTitles: catalog.chapterTitles,
    choiceTexts: catalog.choiceTexts,
    endings: catalog.endings,
    characterNames: catalog.characterNames,
    beats: catalog.beats,
    ...(Object.keys(catalog.puzzles).length ? { puzzles: catalog.puzzles } : {}),
    ...(catalog.sceneTitles ? { sceneTitles: catalog.sceneTitles } : {})
  })
}

// ---- building the book ----

function humanName(key: string): string {
  if (/^speaker_\d+$/.test(key)) return `Speaker ${key.slice('speaker_'.length)}`
  return key
}

interface BuildContext {
  pack: Pack
  catalog: Catalog
  warnings: string[]
  /** source character key (or alias key) -> the char key and the label to show. */
  charRefs: Map<string, { key: string; label: string }>
  characters: VnBook['characters']
  places: VnBook['places']
  /** Unknown source speaker/place keys -> synthetic ids. */
  syntheticChars: Map<string, string>
  syntheticPlaces: Map<string, string>
}

function makeCharacterContext(pack: Pack, catalog: Catalog, warnings: string[]): BuildContext {
  const characters: VnBook['characters'] = []
  const charRefs = new Map<string, { key: string; label: string }>()
  const seen = new Set<string>()
  for (const c of pack.characters) {
    const key = slugKey(c.key)
    if (key !== c.key) warnings.push(`character key "${c.key}" is not a slug: using "${key}"`)
    if (seen.has(key)) {
      warnings.push(`duplicate character key "${key}" in vn/pack.json: the first entry wins`)
      continue
    }
    seen.add(key)
    const name = catalog.characterNames[c.key]?.trim() || humanName(key)
    if (!catalog.characterNames[c.key]) warnings.push(`the catalogue has no name for character ${c.key}: using "${name}"`)
    const aliases: string[] = []
    for (const [i, aliasKey] of (c.aliasKeys ?? []).entries()) {
      const n = i + 1
      const expectedKey = `${c.key}#${n}`
      const alias = catalog.characterNames[aliasKey]?.trim()
      if (!alias) warnings.push(`the catalogue has no name for alias ${aliasKey} of ${c.key}`)
      if (aliasKey !== expectedKey) warnings.push(`alias key ${aliasKey} of ${c.key} is not ${expectedKey}`)
      if (alias) aliases.push(alias)
    }
    characters.push({ key, name, looks: c.looks ?? '', ...(c.voice?.trim() ? { voice: c.voice } : {}), ...(aliases.length ? { aliases } : {}) })
    charRefs.set(c.key, { key, label: catalog.characterNames[c.key]?.trim() || name })
    for (const aliasKey of c.aliasKeys ?? []) {
      charRefs.set(aliasKey, { key, label: catalog.characterNames[aliasKey]?.trim() || humanName(aliasKey) })
    }
  }
  const places: VnBook['places'] = []
  const seenPlaces = new Set<string>()
  for (const p of pack.places) {
    const key = slugKey(p.key)
    if (key !== p.key) warnings.push(`place key "${p.key}" is not a slug: using "${key}"`)
    if (seenPlaces.has(key)) {
      warnings.push(`duplicate place key "${key}" in vn/pack.json: the first entry wins`)
      continue
    }
    seenPlaces.add(key)
    places.push({ key, name: p.name?.trim() || humanName(key), looks: p.looks ?? '' })
  }
  return { pack, catalog, warnings, charRefs, characters, places, syntheticChars: new Map(), syntheticPlaces: new Map() }
}

function resolveChar(ctx: BuildContext, ref: string): { key: string; label: string } {
  const known = ctx.charRefs.get(ref)
  if (known) return known
  let synthetic = ctx.syntheticChars.get(ref)
  if (!synthetic) {
    synthetic = `speaker_${ctx.syntheticChars.size + 1}`
    ctx.syntheticChars.set(ref, synthetic)
    const label = ctx.catalog.characterNames[ref]?.trim() || humanName(ref)
    ctx.characters.push({ key: synthetic, name: label, looks: '' })
    ctx.charRefs.set(ref, { key: synthetic, label })
    ctx.warnings.push(`unknown speaker "${ref}": synthesized character ${synthetic}`)
  }
  return { key: synthetic, label: ctx.charRefs.get(ref)?.label ?? humanName(ref) }
}

function resolvePlace(ctx: BuildContext, ref: string, placeText: string): string | null {
  if (!ref) return null
  if (ctx.places.some((p) => p.key === ref)) return ref
  let synthetic = ctx.syntheticPlaces.get(ref)
  if (!synthetic) {
    synthetic = `place_${ctx.syntheticPlaces.size + 1}`
    ctx.syntheticPlaces.set(ref, synthetic)
    ctx.places.push({ key: synthetic, name: ref, looks: '' })
    ctx.warnings.push(`unknown place "${ref}": synthesized place ${synthetic}${placeText ? ` (${placeText})` : ''}`)
  }
  return synthetic
}

const imageOf = (images: ImageEntry[], key: string): ImageEntry | undefined => images.find((i) => i.key === key)
const soundOf = (sounds: SoundEntry[], kind: 'sfx' | 'ambience', key: string): SoundEntry | undefined => sounds.find((s) => s.kind === kind && s.key === key)

/**
 * Builds the `VnBook` and the primary `Edition` from a validated pack and its primary catalogue. The catalogue is the
 * source language: its values fill the book's primary text. Cue descriptors become `cg_`/`sfx_`/`amb_` catalogue keys
 * with the existing rules, and no asset key ever comes from the translated catalogues.
 */
export function buildFromPack(loaded: LoadedPack, catalog: Catalog): { book: VnBook; edition: Edition; warnings: string[] } {
  const { pack } = loaded
  const warnings = [...loaded.warnings]
  const presentation = presentationForFormat(pack.book.format)
  const ctx = makeCharacterContext(pack, catalog, warnings)
  const images: ImageEntry[] = []
  const sounds: SoundEntry[] = []
  const chapters: VnChapter[] = []

  const imageFor = (desc: NonNullable<PackBeat['image']>): string => {
    const key = desc.key ? slugKey(desc.key) : cueKey(desc.text)
    if (!imageOf(images, key)) {
      const characters = desc.display === 'insert' ? [] : charactersInText(desc.text, ctx.characters)
      images.push({ key, description: desc.text, display: desc.display, ...(characters.length ? { characters } : {}) })
    }
    return key
  }
  const soundFor = (desc: { text: string }, kind: 'sfx' | 'ambience'): string => {
    const key = cueKey(desc.text)
    if (!soundOf(sounds, kind, key)) sounds.push({ key, kind, description: desc.text })
    return key
  }

  for (const chapter of pack.chapters) {
    // missing catalogue values are '' here; importPackBook reports them as missing keys before returning the book
    const title = catalog.chapterTitles[String(chapter.n)] ?? ''
    const choices = (chapter.choices ?? []).map((c) => ({ text: catalog.choiceTexts[`${chapter.n}:${c.index}`] ?? '', to: c.to }))
    const ending = chapter.isEnding ? (catalog.endings[String(chapter.n)] ?? '') : null
    const scenes: VnScene[] = []
    for (const [sceneIndex, sc] of chapter.scenes.entries()) {
      const id = sc.id || sceneId(chapter.n, sceneIndex + 1)
      const placeText = sc.placeText ?? ''
      // A pack may leave placeKey null when the SCENE text is not a bible name (Scriptorium writes the text as
      // written). Resolve it with the same matchPlace rule the legacy importer uses, so existing background assets keep
      // their ids; when nothing matches, keep the legacy text-based background id and warn.
      const explicitPlace = sc.placeKey ?? ''
      const placeKey = explicitPlace ? resolvePlace(ctx, explicitPlace, placeText) : matchPlace(placeText, ctx.places)
      if (!explicitPlace && placeText && !placeKey) warnings.push(`scene ${id}: the place "${placeText}" matches no place in vn/pack.json: the background uses the place text`)
      // the background id uses VNO's own time canonicalization (script.ts), so a pack's "before dawn" and the legacy
      // importer's "dawn" share one background asset; an unknown time is null, as the legacy parser had it
      const time = detectTime(sc.time ?? '')
      const sceneWarnings: string[] = []
      const beats: VnBeat[] = []
      for (const [beatIndex, b] of sc.beats.entries()) {
        const bid = b.id || beatId(id, beatIndex + 1)
        const cue: Pick<VnBeat, 'image' | 'sfx' | 'ambience'> = {
          ...(b.image === null ? { image: null } : b.image ? { image: imageFor(b.image) } : {}),
          ...(b.sfx === null ? {} : b.sfx ? { sfx: soundFor(b.sfx, 'sfx') } : {}),
          ...(b.ambience === null ? { ambience: null } : b.ambience ? { ambience: soundFor(b.ambience, 'ambience') } : {})
        }
        if (b.type === 'cast') {
          const cast = b.cast
            .map((c) => {
              const r = resolveChar(ctx, c.charKey)
              return { charKey: r.key, ...(c.look?.trim() ? { look: c.look } : {}) }
            })
            .filter((c, i, all) => all.findIndex((x) => x.charKey === c.charKey) === i)
          beats.push({ id: bid, type: 'cast', cast, ...cue })
        } else if (b.type === 'line') {
          const r = resolveChar(ctx, b.speakerKey)
          // a line under an alias: the template names only the alias key; its display name is in the catalogue
          let label = r.label
          if (b.aliasKey) {
            if (!b.aliasKey.startsWith(`${b.speakerKey}#`)) warnings.push(`beat ${bid}: aliasKey ${b.aliasKey} does not belong to speaker ${b.speakerKey}`)
            label = catalog.characterNames[b.aliasKey]?.trim() || humanName(b.aliasKey)
          }
          const text = catalog.beats[bid] ?? ''
          const mapped = mapExpression(b.expression ?? 'neutral')
          beats.push({ id: bid, type: 'line', speakerKey: r.key, speakerLabel: label, expression: mapped.expression, ...(mapped.rawExpression ? { rawExpression: mapped.rawExpression } : {}), text, ...cue })
        } else if (b.type === 'narration') {
          const text = catalog.beats[bid] ?? ''
          beats.push({ id: bid, type: 'narration', text, ...cue })
        } else {
          if (!pack.puzzles?.some((p) => p.key === b.puzzle)) sceneWarnings.push(`beat ${bid} plays puzzle "${b.puzzle}", which vn/pack.json does not list`)
          beats.push({ id: bid, type: 'puzzle', puzzle: b.puzzle, ...cue })
        }
      }
      if (!beats.length) warnings.push(`scene ${id} has no beats`)
      scenes.push({
        id,
        placeKey,
        placeText,
        time,
        backgroundId: backgroundIdFor(presentation, id, placeKey, placeText, time),
        description: sc.description ?? '',
        beats,
        breakBefore: sc.breakBefore ?? false
      })
      warnings.push(...sceneWarnings)
    }
    chapters.push({ n: chapter.n, title, choices, ending, scenes })
  }

  // puzzles: the core is checked; the primary catalogue supplies the words of the book
  const puzzles: PuzzleEntry[] = []
  for (const p of pack.puzzles ?? []) {
    const core = puzzleCoreSchema.safeParse(p.data)
    if (!core.success) throw new Error(`puzzle "${p.key}" has an invalid core: ${core.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    const data = core.data
    const words = catalog.puzzles[p.key] ?? { names: {}, text: {} }
    if (!catalog.puzzles[p.key]) warnings.push(`vn/text/${catalog.lang}.json has no words for puzzle ${p.key}`)
    const names = { ...words.names }
    const text = { ...words.text }
    for (const id of puzzleEntityIds(data)) if (!(id in names)) warnings.push(`puzzle ${p.key}: the catalogue has no name for ${id}`)
    for (const id of puzzleTextIds(data)) if (!(id in text)) warnings.push(`puzzle ${p.key}: the catalogue has no prose for ${id}`)
    for (const [clue, at] of Object.entries(p.clueAt ?? {})) {
      const found = chapters.some((c) => c.scenes.some((s) => s.beats.some((b) => b.id === at)))
      if (!found) warnings.push(`puzzle ${p.key}: clue ${clue} points at beat ${at}, which the pack does not have`)
    }
    for (const [item, link] of Object.entries(p.links ?? {})) {
      if (link.type === 'character' && !ctx.characters.some((c) => c.key === link.key)) warnings.push(`puzzle ${p.key}: item ${item} links to unknown character ${link.key}`)
      if (link.type === 'place' && !ctx.places.some((x) => x.key === link.key)) warnings.push(`puzzle ${p.key}: item ${item} links to unknown place ${link.key}`)
      if (link.type === 'image' && !imageOf(images, link.key)) warnings.push(`puzzle ${p.key}: item ${item} links to image ${link.key}, which no beat shows`)
    }
    puzzles.push({
      key: p.key,
      kind: p.kind,
      data,
      names,
      text,
      ...(p.links ? { links: p.links } : {}),
      ...(p.clueAt ? { clueAt: p.clueAt } : {}),
      ...(p.onFail ? { onFail: p.onFail } : {}),
      ...(p.hints !== undefined ? { hints: p.hints } : {}),
      ...(p.verified ? { verified: p.verified } : { verified: { unique: false, deducible: false, score: 0, textChecked: false, by: 'vn-pack' } })
    })
  }

  const book = vnBookSchema.parse({
    slug: pack.book.slug,
    title: catalog.title,
    ...(pack.book.author ? { author: pack.book.author } : {}),
    ...(pack.book.genre ? { genre: pack.book.genre } : {}),
    format: pack.book.format,
    presentation,
    kind: pack.book.kind,
    primaryLang: pack.book.primaryLang,
    style: pack.book.style ?? '',
    characters: ctx.characters,
    places: ctx.places,
    ...(pack.expressions?.length ? { expressions: pack.expressions } : {}),
    ...(images.length ? { images } : {}),
    ...(sounds.length ? { sounds } : {}),
    ...(puzzles.length ? { puzzles } : {}),
    ...(pack.book.coverBrief ? { coverBrief: pack.book.coverBrief } : {}),
    chapters,
    warnings
  })
  return { book, edition: editionFromCatalog(catalog), warnings }
}

/**
 * Imports a book folder that has `vn/pack.json` and `vn/text/<primaryLang>.json`. Throws when the pack or the primary
 * catalogue is invalid, when a required catalogue key is missing, or when the catalogue carries an unknown key.
 */
export async function importPackBook(folder: string, opts: { lang?: Lang } = {}): Promise<PackImportResult> {
  const loaded = await readPack(folder)
  const primary = loaded.pack.book.primaryLang
  if (opts.lang !== undefined && opts.lang !== primary) throw new Error(`the pack is ${primary} (vn/text/${primary}.json): give lang ${primary} or import it as it is`)
  const catalog = await readCatalog(loaded.catalogPath)
  if (catalog.lang !== primary) throw new Error(`${loaded.catalogPath} is the ${catalog.lang} catalogue, but vn/pack.json says the primary language is ${primary}`)
  if (catalog.packHash !== loaded.packHash) throw new Error(`${loaded.catalogPath} was made for pack ${catalog.packHash}, but vn/pack.json declares ${loaded.packHash}: recompile the pack or the catalogue`)
  // build once to know the book (synthetic characters and places included), then check the keys and values
  const built = buildFromPack(loaded, catalog)
  const book = built.book
  const diff = compareCatalogKeys(book, catalog)
  const problems = catalogValueProblems(catalog)
  const errors = [...diff.missing.map((k) => `missing ${k}`), ...diff.extra.map((k) => `unknown ${k}`), ...problems]
  if (errors.length) throw new Error(`${loaded.catalogPath} does not fit vn/pack.json:\n- ${errors.slice(0, 30).join('\n- ')}${errors.length > 30 ? `\n… ${errors.length - 30} more` : ''}`)
  const language = languageInfo(primary)
  const detected: LangDetection = { lang: primary, confidence: 1, scores: { [primary]: 1 }, words: 0, script: language?.script ?? 'other' }
  return {
    book,
    edition: built.edition,
    detected,
    uncertain: [],
    aliases: [],
    warnings: built.warnings,
    packHash: loaded.packHash,
    packVersion: loaded.pack.version,
    ...(loaded.pack.book.sourceHash ? { sourceHash: loaded.pack.book.sourceHash } : {}),
    folder: loaded.folder,
    catalogPath: loaded.catalogPath
  }
}

// ---- edition sources ----

/** Where a catalogue to add lives: a bare `vn-text` JSON file, or a bundle folder (`edition.json` + `vn/text/<lang>.json`). */
export interface CatalogSource {
  kind: 'catalog' | 'bundle'
  file: string
  folder: string
  /** The bundle's `edition.json`. */
  bundleFile?: string
  /** The bundle's `vn/pack.json`, when it carries one. */
  bundlePack?: string
}

const isFile = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}
const isDir = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

const isCatalogFile = async (file: string): Promise<boolean> => {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { format?: unknown }
    return raw.format === TEXT_FORMAT
  } catch {
    return false
  }
}

/** Resolves `vno_add_edition`'s source to a catalogue file and bundle metadata, or null for a legacy book folder. */
export async function resolveCatalogSource(source: string): Promise<CatalogSource | null> {
  const resolved = path.resolve(source)
  if (await isFile(resolved)) return (await isCatalogFile(resolved)) ? { kind: 'catalog', file: resolved, folder: path.dirname(resolved) } : null
  if (!(await isDir(resolved))) return null
  const bundleFile = path.join(resolved, 'edition.json')
  const textDir = path.join(resolved, 'vn', 'text')
  if (await isFile(bundleFile)) {
    let meta: z.infer<typeof bundleMetaSchema>
    try {
      meta = bundleMetaSchema.parse(JSON.parse(await fs.readFile(bundleFile, 'utf8')))
    } catch (e) {
      throw new Error(`${bundleFile}: ${(e as Error).message}`, { cause: e })
    }
    const file = path.join(textDir, `${meta.lang}.json`)
    if (!(await isFile(file))) throw new Error(`the bundle ${resolved} has no vn/text/${meta.lang}.json`)
    const bundlePack = path.join(resolved, 'vn', 'pack.json')
    return { kind: 'bundle', file, folder: resolved, bundleFile, ...((await isFile(bundlePack)) ? { bundlePack } : {}) }
  }
  // a folder that holds just catalogues (`vn/text/*.json`) is accepted when exactly one is non-primary-sized? No:
  // without a bundle or a named file the caller must say which. `vno_sync_editions` scans the source folder.
  return null
}

/** The bundle's metadata, or null for a bare catalogue. */
export async function readBundleMeta(src: CatalogSource): Promise<z.infer<typeof bundleMetaSchema> | null> {
  if (!src.bundleFile) return null
  return bundleMetaSchema.parse(JSON.parse(await fs.readFile(src.bundleFile, 'utf8')))
}

/** Compares a bundle's copy of the pack with the project pack hash (and the source pack bytes, when they are known). */
export async function checkBundlePack(src: CatalogSource, projectPackHash: string, projectPackDir?: string): Promise<string[]> {
  if (!src.bundlePack) return []
  const warnings: string[] = []
  const loaded = await readPack(src.bundlePack)
  if (loaded.packHash !== projectPackHash) throw new Error(`the bundle's vn/pack.json is ${loaded.packHash}, but this project uses ${projectPackHash}: it belongs to another pack`)
  if (loaded.computedHash !== loaded.packHash) warnings.push(`the bundle's vn/pack.json declares ${loaded.packHash} but hashes to ${loaded.computedHash}`)
  if (projectPackDir) {
    const ours = path.join(projectPackDir, 'vn', 'pack.json')
    try {
      const [a, b] = await Promise.all([fs.readFile(ours), fs.readFile(src.bundlePack)])
      if (!a.equals(b)) warnings.push(`the bundle's vn/pack.json is not byte-identical to ${ours} (same hash, different formatting)`)
    } catch {
      /* no copy in the source folder */
    }
  }
  return warnings
}

/** Lists the catalogues in a folder's `vn/text/` (`*.json` whose name is a language code), sorted by language. */
export async function listCatalogs(folder: string): Promise<{ lang: Lang; file: string }[]> {
  let names: string[]
  try {
    names = (await fs.readdir(path.join(folder, 'vn', 'text'))).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: { lang: Lang; file: string }[] = []
  for (const name of names.sort()) {
    const lang = name.slice(0, -'.json'.length)
    if (!langSchema.safeParse(lang).success) continue
    out.push({ lang, file: path.join(folder, 'vn', 'text', name) })
  }
  return out
}

// ---- primary consistency and stale editions ----

/** Messages for primary text that `vn.json` and `editions/<primary>.json` do not agree on (empty: they agree). */
export function primaryEditionProblems(book: VnBook, edition: Edition): string[] {
  const out: string[] = []
  const at = `editions/${edition.lang}.json`
  if (edition.title !== book.title) out.push(`${at}: the title is "${edition.title}" but vn.json has "${book.title}"`)
  for (const ch of book.chapters) {
    if (edition.chapterTitles[ch.n] !== ch.title) out.push(`${at}: chapter ${ch.n} title is "${edition.chapterTitles[ch.n] ?? ''}" but vn.json has "${ch.title}"`)
    ch.choices.forEach((c, i) => {
      const key = `${ch.n}:${i}`
      if (edition.choiceTexts[key] !== c.text) out.push(`${at}: choice ${key} is "${edition.choiceTexts[key] ?? ''}" but vn.json has "${c.text}"`)
    })
    if (ch.ending !== null && ch.ending.trim() !== '' && edition.endings[ch.n] !== ch.ending) out.push(`${at}: ending ${ch.n} is "${edition.endings[ch.n] ?? ''}" but vn.json has "${ch.ending}"`)
    for (const sc of ch.scenes) {
      for (const b of sc.beats) {
        if (!hasText(b)) continue
        if (edition.beats[b.id] !== b.text) out.push(`${at}: beat ${b.id} is "${edition.beats[b.id] ?? ''}" but vn.json has "${b.text}"`)
      }
    }
  }
  for (const c of book.characters) {
    if (edition.characterNames[c.key] !== c.name) out.push(`${at}: name of ${c.key} is "${edition.characterNames[c.key] ?? ''}" but vn.json has "${c.name}"`)
    ;(c.aliases ?? []).forEach((alias, i) => {
      const key = `${c.key}#${i + 1}`
      if (edition.characterNames[key] !== undefined && edition.characterNames[key] !== alias) out.push(`${at}: alias ${key} is "${edition.characterNames[key]}" but vn.json has "${alias}"`)
    })
  }
  for (const p of book.puzzles ?? []) {
    const words = edition.puzzles?.[p.key]
    if (!words) continue // the build falls back to the book's words
    for (const [id, text] of Object.entries(words.text)) {
      if (id in p.text && text !== p.text[id]) out.push(`${at}: puzzle ${p.key} clue ${id} differs from vn.json`)
    }
    for (const [id, name] of Object.entries(words.names)) {
      if (id in p.names && name !== p.names[id]) out.push(`${at}: puzzle ${p.key} name ${id} differs from vn.json`)
    }
  }
  return out
}
