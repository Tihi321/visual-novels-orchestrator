import { z } from 'zod'
import { CANONICAL_EXPRESSIONS } from '../../../shared/vn'
import type { VnBook } from '../../../shared/vn'
import { BudgetError, isAbortError } from '../../models/types'
import type { Uncertain } from '../script'
import { asJson, askJson, batches, clip } from './common'
import type { AgentCall } from './common'

/**
 * script-analyst / resolve_uncertain: settles what the deterministic parser could not: the place and time of a scene, a
 * speaker or an ON SCREEN name that is not in the bible, a free-form expression, a screenplay direction written like a speaker.
 * Every field is present (null when it does not apply), so the answer fits strict structured-output providers.
 */
export const decisionSchema = z.object({
  /** The `index` of the item in the request. */
  index: z.number().int(),
  /** An existing place key (kind place). */
  placeKey: z.string().nullable(),
  /** A place that is not in the bible yet (kind place). */
  newPlace: z.object({ name: z.string(), looks: z.string() }).nullable(),
  /** One of dawn, morning, day, afternoon, evening, dusk, night (kind time and place), or null when the text names none. */
  time: z.string().nullable(),
  /** An existing character key (kinds speaker and cast). */
  charKey: z.string().nullable(),
  /** A character that is not in the bible yet (kinds speaker and cast). */
  newCharacter: z.object({ name: z.string(), looks: z.string() }).nullable(),
  /** One of the standard expressions (kind expression), or null. */
  expression: z.enum(CANONICAL_EXPRESSIONS).nullable(),
  /** The text is a stage direction or a prop, not a speaker or a character (SMASH CUT TO, a sign). */
  isDirection: z.boolean()
})
export type Decision = z.infer<typeof decisionSchema>

export const resolveUncertainSchema = z.object({ decisions: z.array(decisionSchema) })

export const BATCH = 30

/** What the agent sees of one uncertain item: the item and the lines around it. */
export function describeItems(book: VnBook, items: Uncertain[]): Record<string, unknown>[] {
  const scenes = new Map(book.chapters.flatMap((c) => c.scenes).map((s) => [s.id, s]))
  return items.map((u, index) => {
    const scene = scenes.get(u.sceneId)
    const base: Record<string, unknown> = { index, kind: u.kind, text: clip(u.text, 200), reason: u.reason, chapter: u.chapter }
    if (!scene) return base
    base.scene = { place: scene.placeText, placeKey: scene.placeKey, time: scene.time, description: clip(scene.description, 160) }
    const at = u.beatId ? scene.beats.findIndex((b) => b.id === u.beatId) : -1
    const around = at >= 0 ? scene.beats.slice(Math.max(0, at - 2), at + 3) : scene.beats.slice(0, 3)
    base.around = around.map((b) => (b.type === 'cast' ? `[on screen: ${b.cast.map((c) => c.charKey).join(', ')}]` : b.type === 'line' ? `${b.speakerLabel}${b.rawExpression ? ` (${b.rawExpression})` : ''}: ${clip(b.text, 120)}` : `[narration] ${clip(b.text, 120)}`))
    return base
  })
}

export function bibleForAnalyst(book: VnBook): { characters: unknown[]; places: unknown[] } {
  return {
    characters: book.characters.map((c) => ({ key: c.key, name: c.name, looks: clip(c.looks, 100) })),
    places: book.places.map((p) => ({ key: p.key, name: p.name, looks: clip(p.looks, 100) }))
  }
}

/**
 * Asks the script-analyst about every item, in batches. Decisions come back with indexes into `items`. A batch the model could
 * not answer is reported in `errors` (its items keep the parser's defaults); the other batches still count.
 */
export async function resolveUncertain(call: AgentCall, book: VnBook, items: Uncertain[]): Promise<{ decisions: Decision[]; errors: string[] }> {
  const out: Decision[] = []
  const errors: string[] = []
  const bible = bibleForAnalyst(book)
  let offset = 0
  for (const batch of batches(items, BATCH)) {
    const described = describeItems(book, batch)
    try {
      const r = await askJson(
        call,
        'script-analyst',
        'resolve_uncertain',
        { title: book.title, lang: book.primaryLang, characters: asJson(bible.characters), places: asJson(bible.places), items: asJson(described) },
        resolveUncertainSchema,
        { maxTokens: 4000 }
      )
      for (const d of r.decisions) {
        if (d.index >= 0 && d.index < batch.length) out.push({ ...d, index: d.index + offset })
      }
    } catch (e) {
      if (call.ctx.signal.aborted || isAbortError(e) || e instanceof BudgetError) throw e
      errors.push(`items ${offset + 1}-${offset + batch.length}: ${(e as Error).message}`)
      if (errors.length >= 2) break // the model is not answering: do not wait for every batch
    }
    offset += batch.length
  }
  return { decisions: out, errors }
}
