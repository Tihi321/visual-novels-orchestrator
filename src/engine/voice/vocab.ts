import { createHash } from 'node:crypto'
import { VOICE_VOCAB } from '../../shared/voice-vocab'
import type { VoiceCategory } from '../../shared/voice-vocab'

export { VOICE_VOCAB } from '../../shared/voice-vocab'
export type { VoiceCategory } from '../../shared/voice-vocab'
const CATEGORIES = Object.keys(VOICE_VOCAB) as VoiceCategory[]
export const MAX_SEED = 2 ** 31 - 1
export const MAX_VOICE_NAME = 32

/** Common near-misses a model writes, mapped to the allowed word. */
const SYNONYMS: Record<string, string> = {
  woman: 'female', girl: 'female', feminine: 'female', lady: 'female',
  man: 'male', boy: 'male', masculine: 'male', gentleman: 'male',
  kid: 'child', young: 'young adult', teen: 'teenager', adolescent: 'teenager',
  'middle aged': 'middle-aged', 'middle-age': 'middle-aged', adult: 'young adult', old: 'elderly', aged: 'elderly',
  low: 'low pitch', deep: 'low pitch', 'very deep': 'very low pitch', 'very low': 'very low pitch',
  high: 'high pitch', 'very high': 'very high pitch', moderate: 'moderate pitch', medium: 'moderate pitch', 'medium pitch': 'moderate pitch',
  whispered: 'whisper', whispering: 'whisper', whispery: 'whisper', hushed: 'whisper'
}

export interface VoiceSpec {
  /** Comma-separated allowed words, e.g. `female, young adult, low pitch`. */
  description: string
  seed: number
}

const categoryOf = (word: string): VoiceCategory | null => CATEGORIES.find((c) => (VOICE_VOCAB[c] as readonly string[]).includes(word)) ?? null

/** Keeps only the allowed words (synonyms mapped), at most one per category, in category order. */
export function sanitizeDescription(raw: string): string {
  const picked: Partial<Record<VoiceCategory, string>> = {}
  for (const part of String(raw ?? '').toLowerCase().split(/[,;]|\band\b/)) {
    const w = part.trim().replace(/\s+/g, ' ')
    if (!w) continue
    const word = categoryOf(w) ? w : (SYNONYMS[w] ?? '')
    const cat = word ? categoryOf(word) : null
    if (cat && !picked[cat]) picked[cat] = word
  }
  return CATEGORIES.flatMap((c) => (picked[c] ? [picked[c]!] : [])).join(', ')
}

/** A valid seed: an integer 0..2^31-1, else the fallback. */
export function sanitizeSeed(seed: unknown, fallback: number): number {
  const n = typeof seed === 'number' ? seed : Number.NaN
  return Number.isInteger(n) && n >= 0 && n <= MAX_SEED ? n : fallback
}

/** A voice name for VibeTTS: lower case [a-z0-9_-], at most 32 characters, not `default`. Empty when nothing is left. */
export function slugVoiceName(raw: string): string {
  const ascii = String(raw ?? '')
    .replace(/đ/gi, 'dj')
    .normalize('NFKD')
    .replace(/[^ -~]/g, '')
  const name = ascii
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_VOICE_NAME)
    .replace(/^[-_]+|[-_]+$/g, '')
  return name === 'default' ? '' : name
}

/** A stable seed from a text (the deterministic fallback, so the same character gets the same voice again). */
export function seedFrom(text: string): number {
  return createHash('sha1').update(text).digest().readUInt32BE(0) % 1_000_000
}

const WORDS = (s: string, ...res: RegExp[]): boolean => res.some((r) => r.test(s))

function ageFromNumber(text: string): string | null {
  const m = /(\d{1,3})[\s-]*(?:years?[\s-]*old|yo\b|god(?:ina|ine)?\b)|\baged?\s+(\d{1,3})\b|\bof\s+about\s+(\d{1,3})\b/i.exec(text)
  const n = m ? Number(m[1] ?? m[2] ?? m[3]) : Number.NaN
  if (!Number.isFinite(n)) return null
  return n < 13 ? 'child' : n < 20 ? 'teenager' : n < 36 ? 'young adult' : n < 60 ? 'middle-aged' : 'elderly'
}

/** What the bible says about a speaker, for the deterministic voice. */
export interface VoiceHints {
  key: string
  name: string
  looks: string
  voiceHint: string
}

