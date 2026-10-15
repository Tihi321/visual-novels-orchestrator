import type { PipelineStep } from '../../shared/protocol'

/** The pipeline steps in order (see docs/protocol.md). */
export const STEPS: readonly PipelineStep[] = ['import', 'analyse', 'art', 'music', 'generate', 'voice', 'stage', 'build', 'lint']

export const stepIndex = (step: PipelineStep): number => STEPS.indexOf(step)
export const isStep = (s: string): s is PipelineStep => (STEPS as readonly string[]).includes(s)

/** The job tasks of the VN pipeline. */
export const TASKS = {
  pipeline: 'vn.pipeline.run',
  import: 'vn.import',
  analyse: 'vn.analyse',
  editionAdd: 'vn.edition.add',
  editionAlign: 'vn.edition.align',
  artPlan: 'vn.art.plan',
  musicPlan: 'vn.music.plan',
  generate: 'vn.assets.generate',
  /** A sprite drawn by the agent in Pixel Studio (`art.provider: pixel-studio-draw`): needs a model, unlike `generate`. */
  draw: 'vn.assets.draw',
  review: 'vn.assets.review',
  stage: 'vn.stage',
  build: 'vn.build',
  lint: 'vn.lint',
  voicePlan: 'vn.voice.plan',
  voiceGenerate: 'vn.voice.generate',
  android: 'vn.android',
  summary: 'vn.pipeline.summary'
} as const

export type VnTask = (typeof TASKS)[keyof typeof TASKS]

/** The agent role that takes each task. Deterministic tasks (no model) still go to the role that owns the work. */
export const ROLE_OF: Record<VnTask, string> = {
  'vn.pipeline.run': 'director',
  'vn.import': 'director',
  'vn.analyse': 'script-analyst',
  'vn.edition.add': 'edition-aligner',
  'vn.edition.align': 'edition-aligner',
  'vn.art.plan': 'art-director',
  'vn.music.plan': 'composer',
  'vn.assets.generate': 'art-director',
  'vn.assets.draw': 'art-director',
  'vn.assets.review': 'art-critic',
  'vn.stage': 'stage-director',
  'vn.build': 'director',
  'vn.lint': 'director',
  'vn.voice.plan': 'voice-director',
  'vn.voice.generate': 'voice-director',
  'vn.android': 'director',
  'vn.pipeline.summary': 'director'
}

/** The pipeline step a task belongs to, for the progress events. */
export const STEP_OF_TASK: Partial<Record<VnTask, PipelineStep>> = {
  'vn.import': 'import',
  'vn.analyse': 'analyse',
  'vn.art.plan': 'art',
  'vn.music.plan': 'music',
  'vn.assets.generate': 'generate',
  'vn.assets.draw': 'generate',
  'vn.assets.review': 'generate',
  'vn.voice.plan': 'voice',
  'vn.voice.generate': 'voice',
  'vn.stage': 'stage',
  'vn.build': 'build',
  'vn.lint': 'lint'
}

/** `<slug>--<task>--<unit>--r<run>`: deterministic, so enqueueing twice makes one job. */
export const jobId = (slug: string, task: string, unit: string, run: number): string => `${slug}--${task}--${unit}--r${run}`

/** The run number of a job id made by `jobId`, or 0. */
export function runOf(id: string): number {
  const m = /--r(\d+)$/.exec(id)
  return m ? Number(m[1]) : 0
}

/** The body of a job: JSON parameters. */
export const bodyOf = <T extends object>(body: string): Partial<T> => {
  const t = body.trim()
  if (!t.startsWith('{')) return {}
  try {
    return JSON.parse(t) as Partial<T>
  } catch {
    return {}
  }
}

/** At most `permits` run at once; the rest wait. Used so ComfyUI gets one job per lane. */
export class Semaphore {
  private waiting: (() => void)[] = []
  private active = 0
  constructor(private permits: number) {}
  setPermits(n: number): void {
    this.permits = Math.max(1, n)
    this.pump()
  }
  private pump(): void {
    while (this.active < this.permits && this.waiting.length) {
      this.active++
      this.waiting.shift()!()
    }
  }
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      const go = () => resolve()
      this.waiting.push(go)
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.waiting.indexOf(go)
          if (i >= 0) {
            this.waiting.splice(i, 1)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }
        },
        { once: true }
      )
      this.pump()
    })
    try {
      return await fn()
    } finally {
      this.active--
      this.pump()
    }
  }
}
