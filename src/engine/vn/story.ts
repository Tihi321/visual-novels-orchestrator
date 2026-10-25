import { z } from 'zod'
import { CANONICAL_EXPRESSIONS, EXPRESSION_RE, hasText, langSchema, presentationForFormat, presentationOf, presentationSchema, vnBookSchema } from '../../shared/vn'
import { puzzleCoreSchema, puzzleEntityIds, puzzleEntrySchema, puzzleFindableIds, puzzleTextIds } from '../../shared/puzzle'
import type { Edition, Lang, Presentation, VnBeat, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { aliasIndex } from './aliases'
import { expressionsOf, mapExpression } from './expressions'
import { backgroundIdFor, beatId, normText, sceneId, slugKey } from './ids'
import { DEFAULT_ENDING } from './outline'

/**
 * Story as data: build a book from JSON an agent wrote by hand, check it, and edit it with small operations.
 * Pure: no files, no engine. The service (`createProject`, `editStory`) does the saving and the asset follow-up.
 *
 * Ids are stable. A new scene gets the next free `sNN` of its chapter and a new beat the next free `bNNN` of its scene, wherever it
 * is placed; an existing id never changes (editions, voice clips and translations are keyed by them).
 */

const KEY_RE = /^[a-z][a-z0-9_]*$/

// ---- input schemas (lenient: an agent writes these by hand) ----

const keyField = z.string().regex(KEY_RE, 'lowercase letters, digits and underscores, starting with a letter').describe('A short id such as mara or old_harbour. Left out: made from the name')

export const beatInputSchema = z.object({
  type: z.enum(['cast', 'line', 'narration']).optional().describe('Left out: cast when cast is given, line when speaker is given, else narration'),
  cast: z
    .array(z.union([z.string(), z.object({ charKey: z.string().optional(), key: z.string().optional(), look: z.string().optional() })]))
    .optional()
    .describe('For a cast beat: who is on screen from here on (character keys or names, or { charKey, look }). An empty list clears the stage'),
  speaker: z.string().optional().describe('For a line: a character key or name (an unknown name is spoken without a sprite)'),
  expression: z.string().optional().describe(`For a line: ${CANONICAL_EXPRESSIONS.join(', ')} or a free word such as grinning (mapped to the nearest; default neutral)`),
  text: z.string().optional().describe('The words of a line or a narration'),
  image: z.string().nullable().optional().describe('A picture of images (its key): shown from this beat on, over the scene. null hides the picture. Goes on a beat with text, a speaker or a cast'),
  sfx: z.string().optional().describe('A sound effect of sounds (its key), played when this beat starts'),
  ambience: z.string().nullable().optional().describe('An ambience of sounds (its key), started looped from this beat. null stops it'),
  puzzle: z.string().optional().describe('A puzzle of puzzles (its key; vno_puzzle_set makes it): the player solves it here and the story goes on. Stands alone on its beat (a picture, sound or ambience cue is allowed with it)')
})
export type BeatInput = z.infer<typeof beatInputSchema>

export const sceneInputSchema = z.object({
  place: z.string().describe('A place key or name, or free text (then the scene has no place sheet)'),
  time: z.string().nullable().optional().describe('For example dawn, dusk, night. One background is made per place and time'),
  description: z.string().optional().describe('What the scene looks like, used for the background prompt'),
  breakBefore: z.boolean().optional().describe('A scene break came before this scene'),
  music: z.string().nullable().optional().describe('The music of this scene: a track id (music_02, see vno_asset_list kind music). null: silence. Left out: the chapter music goes on'),
  ambience: z.string().nullable().optional().describe('An ambience (a key of sounds) for this scene, looped. null stops it. Left out: what plays goes on'),
  beats: z.array(beatInputSchema).default([])
})
export type SceneInput = z.infer<typeof sceneInputSchema>

const choiceInputSchema = z.object({ text: z.string(), to: z.number().int().positive().describe('The chapter number this choice leads to') })

export const chapterInputSchema = z.object({
  n: z.number().int().positive().optional().describe('The chapter number. Left out: its position, starting at 1'),
  title: z.string(),
  summary: z.string().optional(),
  choices: z.array(choiceInputSchema).optional().describe('Choices at the end of the chapter. A chapter without choices ends the game in a book that has choices'),
  ending: z.string().nullable().optional().describe('The ending text of a chapter that ends the game (not allowed together with choices)'),
  scenes: z.array(sceneInputSchema).default([])
})
export type ChapterInput = z.infer<typeof chapterInputSchema>

const characterInputSchema = z.object({
  key: keyField.optional(),
  name: z.string().min(1),
  looks: z.string().optional().describe('What the character looks like (hair, clothes, colours): the character sheet prompt is made from it'),
  voice: z.string().optional().describe('How the character sounds (a note)'),
  expressions: z.array(z.string()).optional().describe('Expressions of this character beyond the book set (for example smug): each gets a sprite. Lowercase letters and digits, at most 24'),
  aliases: z.array(z.string().min(1)).optional().describe('Other names the story calls the character by ("the bald man"). A line spoken under one shows that name in the game, so the reader is not told the real name early')
})
const imageInputSchema = z.object({
  key: keyField.optional(),
  description: z.string().min(1).describe('What the picture shows: the prompt is made from it'),
  display: z.enum(['full', 'insert']).default('full').describe('full: a CG over the whole scene. insert: an object or a document shown small in the middle'),
  characters: z.array(z.string()).optional().describe('Character keys in the picture (at most 3 are references: their sheets are used)')
})
const soundInputSchema = z.object({
  key: keyField.optional(),
  kind: z.enum(['sfx', 'ambience']).describe('sfx: played once. ambience: looped until stopped'),
  description: z.string().min(1).describe('What it sounds like: the prompt is made from it')
})
const placeInputSchema = z.object({ key: keyField.optional(), name: z.string().min(1), looks: z.string().optional().describe('What the place looks like') })

export const storyInputSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional().describe('The project slug. Left out: made from the title'),
  author: z.string().optional(),
  genre: z.string().optional(),
  format: z.string().optional().describe('For example visual-novel or choice-visual-novel. Left out: chosen from kind'),
  presentation: presentationSchema.optional().describe('visual-novel (sprites and a text box) or picture-book (one illustration and a caption per scene). Left out: follows the format (kids-picture-book is a picture book)'),
  kind: z.enum(['linear', 'choice']).optional().describe('choice when a chapter has choices, else linear. Left out: found from the chapters'),
  lang: langSchema.optional().describe('The language of the text. Left out: detected'),
  style: z.string().optional().describe('Writing or art style note'),
  coverBrief: z.string().optional().describe('What the cover shows'),
  characters: z.array(characterInputSchema).default([]),
  places: z.array(placeInputSchema).default([]),
  expressions: z.array(z.string()).optional().describe('The expression set of the book (default: neutral, happy, sad, angry, surprised, worried, scared, thinking). Must include neutral. Each character gets a sprite for each word it uses'),
  images: z.array(imageInputSchema).default([]).describe('CGs and inserts the beats show (image: <key>)'),
  sounds: z.array(soundInputSchema).default([]).describe('Sound effects and ambiences the beats play (sfx, ambience: <key>)'),
  chapters: z.array(chapterInputSchema).min(1)
})
export type StoryInput = z.infer<typeof storyInputSchema>

// ---- helpers ----

interface Ctx {
  characters: VnBook['characters']
  places: VnBook['places']
  /** The book's expression set (default: the standard eight). */
  expressions?: string[]
  /** How the book is shown: a picture book gives every scene its own page id. Missing: a visual novel. */
  presentation?: Presentation
}

