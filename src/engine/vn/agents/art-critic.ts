import sharp from 'sharp'
import { z } from 'zod'
import type { AssetEntry } from '../../../shared/vn'
import type { ChatMessage } from '../../models/types'
import { askJson } from './common'
import type { AgentCall } from './common'

/**
 * art-critic / review_image: looks at a generated image against its prompt (and, for a sprite, the character sheet) and
 * approves it or sends back a revised prompt. Needs a vision model (`visionOnly` routing, `vision: true` on the job).
 */
export const reviewImageSchema = z.object({
  approved: z.boolean(),
  /** What is wrong: wrong subject, face drifted from the sheet, stray words or letters, a frame or border, cut-off limbs. */
  problems: z.array(z.string()),
  /** A better prompt when it is not approved, else null. */
  revisedPrompt: z.string().nullable()
})
export type ImageReview = z.infer<typeof reviewImageSchema>

/** A small JPEG of an image for the model: transparent sprites sit on mid grey, the long side is at most 1024. */
export async function reviewThumbnail(bytes: Buffer): Promise<{ mime: string; data: string }> {
  const jpeg = await sharp(bytes).flatten({ background: '#808080' }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  return { mime: 'image/jpeg', data: jpeg.toString('base64') }
}

export interface ReviewInput {
  entry: Pick<AssetEntry, 'id' | 'kind'>
  prompt: string
  image: Buffer
  /** The character sheet of a sprite. */
  sheet?: Buffer
}

export async function reviewImage(call: AgentCall, input: ReviewInput): Promise<ImageReview> {
  const image = await reviewThumbnail(input.image)
  const sheet = input.sheet ? await reviewThumbnail(input.sheet) : undefined
  return askJson(
    call,
    'art-critic',
    'review_image',
    { id: input.entry.id, kind: input.entry.kind, prompt: input.prompt, hasSheet: sheet ? 'yes: the first image is the character sheet, the second is the image to review' : 'no: there is one image to review' },
    reviewImageSchema,
    {
      maxTokens: 1200,
      tweak: (messages: ChatMessage[]) => {
        const last = messages[messages.length - 1]
        if (!last || typeof last.content !== 'string') return
        const parts: Exclude<ChatMessage['content'], string> = [{ type: 'text', text: last.content }]
        if (sheet) parts.push({ type: 'image', ...sheet })
        parts.push({ type: 'image', ...image })
        last.content = parts
      }
    }
  )
}
