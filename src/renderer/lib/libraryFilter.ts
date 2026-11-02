import type { ProjectSummary, SourceBook } from '../../shared/protocol'
import { isPictureBook } from '../../shared/vn'
import { hasChoices, TYPE_GROUPS, typeGroupOf, type TypeGroup } from './bookTypes'
import { isProjectFinished } from './pipeline'

export type StatusFilter = 'all' | 'in_progress' | 'finished'
export type SortKey = 'recent' | 'title'
export interface LibraryQuery {
  group: TypeGroup | 'all'
  choices: boolean
  query: string
  status: StatusFilter
  sort: SortKey
}

export const DEFAULT_QUERY: LibraryQuery = { group: 'all', choices: false, query: '', status: 'all', sort: 'recent' }

/** The type group of a project: picture books by presentation or format, else by format. */
export function projectGroup(p: ProjectSummary): TypeGroup {
  return p.presentation === 'picture-book' || isPictureBook(p.format) ? 'picture' : typeGroupOf(p.format)
}

export function projectChoices(p: ProjectSummary): boolean {
  return p.kind === 'choice'
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function matchesText(haystack: string, q: string): boolean {
  const h = haystack.toLowerCase()
  return words(q).every((w) => h.includes(w))
}

const projectText = (p: ProjectSummary): string => `${p.title} ${p.genre ?? ''} ${p.slug}`

function statusOk(p: ProjectSummary, status: StatusFilter): boolean {
  if (status === 'all') return true
  return status === 'finished' ? isProjectFinished(p) : !isProjectFinished(p)
}

type Skip = 'group' | 'choices' | 'status'

function projectMatches(p: ProjectSummary, q: LibraryQuery, skip?: Skip): boolean {
  if (skip !== 'group' && q.group !== 'all' && projectGroup(p) !== q.group) return false
  if (skip !== 'choices' && q.choices && !projectChoices(p)) return false
  if (skip !== 'status' && !statusOk(p, q.status)) return false
  return matchesText(projectText(p), q.query)
}

export function filterProjects(list: ProjectSummary[], q: LibraryQuery): ProjectSummary[] {
  const out = list.filter((p) => projectMatches(p, q))
  return q.sort === 'title' ? out.sort((a, b) => a.title.localeCompare(b.title)) : out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

function emptyGroups(): Record<TypeGroup | 'all', number> {
  const groups = { all: 0 } as Record<TypeGroup | 'all', number>
  for (const g of TYPE_GROUPS) groups[g.id] = 0
  return groups
}

export function projectCounts(list: ProjectSummary[], q: LibraryQuery): { groups: Record<TypeGroup | 'all', number>; choices: number; status: Record<StatusFilter, number> } {
  const groups = emptyGroups()
  for (const p of list) {
    if (!projectMatches(p, q, 'group')) continue
    groups.all++
    groups[projectGroup(p)]++
  }
  const status: Record<StatusFilter, number> = { all: 0, in_progress: 0, finished: 0 }
  for (const p of list) {
    if (!projectMatches(p, q, 'status')) continue
    status.all++
    status[isProjectFinished(p) ? 'finished' : 'in_progress']++
  }
  return { groups, choices: list.filter((p) => projectMatches(p, q, 'choices') && projectChoices(p)).length, status }
}

function bookMatches(b: SourceBook, q: LibraryQuery, skip?: 'group' | 'choices'): boolean {
  if (skip !== 'group' && q.group !== 'all' && typeGroupOf(b.format) !== q.group) return false
  if (skip !== 'choices' && q.choices && !hasChoices(b.format)) return false
  return matchesText(`${b.title} ${b.slug}`, q.query)
}

export function filterSourceBooks(list: SourceBook[], q: LibraryQuery): SourceBook[] {
  return list.filter((b) => bookMatches(b, q)).sort((a, b) => a.title.localeCompare(b.title))
}

export function sourceBookCounts(list: SourceBook[], q: LibraryQuery): { groups: Record<TypeGroup | 'all', number>; choices: number } {
  const groups = emptyGroups()
  for (const b of list) {
    if (!bookMatches(b, q, 'group')) continue
    groups.all++
    groups[typeGroupOf(b.format)]++
  }
  return { groups, choices: list.filter((b) => bookMatches(b, q, 'choices') && hasChoices(b.format)).length }
}