/** The cues a beat input carries, in a book's terms: catalogue keys (a `cg_`, `sfx_` or `amb_` prefix is allowed). */
function cuesOf(input: BeatInput): Pick<VnBeat, 'image' | 'sfx' | 'ambience'> {
  return {
    ...(input.image !== undefined ? { image: input.image === null ? null : input.image.trim().replace(/^cg_/, '') } : {}),
    ...(input.sfx !== undefined ? { sfx: input.sfx.trim().replace(/^sfx_/, '') } : {}),
    ...(input.ambience !== undefined ? { ambience: input.ambience === null ? null : input.ambience.trim().replace(/^amb_/, '') } : {})
  }
}

/** The character a key, a name or an alias points to. */
function findChar(chars: Ctx['characters'], text: string): Ctx['characters'][number] | undefined {
  const t = text.trim()
  const n = normText(t)
  return (
    chars.find((c) => c.key === t) ?? chars.find((c) => normText(c.name) === n) ?? chars.find((c) => c.key === slugKey(t)) ?? chars.find((c) => (c.aliases ?? []).some((a) => normText(a) === n))
  )
}

/** The speaker label of a line spoken by `who` as `text`: an alias keeps its own words (the game shows them), anything else is the character's name. */
const speakerLabelFor = (who: Ctx['characters'][number] | undefined, text: string): string => (who && aliasIndex(who, text) > 0 ? text.trim() : (who?.name ?? text.trim()))

/** The place a key or a name points to. */
function findPlace(places: Ctx['places'], text: string): Ctx['places'][number] | undefined {
  const t = text.trim()
  const n = normText(t)
  return places.find((p) => p.key === t) ?? places.find((p) => normText(p.name) === n) ?? places.find((p) => p.key === slugKey(t))
}

const maxIndex = (ids: string[], re: RegExp): number => ids.reduce((m, id) => Math.max(m, Number(re.exec(id)?.[1] ?? 0)), 0)
const nextSceneIndex = (ch: VnChapter): number => maxIndex(ch.scenes.map((s) => s.id), /\.s(\d+)$/) + 1
const nextBeatIndex = (scene: VnScene): number => maxIndex(scene.beats.map((b) => b.id), /\.b(\d+)$/) + 1

/** A unique key for a new character or place. */
function freeKey(wanted: string, taken: string[]): string {
  if (!taken.includes(wanted)) return wanted
  for (let i = 2; ; i++) if (!taken.includes(`${wanted}_${i}`)) return `${wanted}_${i}`
}

function makeBeat(ctx: Ctx, id: string, input: BeatInput): VnBeat {
  const cues = cuesOf(input)
  if (input.puzzle !== undefined) {
    if (input.cast !== undefined || input.speaker !== undefined || input.text !== undefined || input.type !== undefined) throw new Error(`beat ${id}: a puzzle beat has only a puzzle key (and cues), not a cast, speaker or text`)
    if (!input.puzzle.trim()) throw new Error(`beat ${id}: a puzzle beat needs the key of a puzzle`)
    return { id, type: 'puzzle', puzzle: input.puzzle.trim(), ...cues }
  }
  if (Object.keys(cues).length && input.type === undefined && input.cast === undefined && input.speaker === undefined && input.text === undefined) {
    throw new Error(`beat ${id}: an image, sfx or ambience goes on a beat with text, a speaker or a cast; it cannot stand alone`)
  }
  const type = input.type ?? (input.cast ? 'cast' : input.speaker !== undefined ? 'line' : 'narration')
  if (type === 'cast') {
    const cast = (input.cast ?? []).map((c) => {
      const raw = typeof c === 'string' ? c : (c.charKey ?? c.key ?? '')
      const look = typeof c === 'string' ? undefined : c.look
      if (!raw.trim()) throw new Error(`beat ${id}: a cast entry needs a character key or name`)
      return { charKey: findChar(ctx.characters, raw)?.key ?? raw.trim(), ...(look ? { look } : {}) }
    })
    return { id, type: 'cast', cast, ...cues }
  }
  if (input.text === undefined || !input.text.trim()) throw new Error(`beat ${id}: a ${type} needs text`)
  if (type === 'narration') return { id, type: 'narration', text: input.text, ...cues }
  const label = (input.speaker ?? '').trim()
  if (!label) throw new Error(`beat ${id}: a line needs a speaker (a character key or name)`)
  const who = findChar(ctx.characters, label)
  const mapped = mapExpression(input.expression ?? '', expressionsOf({ expressions: ctx.expressions }, who))
  return {
    id,
    type: 'line',
    speakerKey: who?.key ?? null,
    speakerLabel: speakerLabelFor(who, label),
    expression: mapped.expression,
    ...(mapped.rawExpression ? { rawExpression: mapped.rawExpression } : {}),
    text: input.text,
    ...cues
  }
}

function makeScene(ctx: Ctx, id: string, input: SceneInput): VnScene {
  const placeText = input.place.trim()
  const place = placeText ? findPlace(ctx.places, placeText) : undefined
  const time = input.time?.trim() || null
  return {
    id,
    placeKey: place?.key ?? null,
    placeText: place?.name ?? placeText,
    time,
    backgroundId: backgroundIdFor(ctx.presentation, id, place?.key ?? null, place?.name ?? placeText, time),
    description: input.description?.trim() ?? '',
    beats: input.beats.map((b, i) => makeBeat(ctx, beatId(id, i + 1), b)),
    breakBefore: input.breakBefore ?? false,
    ...(input.music !== undefined ? { music: input.music === null ? null : input.music.trim() } : {}),
    ...(input.ambience !== undefined ? { ambience: input.ambience === null ? null : input.ambience.trim().replace(/^amb_/, '') } : {})
  }
}

function makeChapter(ctx: Ctx, n: number, input: ChapterInput): VnChapter {
  const choices = (input.choices ?? []).map((c) => ({ text: c.text, to: c.to }))
  return {
    n,
    title: input.title,
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    choices,
    ending: input.ending ?? null,
    scenes: input.scenes.map((s, i) => makeScene(ctx, sceneId(n, i + 1), s))
  }
}

