import type { Lang, ProjectSettings } from '../../shared/vn'
import type { VibeVoice } from './vibetts'
import { sha1 } from './vocab'

/** The voices VibeTTS offers are fixed: this picks among them (gender, language, spreading) without any model. */

export type Gender = 'female' | 'male'

export type EnglishEngine = NonNullable<ProjectSettings['voice']['englishEngine']>

export const NARRATOR = 'narrator'

/** Shown when a language other than English needs Supertonic and VibeTTS does not have it yet. */
export const SUPERTONIC_HINT = 'Supertonic is not installed in VibeTTS: download it in VibeTTS Settings > Supertonic (about 400 MB), then plan the voices again'

/** The gender of a voice id: Kokoro `af_`/`bf_` female, `am_`/`bm_` male; Supertonic `F1`..`F5` female, `M1`..`M5` male. Null when unknown. */
export function voiceGender(id: string): Gender | null {
  const st = /^supertonic:([FM])\d+$/i.exec(id)
  if (st) return st[1]!.toUpperCase() === 'F' ? 'female' : 'male'
  const k = /^[a-z]([fm])_/.exec(id)
  if (k) return k[1] === 'f' ? 'female' : 'male'
  return null
}

/** `female` / `male` from a model's word (case and a few near-misses tolerated), else null. */
export function parseGender(raw: unknown): Gender | null {
  const w = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (['female', 'woman', 'f', 'girl', 'feminine'].includes(w)) return 'female'
  if (['male', 'man', 'm', 'boy', 'masculine'].includes(w)) return 'male'
  return null
}

/** What the bible says about a speaker. */
export interface VoiceHints {
  key: string
  name: string
  looks: string
  voiceHint: string
}

const WORDS = (s: string, ...res: RegExp[]): boolean => res.some((r) => r.test(s))

/**
 * The gender from the bible text alone (used when the voice-director does not answer, or leaves it out). The narrator is female unless the
 * text says otherwise; a character the text says nothing about gets a stable gender from its key, so the cast is not all one gender.
 */
export function guessGender(h: VoiceHints): Gender {
  const text = `${h.looks} ${h.voiceHint}`.toLowerCase()
  if (WORDS(text, /\b(she|her|hers|girl|woman|female|mother|lady|daughter|sister|queen|princess|witch|djevojk\w*|žen\w*|majk\w*|kći|sestr\w*)\b/)) return 'female'
  if (WORDS(text, /\b(he|his|him|boy|man|male|father|gentleman|son|brother|king|prince|wizard|dječak\w*|muškar\w*|otac|brat\w*|sin)\b/)) return 'male'
  if (h.key === NARRATOR) return 'female'
  return parseInt(sha1(h.key).slice(0, 2), 16) % 2 === 0 ? 'female' : 'male'
}

/**
 * The voices that can read `lang`. English: the `englishEngine`'s voices (Kokoro by default), or every voice that reads English when that
 * engine has none. Any other language: the voices whose `languages` include it (Supertonic).
 */
export function voicesFor(voices: readonly VibeVoice[], lang: Lang | string, englishEngine: EnglishEngine = 'kokoro'): VibeVoice[] {
  const reads = voices.filter((v) => v.languages.includes(lang))
  if (lang !== 'en') return reads
  const own = reads.filter((v) => v.engine === englishEngine)
  return own.length ? own : reads
}

/** True when `id` is listed and reads `lang`. */
export const readsLang = (voices: readonly VibeVoice[], id: string, lang: Lang | string): boolean => voices.some((v) => v.id === id && v.languages.includes(lang))

/** One speaker to give a voice. `preferred` is the voice-director's pick: used when it is a candidate of the speaker's gender and not taken. */
export interface VoiceWish {
  key: string
  gender: Gender
  preferred?: string
}

/**
 * A voice for each speaker from `candidates` (the result of `voicesFor`), deterministic: the same input gives the same voices.
 * Speakers of one gender spread over that gender's voices, so they differ while there are enough voices; then voices are reused round-robin
 * (Supertonic has 5 per gender). The narrator goes last and takes a voice the cast does not use where it can. `taken` voices (already
 * given to other speakers of this language) count as used. A gender with no candidates draws from all of them.
 */
export function pickVoices(speakers: readonly VoiceWish[], candidates: readonly VibeVoice[], taken: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  if (!candidates.length) return out
  const uses = new Map<string, number>(candidates.map((v) => [v.id, 0]))
  for (const id of taken) if (uses.has(id)) uses.set(id, uses.get(id)! + 1)
  const ids = new Set(candidates.map((v) => v.id))
  const ordered = [...speakers.filter((s) => s.key !== NARRATOR), ...speakers.filter((s) => s.key === NARRATOR)]
  for (const s of ordered) {
    const same = candidates.filter((v) => voiceGender(v.id) === s.gender)
    const pool = same.length ? same : candidates
    let id: string | undefined
    if (s.preferred && ids.has(s.preferred) && uses.get(s.preferred) === 0 && [s.gender, null].includes(voiceGender(s.preferred))) id = s.preferred
    if (!id) {
      const start = parseInt(sha1(s.key).slice(0, 8), 16) % pool.length
      const least = Math.min(...pool.map((v) => uses.get(v.id)!))
      for (let i = 0; i < pool.length && !id; i++) {
        const v = pool[(start + i) % pool.length]!
        if (uses.get(v.id) === least) id = v.id
      }
    }
    out[s.key] = id!
    uses.set(id!, uses.get(id!)! + 1)
  }
  return out
}

/** The languages a project speaks: `voice.langs`, else its primary language. */
export const voiceLangsOf = (settings: Pick<ProjectSettings, 'primaryLang' | 'voice'>): Lang[] => (settings.voice.langs.length ? settings.voice.langs : [settings.primaryLang])

/** The voice list as the voice-director prompt shows it: per language, the voices that can read it with their gender. */
export function describeVoices(voices: readonly VibeVoice[], langs: readonly Lang[], englishEngine: EnglishEngine = 'kokoro'): string {
  return langs
    .map((lang) => {
      const list = voicesFor(voices, lang, englishEngine)
      return `${lang}: ${list.length ? list.map((v) => `${v.id} (${voiceGender(v.id) ?? 'any'}, ${v.label})`).join('; ') : '(no voice reads this language)'}`
    })
    .join('\n')
}
