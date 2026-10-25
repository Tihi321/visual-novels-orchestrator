import { z } from 'zod'
import type { VnBook } from '../../../shared/vn'
import { asJson, askJson, clip } from './common'
import type { AgentCall } from './common'

/**
 * voice-director / plan_voices (only when the book has voice on): a voice for every speaking character and for the narrator.
 * For the local ComfyUI engines it gives a delivery style per speaker and, per language, an engine id from the list it is shown;
 * for Google Flow it gives a gender and, per language, a voice id from the Flow list. The caller validates the answer.
 */
export const planVoicesSchema = z.object({
  voices: z.array(
    z.object({
      speakerKey: z.string().optional(),
      /** The old prompt (a data folder seeded before the local engines) answers with `voice_<key>`. */
      voiceRefId: z.string().optional(),
      /** `female` or `male` (checked by the caller). */
      gender: z.string().optional(),
      /** Language -> a local TTS engine id from the list in the prompt (`omnivoice`, `chatterbox-23lang` ...). */
      engines: z.record(z.string(), z.string()).optional(),
      /** Language -> a Flow voice id from the list in the prompt (`gemini:<Name>`). */
      voices: z.record(z.string(), z.string()).optional(),
      /** The delivery style of the speaker (the OmniVoice/Qwen3 `instruct`, Higgs inline tags, or the Flow style note). */
      description: z.string().default(''),
      suggestedRef: z.string().nullable().optional()
    })
  )
})
export type PlanVoices = z.infer<typeof planVoicesSchema>

/** The speaker an answer entry is for. */
export const speakerOf = (v: PlanVoices['voices'][number]): string => v.speakerKey ?? v.voiceRefId?.replace(/^voice_/, '') ?? ''

export interface VoiceSubject {
  /** A character key, or `narrator`. */
  speakerKey: string
  name: string
  looks: string
  voiceHint: string
  lines: number
  samples: string[]
}

/** The speaking characters of the book and the narrator, with a few sample lines each. */
export function voiceSubjects(book: VnBook): VoiceSubject[] {
  const lines = new Map<string, { n: number; samples: string[] }>()
  const narration = { n: 0, samples: [] as string[] }
  for (const c of book.chapters)
    for (const s of c.scenes)
      for (const b of s.beats) {
        if (b.type === 'narration') {
          narration.n++
          if (narration.samples.length < 2) narration.samples.push(clip(b.text, 90))
        } else if (b.type === 'line' && b.speakerKey) {
          const cur = lines.get(b.speakerKey) ?? { n: 0, samples: [] }
          cur.n++
          if (cur.samples.length < 3) cur.samples.push(clip(b.text, 90))
          lines.set(b.speakerKey, cur)
        }
      }
  const out: VoiceSubject[] = []
  for (const [key, v] of lines) {
    const c = book.characters.find((x) => x.key === key)
    out.push({ speakerKey: key, name: c?.name ?? key, looks: clip(c?.looks ?? '', 160), voiceHint: c?.voice ?? '', lines: v.n, samples: v.samples })
  }
  out.push({ speakerKey: 'narrator', name: 'Narrator', looks: '', voiceHint: '', lines: narration.n, samples: narration.samples })
  return out
}

/**
 * `voiceList` is the Flow voices per language (`describeVoices`); `engineList` the local TTS engines per language
 * (`describeTtsEngines`). Empty for the provider that is not in use, so the prompt says which one it plans for.
 */
export async function planVoices(call: AgentCall, book: VnBook, clips: string[] = [], voiceList = '', engineList = ''): Promise<PlanVoices> {
  return askJson(
    call,
    'voice-director',
    'plan_voices',
    {
      title: book.title,
      lang: book.primaryLang,
      genre: book.genre ?? '',
      subjects: asJson(voiceSubjects(book)),
      clips: asJson(clips),
      voiceList: voiceList || '(none: the Flow provider is not in use)',
      engines: engineList || '(none: the local ComfyUI provider is not in use)'
    },
    planVoicesSchema,
    { maxTokens: 2500 }
  )
}