/** A key list from the input: given keys or made from the names, unique and Ren'Py-safe. */
function makeKeyed<T extends { key?: string; name: string; looks?: string }>(items: T[], what: string): { key: string; name: string; looks: string }[] {
  const out: { key: string; name: string; looks: string }[] = []
  for (const it of items) {
    const key = it.key ?? slugKey(it.name)
    if (!KEY_RE.test(key)) throw new Error(`${what} key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
    if (out.some((o) => o.key === key)) throw new Error(`two ${what}s have the key "${key}": give one of them another key`)
    out.push({ key, name: it.name, looks: it.looks?.trim() ?? '' })
  }
  return out
}

/** The key of a catalogue entry made from its description: its first four content words (see `cueKey` in script.ts). */
const cueKeyOf = (description: string): string => {
  const stop = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'to', 'and', 'with', 'by', 'for', 'from'])
  return slugKey(normText(description).split(' ').filter((w) => w.length > 1 && !stop.has(w)).slice(0, 4).join(' ') || description)
}

/** A catalogue (images or sounds) from the input: keys given or made from the descriptions, valid and unique (per `group`, for sounds the kind). */
function makeCatalogue<T extends { key?: string; description: string }>(items: T[], what: string, keyOf: (item: T) => string, group: (item: T) => string = () => ''): (T & { key: string })[] {
  const out: (T & { key: string })[] = []
  for (const it of items) {
    const key = keyOf(it)
    if (!KEY_RE.test(key)) throw new Error(`${what} key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
    if (out.some((o) => o.key === key && group(o) === group(it))) throw new Error(`two ${what}s have the key "${key}": give one of them another key`)
    out.push({ ...it, key })
  }
  return out
}

const defaultFormat = (kind: VnBook['kind']) => (kind === 'choice' ? 'choice-visual-novel' : 'visual-novel')

/**
 * Settles the `ending` of every chapter the way the importer does: in a book with choices a chapter without choices ends the game
 * (`The End` when it has no text), a chapter with choices has none; in a linear book only the last chapter ends. Returns warnings.
 */
function normalizeEndings(book: VnBook): string[] {
  const warnings: string[] = []
  const blank = (s: string | null) => !s || !s.trim()
  book.chapters.forEach((c, i) => {
    if (book.kind === 'choice') {
      if (c.choices.length) {
        if (blank(c.ending)) c.ending = null
      } else if (blank(c.ending)) {
        c.ending = DEFAULT_ENDING
        warnings.push(`chapter ${c.n} has no choices and no ending text: using "${DEFAULT_ENDING}"`)
      }
    } else if (i < book.chapters.length - 1) {
      if (!blank(c.ending)) warnings.push(`chapter ${c.n} has an ending text but is not the last chapter of a linear story: the text is dropped`)
      c.ending = null
    } else if (c.ending === null) c.ending = ''
  })
  return warnings
}

const joinProblems = (what: string, errors: string[]) => `${what}:\n${errors.map((e) => `- ${e}`).join('\n')}`

/** Builds a book from the input. Throws with every problem when it is not valid (see `validateBook`). */
export function buildBook(input: StoryInput, o: { slug: string; lang: Lang }): { book: VnBook; warnings: string[] } {
  const characters = makeKeyed(input.characters, 'character').map((c, i) => {
    const aliases = [...new Set((input.characters[i]!.aliases ?? []).map((a) => a.trim()).filter((a) => a && normText(a) !== normText(c.name)))]
    const own = [...new Set(input.characters[i]!.expressions ?? [])]
    return { ...c, ...(input.characters[i]!.voice ? { voice: input.characters[i]!.voice } : {}), ...(aliases.length ? { aliases } : {}), ...(own.length ? { expressions: own } : {}) }
  })
  const places = makeKeyed(input.places, 'place')
  const images = makeCatalogue(input.images, 'image', (i) => i.key ?? cueKeyOf(i.description)).map((i, n) => ({ key: i.key, description: i.description.trim(), display: input.images[n]!.display, ...(input.images[n]!.characters?.length ? { characters: input.images[n]!.characters } : {}) }))
  const sounds = makeCatalogue(input.sounds, 'sound', (s) => s.key ?? cueKeyOf(s.description), (s) => s.kind).map((s, n) => ({ key: s.key, kind: input.sounds[n]!.kind, description: s.description.trim() }))
  const ctx: Ctx = { characters, places, expressions: input.expressions }
  const ns = input.chapters.map((c, i) => c.n ?? i + 1)
  const kind: VnBook['kind'] = input.chapters.some((c) => (c.choices?.length ?? 0) > 0) ? 'choice' : 'linear'
  if (input.kind && input.kind !== kind) throw new Error(input.kind === 'choice' ? 'kind is "choice" but no chapter has choices' : 'kind is "linear" but a chapter has choices')
  // the presentation decides the background ids (one page per scene in a picture book), so it is settled before the scenes are built
  const format = input.format?.trim() || defaultFormat(kind)
  const presentation = input.presentation ?? presentationForFormat(format)
  ctx.presentation = presentation
  const chapters = input.chapters.map((c, i) => makeChapter(ctx, ns[i]!, c))
  const book: VnBook = {
    slug: o.slug,
    title: input.title,
    ...(input.author?.trim() ? { author: input.author.trim() } : {}),
    ...(input.genre?.trim() ? { genre: input.genre.trim() } : {}),
    format,
    presentation,
    kind,
    primaryLang: o.lang,
    style: input.style?.trim() ?? '',
    characters,
    places,
    ...(input.expressions ? { expressions: [...new Set(input.expressions)] } : {}),
    ...(images.length ? { images } : {}),
    ...(sounds.length ? { sounds } : {}),
    ...(input.coverBrief?.trim() ? { coverBrief: input.coverBrief.trim() } : {}),
    chapters,
    warnings: []
  }
  const warnings = normalizeEndings(book)
  const v = validateBook(book)
  if (v.errors.length) throw new Error(joinProblems('the story has problems', v.errors))
  book.warnings = [...warnings, ...v.warnings]
  return { book: vnBookSchema.parse(book), warnings: book.warnings }
}

/** Checks a book. Errors stop an edit (nothing is saved); warnings are kept in `book.warnings`. */
export function validateBook(book: VnBook): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const dupes = (what: string, ids: string[]) => {
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) errors.push(`${what} "${id}" is used twice`)
  }
  dupes('character key', book.characters.map((c) => c.key))
  dupes('place key', book.places.map((p) => p.key))
  dupes('chapter number', book.chapters.map((c) => String(c.n)))
  dupes('scene id', book.chapters.flatMap((c) => c.scenes.map((s) => s.id)))
  dupes('beat id', book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.map((b) => b.id))))
  for (const c of book.characters) if (!KEY_RE.test(c.key)) errors.push(`character key "${c.key}" must be lowercase letters, digits and underscores, starting with a letter`)
  for (const p of book.places) if (!KEY_RE.test(p.key)) errors.push(`place key "${p.key}" must be lowercase letters, digits and underscores, starting with a letter`)

  const chars = new Set(book.characters.map((c) => c.key))
  const places = new Set(book.places.map((p) => p.key))
  const chapterNs = new Set(book.chapters.map((c) => c.n))
  // expression sets: the book's (default: the standard eight) must have neutral; a character may add words
  const bookSet = book.expressions ?? [...CANONICAL_EXPRESSIONS]
  if (!bookSet.includes('neutral')) errors.push('the expression set of the book must include neutral')
  for (const e of [...bookSet, ...book.characters.flatMap((c) => c.expressions ?? [])]) if (!EXPRESSION_RE.test(e)) errors.push(`expression "${e}" must be lowercase letters and digits, starting with a letter, at most 24 characters (no underscore)`)
  // the catalogues of pictures and sounds, and the cues that name them
  const images = new Set((book.images ?? []).map((i) => i.key))
  const sfx = new Set((book.sounds ?? []).filter((s) => s.kind === 'sfx').map((s) => s.key))
  const ambiences = new Set((book.sounds ?? []).filter((s) => s.kind === 'ambience').map((s) => s.key))
  dupes('image key', (book.images ?? []).map((i) => i.key))
  dupes('sfx key', [...(book.sounds ?? [])].filter((s) => s.kind === 'sfx').map((s) => s.key))
  dupes('ambience key', [...(book.sounds ?? [])].filter((s) => s.kind === 'ambience').map((s) => s.key))
  for (const i of book.images ?? []) {
    if (!KEY_RE.test(i.key)) errors.push(`image key "${i.key}" must be lowercase letters, digits and underscores, starting with a letter`)
    for (const c of i.characters ?? []) if (!chars.has(c)) errors.push(`image "${i.key}": character "${c}" is not a character`)
  }
  for (const s of book.sounds ?? []) if (!KEY_RE.test(s.key)) errors.push(`sound key "${s.key}" must be lowercase letters, digits and underscores, starting with a letter`)
  // puzzles: a puzzle beat names a puzzle of the book, a puzzle is played by one beat, the clues are found before it is played
  const puzzleKeys = new Set((book.puzzles ?? []).map((p) => p.key))
  dupes('puzzle key', (book.puzzles ?? []).map((p) => p.key))
  const order = new Map<string, number>()
  book.chapters.forEach((c) => c.scenes.forEach((s) => s.beats.forEach((b) => order.set(b.id, order.size))))
  const players = new Map<string, string>()
  for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.type === 'puzzle') {
    if (!puzzleKeys.has(b.puzzle)) warnings.push(`${b.id}: puzzle "${b.puzzle}" is not made yet (${puzzleKeys.size ? `puzzles: ${[...puzzleKeys].join(', ')}; ` : ''}vno_puzzle_set makes it); the build skips the beat until it is`)
    else if (players.has(b.puzzle)) errors.push(`puzzle "${b.puzzle}" is played by two beats (${players.get(b.puzzle)} and ${b.id})`)
    else players.set(b.puzzle, b.id)
  }
  for (const p of book.puzzles ?? []) {
    if (!KEY_RE.test(p.key)) errors.push(`puzzle key "${p.key}" must be lowercase letters, digits and underscores, starting with a letter`)
    const items = puzzleEntityIds(p.data)
    for (const it of items) if (!p.names[it]?.trim()) errors.push(`puzzle "${p.key}": item ${it} has no name`)
    for (const c of puzzleTextIds(p.data)) if (!p.text[c]?.trim()) errors.push(`puzzle "${p.key}": ${c === 'murder' ? 'the murder note' : `clue ${c}`} has no text`)
    for (const [it, l] of Object.entries(p.links ?? {})) {
      if (!items.includes(it)) errors.push(`puzzle "${p.key}": link of unknown item ${it}`)
      else if (l.type === 'character' ? !chars.has(l.key) : l.type === 'place' ? !places.has(l.key) : !images.has(l.key)) errors.push(`puzzle "${p.key}": ${it} links to ${l.type} "${l.key}", which the book does not have`)
    }
    const mine = players.get(p.key)
    for (const [clue, at] of Object.entries(p.clueAt ?? {})) {
      if (!puzzleFindableIds(p.data).includes(clue)) errors.push(`puzzle "${p.key}": clueAt names unknown clue ${clue}`)
      else if (!order.has(at)) errors.push(`puzzle "${p.key}": clue ${clue} is found at beat ${at}, which does not exist`)
      else if (mine && order.get(at)! >= order.get(mine)!) errors.push(`puzzle "${p.key}": clue ${clue} is found at ${at}, which is not before the puzzle beat ${mine}`)
    }
    if (p.onFail?.mode === 'chapter' && !chapterNs.has(p.onFail.to ?? -1)) errors.push(`puzzle "${p.key}": onFail chapter ${p.onFail.to ?? '(missing)'} does not exist`)
    if (!players.has(p.key)) warnings.push(`puzzle "${p.key}" is not played by any beat (vno_beat_add {puzzle: "${p.key}"})`)
  }
  const known = (what: string, keys: Set<string>) => (keys.size ? `known ${what}: ${[...keys].join(', ')}` : `the book has no ${what}`)
  const unknownSpeakers = new Set<string>()
  let unplaced = 0
  for (const ch of book.chapters) {
    if (ch.choices.length && ch.ending !== null) errors.push(`chapter ${ch.n} has choices and an ending: a chapter either ends the game or offers choices`)
    for (const c of ch.choices) if (!chapterNs.has(c.to)) errors.push(`chapter ${ch.n}: the choice "${c.text}" leads to chapter ${c.to}, which does not exist`)
    for (const s of ch.scenes) {
      if (s.placeKey && !places.has(s.placeKey)) errors.push(`${s.id}: place "${s.placeKey}" is not in places`)
      if (!s.placeKey) unplaced++
      if (typeof s.music === 'string' && !/^music_\d{2,}$/.test(s.music)) errors.push(`${s.id}: music "${s.music}" is not a track id (music_01 ...; null is silence)`)
      if (s.ambience && !ambiences.has(s.ambience)) errors.push(`${s.id}: ambience "${s.ambience}" is not in sounds (${known('ambiences', ambiences)})`)
      if (!s.beats.length) warnings.push(`${s.id} has no beats`)
      for (const b of s.beats) {
        if (b.image && !images.has(b.image)) errors.push(`${b.id}: image "${b.image}" is not in images (${known('images', images)})`)
        if (b.sfx && !sfx.has(b.sfx)) errors.push(`${b.id}: sfx "${b.sfx}" is not in sounds as a sound effect (${known('sound effects', sfx)})`)
        if (b.ambience && !ambiences.has(b.ambience)) errors.push(`${b.id}: ambience "${b.ambience}" is not in sounds as an ambience (${known('ambiences', ambiences)})`)
        if (b.type === 'cast') {
          for (const c of b.cast) if (!chars.has(c.charKey)) errors.push(`${b.id}: cast member "${c.charKey}" is not a character (add it to characters first)`)
        } else if (b.type === 'line') {
          if (b.speakerKey && !chars.has(b.speakerKey)) errors.push(`${b.id}: speaker "${b.speakerKey}" is not a character`)
          if (!b.speakerKey) unknownSpeakers.add(b.speakerLabel)
          const own = expressionsOf(book, book.characters.find((c) => c.key === b.speakerKey))
          if (!own.includes(b.expression)) errors.push(`${b.id}: expression "${b.expression}" is not in the expression set of ${b.speakerKey ?? 'the book'} (${own.join(', ')})`)
        }
      }
    }
  }
  if (unknownSpeakers.size) warnings.push(`speakers not in the characters (no sprite): ${[...unknownSpeakers].join(', ')}`)
  if (unplaced) warnings.push(`${unplaced} scene(s) have a place that matches no place`)
  if (book.kind === 'choice') {
    const reached = new Set(book.chapters.flatMap((c) => c.choices.map((x) => x.to)))
    for (const c of book.chapters.slice(1)) if (!reached.has(c.n)) warnings.push(`chapter ${c.n} is not reached by any choice`)
    if (!book.chapters.some((c) => c.ending !== null)) warnings.push('no chapter ends the game: every chapter has choices')
  }
  return { errors, warnings }
}

