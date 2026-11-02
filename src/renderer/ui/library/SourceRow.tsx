import type { SourceBook } from '../../../shared/protocol'
import { typeBadge } from '../../lib/bookTypes'
import { Pill } from '../common'

export function SourceRow({ book, imported, onImport }: { book: SourceBook; imported: boolean; onImport(): void }) {
  const badge = typeBadge(book.format)
  return (
    <div className="lib-row" data-testid={`source-${book.slug}`}>
      <div className="lib-row-main">
        <b className="lib-row-title">{book.title}</b>
        {badge && (
          <span className={`badge t-${badge.group}`} title={book.format}>
            {badge.text}
          </span>
        )}
        <span className="dim lib-row-slug">{book.slug}</span>
      </div>
      <div className="lib-row-side">
        <Pill tone={book.script ? 'good' : 'warn'} title={book.script ? 'Has a script' : 'Prose only: the importer converts it'}>
          {book.stage}
        </Pill>
        {imported && <Pill tone="good">imported</Pill>}
        <button className="primary" onClick={onImport} data-testid={`import-${book.slug}`}>
          {imported ? 'Import again' : 'Import'}
        </button>
      </div>
    </div>
  )
}
