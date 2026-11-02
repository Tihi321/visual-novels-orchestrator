import { useEffect, useState } from 'react'
import type { BuildResult, ProjectDetail } from '../../../shared/protocol'
import type { Lang } from '../../../shared/vn'
import { openFolder, sendCommand } from '../../api'
import { langName } from '../../lib/voice'
import { dirOf, projectRel, relativeToData } from '../../lib/urls'
import { useVn } from '../../store/hooks'
import { Pill, useRecentError } from '../common'

export function BuildTab({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const builds = useVn((s) => s.builds[slug])
  const dataDir = useVn((s) => s.dataDir)
  const jobs = detail.jobs
  const busy = jobs.running + jobs.queued > 0
  const build = builds?.build ?? detail.build
  const lint = builds?.lint ?? detail.lint
  const error = useRecentError(slug)
  const gameRel = (build?.gameDir && relativeToData(dataDir, build.gameDir)) || projectRel(slug, 'game')

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
        <div className="dim" style={{ marginTop: 6 }}>
          Compiles a self-contained HTML5/Web Visual Novel &amp; Puzzle bundle into <code>game/index.html</code> (playable directly via <b>Play</b> or in any browser, and ready to wrap with Capacitor for mobile).
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
      <ExportSection slug={slug} detail={detail} />
    </div>
  )
}

/** Prints the project as a book (VNO-56): the same engine function as the `vno_export_book` MCP tool, through the `exportBook` command. */
function ExportSection({ slug, detail }: { slug: string; detail: ProjectDetail }) {
  const exp = useVn((s) => s.exports[slug])
  const dataDir = useVn((s) => s.dataDir)
  const primary = detail.summary.primaryLang
  const langs = [primary, ...detail.summary.editions.filter((l) => l !== primary)]
  const [lang, setLang] = useState<Lang>(primary)
  const [order, setOrder] = useState<'shuffled' | 'in-order'>('shuffled')
  const [renumber, setRenumber] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const choice = detail.summary.kind === 'choice'
  useEffect(() => setPending(null), [exp])
  const run = (format: 'epub' | 'pdf' | 'plan') => {
    setPending(format)
    sendCommand({ type: 'exportBook', slug, format, lang, ...(choice ? { order, renumber } : {}) })
  }
  const r = exp?.result
  const folderRel = r?.path ? (relativeToData(dataDir, dirOf(r.path)) ?? projectRel(slug, 'export')) : null
  return (
    <div className="card" data-testid="export-section">
      <h3>Export</h3>
      <div className="row">
        <label className="inline">
          Language
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} data-testid="export-lang">
            {langs.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </label>
        {choice && (
          <>
            <label className="inline">
              Numbering
              <select value={order} onChange={(e) => setOrder(e.target.value as 'shuffled' | 'in-order')} data-testid="export-order">
                <option value="shuffled">Shuffled</option>
                <option value="in-order">Chapter order</option>
              </select>
            </label>
            <label className="inline" title="Compute the section numbers again and replace the stored ones">
              <input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} data-testid="export-renumber" />
              Renumber
            </label>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" disabled={!!pending} onClick={() => run('epub')} data-testid="export-epub">
          EPUB (Kindle)
        </button>
        <button className="primary" disabled={!!pending} onClick={() => run('pdf')} data-testid="export-pdf">
          PDF
        </button>
        <button disabled={!!pending} onClick={() => run('plan')} data-testid="export-plan">
          Preview plan
        </button>
        {pending && <Pill tone="accent">{pending === 'plan' ? 'planning' : `writing ${pending}`}...</Pill>}
      </div>
      <div className="dim" style={{ marginTop: 6 }}>
        Prints the story as an illustrated book into <code>export/</code>. A choice story becomes a numbered gamebook; sprites, sound and puzzles are left out.
      </div>
      {exp?.error && (
        <div className="bad-text" data-testid="export-error">
          {exp.error}
        </div>
      )}
      {r && (
        <div className="result" data-testid="export-result">
          <div className="row">
            <b>{r.format === 'plan' ? 'Plan' : r.format.toUpperCase()}</b>
            <Pill>{r.mode}</Pill>
            <Pill>{langName(r.lang)}</Pill>
            <span className="dim">
              {r.sections} {r.mode === 'picture-book' ? 'pages' : 'sections'}, {r.pictures} pictures
            </span>
            {r.stale && <Pill tone="warn">stored numbering is stale: tick Renumber to replace it</Pill>}
          </div>
          {r.path && (
            <div className="row" style={{ marginTop: 4 }}>
              <code className="ellipsis" data-testid="export-path">{r.path}</code>
              {folderRel && (
                <button onClick={() => void openFolder(folderRel)} data-testid="open-export">
                  Open folder
                </button>
              )}
            </div>
          )}
          {r.warnings.length > 0 && (
            <ul className="log-list" data-testid="export-warnings">
              {r.warnings.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