/** The numbers of a book for a reply. */
export function storySummary(book: VnBook): { slug: string; title: string; kind: VnBook['kind']; format: string; presentation: Presentation; primaryLang: Lang; chapters: number; scenes: number; beats: number; characters: number; places: number } {
  const scenes = book.chapters.flatMap((c) => c.scenes)
  return {
    slug: book.slug,
    title: book.title,
    kind: book.kind,
    format: book.format,
    presentation: presentationOf(book),
    primaryLang: book.primaryLang,
    chapters: book.chapters.length,
    scenes: scenes.length,
    beats: scenes.reduce((n, s) => n + s.beats.length, 0),
    characters: book.characters.length,
    places: book.places.length
  }
}

/**
 * Brings the edition of another language in line with an edited book: drops the text of beats, chapters and choices that are gone,
 * and adds the name of a new character (in the primary language) so the build has one. Translated text that is still valid stays.
 */
export function syncEdition(ed: Edition, book: VnBook): Edition {
  const beatIds = new Set(book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.filter(hasText).map((b) => b.id))))
  const pick = <T>(rec: Record<string, T>, keep: (k: string) => boolean): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([k]) => keep(k)))
  const chapter = (k: string) => book.chapters.find((c) => c.n === Number(k))
  const characterNames: Record<string, string> = {}
  for (const c of book.characters) {
    characterNames[c.key] = ed.characterNames[c.key] ?? c.name
    // the translated name of an alias is kept while the alias is there
    for (const i of (c.aliases ?? []).keys()) {
      const k = `${c.key}#${i + 1}`
      if (ed.characterNames[k] !== undefined) characterNames[k] = ed.characterNames[k]
    }
  }
  return {
    ...ed,
    beats: pick(ed.beats, (id) => beatIds.has(id)),
    chapterTitles: pick(ed.chapterTitles, (k) => !!chapter(k)),
    choiceTexts: pick(ed.choiceTexts, (k) => {
      const [n, i] = k.split(':')
      return Number(i) < (chapter(n!)?.choices.length ?? 0)
    }),
    endings: pick(ed.endings, (k) => !!chapter(k)?.ending),
    characterNames,
    // the words of a puzzle stay while the puzzle (and its item or clue) is there
    ...(ed.puzzles
      ? {
          puzzles: Object.fromEntries(
            (book.puzzles ?? [])
              .filter((p) => ed.puzzles![p.key])
              .map((p) => {
                const e = ed.puzzles![p.key]!
                return [p.key, { names: pick(e.names, (k) => k in p.names), text: pick(e.text, (k) => k in p.text) }]
              })
          )
        }
      : {})
  }
}

