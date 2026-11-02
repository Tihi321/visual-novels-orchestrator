import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../src/shared/protocol'
import { hasChoices, typeGroupOf } from '../src/renderer/lib/bookTypes'
import { DEFAULT_QUERY, filterProjects, projectCounts, projectGroup } from '../src/renderer/lib/libraryFilter'

const project = (slug: string, over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  slug,
  title: slug,
  format: 'visual-novel',
  kind: 'linear',
  primaryLang: 'en',
  editions: ['en'],
  theme: null,
  chapters: 1,
  characters: 1,
  places: 1,
  voice: false,
  assets: { total: 0, ready: 0, missing: 0, locked: 0, custom: 0 },
  warnings: 0,
  pipeline: null,
  updatedAt: '2026-01-01',
  ...over
})
const built = { steps: { build: { status: 'done', at: 'x' } } } as unknown as ProjectSummary['pipeline']

describe('library types', () => {
  it('groups the real formats', () => {
    const cases: [string, string, boolean][] = [
      ['visual-novel', 'vn', false],
      ['choice-visual-novel', 'vn', true],
      ['kids-visual-story', 'vn', false],
      ['kids-choice-visual-story', 'vn', true],
      ['mystery-puzzle-visual-novel', 'puzzle', false],
      ['kids-picture-book', 'picture', false],
      ['gamebook', 'stories', true],
      ['made-up-format', 'other', false]
    ]
    for (const [format, group, choices] of cases) expect([format, typeGroupOf(format), hasChoices(format)]).toEqual([format, group, choices])
    expect(projectGroup(project('p', { presentation: 'picture-book' }))).toBe('picture')
  })

  it('filters, counts and sorts projects', () => {
    const list = [
      project('alpha', { title: 'Alpha', updatedAt: '2026-01-03', pipeline: built }),
      project('beta', { title: 'Beta', kind: 'choice', format: 'choice-visual-novel', updatedAt: '2026-01-05' }),
      project('gamma', { title: 'Gamma', kind: 'choice', format: 'choice-visual-novel', genre: 'noir', updatedAt: '2026-01-04', pipeline: built }),
      project('delta', { title: 'Delta', format: 'kids-picture-book', updatedAt: '2026-01-02' }),
      project('eps', { title: 'Epsilon', format: 'mystery-puzzle-visual-novel', updatedAt: '2026-01-01' })
    ]
    expect(filterProjects(list, DEFAULT_QUERY).map((p) => p.slug)).toEqual(['beta', 'gamma', 'alpha', 'delta', 'eps'])
    expect(filterProjects(list, { ...DEFAULT_QUERY, sort: 'title' }).map((p) => p.slug)).toEqual(['alpha', 'beta', 'delta', 'eps', 'gamma'])
    const q = { ...DEFAULT_QUERY, group: 'vn' as const, choices: true, status: 'finished' as const, query: 'NOIR gam' }
    expect(filterProjects(list, q).map((p) => p.slug)).toEqual(['gamma'])
    const c = projectCounts(list, { ...DEFAULT_QUERY, group: 'vn', choices: true })
    expect(c.groups).toMatchObject({ all: 2, vn: 2, picture: 0, puzzle: 0 })
    expect(c.choices).toBe(2)
    expect(c.status).toEqual({ all: 2, in_progress: 1, finished: 1 })
    expect(projectCounts(list, DEFAULT_QUERY).groups).toMatchObject({ all: 5, vn: 3, picture: 1, puzzle: 1 })
  })
})
