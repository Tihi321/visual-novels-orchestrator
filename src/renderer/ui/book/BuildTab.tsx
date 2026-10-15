import { useState } from 'react'
import type { BuildResult, ProjectDetail } from '../../../shared/protocol'
import { openFolder, sendCommand } from '../../api'
import { projectRel, relativeToData } from '../../lib/urls'
import { useVn } from '../../store/hooks'
import { Pill, useRecentError } from '../common'

export function BuildTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const builds = useVn((s) => s.builds[slug])
  const dataDir = useVn((s) => s.dataDir)
  const jobs = detail.jobs
  const busy = jobs.running + jobs.queued > 0
  const build = builds?.build ?? detail.build
  const lint = builds?.lint ?? detail.lint
  const preflight = builds?.preflight
  const android = builds?.android
  const error = useRecentError(slug)
  const [bundle, setBundle] = useState(false)
  const gameRel = (build?.gameDir && relativeToData(dataDir, build.gameDir)) || projectRel(slug, 'game')
  const androidOk = preflight?.ok === true

  return (
    <div className="stack" data-testid="tab-build-body">
      <div className="card">
        <h3>Game</h3>
        <div className="row">
          <button className="primary" onClick={() => sendCommand({ type: 'buildGame', slug })} data-testid="build-go">
            Build
          </button>
          <button onClick={() => sendCommand({ type: 'lintGame', slug })} data-testid="lint-go">
            Lint
          </button>
          <button onClick={() => sendCommand({ type: 'runGame', slug })} disabled={!build?.ok} data-testid="play-go" title="Starts the built game">
            Play
          </button>
          {busy && <Pill tone="accent">{jobs.running} running, {jobs.queued} queued</Pill>}
        </div>
        {error && <div className="bad-text">{error}</div>}
        <ResultView title="Build" result={build} testId="build-result" />
        <ResultView title="Lint" result={lint} testId="lint-result" />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="dim">Game folder:</span>
          <code className="ellipsis">{build?.gameDir ?? gameRel}</code>
          <button onClick={() => void openFolder(gameRel)} data-testid="open-game">
            Open folder
          </button>
        </div>
      </div>

      <div className="card" data-testid="android-card">
        <h3>Android</h3>
        <div className="row">
          <button onClick={() => sendCommand({ type: 'androidPreflight', slug })} data-testid="preflight-go">
            Check (preflight)
          </button>
          <label className="inline">
            <input type="checkbox" checked={bundle} onChange={(e) => setBundle(e.target.checked)} />
            Bundle (.aab) instead of .apk
          </label>
          <button
            className="primary"
            disabled={!androidOk}
            title={androidOk ? undefined : 'Run the preflight check first; it has to pass'}
            onClick={() => sendCommand({ type: 'androidBuild', slug, bundle })}
            data-testid="android-go"
          >
            Build Android
          </button>
        </div>
        {!preflight && <div className="dim">Run the check to see what is missing for an Android build.</div>}
        <ResultView title="Preflight" result={preflight} testId="preflight-result" actionable />
        <ResultView title="Android build" result={android} testId="android-result" />
        {android?.files && android.files.length > 0 && (
          <div className="row">
            <span className="dim">Output:</span>
            <code className="ellipsis">{android.files.join(', ')}</code>
            <button onClick={() => void openFolder(projectRel(slug, 'android'))}>Open folder</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultView({ title, result, testId, actionable }: { title: string; result: BuildResult | null | undefined; testId: string; actionable?: boolean }) {
  if (!result) return null
  const tone = result.skipped ? 'warn' : result.ok ? 'good' : 'bad'
  const label = result.skipped ? 'skipped' : result.ok ? 'ok' : 'problems'
  return (
    <div className="result" data-testid={testId}>
      <div className="row">
        <b>{title}</b>
        <Pill tone={tone}>{label}</Pill>
        <span className="dim">{new Date(result.at).toLocaleString()}</span>
        {result.theme && <Pill>{result.theme}</Pill>}
        {result.translated && result.translated.length > 0 && <Pill tone="good">translated: {result.translated.join(', ')}</Pill>}
        {result.placeholders && result.placeholders.length > 0 && (
          <Pill tone="warn" title={result.placeholders.join(', ')}>
            {result.placeholders.length} placeholders
          </Pill>
        )}
      </div>
      {result.statistics && <div className="dim">{result.statistics}</div>}
      {result.messages.length > 0 && (
        <ul className={actionable && !result.ok ? 'log-list todo' : 'log-list'}>
          {result.messages.slice(0, 60).map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {result.messages.length === 0 && result.ok && <div className="dim">No messages.</div>}
    </div>
  )
}