// ---- operations ----

const nullableText = z.string().nullable().optional()

export const storyOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('book.update'),
    title: z.string().min(1).optional(),
    author: nullableText.describe('null clears it'),
    genre: nullableText.describe('null clears it'),
    style: z.string().optional(),
    coverBrief: nullableText.describe('null clears it'),
    format: z.string().optional(),
    presentation: presentationSchema.optional().describe('visual-novel or picture-book. Changed: every scene gets the background id of its presentation again (in a picture book one page per scene), so the pages need new prompts and images'),
    expressions: z.array(z.string()).nullable().optional().describe('The expression set of the book (must include neutral); null goes back to the standard eight. A line that uses a word the set loses is refused')
  }),
  z.object({
    op: z.literal('character.set'),
    key: z.string().optional().describe('An existing key to change, or the key of a new character'),
    name: z.string().optional(),
    looks: z.string().optional(),
    voice: z.string().optional(),
    aliases: z.array(z.string()).nullable().optional().describe('Other names the story calls the character by; replaces the list, null clears it'),
    expressions: z.array(z.string()).nullable().optional().describe('Expressions of this character beyond the book set; replaces the list, null clears it')
  }),
  z.object({
    op: z.literal('image.set'),
    key: z.string().describe('An existing key to change, or the key of a new picture'),
    description: z.string().optional().describe('What the picture shows (needed for a new one)'),
    display: z.enum(['full', 'insert']).optional(),
    characters: z.array(z.string()).nullable().optional().describe('Character keys in the picture; replaces the list, null clears it')
  }),
  z.object({ op: z.literal('image.remove'), key: z.string(), force: z.boolean().optional().describe('Also clear the image cues of the beats that show it') }),
  z.object({
    op: z.literal('sound.set'),
    key: z.string().describe('An existing key to change, or the key of a new sound'),
    kind: z.enum(['sfx', 'ambience']).optional().describe('Needed for a new sound, and to say which one when a sfx and an ambience share the key'),
    description: z.string().optional().describe('What it sounds like (needed for a new one)')
  }),
  z.object({ op: z.literal('sound.remove'), key: z.string(), kind: z.enum(['sfx', 'ambience']).optional(), force: z.boolean().optional().describe('Also clear the cues that play it') }),
  z.object({
    op: z.literal('puzzle.set'),
    key: z.string().describe('An existing key to change, or the key of a new puzzle'),
    data: puzzleCoreSchema.optional().describe('The puzzle core (vno_puzzle_generate makes one). Needed for a new puzzle'),
    names: z.record(z.string(), z.string()).optional().describe('Item id -> name (s1: Colonel Ash). Needed for a new puzzle'),
    text: z.record(z.string(), z.string()).optional().describe('Clue id (and murder) -> the clue in prose. Needed for a new puzzle'),
    links: z.record(z.string(), z.object({ type: z.enum(['character', 'place', 'image']), key: z.string() })).nullable().optional(),
    clueAt: z.record(z.string(), z.string()).nullable().optional().describe('Clue id -> the beat id where the clue is found; the puzzle lists only the clues found by then'),
    onFail: puzzleEntrySchema.shape.onFail.nullable(),
    hints: z.boolean().nullable().optional(),
    verified: puzzleEntrySchema.shape.verified.optional().describe('What the code proved (set by vno_puzzle_set, not by hand)')
  }),
  z.object({ op: z.literal('puzzle.remove'), key: z.string(), force: z.boolean().optional().describe('Also remove the beat that plays it') }),
  z.object({ op: z.literal('character.remove'), key: z.string(), force: z.boolean().optional().describe('Also remove its cast entries and make its lines speakerless') }),
  z.object({ op: z.literal('place.set'), key: z.string().optional().describe('An existing key to change, or the key of a new place'), name: z.string().optional(), looks: z.string().optional() }),
  z.object({ op: z.literal('place.remove'), key: z.string(), force: z.boolean().optional().describe('The scenes keep the place text but lose the place') }),
  z.object({ op: z.literal('chapter.add'), chapter: chapterInputSchema, n: z.number().int().positive().optional().describe('Left out: the highest number plus one'), after: z.number().int().positive().optional().describe('Put it after this chapter number (default: by number)') }),
  z.object({
    op: z.literal('chapter.update'),
    n: z.number().int().positive(),
    title: z.string().optional(),
    summary: z.string().optional(),
    ending: z.string().nullable().optional().describe('The ending text; null makes it a chapter that does not end the game'),
    choices: z.array(choiceInputSchema).optional().describe('Replaces the choices')
  }),
  z.object({ op: z.literal('chapter.remove'), n: z.number().int().positive() }),
  z.object({ op: z.literal('scene.add'), chapter: z.number().int().positive().describe('The chapter number'), scene: sceneInputSchema, at: z.number().int().min(0).optional().describe('Position in the chapter, from 0. Default: the end') }),
  z.object({
    op: z.literal('scene.update'),
    sceneId: z.string().describe('For example ch01.s02'),
    place: z.string().optional().describe('A place key or name (the background follows)'),
    time: z.string().nullable().optional().describe('For example dusk; null clears it (the background follows)'),
    description: z.string().optional(),
    breakBefore: z.boolean().optional(),
    music: z.string().nullable().optional().describe('A track id (music_02), "none" for silence in this scene, null to remove the setting (the chapter music goes on)'),
    ambience: z.string().nullable().optional().describe('An ambience key, "none" to stop it in this scene, null to remove the setting')
  }),
  z.object({ op: z.literal('scene.remove'), sceneId: z.string() }),
  z.object({
    op: z.literal('beat.add'),
    sceneId: z.string(),
    beats: z.array(beatInputSchema).min(1),
    at: z.number().int().min(0).optional().describe('Position in the scene, from 0. Default: the end'),
    after: z.string().optional().describe('Put them after this beat id, for example ch01.s02.b003')
  }),
  z.object({
    op: z.literal('beat.update'),
    beatId: z.string().describe('For example ch01.s02.b003'),
    text: z.string().optional().describe('Line or narration'),
    speaker: z.string().optional().describe('Line: a character key or name'),
    expression: z.string().optional().describe('Line'),
    cast: beatInputSchema.shape.cast.describe('Cast beat: the new list of who is on screen'),
    image: z.string().nullable().optional().describe('A picture key shown from this beat, "none" to hide the picture here, null to clear the cue'),
    sfx: z.string().nullable().optional().describe('A sound effect key played when the beat starts; null clears it'),
    ambience: z.string().nullable().optional().describe('An ambience key started here, "none" to stop it, null to clear the cue')
  }),
  z.object({ op: z.literal('beat.remove'), beatIds: z.array(z.string()).min(1) })
])
export type StoryOp = z.infer<typeof storyOpSchema>

