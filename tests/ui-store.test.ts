import { describe, expect, it } from 'vitest'
import type { AssetView, EngineEvent, ProjectDetail, ProjectSummary } from '../src/shared/protocol'
import { initialVn, reduceVn, type VnData } from '../src/renderer/store/vn'

const apply = (s: VnData, ...events: EngineEvent[]): VnData => events.reduce((acc, e) => ({ ...acc, ...reduceVn(acc, e, 1000) }), s)
const summary = (slug: string): ProjectSummary => ({
  slug,
  title: slug,
  format: 'f',
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
  updatedAt: 'a'
})
const asset = (id: string): AssetView => ({ id, kind: 'cover', prompt: '', engine: 'e', seed: null, size: null, versions: [], selected: null, source: 'generated', locked: false, fileRel: null, versionFiles: {}, orphaned: false })

describe('reduceVn', () => {
  it('stores the library and the projects', () => {
    const s = apply(initialVn(), { type: 'books.listed', books: [], scriptoriumData: 'D' }, { type: 'projects.listed', projects: [summary('a'), summary('b')] })
    expect(s.sourceBooks).toEqual([])
    expect(s.scriptoriumData).toBe('D')
    expect(Object.keys(s.projects)).toEqual(['a', 'b'])
    expect(s.projectsLoaded).toBe(true)
  })
  it('keeps live pipeline progress per project and step', () => {
    const s = apply(
      initialVn(),
      { type: 'pipeline.progress', slug: 'a', step: 'art', status: { status: 'running', message: '', at: '1' } },
      { type: 'pipeline.progress', slug: 'a', step: 'art', status: { status: 'done', message: '', at: '2' } }
    )
    expect(s.progress.a?.art?.status).toBe('done')
  })
  it('updates an asset live and bumps its revision', () => {
    let s = apply(initialVn(), { type: 'assets.listed', slug: 'a', assets: [asset('cover')] })
    expect(s.assetRev['a:cover']).toBe(0)
    s = apply(s, { type: 'asset.updated', slug: 'a', asset: { ...asset('cover'), locked: true } })
    expect(s.assets.a?.cover?.locked).toBe(true)
    expect(s.assetRev['a:cover']).toBe(1)
  })
  it('follows project.updated into a loaded detail, and drops a deleted project', () => {
    const detail = { summary: summary('a') } as ProjectDetail
    let s = apply(initialVn(), { type: 'project.loaded', slug: 'a', project: detail })
    s = apply(s, { type: 'project.updated', slug: 'a', project: { ...summary('a'), title: 'New' } })
    expect(s.details.a?.summary.title).toBe('New')
    s = { ...s, currentSlug: 'a' }
    s = apply(s, { type: 'project.deleted', slug: 'a' })
    expect(s.projects.a).toBeUndefined()
    expect(s.currentSlug).toBeNull()
  })
  it('stores a build result by action, an edition beat edit and the command errors', () => {
    let s = apply(initialVn(), { type: 'build.result', result: { slug: 'a', action: 'preflight', ok: false, messages: ['no sdk'], at: 'x' } })
    expect(s.builds.a?.preflight?.ok).toBe(false)
    s = apply(s, { type: 'edition.loaded', slug: 'a', lang: 'hr', edition: { lang: 'hr', title: 't', chapterTitles: {}, choiceTexts: {}, endings: {}, characterNames: {}, beats: { b1: 'x' } } })
    s = apply(s, { type: 'edition.updated', slug: 'a', lang: 'hr', beatId: 'b1', text: 'y' })
    expect(s.editions.a?.hr?.beats.b1).toBe('y')
    s = apply(s, { type: 'command.error', command: 'addEdition', message: 'bad', slug: 'a' })
    expect(s.errors[0]).toMatchObject({ command: 'addEdition', message: 'bad', at: 1000 })
  })
  it('stores the import preview and clears it when done', () => {
    const preview = { source: 's', path: 'p', slug: 'a', title: 'A', format: 'f', kind: 'linear' as const, detected: { lang: 'en' as const, confidence: 0.9 }, chapters: 1, characters: 1, places: 1, uncertain: 0, warnings: [] }
    let s = apply(initialVn(), { type: 'import.preview', preview })
    expect(s.importPreview?.slug).toBe('a')
    s = apply(s, { type: 'import.done', slug: 'a', preview })
    expect(s.importPreview).toBeNull()
    expect(s.lastImported).toBe('a')
  })
})
