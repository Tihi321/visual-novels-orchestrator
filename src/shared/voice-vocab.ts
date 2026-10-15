/** The words OmniVoice (VibeTTS `create_voice`) accepts in a voice description, one per category at most. */
export const VOICE_VOCAB = {
  gender: ['male', 'female'],
  age: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'],
  pitch: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'],
  style: ['whisper']
} as const

export type VoiceCategory = keyof typeof VOICE_VOCAB

export const VOICE_CATEGORIES = Object.keys(VOICE_VOCAB) as VoiceCategory[]

/** The words of a description by category (words that are not in the vocabulary are dropped). */
export function parseDescription(description: string): Partial<Record<VoiceCategory, string>> {
  const out: Partial<Record<VoiceCategory, string>> = {}
  for (const part of description.toLowerCase().split(',')) {
    const w = part.trim()
    const cat = VOICE_CATEGORIES.find((c) => (VOICE_VOCAB[c] as readonly string[]).includes(w))
    if (cat && !out[cat]) out[cat] = w
  }
  return out
}

/** `female, young adult, low pitch` from the chosen word of each category (empty ones are left out). */
export function buildDescription(parts: Partial<Record<VoiceCategory, string>>): string {
  return VOICE_CATEGORIES.flatMap((c) => (parts[c] ? [parts[c]!] : [])).join(', ')
}
