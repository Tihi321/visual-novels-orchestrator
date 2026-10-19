import { z } from 'zod'
import type { VnBook } from '../../../shared/vn'
import { asJson, askJson, clip } from './common'
import type { AgentCall } from './common'

/**
 * voice-director / plan_voices (only when the book has voice on): one voice per speaking character and for the narrator.
 * For VibeTTS it gives a gender and, per language, a voice from the list it is shown; for a ComfyUI TTS workflow it gives a free-text
 * description of the voice (the prompt of the reference clip) and may name an uploaded reference clip. The caller validates the answer.
 */
export const planVoicesSchema = z.object({
  voices: z.array(
    z.object({
      speakerKey: z.string().optional(),
      /** The old prompt (a data folder seeded before VibeTTS) answers with `voice_<key>`. */
      voiceRefId: z.string().optional(),
      /** `female` or `male` (checked by the caller). */
      gender: z.string().optional(),
      /** Language -> a voice id from the list in the prompt (VibeTTS only; checked by the caller). */
      voices: z.record(z.string(), z.string()).optional(),
      /** Free text; the ComfyUI path uses it as the prompt of the voice reference. */
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

/** `voiceList` is the VibeTTS voices per language (`describeVoices`), empty for a ComfyUI TTS workflow. */
export async function planVoices(call: AgentCall, book: VnBook, clips: string[] = [], voiceList = ''): Promise<PlanVoices> {
  return askJson(
    call,
    'voice-director',
    'plan_voices',
    { title: book.title, lang: book.primaryLang, genre: book.genre ?? '', subjects: asJson(voiceSubjects(book)), clips: asJson(clips), voiceList: voiceList || '(none: a ComfyUI TTS workflow makes the voices from reference clips)' },
    planVoicesSchema,
    { maxTokens: 2500 }
  )
}
