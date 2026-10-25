import { z } from 'zod'
import { isPictureBook } from '../../../shared/vn'
import type { AssetEntry, ProjectSettings, VnBook } from '../../../shared/vn'
import { BACKGROUND_FRAMING, charactersOnPage, fallbackNegative, imageOfAsset, INSERT_FRAMING, PAGE_FRAMING, peopleClause, personLine, resolveStylePrompt, styleForKind, SHEET_FRAMING, spriteFraming, visualLooks, withoutCharacterSentences } from '../../assets/derive'
import { asJson, askJson, batches, clip } from './common'
import type { AgentCall } from './common'

/**
 * art-director / plan_art: the English ComfyUI prompts and negatives for the asset stubs, from the bible, the style and the
 * genre, also for a Croatian book (the looks are translated into English prompts).
 */
export const planArtSchema = z.object({
  /** The shared style words every prompt of the book starts with. Keep it the same in every batch. */
  stylePrefix: z.string(),
  assets: z.array(z.object({ id: z.string(), prompt: z.string(), negative: z.string() }))
})
export type PlanArt = z.infer<typeof planArtSchema>

export const BATCH = 10

/** Words that make image models draw a book, a page border or a picture frame. */
const BANNED = /\b(?:story\s?books?|books?|framed|frames?)\b/gi

/** Removes the words image models misread, and tidies the commas left behind. */
export function sanitizePrompt(prompt: string): string {
  return prompt
    .replace(BANNED, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/(?:\s*,){2,}/g, ',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim()
}

/** Adds the standard negatives of the asset kind to what the agent wrote, without repeating a term. A picture-book page keeps the people. */
export function mergeNegative(agentNegative: string, kind: AssetEntry['kind'] = 'background', opts: { pictureBook?: boolean } = {}): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of `${fallbackNegative(kind, opts)}, ${agentNegative}`.split(',')) {
    const t = part.trim()
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.join(', ')
}

function sceneFor(book: Pick<VnBook, 'chapters'>, backgroundId: string) {
  for (const c of book.chapters) for (const s of c.scenes) if (s.backgroundId === backgroundId) return s
  return undefined
}

/** The empty-background words an agent may still write for a picture-book page: they are taken out, because the page shows its people. */
const EMPTY_BACKGROUND_WORDS = /\b(?:empty environment|no people|no characters?|no creatures?|no animals)\b[.,]?\s*/gi

