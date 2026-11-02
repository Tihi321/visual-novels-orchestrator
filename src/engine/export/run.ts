import type { Lang } from '../../shared/vn'
import type { ProjectStore } from '../vn/project'
import { writeEpubFile } from './epub'
import { loadExportBook, pictureCount } from './model'
import type { ExportMode } from './model'
import { writePdfFile } from './pdf'
import type { SectionMap, SectionOrder } from './sections'

export type ExportFormat = 'epub' | 'pdf' | 'plan'

export interface ExportRunInput {
  lang?: Lang
  format: ExportFormat
  order?: SectionOrder
  seed?: string
  renumber?: boolean
  out?: string
  grayscale?: boolean
  /** pdf only: sections laid out so far (done of total). */
  onProgress?: (done: number, total: number) => void
}

export interface ExportRunResult {
  format: ExportFormat
  mode: ExportMode
  lang: Lang
  sections: number
  pictures: number
  warnings: string[]
  /** The stored section numbers no longer fit the chapters (a dry run reports it; a file format refuses instead). */
  stale: boolean
  path?: string
  bytes?: number
  map?: SectionMap
}

/** The one export entry point: the MCP tool `vno_export_book` and the UI command `exportBook` both call it. `plan` is the dry run and writes nothing. */
export async function runBookExport(store: ProjectStore, slug: string, a: ExportRunInput): Promise<ExportRunResult> {
  if (a.format === 'epub' || a.format === 'pdf') {
    const opts = { lang: a.lang, order: a.order, seed: a.seed, renumber: a.renumber, out: a.out, grayscale: a.grayscale, onProgress: a.onProgress }
    const w = a.format === 'pdf' ? await writePdfFile(store, slug, opts) : await writeEpubFile(store, slug, opts)
    const b = w.book
    return { path: w.path, format: a.format, mode: b.mode, lang: b.lang, sections: b.mode === 'picture-book' ? b.pages.length : b.sections.length, pictures: w.pictures, bytes: w.bytes, warnings: w.warnings, stale: false, map: w.map }
  }
  const r = await loadExportBook(store, slug, { lang: a.lang, order: a.order, seed: a.seed, renumber: a.renumber, persist: false })
  const b = r.book
  return { format: a.format, mode: b.mode, lang: b.lang, sections: b.mode === 'picture-book' ? b.pages.length : b.sections.length, pictures: pictureCount(b), warnings: b.warnings, stale: r.stale.length > 0, map: r.map }
}
