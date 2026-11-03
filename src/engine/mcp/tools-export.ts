import { z } from 'zod'
import { langSchema } from '../../shared/vn'
import { runBookExport } from '../export/run'
import type { VnService } from '../vn/service'
import type { Tool, ToolDef } from './tools'

/**
 * The book export tool. `plan` is the dry run (no file, no number stored); the EPUB writer (VNO-53) and the PDF writer (VNO-54) call
 * `loadExportBook` with `persist: true`, then refuse when the stored numbering is stale.
 */
export function exportTools(svc: VnService, def: ToolDef): Tool[] {
  return [
    def(
      'vno_export_book',
      "Export a finished project as an illustrated book. A project with choices becomes a gamebook: one numbered section per chapter, shuffled numbers from a stored seed (projects/<slug>/export.json, so the EPUB and the PDF match and a re-export keeps the numbers), section 1 is the start, choices read \"... turn to section N\" (hr: \"... idi na odlomak N\"). A linear visual novel is printed chapter by chapter, a picture book page by page; the picture is each chapter's first scene background (the cover is the first scene's background). Sprites, CGs, puzzles, voice, music and cues are dropped and listed as warnings. format 'plan' is the dry run: it returns the mode, the section map, the picture count and the warnings and writes nothing; 'epub' writes a reflowable EPUB 3 (Kindle: Send to Kindle) to projects/<slug>/export/<slug>-<lang>.epub; 'pdf' writes an A5 PDF (Lora font, a link on each \"section N\", the section number in the footer) to projects/<slug>/export/<slug>-<lang>.pdf. Returns { path?, format, mode, lang2?, paired?, unpaired?, sections, pictures, warnings, sectionMap? }, never file bytes. A stored map that no longer fits the chapters is reported stale, never renumbered silently: pass renumber: true. Right-to-left editions are refused. lang2 prints a parallel-text book: each paragraph, caption, choice, title and ending is followed by the lang2 line (smaller, grey, italic); the file is <slug>-<lang>-<lang2>.<ext>; lines missing in lang2 print without translation (one warning).",
      z.object({
        slug: z.string().describe('The project slug (see vno_list_projects)'),
        lang: langSchema.optional().describe('The edition to print. Default: the primary language'),
        lang2: langSchema.optional().describe('A second edition printed under each line, smaller, grey and italic (parallel text). Must differ from lang'),
        format: z.enum(['epub', 'pdf', 'plan']).describe("'plan' is the dry run; 'epub' (Kindle) and 'pdf'"),
        order: z.enum(['shuffled', 'in-order']).optional().describe('Gamebook section numbers: shuffled (default) or in chapter order'),
        seed: z.string().optional().describe('Seed of the shuffle. Default: the stored seed, else the project slug'),
        renumber: z.boolean().optional().describe('Compute the section numbers again and replace the stored ones'),
        out: z.string().optional().describe('The output file for epub/pdf. Default: projects/<slug>/export/<slug>-<lang>.<ext>, or <slug>-<lang>-<lang2>.<ext> when lang2 is set'),
        grayscale: z.boolean().optional().describe('epub/pdf: a grey JPEG variant of the pictures (default: colour)')
      }),
      async (a) => {
        const { map, stale: _stale, ...r } = await runBookExport(svc.store, a.slug, a)
        return { ...r, ...(map ? { sectionMap: map } : {}) }
      }
    )
  ]
}
