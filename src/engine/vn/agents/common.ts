import type { ZodType } from 'zod'
import { chatJson } from '../../pipeline/llm'
import { buildMessages } from '../../pipeline/prompts'
import type { ChatMessage } from '../../models/types'
import type { JobContext } from '../../queue/scheduler'

/** What every agent call needs: the job context (model routing, logging) and the data folder (prompt templates). */
export interface AgentCall {
  ctx: JobContext
  dataDir: string
}

export type PromptVars = Record<string, string | number | undefined | null>

/** Compact JSON for a prompt variable. */
export const asJson = (value: unknown): string => JSON.stringify(value)

/** Cuts a text to `max` characters on a word edge. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '...'
}

/**
 * One structured call: builds the system and user messages from `prompts/<role>/<task>.md` and the agent's persona,
 * asks for JSON and validates it with the schema (`chatJson` repairs once). `tweak` may change the messages first
 * (the art-critic adds the images).
 */
export async function askJson<T>(call: AgentCall, role: string, task: string, vars: PromptVars, schema: ZodType<T>, opts: { maxTokens?: number; temperature?: number; tweak?: (messages: ChatMessage[]) => void } = {}): Promise<T> {
  const { messages } = await buildMessages(call.dataDir, call.ctx, role, task, vars)
  opts.tweak?.(messages)
  const r = await chatJson(call.ctx, messages, schema, { maxTokens: opts.maxTokens, temperature: opts.temperature ?? 0.2 })
  return r.value
}

/** Splits a list into batches. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
