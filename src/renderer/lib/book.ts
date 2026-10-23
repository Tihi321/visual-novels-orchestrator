import { hasText } from '../../shared/vn'
import type { VnBook, VnBeat } from '../../shared/vn'

export interface BeatInfo {
  id: string
  chapter: number
  scene: string
  speaker: string | null
  text: string
}

/** The beats that carry text (lines and narration), in book order, keyed by id. */
export function textBeats(book: Pick<VnBook, 'chapters'>): BeatInfo[] {
  const out: BeatInfo[] = []
  for (const ch of book.chapters) {
    for (const sc of ch.scenes) {
      for (const b of sc.beats) {
        const t = beatText(b)
        if (t !== null) out.push({ id: b.id, chapter: ch.n, scene: sc.id, speaker: b.type === 'line' ? b.speakerLabel : null, text: t })
      }
    }
  }
  return out
}

function beatText(b: VnBeat): string | null {
  return hasText(b) ? b.text : null
}

export function beatIndex(book: Pick<VnBook, 'chapters'>): Map<string, BeatInfo> {
  return new Map(textBeats(book).map((b) => [b.id, b]))
}

/** The beat ids of a primary book that have no text in an edition. Used when there is no align report. */
export function missingFromEdition(book: Pick<VnBook, 'chapters'>, edition: { beats: Record<string, string> }): string[] {
  return textBeats(book)
    .filter((b) => !(edition.beats[b.id] ?? '').trim())
    .map((b) => b.id)
}
