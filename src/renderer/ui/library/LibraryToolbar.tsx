import { TYPE_GROUPS, type TypeGroup } from '../../lib/bookTypes'
import type { LibraryQuery, StatusFilter } from '../../lib/libraryFilter'
import type { LibraryTab } from '../../store/store'

export interface LibraryCounts {
  groups: Record<TypeGroup | 'all', number>
  choices: number
  status?: Record<StatusFilter, number>
}

interface Props {
  tab: LibraryTab
  query: LibraryQuery
  counts: LibraryCounts
  onQuery(patch: Partial<LibraryQuery>): void
  onTab(tab: LibraryTab): void
  onRefresh(): void
  projectTotal: number
  bookTotal: number
}

const STATUSES: { id: StatusFilter; label: string; testId: string }[] = [
  { id: 'all', label: 'All', testId: 'project-filter-all' },
  { id: 'in_progress', label: 'In progress', testId: 'project-filter-in-progress' },
  { id: 'finished', label: 'Finished', testId: 'project-filter-finished' }
]

export function LibraryToolbar({ tab, query, counts, onQuery, onTab, onRefresh, projectTotal, bookTotal }: Props) {
  const chips: { id: TypeGroup | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, ...TYPE_GROUPS]
  const projects = tab === 'projects'
  return (
    <div className="lib-toolbar">
      <div className="lib-head">
        <h1 className="lib-title">Library</h1>
        <input
          type="search"
          className="lib-search"
          placeholder={projects ? 'Search titles, genres' : 'Search titles'}
          aria-label="Search"
          value={query.query}
          onChange={(e) => onQuery({ query: e.target.value })}
          data-testid="library-search"
        />
        {projects && (
          <label className="lib-sort">
            Sort
            <select value={query.sort} onChange={(e) => onQuery({ sort: e.target.value as LibraryQuery['sort'] })} data-testid="library-sort">
              <option value="recent">Recent</option>
              <option value="title">Title</option>
            </select>
          </label>
        )}
        <button onClick={onRefresh}>Refresh</button>
      </div>

      <div className="lib-tabs" role="tablist" data-testid="library-tabs">
        <button role="tab" aria-selected={projects} className={projects ? 'on' : ''} onClick={() => onTab('projects')} data-testid="library-tab-projects">
          Projects {projectTotal}
        </button>
        <button role="tab" aria-selected={!projects} className={!projects ? 'on' : ''} onClick={() => onTab('books')} data-testid="library-tab-books">
          Scriptorium books {bookTotal}
        </button>
      </div>

      <div className="lib-filters">
        <div className="lib-chips">
          {chips.map((c) => {
            const n = counts.groups[c.id]
            const on = query.group === c.id
            if (n === 0 && !on && c.id !== 'all') return null
            return (
              <button key={c.id} className={`lib-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onQuery({ group: c.id })} data-testid={`type-chip-${c.id}`}>
                {c.label} <span className="lib-count">{n}</span>
              </button>
            )
          })}
          {(counts.choices > 0 || query.choices) && (
            <>
              <span className="lib-divider" aria-hidden="true" />
              <button className={`lib-chip${query.choices ? ' on' : ''}`} aria-pressed={query.choices} onClick={() => onQuery({ choices: !query.choices })} data-testid="choices-toggle">
                With choices <span className="lib-count">{counts.choices}</span>
              </button>
            </>
          )}
        </div>
        {projects && counts.status && (
          <div className="lib-seg" role="tablist" data-testid="project-filter-tabs">
            {STATUSES.map((s) => (
              <button key={s.id} role="tab" aria-selected={query.status === s.id} className={query.status === s.id ? 'on' : ''} onClick={() => onQuery({ status: s.id })} data-testid={s.testId}>
                {s.label} ({counts.status![s.id]})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