/** A description from the bible text alone (used when the voice-director does not answer, and to fill what it left out). */
export function fallbackSpec(h: VoiceHints, narrator = h.key === 'narrator'): VoiceSpec {
  const text = `${h.looks} ${h.voiceHint}`.toLowerCase()
  const parts: string[] = []
  let gender = ''
  if (WORDS(text, /\b(she|her|hers|girl|woman|female|mother|lady|daughter|sister|queen|princess|witch|djevojk\w*|žen\w*|majk\w*|kći|sestr\w*)\b/)) gender = 'female'
  else if (WORDS(text, /\b(he|his|him|boy|man|male|father|gentleman|son|brother|king|prince|wizard|dječak\w*|muškar\w*|otac|brat\w*|sin)\b/)) gender = 'male'
  if (narrator && !gender) gender = 'female'
  let age = ageFromNumber(text) ?? ''
  if (age) {
    /* "ten years old", "aged 70" */
  } else if (WORDS(text, /\b(child|kid|toddler|little (?:girl|boy)|small (?:girl|boy)|dijete|mali|mala)\b/)) age = 'child'
  else if (WORDS(text, /\b(teen|teenager|teenage|adolescent|tinejdžer\w*)\b/)) age = 'teenager'
  else if (WORDS(text, /\b(thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/)) age = 'teenager'
  else if (WORDS(text, /\b(five|six|seven|eight|nine|ten|eleven|twelve)[- ]years?[- ]old\b/)) age = 'child'
  else if (WORDS(text, /\b(elderly|old|aged|ancient|grand(?:mother|father|ma|pa)|stari|starica|starac)\b/)) age = 'elderly'
  else if (WORDS(text, /\b(middle[- ]aged)\b/)) age = 'middle-aged'
  else if (WORDS(text, /\b(young|youth|twenties|mlad\w*)\b/)) age = 'young adult'
  age ||= narrator ? 'middle-aged' : 'young adult'
  // pitch and whisper come from the bible's voice notes only (hair "light" or eyes "bright" are not about the voice)
  const voiceText = h.voiceHint.toLowerCase()
  let pitch = ''
  if (WORDS(voiceText, /\b(deep|bass|gravel\w*|rumbl\w*|booming|dubok\w*)\b/)) pitch = 'very low pitch'
  else if (WORDS(voiceText, /\b(low|husky|hoarse|smoky|nizak|niski)\b/)) pitch = 'low pitch'
  else if (WORDS(voiceText, /\b(squeak\w*|shrill|piping)\b/)) pitch = 'very high pitch'
  else if (WORDS(voiceText, /\b(high|bright|light|soprano|visok\w*)\b/) || age === 'child') pitch = 'high pitch'
  else if (narrator) pitch = 'moderate pitch'
  if (gender) parts.push(gender)
  parts.push(age)
  if (pitch) parts.push(pitch)
  if (WORDS(voiceText, /\b(whisper\w*|hushed|šapat\w*)\b/)) parts.push('whisper')
  return { description: sanitizeDescription(parts.join(', ')), seed: seedFrom(`${h.key}|${h.name}|${h.looks}`) }
}

/** The model's description, cleaned; a missing gender or age is filled from the deterministic one. */
export function completeSpec(raw: { description?: string; seed?: unknown }, hints: VoiceHints): VoiceSpec {
  const fb = fallbackSpec(hints)
  const clean = sanitizeDescription(raw.description ?? '')
  const have = new Set(clean.split(', ').filter(Boolean).map((w) => categoryOf(w)))
  const extra = fb.description.split(', ').filter((w) => {
    const c = categoryOf(w)
    return (c === 'gender' || c === 'age') && !have.has(c)
  })
  return { description: sanitizeDescription([clean, ...extra].filter(Boolean).join(', ')), seed: sanitizeSeed(raw.seed, fb.seed) }
}

/** A VibeTTS voice name for a speaker of a book: the model's choice when usable, else `<book>-<key>`. */
export function voiceNameFor(bookSlug: string, speakerKey: string, proposed?: string): string {
  const own = slugVoiceName(proposed ?? '')
  if (own) return own
  const prefix = slugVoiceName(bookSlug).slice(0, 14).replace(/-+$/, '')
  return slugVoiceName(`${prefix}-${speakerKey}`) || slugVoiceName(speakerKey) || 'voice'
}

/** `name`, or `name-2`, `name-3` ... the first not in `taken`. Stays within 32 characters. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`
    const n = name.slice(0, MAX_VOICE_NAME - suffix.length).replace(/[-_]+$/, '') + suffix
    if (!taken.has(n)) return n
  }
  return `${name.slice(0, 24)}-${Date.now().toString(36)}`
}

export const vocabularyText = (): string => CATEGORIES.map((c) => `${c}: ${VOICE_VOCAB[c].join(' | ')}`).join('; ')

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')
