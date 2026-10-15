import { z } from 'zod'
import type { AssetEntry, ProjectSettings, VnBook } from '../../../shared/vn'
import { BACKGROUND_FRAMING, fallbackNegative, resolveStylePrompt, styleForKind, SHEET_FRAMING, spriteFraming, visualLooks, withoutCharacterSentences } from '../../assets/derive'
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

/** Adds the standard negatives of the asset kind to what the agent wrote, without repeating a term. */
export function mergeNegative(agentNegative: string, kind: AssetEntry['kind'] = 'background'): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of `${fallbackNegative(kind)}, ${agentNegative}`.split(',')) {
    const t = part.trim()
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.join(', ')
}

function sceneFor(book: VnBook, backgroundId: string) {
  for (const c of book.chapters) for (const s of c.scenes) if (s.backgroundId === backgroundId) return s
  return undefined
}

/** What the agent is told about one asset: what it shows, from the structure. */
export function describeAsset(book: VnBook, entry: Pick<AssetEntry, 'id' | 'kind'>): Record<string, unknown> {
  switch (entry.kind) {
    case 'background': {
      const s = sceneFor(book, entry.id)
      const place = s?.placeKey ? book.places.find((p) => p.key === s.placeKey) : undefined
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
    case 'cover':
      return { id: entry.id, kind: 'cover', title: book.title, brief: clip(book.coverBrief ?? '', 400) }
    default:
      return { id: entry.id, kind: entry.kind }
  }
}

/** Adds the framing words that keep the model to one figure (sheet, sprite) or an empty place (background), when the agent left them out. */
export function ensureFraming(kind: AssetEntry['kind'], id: string, prompt: string): string {
  const lower = prompt.toLowerCase()
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
      let prompt = ensureFraming(kind, a.id, sanitizePrompt(a.prompt))
      if (kind !== 'sprite' && !prompt.toLowerCase().startsWith(stylePrefix.toLowerCase().slice(0, 24))) prompt = `${styleForKind(stylePrefix, kind)}, ${prompt}`
      prompts.set(a.id, { prompt, negative: mergeNegative(a.negative, kind) })
    }
  }
  return { stylePrefix, prompts }
}