export type StoryPart = 'book' | 'characters' | 'places' | 'images' | 'sounds' | 'puzzles' | 'chapters' | 'scenes' | 'beats'

export interface Affected {
  /** Keys of the characters whose name or looks changed (or that are new): their sheet and sprites need new prompts. */
  chars: string[]
  /** Ids of the backgrounds of scenes that changed (or whose place changed). */
  backgrounds: string[]
  /** The title or cover brief changed. */
  cover: boolean
}

/** What an edit changes for the prompts of the unlocked assets. */
export function storyAffects(before: VnBook, after: VnBook): Affected {
  const oldChars = new Map(before.characters.map((c) => [c.key, c]))
  const chars = after.characters.filter((c) => {
    const o = oldChars.get(c.key)
    return !o || o.name !== c.name || o.looks !== c.looks
  })
  const oldPlaces = new Map(before.places.map((p) => [p.key, p]))
  const changedPlaces = new Set(after.places.filter((p) => { const o = oldPlaces.get(p.key); return !o || o.name !== p.name || o.looks !== p.looks }).map((p) => p.key))
  const oldScenes = new Map(before.chapters.flatMap((c) => c.scenes).map((s) => [s.id, s]))
  const backgrounds = new Set<string>()
  for (const s of after.chapters.flatMap((c) => c.scenes)) {
    const o = oldScenes.get(s.id)
    const same = o && o.backgroundId === s.backgroundId && o.placeKey === s.placeKey && o.placeText === s.placeText && o.time === s.time && o.description === s.description
    if (!same || (s.placeKey && changedPlaces.has(s.placeKey))) backgrounds.add(s.backgroundId)
  }
  return { chars: chars.map((c) => c.key), backgrounds: [...backgrounds], cover: before.title !== after.title || before.coverBrief !== after.coverBrief }
}

function locateScene(book: VnBook, id: string): { chapter: VnChapter; scene: VnScene; index: number } {
  for (const chapter of book.chapters) {
    const index = chapter.scenes.findIndex((s) => s.id === id)
    if (index >= 0) return { chapter, scene: chapter.scenes[index]!, index }
  }
  throw new Error(`no scene "${id}" (ids look like ch01.s02)`)
}

function locateBeat(book: VnBook, id: string): { scene: VnScene; index: number; beat: VnBeat } {
  for (const chapter of book.chapters) {
    for (const scene of chapter.scenes) {
      const index = scene.beats.findIndex((b) => b.id === id)
      if (index >= 0) return { scene, index, beat: scene.beats[index]! }
    }
  }
  throw new Error(`no beat "${id}" (ids look like ch01.s02.b003)`)
}

const chapterOf = (book: VnBook, n: number): VnChapter => {
  const c = book.chapters.find((x) => x.n === n)
  if (!c) throw new Error(`no chapter ${n}`)
  return c
}

/** Sets the background of a scene from its place and time (it follows them), or the page id of a picture book. */
function setPlace(book: VnBook, scene: VnScene, text: string): void {
  const t = text.trim()
  const place = t ? findPlace(book.places, t) : undefined
  scene.placeKey = place?.key ?? null
  scene.placeText = place?.name ?? t
  scene.backgroundId = backgroundIdFor(presentationOf(book), scene.id, scene.placeKey, scene.placeText, scene.time)
}

const eachScene = (book: VnBook, fn: (s: VnScene) => void) => book.chapters.forEach((c) => c.scenes.forEach(fn))
const eachBeat = (book: VnBook, fn: (b: VnBeat) => void) => eachScene(book, (s) => s.beats.forEach(fn))

