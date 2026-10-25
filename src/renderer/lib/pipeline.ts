import type { PipelineStatus, PipelineStep, StepState, StepStatus } from '../../shared/protocol'

export const PIPELINE_STEPS: { id: PipelineStep; label: string; hint: string }[] = [
  { id: 'import', label: 'Import', hint: 'Reads the book folder into vn.json' },
  { id: 'analyse', label: 'Analyse', hint: 'The script-analyst settles uncertain items' },
  { id: 'art', label: 'Art plan', hint: 'The art-director writes the prompts' },
  { id: 'music', label: 'Music plan', hint: 'The composer plans the tracks' },
  { id: 'generate', label: 'Generate', hint: 'ComfyUI draws images and makes music' },
  { id: 'voice', label: 'Voice', hint: 'Text to speech clips (only when voice is on)' },
  { id: 'stage', label: 'Stage', hint: 'The stage-director sets cues' },
  { id: 'build', label: 'Build', hint: "Writes the Ren'Py game" },
  { id: 'lint', label: 'Lint', hint: "Checks the game with Ren'Py" }
]

export type RowState = StepState | 'idle'

export interface StepRow {
  id: PipelineStep
  label: string
  hint: string
  state: RowState
  message: string
  at: string
  done?: number
  total?: number
}

/**
 * The step statuses to show: the saved ones of the latest run, with the live `pipeline.progress` ones over them when they are
 * not older. A live status of a new run replaces everything before it, so the caller passes `run` changes through `resetLive`.
 */
export function mergeSteps(saved: PipelineStatus | null, live: Partial<Record<PipelineStep, StepStatus>> | undefined): Partial<Record<PipelineStep, StepStatus>> {
  const out: Partial<Record<PipelineStep, StepStatus>> = { ...(saved?.steps ?? {}) }
  for (const [step, status] of Object.entries(live ?? {}) as [PipelineStep, StepStatus][]) {
    const cur = out[step]
    if (!cur || status.at >= cur.at) out[step] = status
  }
  return out
}

/** One row per step. The voice step only appears when voice is on or the run has a status for it. */
export function stepRows(steps: Partial<Record<PipelineStep, StepStatus>>, voiceEnabled: boolean): StepRow[] {
  return PIPELINE_STEPS.filter((s) => s.id !== 'voice' || voiceEnabled || steps.voice).map((s) => {
    const st = steps[s.id]
    return { id: s.id, label: s.label, hint: s.hint, state: st?.status ?? 'idle', message: st?.message ?? '', at: st?.at ?? '', done: st?.done, total: st?.total }
  })
}

/** "12 / 40" for a step that counts its work, else an empty string. */
export function progressText(row: Pick<StepRow, 'done' | 'total'>): string {
  if (row.total === undefined || row.total <= 0) return ''
  return `${Math.min(row.done ?? 0, row.total)} / ${row.total}`
}

export function progressFraction(row: Pick<StepRow, 'done' | 'total'>): number | null {
  if (row.total === undefined || row.total <= 0) return null
  return Math.max(0, Math.min(1, (row.done ?? 0) / row.total))
}

/** True while any step is queued or running. */
export function isRunning(rows: readonly StepRow[]): boolean {
  return rows.some((r) => r.state === 'running' || r.state === 'queued')
}

/** The first failed step, if any. */
export function failedStep(rows: readonly StepRow[]): StepRow | null {
  return rows.find((r) => r.state === 'failed') ?? null
}

/** The steps after generate: a run from one of them does not make the assets that are still missing. */
const AFTER_GENERATE: ReadonlySet<PipelineStep> = new Set(['voice', 'stage', 'build', 'lint'])

/**
 * The step to continue from: the failed one, else the one that was running or queued, else the step after the last finished one
 * (steps before it that never ran, like import after a run from analyse, are not repeated), else analyse. With missing assets, a
 * result that would skip the generate step (or a pipeline that finished) starts at generate instead: unrun analyse/art/music
 * are never skipped, and the pipeline then tails into voice/stage/build/lint as usual.
 */
export function suggestedStart(rows: readonly StepRow[], opts: { missingAssets?: number } = {}): PipelineStep {
  const stuck = rows.find((r) => r.state === 'failed') ?? rows.find((r) => r.state === 'running' || r.state === 'queued')
  if (stuck) return stuck.id
  let lastDone = -1
  rows.forEach((r, i) => {
    if (r.state === 'done') lastDone = i
  })
  const next: PipelineStep = lastDone < 0 ? 'analyse' : rows[lastDone + 1]?.id ?? rows[lastDone]!.id
  const finished = rows.length > 0 && rows.every((r) => r.state === 'done')
  if ((opts.missingAssets ?? 0) > 0 && (finished || AFTER_GENERATE.has(next))) return 'generate'
  return next
}

export const STATE_TONE: Record<RowState, 'good' | 'bad' | 'warn' | 'dim' | 'accent'> = {
  done: 'good',
  failed: 'bad',
  running: 'accent',
  queued: 'warn',
  skipped: 'dim',
  idle: 'dim'
}

/** The last `n` non-empty lines of a text. */
export function lastLines(text: string, n: number): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(-n)
}

/** True when the build step finished with status 'done'. */
export function isProjectFinished(project: { pipeline?: PipelineStatus | null }): boolean {
  return project.pipeline?.steps.build?.status === 'done'
}
