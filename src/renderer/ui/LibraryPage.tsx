import { useEffect, useMemo, useState } from 'react'
import { sendCommand } from '../api'
import { DEFAULT_QUERY, filterProjects, filterSourceBooks, projectCounts, sourceBookCounts } from '../lib/libraryFilter'
import { useVn } from '../store/hooks'
import { vnStore } from '../store/store'
import { ImportDialog } from './ImportDialog'
import { PathField } from './common'
import { LibraryToolbar } from './library/LibraryToolbar'
import { ProjectCard } from './library/ProjectCard'
import { SourceRow } from './library/SourceRow'

export function LibraryPage() {
  const books = useVn((s) => s.sourceBooks)
  const scriptoriumData = useVn((s) => s.scriptoriumData)
  const projects = useVn((s) => s.projects)
  const loaded = useVn((s) => s.projectsLoaded)
  const connected = useVn((s) => s.connected)
  const { tab, query } = useVn((s) => s.library)
  const [importing, setImporting] = useState<string | null>(null)
  const [folder, setFolder] = useState('')

  useEffect(() => {
    if (!connected) return
    sendCommand({ type: 'listSourceBooks' })
    sendCommand({ type: 'listProjects' })
  }, [connected])

  const projectList = useMemo(() => Object.values(projects), [projects])
  const bookList = useMemo(() => books ?? [], [books])
  const shownProjects = useMemo(() => filterProjects(projectList, query), [projectList, query])
  const shownBooks = useMemo(() => filterSourceBooks(bookList, query), [bookList, query])
  const counts = useMemo(() => (tab === 'projects' ? projectCounts(projectList, query) : sourceBookCounts(bookList, query)), [tab, projectList, bookList, query])
  const setLibrary = vnStore.getState().setLibrary
  const clearFilters = () => setLibrary({ query: { ...DEFAULT_QUERY, sort: query.sort } })
  const refresh = () => {
    sendCommand({ type: 'listSourceBooks' })
    sendCommand({ type: 'listProjects' })
  }

  return (
    <div className="lib-page" data-testid="page-library">
      <LibraryToolbar
        tab={tab}
        query={query}
        counts={counts}
        onQuery={(patch) => setLibrary({ query: patch })}
        onTab={(t) => setLibrary({ tab: t })}
        onRefresh={refresh}
        projectTotal={projectList.length}
        bookTotal={bookList.length}
      />

      {tab === 'projects' && (
        <div className="lib-grid" data-testid="project-list">
          {shownProjects.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      )}
      {tab === 'projects' && (
        <>
          {loaded && !projectList.length && (
            <div className="lib-empty" data-testid="library-projects-view">
              <span>No projects yet. Import a book from Scriptorium books.</span>
              <button onClick={() => setLibrary({ tab: 'books' })} data-testid="library-go-books">
                Browse Scriptorium Books
              </button>
            </div>
          )}
          {loaded && projectList.length > 0 && !shownProjects.length && (
            <div className="lib-empty">
              <span>Nothing matches these filters.</span>
              <button onClick={clearFilters} data-testid="library-clear">
                Clear filters
              </button>
            </div>
          )}
          {!loaded && <div className="dim">Loading...</div>}
        </>
      )}

      {tab === 'books' && (
        <div className="lib-page" data-testid="library-books-view">
          <div className="dim">
            {scriptoriumData ? `From ${scriptoriumData}/books (change it in Settings).` : 'Set the Scriptorium data folder in Settings.'}
          </div>
          <div className="lib-rows" data-testid="book-list">
            {shownBooks.map((b) => (
              <SourceRow key={b.slug} book={b} imported={!!projects[b.slug]} onImport={() => setImporting(b.slug)} />
            ))}
            {books && !books.length && <div className="dim">No script or choice books found in that folder.</div>}
            {books && books.length > 0 && !shownBooks.length && (
              <div className="lib-empty">
                <span>Nothing matches these filters.</span>
                <button onClick={clearFilters} data-testid="library-clear">
                  Clear filters
                </button>
              </div>
            )}
            {!books && <div className="dim">Loading...</div>}
          </div>

          <div className="card">
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
        </div>
      )}
      {importing && <ImportDialog source={importing} onClose={() => setImporting(null)} />}
    </div>
  )
}
