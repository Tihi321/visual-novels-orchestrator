import { describe, expect, it } from 'vitest'
import type { PipelineStatus, StepStatus } from '../src/shared/protocol'
import { failedStep, isRunning, lastLines, mergeSteps, progressFraction, progressText, stepRows, suggestedStart } from '../src/renderer/lib/pipeline'

const st = (status: StepStatus['status'], at: string, extra: Partial<StepStatus> = {}): StepStatus => ({ status, message: '', at, ...extra })
const saved: PipelineStatus = { run: 2, from: 'analyse', startedAt: '2026-01-01T00:00:00Z', steps: { analyse: st('done', '2026-01-01T00:01:00Z'), art: st('running', '2026-01-01T00:02:00Z') } }

describe('mergeSteps', () => {
  it('uses the saved steps with no live ones', () => {
    expect(mergeSteps(saved, undefined).art?.status).toBe('running')
    expect(mergeSteps(null, undefined)).toEqual({})
  })
  it('lets a newer live status win and ignores an older one', () => {
    const m = mergeSteps(saved, { art: st('done', '2026-01-01T00:03:00Z'), analyse: st('failed', '2026-01-01T00:00:30Z'), music: st('queued', '2026-01-01T00:03:00Z') })
    expect(m.art?.status).toBe('done')
    expect(m.analyse?.status).toBe('done')
    expect(m.music?.status).toBe('queued')
  })
})

describe('stepRows', () => {
  it('lists the steps in order and hides voice unless it is on', () => {
    const rows = stepRows({}, false)
    expect(rows.map((r) => r.id)).toEqual(['import', 'analyse', 'art', 'music', 'generate', 'stage', 'build', 'lint'])
    expect(rows.every((r) => r.state === 'idle')).toBe(true)
    expect(stepRows({}, true).map((r) => r.id)).toContain('voice')
    expect(stepRows({ voice: st('skipped', 'x') }, false).map((r) => r.id)).toContain('voice')
  })
  it('carries the status of each step', () => {
    const rows = stepRows(mergeSteps(saved, undefined), false)
    expect(rows.find((r) => r.id === 'analyse')?.state).toBe('done')
    expect(isRunning(rows)).toBe(true)
    expect(failedStep(rows)).toBeNull()
  })
  it('finds a failed step and where to continue', () => {
    const rows = stepRows({ import: st('done', 'a'), analyse: st('done', 'b'), art: st('failed', 'c') }, false)
    expect(failedStep(rows)?.id).toBe('art')
    expect(suggestedStart(rows)).toBe('art')
    expect(suggestedStart(stepRows({}, false))).toBe('analyse')
    expect(suggestedStart(stepRows({ analyse: st('done', 'b'), art: st('done', 'c') }, false))).toBe('music')
    expect(suggestedStart(stepRows({ lint: st('done', 'z') }, false))).toBe('lint')
  })
})

describe('suggestedStart with missing assets', () => {
  it('keeps unrun planning steps first', () => {
    const afterImport = stepRows({ import: st('done', 'a'), analyse: st('done', 'b') }, false)
    expect(suggestedStart(afterImport, { missingAssets: 3 })).toBe('art')
    const afterArt = stepRows({ analyse: st('done', 'b'), art: st('done', 'c') }, false)
    expect(suggestedStart(afterArt, { missingAssets: 3 })).toBe('music')
    expect(suggestedStart(stepRows({}, false), { missingAssets: 3 })).toBe('analyse')
  })
  it('switches to generate when the normal next step is after it', () => {
    const planned = stepRows({ import: st('done', 'a'), analyse: st('done', 'b'), art: st('done', 'c'), music: st('done', 'd') }, false)
    expect(suggestedStart(planned)).toBe('generate')
    expect(suggestedStart(planned, { missingAssets: 2 })).toBe('generate')
    const generated = stepRows({ import: st('done', 'a'), analyse: st('done', 'b'), art: st('done', 'c'), music: st('done', 'd'), generate: st('done', 'e') }, false)
    expect(suggestedStart(generated)).toBe('stage')
    expect(suggestedStart(generated, { missingAssets: 2 })).toBe('generate')
  })
  it('switches to generate when the pipeline finished', () => {
    const done: Record<string, StepStatus> = {}
    for (const id of ['import', 'analyse', 'art', 'music', 'generate', 'stage', 'build', 'lint']) done[id] = st('done', id)
    const rows = stepRows(done, false)
    expect(suggestedStart(rows)).toBe('lint')
    expect(suggestedStart(rows, { missingAssets: 1 })).toBe('generate')
    expect(suggestedStart(rows, { missingAssets: 0 })).toBe('lint')
  })
  it('does not jump to generate over a failed or running step', () => {
    const failed = stepRows({ analyse: st('done', 'a'), art: st('failed', 'b'), music: st('done', 'c'), generate: st('done', 'd') }, false)
    expect(suggestedStart(failed, { missingAssets: 5 })).toBe('art')
    const queued = stepRows({ music: st('done', 'a'), generate: st('queued', 'b') }, false)
    expect(suggestedStart(queued, { missingAssets: 5 })).toBe('generate')
  })
})

describe('progress', () => {
  it('formats and clamps counts', () => {
    expect(progressText({ done: 3, total: 10 })).toBe('3 / 10')
    expect(progressText({ done: 12, total: 10 })).toBe('10 / 10')
    expect(progressText({})).toBe('')
    expect(progressFraction({ done: 5, total: 10 })).toBe(0.5)
    expect(progressFraction({ done: 0, total: 0 })).toBeNull()
  })
  it('keeps the last non-empty lines of a log', () => {
    expect(lastLines('a\n\nb\r\nc\n', 2)).toEqual(['b', 'c'])
  })
})