/** The prompt without the empty-background wording, cut at the commas again. */
function withoutEmptyBackground(prompt: string): string {
  return prompt
    .replace(EMPTY_BACKGROUND_WORDS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/(?:\s*,){2,}/g, ',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim()
}

/**
 * Makes a prompt a picture-book page prompt: the empty-background words are taken out, the scene's people are named with their looks (never
 * "no people"), and the page framing says the whole page is the illustration. This is how an agent cannot reintroduce the empty-background rule.
 */
export function pagePrompt(book: Pick<VnBook, 'characters' | 'chapters'>, id: string, prompt: string): string {
  const cleaned = withoutEmptyBackground(prompt)
  const scene = sceneFor(book, id)
  const people = scene ? charactersOnPage(book, scene) : []
  const clause = peopleClause(book, people) || (people.length === 1 ? personLine(book, people[0]!) : '')
  const lower = cleaned.toLowerCase()
  const withPeople = clause && (people.length > 1 ? !lower.includes('different people') : true) ? `${cleaned}, ${clause}` : cleaned
  return /picture book/i.test(withPeople) ? withPeople : `${withPeople}, ${PAGE_FRAMING}`
}

/** What the agent is told about one asset: what it shows, from the structure. */
export function describeAsset(book: VnBook, entry: Pick<AssetEntry, 'id' | 'kind'>): Record<string, unknown> {
  switch (entry.kind) {
    case 'background': {
      const s = sceneFor(book, entry.id)
      const place = s?.placeKey ? book.places.find((p) => p.key === s.placeKey) : undefined
      if (isPictureBook(book)) {
        // a page is one illustration of the scene WITH its characters: the people named in the place and the description are kept
        const people = s ? charactersOnPage(book, s) : []
        return {
          id: entry.id,
          kind: 'picture-book page: ONE full illustration of this scene, the characters drawn INTO the picture (it is not an empty background and must not be one)',
          place: place?.name ?? s?.placeText ?? entry.id,
          placeLooks: clip(place?.looks ?? '', 240),
          time: s?.time ?? null,
          scene: clip(s?.description ?? '', 240),
          people: people.flatMap((k) => {
            const c = book.characters.find((x) => x.key === k)
            return c ? [{ name: c.name, looks: clip(visualLooks(c.looks) || c.looks, 200) }] : []
          }),
          framing: PAGE_FRAMING
        }
      }
      // what is said about the people in a place is left out: a background is empty
      return { id: entry.id, kind: 'background', place: place?.name ?? s?.placeText ?? entry.id, placeLooks: clip(withoutCharacterSentences(place?.looks, book), 240), time: s?.time ?? null, scene: clip(withoutCharacterSentences(s?.description, book), 240) }
    }
    case 'sheet': {
      const c = book.characters.find((x) => x.key === entry.id.replace(/^sheet_/, ''))
      return { id: entry.id, kind: 'character sheet', name: c?.name ?? entry.id, looks: clip(visualLooks(c?.looks) || (c?.looks ?? ''), 300) }
    }
    case 'sprite': {
      const rest = entry.id.replace(/^sprite_/, '')
      const at = rest.lastIndexOf('_')
      const key = at < 0 ? rest : rest.slice(0, at)
      const c = book.characters.find((x) => x.key === key)
      return { id: entry.id, kind: 'sprite (the same character as the sheet)', name: c?.name ?? key, looks: clip(visualLooks(c?.looks) || (c?.looks ?? ''), 240), expression: at < 0 ? 'neutral' : rest.slice(at + 1) }
    }
    case 'cg': {
      const img = imageOfAsset(book, entry.id)
      const scene = book.chapters.flatMap((c) => c.scenes).find((s) => s.beats.some((b) => b.image === img?.key))
      const place = scene?.placeKey ? book.places.find((p) => p.key === scene.placeKey) : undefined
      const people = (img?.characters ?? []).flatMap((k) => book.characters.find((c) => c.key === k) ?? []).map((c) => ({ name: c.name, looks: clip(visualLooks(c.looks) || c.looks, 200) }))
      return {
        id: entry.id,
        kind: img?.display === 'insert' ? 'insert (an object or a document shown small in the middle of the screen)' : 'CG (a picture shown over the whole scene)',
        shows: clip(img?.description ?? entry.id, 300),
        people,
        place: place ? { name: place.name, looks: clip(withoutCharacterSentences(place.looks, book), 200) } : (scene?.placeText ?? null)
      }
    }
    case 'cover':
      return { id: entry.id, kind: 'cover (the main menu picture: wide 16:9 landscape key art, the left third calm for the menu buttons)', title: book.title, brief: clip(book.coverBrief ?? '', 400) }
    default:
      return { id: entry.id, kind: entry.kind }
  }
}

/** Adds the framing words that keep the model to one figure (sheet, sprite) or an empty place (background), when the agent left them out. */
export function ensureFraming(kind: AssetEntry['kind'], id: string, prompt: string, book?: Pick<VnBook, 'images'> & Partial<Pick<VnBook, 'characters' | 'format' | 'presentation' | 'chapters'>>): string {
  const lower = prompt.toLowerCase()
  if (kind === 'background' && book && isPictureBook({ format: book.format ?? '', presentation: book.presentation })) {
    // a page illustration is never an empty environment: the people stay and the scene's cast is named
    return book.characters && book.chapters ? pagePrompt({ characters: book.characters, chapters: book.chapters }, id, prompt) : `${withoutEmptyBackground(prompt)}, ${PAGE_FRAMING}`
  }
  if (kind === 'cg' && book?.characters) {
    const img = imageOfAsset(book, id)
    const clause = img?.display === 'insert' ? '' : peopleClause({ characters: book.characters }, img?.characters ?? [])
    if (clause && !lower.includes('different people')) return `${prompt}, ${clause}`
  }
  if (kind === 'cg' && book && imageOfAsset(book, id)?.display === 'insert' && !lower.includes('close-up')) return `${prompt}, ${INSERT_FRAMING}`
  if (kind === 'sheet' && !lower.includes('one full-body figure only')) return `${prompt}, ${SHEET_FRAMING}`
  if (kind === 'background' && !lower.includes('no people')) return `${prompt}, ${BACKGROUND_FRAMING}`
  if (kind === 'sprite' && !lower.includes('single full-body figure')) {
    const expression = id.slice(id.lastIndexOf('_') + 1)
    return `${prompt.replace(/^same character[^,.]*[,.]?\s*/i, '')}. ${spriteFraming(expression)}`
  }
  return prompt
}

export interface PlannedArt {
  stylePrefix: string
  prompts: Map<string, { prompt: string; negative: string }>
}

/** Writes the prompts for the stubs, in batches of ten, keeping one style prefix across the batches. */
export async function planArt(call: AgentCall, book: VnBook, settings: ProjectSettings, stubs: AssetEntry[]): Promise<PlannedArt> {
  const prompts = new Map<string, { prompt: string; negative: string }>()
  // the style words are fixed (the user's, or derived from the format and genre); the agent never invents them
  const stylePrefix = resolveStylePrompt(book, settings)
  const pictureBook = isPictureBook(book)
  const pixel = settings.art.style === 'pixel'
  for (const batch of batches(stubs, BATCH)) {
    const r = await askJson(
      call,
      'art-director',
      'plan_art',
      {
        title: book.title,
        lang: book.primaryLang,
        genre: book.genre ?? '',
        format: book.format,
        writingNote: clip(book.style, 300),
        artStyle: pixel ? 'pixel art (16-bit, limited palette)' : 'illustrated (painted, soft)',
        stylePrefix,
        ...(pictureBook
          ? {
              presentation: 'picture-book',
              note: 'This is a children\'s picture book: every background id is ONE PAGE, one illustration of the scene with its characters drawn INTO the picture. Describe the people (their looks, which side they are on) and what they do. Never write "empty environment", "no people", "no characters", "no animals" or an "empty background": the page shows the scene and its characters. No sprites, no character sheets shown on a page, no text or lettering in the picture.'
            }
          : {}),
        assets: asJson(batch.map((a) => describeAsset(book, a)))
      },
      planArtSchema,
      { maxTokens: 4000 }
    )
    const wanted = new Set(batch.map((a) => a.id))
    const kinds = new Map(batch.map((a) => [a.id, a.kind]))
    for (const a of r.assets) {
      if (!wanted.has(a.id) || !a.prompt.trim()) continue
      const kind = kinds.get(a.id)!
      let prompt = ensureFraming(kind, a.id, sanitizePrompt(a.prompt), book)
      // a page keeps the style's character words: it is an illustration of people, not of an empty place
      const style = pictureBook && kind === 'background' ? stylePrefix : styleForKind(stylePrefix, kind)
      if (kind !== 'sprite' && !prompt.toLowerCase().startsWith(stylePrefix.toLowerCase().slice(0, 24))) prompt = `${style}, ${prompt}`
      prompts.set(a.id, { prompt, negative: mergeNegative(a.negative, kind, { pictureBook }) })
    }
  }
  return { stylePrefix, prompts }
}