/** Applies a list of operations to a copy of the book. Throws on a bad operation (the book is not changed). */
export function applyStoryOps(input: VnBook, ops: StoryOp[]): { book: VnBook; changed: Set<StoryPart>; affected: Affected; created: string[] } {
  const book = structuredClone(input)
  const changed = new Set<StoryPart>()
  const created: string[] = []
  const ctx = (): Ctx => ({ characters: book.characters, places: book.places, expressions: book.expressions })

  ops.forEach((op, i) => {
    try {
      switch (op.op) {
        case 'book.update': {
          const wasPresentation = presentationOf(book)
          if (op.title !== undefined) book.title = op.title
          if (op.style !== undefined) book.style = op.style
          if (op.format !== undefined) book.format = op.format
          if (op.presentation !== undefined) book.presentation = op.presentation
          for (const k of ['author', 'genre', 'coverBrief'] as const) {
            const v = op[k]
            if (v === null || (v !== undefined && !v.trim())) delete book[k]
            else if (v !== undefined) book[k] = v.trim()
          }
          if (op.expressions !== undefined) {
            if (op.expressions === null) delete book.expressions
            else book.expressions = [...new Set(op.expressions)]
          }
          // a new presentation changes what a page is: every scene gets its background id again (one per scene in a picture book)
          const nowPresentation = presentationOf(book)
          if (nowPresentation !== wasPresentation) {
            book.presentation = nowPresentation
            eachScene(book, (s) => {
              s.backgroundId = backgroundIdFor(nowPresentation, s.id, s.placeKey, s.placeText, s.time)
            })
            changed.add('scenes')
          }
          changed.add('book')
          break
        }
        case 'character.set': {
          let c = op.key ? book.characters.find((x) => x.key === op.key) : op.name ? findChar(book.characters, op.name) : undefined
          if (!c) {
            if (!op.name?.trim()) throw new Error(op.key ? `no character "${op.key}": give a name to create it` : 'give a key or a name')
            const key = op.key ?? freeKey(slugKey(op.name), book.characters.map((x) => x.key))
            if (!KEY_RE.test(key)) throw new Error(`character key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
            c = { key, name: op.name.trim(), looks: '' }
            book.characters.push(c)
            created.push(`character ${key}`)
            // lines written before the character existed were speakerless: connect them
            eachBeat(book, (b) => {
              if (b.type === 'line' && !b.speakerKey && (normText(b.speakerLabel) === normText(c!.name) || b.speakerLabel === key)) {
                b.speakerKey = key
                b.speakerLabel = c!.name
              }
            })
          } else if (op.name !== undefined && op.name.trim() && op.name.trim() !== c.name) {
            const was = { name: c.name, aliases: c.aliases }
            c.name = op.name.trim()
            eachBeat(book, (b) => {
              // a line spoken under an alias keeps the alias
              if (b.type === 'line' && b.speakerKey === c!.key && aliasIndex(was, b.speakerLabel) === 0) b.speakerLabel = c!.name
            })
          }
          if (op.looks !== undefined) c.looks = op.looks.trim()
          if (op.voice !== undefined) {
            if (op.voice.trim()) c.voice = op.voice.trim()
            else delete c.voice
          }
          if (op.aliases !== undefined) {
            const own = normText(c.name)
            const list = [...new Set((op.aliases ?? []).map((a) => a.trim()).filter((a) => a && normText(a) !== own))]
            if (list.length) c.aliases = list
            else delete c.aliases
          }
          if (op.expressions !== undefined) {
            const list = [...new Set(op.expressions ?? [])]
            if (list.length) c.expressions = list
            else delete c.expressions
          }
          changed.add('characters')
          break
        }
        case 'image.set': {
          const key = op.key.trim().replace(/^cg_/, '')
          if (!KEY_RE.test(key)) throw new Error(`image key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
          const images = (book.images ??= [])
          let img = images.find((i) => i.key === key)
          if (!img) {
            if (!op.description?.trim()) throw new Error(`no image "${key}": give a description to create it`)
            img = { key, description: op.description.trim(), display: op.display ?? 'full' }
            images.push(img)
            created.push(`image ${key}`)
          } else {
            if (op.description?.trim()) img.description = op.description.trim()
            if (op.display) img.display = op.display
          }
          if (op.characters !== undefined) {
            const list = [...new Set(op.characters ?? [])]
            if (list.length) img.characters = list
            else delete img.characters
          }
          changed.add('images')
          break
        }
        case 'image.remove': {
          const key = op.key.trim().replace(/^cg_/, '')
          if (!book.images?.some((i) => i.key === key)) throw new Error(`no image "${key}"`)
          let uses = 0
          eachBeat(book, (b) => {
            if (b.image === key) uses++
          })
          if (uses && !op.force) throw new Error(`image "${key}" is shown by ${uses} beat(s): clear their image first, or pass force to clear it everywhere`)
          eachBeat(book, (b) => {
            if (b.image === key) delete b.image
          })
          book.images = book.images.filter((i) => i.key !== key)
          if (!book.images.length) delete book.images
          changed.add('images')
          break
        }
        case 'sound.set': {
          const key = op.key.trim().replace(/^(?:sfx|amb)_/, '')
          if (!KEY_RE.test(key)) throw new Error(`sound key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
          const sounds = (book.sounds ??= [])
          const same = sounds.filter((s) => s.key === key && (!op.kind || s.kind === op.kind))
          if (same.length > 1) throw new Error(`"${key}" is both a sound effect and an ambience: say which with kind`)
          let snd = same[0]
          if (!snd) {
            if (!op.kind) throw new Error(`no sound "${key}": give its kind (sfx or ambience) and a description to create it`)
            if (!op.description?.trim()) throw new Error(`no sound "${key}": give a description to create it`)
            snd = { key, kind: op.kind, description: op.description.trim() }
            sounds.push(snd)
            created.push(`${op.kind} ${key}`)
          } else if (op.description?.trim()) snd.description = op.description.trim()
          changed.add('sounds')
          break
        }
        case 'sound.remove': {
          const key = op.key.trim().replace(/^(?:sfx|amb)_/, '')
          const same = (book.sounds ?? []).filter((s) => s.key === key && (!op.kind || s.kind === op.kind))
          if (!same.length) throw new Error(`no sound "${key}"`)
          if (same.length > 1) throw new Error(`"${key}" is both a sound effect and an ambience: say which with kind`)
          const snd = same[0]!
          let uses = 0
          const plays = (b: { sfx?: string; ambience?: string | null }) => (snd.kind === 'sfx' ? b.sfx === key : b.ambience === key)
          eachBeat(book, (b) => {
            if (plays(b)) uses++
          })
          if (snd.kind === 'ambience') eachScene(book, (s) => { if (s.ambience === key) uses++ })
          if (uses && !op.force) throw new Error(`${snd.kind} "${key}" is played by ${uses} cue(s): clear them first, or pass force to clear them everywhere`)
          eachBeat(book, (b) => {
            if (!plays(b)) return
            if (snd.kind === 'sfx') delete b.sfx
            else delete b.ambience
          })
          if (snd.kind === 'ambience') eachScene(book, (s) => { if (s.ambience === key) delete s.ambience })
          book.sounds = (book.sounds ?? []).filter((s) => s !== snd)
          if (!book.sounds.length) delete book.sounds
          changed.add('sounds')
          break
        }
        case 'puzzle.set': {
          const key = op.key.trim()
          if (!KEY_RE.test(key)) throw new Error(`puzzle key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
          const puzzles = (book.puzzles ??= [])
          let p = puzzles.find((x) => x.key === key)
          if (!p) {
            if (!op.data || !op.names || !op.text || !op.verified) throw new Error(`no puzzle "${key}": give data, names, text and verified to create it (vno_puzzle_set does this)`)
            p = puzzleEntrySchema.parse({ key, kind: op.data.kind, data: op.data, names: op.names, text: op.text, verified: op.verified })
            puzzles.push(p)
            created.push(`puzzle ${key}`)
          } else {
            if (op.data) p.data = op.data
            if (op.names) p.names = { ...p.names, ...op.names }
            if (op.text) p.text = { ...p.text, ...op.text }
            if (op.verified) p.verified = op.verified
            else if (op.data || op.text) p.verified = { ...p.verified, textChecked: false }
          }
          const opt = <K extends 'links' | 'clueAt' | 'onFail' | 'hints'>(k: K) => {
            const v = op[k] as unknown
            if (v === null) delete p![k]
            else if (v !== undefined) (p as Record<string, unknown>)[k] = v
          }
          opt('links')
          opt('clueAt')
          opt('onFail')
          opt('hints')
          changed.add('puzzles')
          break
        }
        case 'puzzle.remove': {
          const key = op.key.trim()
          if (!book.puzzles?.some((p) => p.key === key)) throw new Error(`no puzzle "${key}"`)
          const users: string[] = []
          eachBeat(book, (b) => {
            if (b.type === 'puzzle' && b.puzzle === key) users.push(b.id)
          })
          if (users.length && !op.force) throw new Error(`puzzle "${key}" is played by beat ${users.join(', ')}: remove the beat first, or pass force to remove it too`)
          for (const id of users) {
            const { scene, index } = locateBeat(book, id)
            scene.beats.splice(index, 1)
          }
          book.puzzles = book.puzzles.filter((p) => p.key !== key)
          if (!book.puzzles.length) delete book.puzzles
          changed.add('puzzles')
          if (users.length) changed.add('beats')
          break
        }
        case 'character.remove': {
          if (!book.characters.some((c) => c.key === op.key)) throw new Error(`no character "${op.key}"`)
          let uses = 0
          eachBeat(book, (b) => {
            if (b.type === 'line' && b.speakerKey === op.key) uses++
            if (b.type === 'cast' && b.cast.some((c) => c.charKey === op.key)) uses++
          })
          if (uses && !op.force) throw new Error(`character "${op.key}" is used by ${uses} beat(s): remove those first, or pass force to remove it everywhere`)
          eachBeat(book, (b) => {
            if (b.type === 'cast') b.cast = b.cast.filter((c) => c.charKey !== op.key)
            else if (b.type === 'line' && b.speakerKey === op.key) b.speakerKey = null
          })
          book.characters = book.characters.filter((c) => c.key !== op.key)
          changed.add('characters')
          break
        }
        case 'place.set': {
          let p = op.key ? book.places.find((x) => x.key === op.key) : op.name ? findPlace(book.places, op.name) : undefined
          if (!p) {
            if (!op.name?.trim()) throw new Error(op.key ? `no place "${op.key}": give a name to create it` : 'give a key or a name')
            const key = op.key ?? freeKey(slugKey(op.name), book.places.map((x) => x.key))
            if (!KEY_RE.test(key)) throw new Error(`place key "${key}" must be lowercase letters, digits and underscores, starting with a letter`)
            p = { key, name: op.name.trim(), looks: '' }
            book.places.push(p)
            created.push(`place ${key}`)
            // scenes written before the place existed: connect them
            eachScene(book, (s) => {
              if (!s.placeKey && (normText(s.placeText) === normText(p!.name) || s.placeText === key)) setPlace(book, s, key)
            })
          } else if (op.name !== undefined && op.name.trim()) p.name = op.name.trim()
          if (op.looks !== undefined) p.looks = op.looks.trim()
          changed.add('places')
          break
        }
        case 'place.remove': {
          if (!book.places.some((p) => p.key === op.key)) throw new Error(`no place "${op.key}"`)
          const uses = book.chapters.flatMap((c) => c.scenes).filter((s) => s.placeKey === op.key)
          if (uses.length && !op.force) throw new Error(`place "${op.key}" is used by ${uses.length} scene(s) (${uses.map((s) => s.id).join(', ')}): change those scenes first, or pass force to keep their place text without the place`)
          for (const s of uses) {
            s.placeKey = null
            s.backgroundId = backgroundIdFor(presentationOf(book), s.id, null, s.placeText, s.time)
          }
          book.places = book.places.filter((p) => p.key !== op.key)
          changed.add('places')
          break
        }
        case 'chapter.add': {
          const n = op.n ?? op.chapter.n ?? book.chapters.reduce((m, c) => Math.max(m, c.n), 0) + 1
          if (book.chapters.some((c) => c.n === n)) throw new Error(`chapter ${n} already exists`)
          const ch = makeChapter(ctx(), n, op.chapter)
          if (ch.choices.length && op.chapter.ending === undefined) ch.ending = null
          let at = book.chapters.findIndex((c) => c.n > n)
          if (at < 0) at = book.chapters.length
          if (op.after !== undefined) at = book.chapters.indexOf(chapterOf(book, op.after)) + 1
          book.chapters.splice(at, 0, ch)
          created.push(`chapter ${n}`, ...ch.scenes.map((s) => s.id))
          changed.add('chapters')
          break
        }
        case 'chapter.update': {
          const ch = chapterOf(book, op.n)
          if (op.title !== undefined) ch.title = op.title
          if (op.summary !== undefined) {
            if (op.summary.trim()) ch.summary = op.summary.trim()
            else delete ch.summary
          }
          if (op.choices !== undefined) {
            ch.choices = op.choices.map((c) => ({ text: c.text, to: c.to }))
            if (ch.choices.length && op.ending === undefined) ch.ending = null
          }
          if (op.ending !== undefined) ch.ending = op.ending
          changed.add('chapters')
          break
        }
        case 'chapter.remove': {
          chapterOf(book, op.n)
          const from = book.chapters.filter((c) => c.n !== op.n && c.choices.some((x) => x.to === op.n)).map((c) => c.n)
          if (from.length) throw new Error(`a choice in chapter ${from.join(', ')} still leads to chapter ${op.n}: change that choice first`)
          book.chapters = book.chapters.filter((c) => c.n !== op.n)
          changed.add('chapters')
          break
        }
        case 'scene.add': {
          const ch = chapterOf(book, op.chapter)
          const id = sceneId(ch.n, nextSceneIndex(ch))
          const scene = makeScene(ctx(), id, op.scene)
          ch.scenes.splice(op.at === undefined ? ch.scenes.length : Math.min(op.at, ch.scenes.length), 0, scene)
          created.push(id, ...scene.beats.map((b) => b.id))
          changed.add('scenes')
          break
        }
        case 'scene.update': {
          const { scene } = locateScene(book, op.sceneId)
          if (op.time !== undefined) scene.time = op.time?.trim() || null
          if (op.place !== undefined) setPlace(book, scene, op.place)
          else if (op.time !== undefined) scene.backgroundId = backgroundIdFor(presentationOf(book), scene.id, scene.placeKey, scene.placeText, scene.time)
          if (op.description !== undefined) scene.description = op.description.trim()
          if (op.breakBefore !== undefined) scene.breakBefore = op.breakBefore
          if (op.music !== undefined) {
            if (op.music === null) delete scene.music
            else scene.music = /^none$/i.test(op.music.trim()) ? null : op.music.trim()
          }
          if (op.ambience !== undefined) {
            if (op.ambience === null) delete scene.ambience
            else scene.ambience = /^none$/i.test(op.ambience.trim()) ? null : op.ambience.trim().replace(/^amb_/, '')
          }
          changed.add('scenes')
          break
        }
        case 'scene.remove': {
          const { chapter, index } = locateScene(book, op.sceneId)
          chapter.scenes.splice(index, 1)
          changed.add('scenes')
          break
        }
        case 'beat.add': {
          const { scene } = locateScene(book, op.sceneId)
          let at = op.at === undefined ? scene.beats.length : Math.min(op.at, scene.beats.length)
          if (op.after !== undefined) {
            const k = scene.beats.findIndex((b) => b.id === op.after)
            if (k < 0) throw new Error(`no beat "${op.after}" in ${scene.id}`)
            at = k + 1
          }
          let next = nextBeatIndex(scene)
          const beats = op.beats.map((b) => makeBeat(ctx(), beatId(scene.id, next++), b))
          scene.beats.splice(at, 0, ...beats)
          created.push(...beats.map((b) => b.id))
          changed.add('beats')
          break
        }
        case 'beat.update': {
          const { beat } = locateBeat(book, op.beatId)
          const bad = (field: string) => new Error(`a ${beat.type} beat has no ${field}`)
          if (op.text !== undefined) {
            if (!hasText(beat)) throw bad('text')
            if (!op.text.trim()) throw new Error('the text cannot be empty (remove the beat instead)')
            beat.text = op.text
          }
          if (op.speaker !== undefined || op.expression !== undefined) {
            if (beat.type !== 'line') throw bad(op.speaker !== undefined ? 'speaker' : 'expression')
            if (op.speaker !== undefined) {
              const who = findChar(book.characters, op.speaker)
              beat.speakerKey = who?.key ?? null
              beat.speakerLabel = speakerLabelFor(who, op.speaker)
            }
            if (op.expression !== undefined) {
              const m = mapExpression(op.expression, expressionsOf(book, book.characters.find((c) => c.key === beat.speakerKey)))
              beat.expression = m.expression
              if (m.rawExpression) beat.rawExpression = m.rawExpression
              else delete beat.rawExpression
            }
          }
          if (op.cast !== undefined) {
            if (beat.type !== 'cast') throw bad('cast')
            beat.cast = (makeBeat(ctx(), beat.id, { type: 'cast', cast: op.cast }) as Extract<VnBeat, { type: 'cast' }>).cast
          }
          if (op.image !== undefined) {
            if (op.image === null) delete beat.image
            else beat.image = /^none$/i.test(op.image.trim()) ? null : op.image.trim().replace(/^cg_/, '')
          }
          if (op.sfx !== undefined) {
            if (op.sfx === null) delete beat.sfx
            else beat.sfx = op.sfx.trim().replace(/^sfx_/, '')
          }
          if (op.ambience !== undefined) {
            if (op.ambience === null) delete beat.ambience
            else beat.ambience = /^none$/i.test(op.ambience.trim()) ? null : op.ambience.trim().replace(/^amb_/, '')
          }
          changed.add('beats')
          break
        }
        case 'beat.remove': {
          for (const id of op.beatIds) {
            const { scene, index } = locateBeat(book, id)
            scene.beats.splice(index, 1)
          }
          changed.add('beats')
          break
        }
      }
    } catch (e) {
      throw new Error(`operation ${i + 1} (${op.op}): ${(e as Error).message}`, { cause: e })
    }
  })

  // kind, format and endings follow the choices
  const kind: VnBook['kind'] = book.chapters.some((c) => c.choices.length) ? 'choice' : 'linear'
  if (kind !== book.kind) {
    if (book.format === defaultFormat(book.kind)) book.format = defaultFormat(kind)
    book.kind = kind
    changed.add('book')
  }
  normalizeEndings(book)
  return { book, changed, affected: storyAffects(input, book), created }
}
