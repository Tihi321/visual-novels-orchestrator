import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../../shared/protocol'
import { readText, sendCommand, tailText } from '../../api'
import { failedStep, isRunning, lastLines, mergeSteps, progressFraction, progressText, STATE_TONE, stepRows, suggestedStart } from '../../lib/pipeline'
import { useVn } from '../../store/hooks'
import { Pill, ProgressBar, useRecentError } from '../common'

export function PipelineTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const live = useVn((s) => s.progress[slug])
  const steps = mergeSteps(detail.summary.pipeline, live)
  const rows = stepRows(steps, detail.settings.voice.enabled)
  const running = isRunning(rows)
  const failed = failedStep(rows)
  const [force, setForce] = useState(false)
  const error = useRecentError(slug, 'runPipeline')
  const uncertain = useUncertainCount(slug)
  const log = useLogTail(slug, running, JSON.stringify(Object.values(steps).map((s) => s?.at)))
  const warnings = detail.book.warnings
  const jobs = detail.jobs

  return (
    <div className="stack" data-testid="tab-pipeline-body">
      <div className="row spread">
        <div className="row">
          <button className="primary" onClick={() => sendCommand({ type: 'runPipeline', slug, force })} data-testid="run-all">
            Run pipeline
          </button>
          <button onClick={() => sendCommand({ type: 'runPipeline', slug, from: suggestedStart(rows), force })} title="Starts at the first step that did not finish" data-testid="run-resume">
            Continue from {suggestedStart(rows)}
          </button>
          <label className="inline" title="Plan the prompts and generate again for assets that have a file (locked and custom ones are never touched)">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force (plan and generate again)
          </label>
        </div>
        <div className="row">
          {detail.summary.pipeline && <span className="dim">run #{detail.summary.pipeline.run}</span>}
          {running && <Pill tone="accent">running</Pill>}
          {failed && <Pill tone="bad">{failed.label} failed</Pill>}
        </div>
      </div>
      {error && <div className="bad-text">{error}</div>}

      <div className="stack" data-testid="step-list">
        {rows.map((r) => {
          const frac = progressFraction(r)
          return (
            <div className="card step-row" key={r.id} data-testid={`step-${r.id}`}>
              <div className="step-main">
                <Pill tone={STATE_TONE[r.state]} testId={`step-state-${r.id}`}>
                  {r.state}
                </Pill>
                <b style={{ width: 90 }}>{r.label}</b>
                <span className="dim ellipsis" title={r.message || r.hint} style={{ flex: 1 }}>
                  {r.message || r.hint}
                </span>
                {progressText(r) && <span>{progressText(r)}</span>}
                <button onClick={() => sendCommand({ type: 'runPipeline', slug, from: r.id, force })} data-testid={`run-from-${r.id}`}>
                  Run from here
                </button>
              </div>
              {r.state === 'running' && frac !== null && <ProgressBar fraction={frac} />}
            </div>
          )
        })}
      </div>

      <div className="row" style={{ gap: 16 }}>
        <span className="dim">
          Jobs: {jobs.running} running, {jobs.queued} queued, {jobs.done} done, {jobs.failed} failed
        </span>
        <Pill tone={uncertain ? 'warn' : 'dim'} title="Items the script-analyst has to settle">
          {uncertain === null ? 'uncertain: ?' : `${uncertain} uncertain`}
        </Pill>
        <Pill tone={warnings.length ? 'warn' : 'dim'}>{warnings.length} warnings</Pill>
      </div>

      {warnings.length > 0 && (
        <details open={warnings.length <= 5}>
          <summary className="warn">Import warnings</summary>
          <ul className="log-list" data-testid="warnings">
            {warnings.slice(0, 50).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="card">
        <h3>Job log (end of log.md)</h3>
        <pre className="log-tail" data-testid="job-log">
          {log.length ? log.join('\n') : 'Nothing logged yet.'}
        </pre>
      </div>
    </div>
  )
}

function useUncertainCount(slug: string): number | null {
  const [n, setN] = useState<number | null>(null)
  const at = useVn((s) => s.projects[slug]?.updatedAt)
  useEffect(() => {
    let off = false
    void readText(`projects/${slug}/uncertain.json`).then((t) => {
      if (off) return
      try {
        const v: unknown = t ? JSON.parse(t) : null
        setN(Array.isArray(v) ? v.length : t === null ? null : 0)
      } catch {
        setN(null)
      }
    })
    return () => {
      off = true
    }
  }, [slug, at])
  return n
}

/** The last lines of the project's log.md, refreshed when a step changes and every 3 seconds while a step runs. */
function useLogTail(slug: string, running: boolean, stamp: string): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    let off = false
    const load = () =>
      void tailText(`projects/${slug}/log.md`, 8000).then((t) => {
        if (!off && t !== null) setLines(lastLines(t, 24))
      })
    load()
    const timer = running ? setInterval(load, 3000) : undefined
    return () => {
      off = true
      if (timer) clearInterval(timer)
    }
  }, [slug, running, stamp])
  return lines
}
