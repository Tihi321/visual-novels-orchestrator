import { z } from 'zod'
import { asJson, askJson } from './common'
import type { AgentCall } from './common'

/** director / summarize_run: a short status summary of a pipeline run for the project log. Optional: skipped when no model answers. */
export const summarizeRunSchema = z.object({
  summary: z.string(),
  /** Steps worth running again, with the reason, or an empty list. */
  redo: z.array(z.object({ step: z.string(), reason: z.string() }))
})
export type RunSummary = z.infer<typeof summarizeRunSchema>

export interface StepReport {
  step: string
  status: string
  message: string
}

export async function summarizeRun(call: AgentCall, project: { slug: string; title: string }, steps: StepReport[]): Promise<RunSummary> {
  return askJson(call, 'director', 'summarize_run', { slug: project.slug, title: project.title, steps: asJson(steps) }, summarizeRunSchema, { maxTokens: 800 })
}
