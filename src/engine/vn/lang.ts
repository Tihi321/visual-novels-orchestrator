import type { Lang } from '../../shared/vn'

export interface LangDetection {
  lang: Lang
  /** 0..1: how clearly one language wins, lower for very short samples. */
  confidence: number
  scores: { en: number; hr: number; words: number; diacritics: number }
}

// Words that are also common in the other language ("a", "to", "on", "do") are left out on purpose.
const HR_WORDS = new Set(
  'je i se da u na što šta nije su ali kao za od ne si smo ste sa ima bio bila bilo mi ti ga ju mu joj nas vas ovo ono taj ta koji koja kako kad kada već samo još jer pa ni nego'.split(' ')
)
const EN_WORDS = new Set(
  'the and is of that it you was for with he she they in his her not are this but have had what there be at as from by we my your'.split(' ')
)
const DIACRITICS = /[čćđšžČĆĐŠŽ]/g

/** Deterministic Croatian/English detection from diacritics and common function words. */
export function detectLanguage(text: string): LangDetection {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let hr = 0
  let en = 0
  for (const w of words) {
    if (HR_WORDS.has(w)) hr++
    if (EN_WORDS.has(w)) en++
  }
  const diacritics = (text.match(DIACRITICS) ?? []).length
  const n = Math.max(words.length, 1)
  const hrScore = (hr + 2 * diacritics) / n
  const enScore = en / n
  const sum = hrScore + enScore
  const lang: Lang = hrScore > enScore ? 'hr' : 'en'
  const margin = sum === 0 ? 0 : Math.abs(hrScore - enScore) / sum
  const confidence = Math.round(margin * Math.min(1, words.length / 25) * 1000) / 1000
  return { lang, confidence, scores: { en: enScore, hr: hrScore, words: words.length, diacritics } }
}
