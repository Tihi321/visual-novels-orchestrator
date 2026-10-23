import { z } from 'zod'
import { hasText } from '../../../shared/vn'
import type { VnBook } from '../../../shared/vn'
import type { AlignReport } from '../align'
import type { AlignFix, AlignNameFix } from '../fixes'
import { asJson, askJson, batches, clip } from './common'
import type { AgentCall } from './common'

/**
 * edition-aligner / resolve_alignment: the deterministic aligner left some beats without a translated text (missing) and some
 * translated texts without a beat (extra). The agent matches them (a fix names the missing beat and the extra text by its
 * index; the text is the translator's own, nothing is translated or written) and confirms the translated character names.
 */
export const resolveAlignmentSchema = z.object({
  fixes: z.array(z.object({ beatId: z.string(), extraIndex: z.number().int() })),
  names: z.array(z.object({ charKey: z.string(), name: z.string() }))
})
export type AlignmentAnswer = z.infer<typeof resolveAlignmentSchema>

export const BATCH = 25

/** The missing beats with their neighbours, and the extra texts of the same chapters. */
export function describeAlignment(book: VnBook, report: AlignReport, missing: string[]): { missing: Record<string, unknown>[]; extra: Record<string, unknown>[] } {
  const flat = book.chapters.flatMap((c) => c.scenes.flatMap((s) => s.beats.map((b, i) => ({ c: c.n, s, b, i }))))
  const text = (b: (typeof flat)[number]['b'] | undefined) => (!b || !hasText(b) ? '' : clip(b.text, 90))
  const rows = missing.map((id) => {
    const at = flat.find((x) => x.b.id === id)
    const scene = at?.s
    const prev = scene && at ? scene.beats.slice(0, at.i).reverse().find((x) => x.type !== 'cast') : undefined
    const next = scene && at ? scene.beats.slice(at.i + 1).find((x) => x.type !== 'cast') : undefined
    return {
      beatId: id,
      chapter: at?.c,
      scene: scene?.id,
      type: at?.b.type,
      speaker: at?.b.type === 'line' ? at.b.speakerLabel : undefined,
      primary: text(at?.b),
      before: text(prev),
      after: text(next)
    }
  })
  const chapters = new Set(rows.map((r) => r.chapter))
  const extra = report.extra.flatMap((e, index) => (chapters.has(e.chapter) ? [{ index, chapter: e.chapter, scene: e.scene, text: clip(e.text, 120) }] : []))
  return { missing: rows, extra }
}

export async function resolveAlignment(call: AgentCall, book: VnBook, report: AlignReport, lang: string): Promise<{ fixes: AlignFix[]; names: AlignNameFix[] }> {
  const fixes: AlignFix[] = []
  const names = new Map<string, string>()
  const groups = report.missing.length ? batches(report.missing, BATCH) : [[]]
  for (const group of groups) {
    const d = describeAlignment(book, report, group)
    const r = await askJson(
      call,
      'edition-aligner',
      'resolve_alignment',
      {
        title: book.title,
        primaryLang: book.primaryLang,
        lang,
        characters: asJson(book.characters.map((c) => ({ key: c.key, name: c.name }))),
        nameMap: asJson(report.nameMap),
        missing: asJson(d.missing),
        extra: asJson(d.extra),
        warnings: asJson(report.warnings.slice(0, 12))
      },
      resolveAlignmentSchema,
      { maxTokens: 3000 }
    )
    fixes.push(...r.fixes)
    for (const n of r.names) names.set(n.charKey, n.name)
  }
  return { fixes, names: [...names].map(([charKey, name]) => ({ charKey, name })) }
}
