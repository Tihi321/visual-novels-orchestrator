import { useEffect, useMemo, useState } from 'react'
import type { ProjectSummary, SourceBook } from '../../shared/protocol'
import { sendCommand } from '../api'
import { langName } from '../lib/voice'
import { useVn } from '../store/hooks'
import { vnStore } from '../store/store'
import { ImportDialog } from './ImportDialog'
import { PathField, Pill, ProgressBar } from './common'
import { mergeSteps, stepRows, isRunning, failedStep } from '../lib/pipeline'

export function LibraryPage() {
  const books = useVn((s) => s.sourceBooks)
  const scriptoriumData = useVn((s) => s.scriptoriumData)
  const projects = useVn((s) => s.projects)
  const loaded = useVn((s) => s.projectsLoaded)
  const connected = useVn((s) => s.connected)
  const [importing, setImporting] = useState<string | null>(null)
  const [folder, setFolder] = useState('')

  useEffect(() => {
    if (!connected) return
    sendCommand({ type: 'listSourceBooks' })
    sendCommand({ type: 'listProjects' })
  }, [connected])

  const list = useMemo(() => Object.values(projects).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), [projects])
  return (
    <div className="stack" style={{ maxWidth: 1100 }} data-testid="page-library">
      <div className="row spread">
        <div className="panel-title">Library</div>
        <button
          onClick={() => {
            sendCommand({ type: 'listSourceBooks' })
            sendCommand({ type: 'listProjects' })
          }}
        >
          Refresh
        </button>
      </div>

      <div className="section-title">Projects</div>
      <div className="grid" data-testid="project-list">
        {list.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
        {loaded && !list.length && <div className="dim">No projects yet. Import a book below.</div>}
        {!loaded && <div className="dim">Loading...</div>}
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        Scriptorium books
      </div>
      <div className="dim">{scriptoriumData ? `From ${scriptoriumData}/books (change it in Settings).` : 'Set the Scriptorium data folder in Settings.'}</div>
      <div className="stack" data-testid="book-list">
        {books?.map((b) => <SourceRow key={b.slug} book={b} imported={!!projects[b.slug]} onImport={() => setImporting(b.slug)} />)}
        {books && !books.length && <div className="dim">No script or choice books found in that folder.</div>}
        {!books && <div className="dim">Loading...</div>}
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <h3>Import a book folder</h3>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div style={{ flex: 1 }}>
            <PathField value={folder} onChange={setFolder} mode="folder" placeholder="A book folder (with book.md, chapters/ ...)" testId="import-folder" />
          </div>
          <button className="primary" disabled={!folder.trim()} onClick={() => setImporting(folder.trim())} data-testid="import-folder-go">
            Import folder...
          </button>
        </div>
      </div>
      {importing && <ImportDialog source={importing} onClose={() => setImporting(null)} />}
    </div>
  )
}

function SourceRow({ book, imported, onImport }: { book: SourceBook; imported: boolean; onImport(): void }) {
  return (
    <div className="card row spread" data-testid={`source-${book.slug}`}>
      <div className="row">
        <b>{book.title}</b>
        <span className="dim">{book.slug}</span>
        <Pill>{book.format}</Pill>
        <Pill tone={book.hasChoices ? 'accent' : 'dim'}>{book.hasChoices ? 'choice' : 'linear'}</Pill>
        <Pill tone={book.script ? 'good' : 'warn'} title={book.script ? 'Has a script' : 'Prose only: the importer converts it'}>
          {book.stage}
        </Pill>
        {imported && <Pill tone="good">imported</Pill>}
      </div>
      <button className="primary" onClick={onImport} data-testid={`import-${book.slug}`}>
        {imported ? 'Import again' : 'Import'}
      </button>
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const live = useVn((s) => s.progress[project.slug])
  const rows = stepRows(mergeSteps(project.pipeline, live), project.voice)
  const running = isRunning(rows)
  const failed = failedStep(rows)
  const { ready, total } = project.assets
  return (
    <button className="card project-card" onClick={() => vnStore.getState().openProject(project.slug)} data-testid={`project-${project.slug}`}>
      <div className="row spread" style={{ flexWrap: 'nowrap' }}>
        <b className="ellipsis">{project.title}</b>
        {running ? <Pill tone="accent">running</Pill> : failed ? <Pill tone="bad">failed</Pill> : null}
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <Pill tone={project.kind === 'choice' ? 'accent' : 'dim'}>{project.kind}</Pill>
        {project.editions.map((l) => (
          <Pill key={l} tone="good" title={langName(l)}>
            {l.toUpperCase()}
          </Pill>
        ))}
        <Pill>{project.theme ?? 'auto theme'}</Pill>
        {project.voice && <Pill tone="accent">voice</Pill>}
        {project.warnings > 0 && <Pill tone="warn">{project.warnings} warnings</Pill>}
      </div>
      <div className="dim" style={{ marginTop: 6 }}>
        {project.chapters} chapters, {project.characters} characters, {project.places} places
      </div>
      <div style={{ marginTop: 6 }}>
        <ProgressBar fraction={total > 0 ? ready / total : null} />
        <div className="dim">{total > 0 ? `${ready} of ${total} assets ready` : 'no assets planned yet'}</div>
      </div>
    </button>
  )
}
