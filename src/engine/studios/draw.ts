import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Rgb } from '../assets/palettes'
import type { ChatMessage } from '../models/types'
import { extractJson } from '../pipeline/llm'
import type { PixelClient } from './pixel'

/** The Pixel Studio tools the drawing agent may call (never the file tools: the loop owns the export). */
export const DRAW_TOOLS = /^(draw_(?!sprite_from_reference)[a-z_]+|fill[a-z_]*|erase[a-z_]*|set_pixels?|remap_to_palette)$/

/** Asks the model and returns its reply. Throws when no model answers. */
export type ModelReply = (messages: ChatMessage[]) => Promise<string>

export interface DrawSpriteOptions {
  client: PixelClient
  /** Asks the model and returns its reply. Throws when no model answers. */
  ask(messages: ChatMessage[]): Promise<string>
  /** Absolute path of the reference image (the cut-out sprite as a PNG). */
  reference: string
  grid: { w: number; h: number }
  palette: Rgb[]
  expression?: string
  name?: string
  /** The size of the result: the drawing scaled up with nearest-neighbour. */
  out: { w: number; h: number }
  tmpRoot: string
  /** At most this many model steps and milliseconds. */
  maxSteps: number
  maxMs: number
  signal?: AbortSignal
  now?: () => number
  log?: (m: string) => void
}

export interface DrawnSprite {
  png: Buffer
  native: Buffer
  steps: number
  calls: number
}

const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

interface Step {
  calls?: { tool?: string; arguments?: Record<string, unknown> }[]
  done?: boolean
}

const SYSTEM = `You draw a small pixel-art sprite in Pixel Studio by calling its tools. Reply with ONE JSON object and nothing else:
{"calls": [{"tool": "draw_grid", "arguments": { ... }}], "done": false}
Set "done": true when the sprite is finished (you may send the last calls and "done": true together). Allowed tools: draw_grid and the other drawing tools named in the guidance. Draw in a few big steps (the body, then the face and the details), keep to the palette, leave the background transparent, and keep the drawing readable at this small size. A hidden reference layer holds the picture to copy.`

/**
 * An agent loop that draws a sprite in Pixel Studio: `draw_sprite_from_reference` makes the document (palette, size, hidden reference
 * layer) and returns the guidance, then the model calls `draw_grid` and friends (one JSON step per turn) until it says it is done, or
 * the steps or time run out. The drawing is exported at the grid size and scaled up. Throws when the model never answers or draws
 * nothing, so the caller can fall back to the import path.
 */
export async function drawSpriteWithStudio(o: DrawSpriteOptions): Promise<DrawnSprite> {
  const now = o.now ?? Date.now
  const end = now() + o.maxMs
  const doc = await o.client.drawSpriteFromReference({ reference: o.reference, width: o.grid.w, height: o.grid.h, palette: o.palette.map(hex), expression: o.expression, name: o.name }, o.signal)
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\n${doc.guidance}` },
    { role: 'user', content: `Document ${doc.documentId} is open: ${doc.width}x${doc.height} pixels, palette ${doc.palette.join(' ')}.${o.expression ? ` Expression: ${o.expression}.` : ''} Start drawing.` }
  ]
  let steps = 0
  let calls = 0
  while (steps < o.maxSteps && now() < end) {
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const reply = await o.ask(messages)
    steps++
    let step: Step
    try {
      step = extractJson(reply) as Step
    } catch (e) {
      messages.push({ role: 'assistant', content: reply.slice(0, 2000) }, { role: 'user', content: `That was not one JSON object (${(e as Error).message}). Reply with only the JSON object.` })
      continue
    }
    const results: string[] = []
    for (const c of step.calls ?? []) {
      const tool = String(c.tool ?? '')
      if (!DRAW_TOOLS.test(tool)) {
        results.push(`${tool || '(no tool)'}: not allowed`)
        continue
      }
      try {
        const r = await o.client.callTool(tool, c.arguments ?? {}, o.signal)
        calls++
        results.push(`${tool}: ok ${r.text.slice(0, 200)}`)
      } catch (e) {
        if (o.signal?.aborted) throw e
        results.push(`${tool}: error ${(e as Error).message.slice(0, 300)}`)
      }
    }
    o.log?.(`draw step ${steps}: ${results.join(' | ').slice(0, 300)}`)
    if (step.done) break
    messages.push({ role: 'assistant', content: JSON.stringify(step).slice(0, 4000) }, { role: 'user', content: `Results:\n${results.join('\n') || '(no calls)'}\nContinue, or set "done": true.` })
  }
  if (calls === 0) throw new Error('the agent drew nothing in Pixel Studio')

  const dir = path.resolve(o.tmpRoot, `draw-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    const big = path.join(dir, 'out.png')
    const small = path.join(dir, 'native.png')
    await o.client.exportMany(
      [
        { document: doc.documentId, path: big, width: o.out.w, height: o.out.h },
        { document: doc.documentId, path: small, scale: 1 }
      ],
      o.signal
    )
    let png = await fs.readFile(big)
    const meta = await sharp(png).metadata()
    if (meta.width !== o.out.w || meta.height !== o.out.h) png = await sharp(png).resize(o.out.w, o.out.h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer()
    return { png, native: await fs.readFile(small), steps, calls }
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
