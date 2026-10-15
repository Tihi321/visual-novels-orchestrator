import { describe, expect, it } from 'vitest'
import { VOICE_VOCAB, buildDescription, parseDescription } from '../src/shared/voice-vocab'
import { completeSpec, fallbackSpec, sanitizeDescription, sanitizeSeed, slugVoiceName, uniqueName, voiceNameFor } from '../src/engine/voice/vocab'
import { planVoicesSchema, speakerOf } from '../src/engine/vn/agents/voice-director'

const ALLOWED = new Set(Object.values(VOICE_VOCAB).flat() as string[])
const allAllowed = (d: string) => d.split(', ').filter(Boolean).every((w) => ALLOWED.has(w))

describe('voice description', () => {
  it('keeps only the allowed words, one per category, in category order', () => {
    expect(sanitizeDescription('Young adult, female, low pitch')).toBe('female, young adult, low pitch')
    expect(sanitizeDescription('female, male, child, teenager, high pitch, low pitch, whisper')).toBe('female, child, high pitch, whisper')
    expect(sanitizeDescription('a warm gravelly baritone, with an accent')).toBe('')
    expect(sanitizeDescription('')).toBe('')
  })
  it('maps the usual near-misses', () => {
    expect(sanitizeDescription('woman, middle aged, deep')).toBe('female, middle-aged, low pitch')
    expect(sanitizeDescription('boy and old')).toBe('male, elderly')
    expect(sanitizeDescription('girl; teen; very high')).toBe('female, teenager, very high pitch')
  })
  it('always gives only allowed words', () => {
    for (const raw of ['loud, angry', 'FEMALE,  Young Adult ', 'british accent, male', ',,,']) expect(allAllowed(sanitizeDescription(raw))).toBe(true)
  })
  it('builds and parses a description for the designer', () => {
    expect(buildDescription({ gender: 'male', pitch: 'low pitch', age: 'elderly' })).toBe('male, elderly, low pitch')
    expect(parseDescription('male, elderly, wobbly, low pitch')).toEqual({ gender: 'male', age: 'elderly', pitch: 'low pitch' })
  })
  it('validates the seed', () => {
    expect(sanitizeSeed(7, 1)).toBe(7)
    for (const bad of [-1, 1.5, 2 ** 31, 'x', null, undefined]) expect(sanitizeSeed(bad, 42)).toBe(42)
  })
})

describe('voice names', () => {
  it('makes a VibeTTS name: [a-z0-9_-], at most 32, never default', () => {
    expect(slugVoiceName('Petra the Brave!')).toBe('petra-the-brave')
    expect(slugVoiceName('Đurđa')).toBe('djurdja')
    expect(slugVoiceName('x'.repeat(40))).toHaveLength(32)
    expect(slugVoiceName('default')).toBe('')
    expect(slugVoiceName('***')).toBe('')
  })
  it('falls back to <book>-<key> and avoids names that are taken', () => {
    expect(voiceNameFor('the-soother-en', 'petra')).toBe('the-soother-en-petra')
    expect(voiceNameFor('b', 'petra', 'Old Fisherman')).toBe('old-fisherman')
    expect(voiceNameFor('b', 'petra', 'default')).toBe('b-petra')
    expect(uniqueName('petra', new Set(['petra', 'petra-2']))).toBe('petra-3')
    expect(uniqueName('x'.repeat(32), new Set(['x'.repeat(32)]))).toHaveLength(32)
  })
})

describe('deterministic voices from the bible', () => {
  const mara = { key: 'mara', name: 'Mara', looks: 'Seventeen, small and wiry, dark curly hair, grey eyes. The lighthouse keeper’s daughter.', voiceHint: 'short sentences, dry jokes' }
  it('reads gender and age from the looks', () => {
    expect(fallbackSpec(mara).description).toBe('female, teenager')
    expect(fallbackSpec({ key: 'a', name: 'A', looks: 'A little girl of about nine', voiceHint: '' }).description).toBe('female, child, high pitch')
    expect(fallbackSpec({ key: 'b', name: 'B', looks: 'He is an old fisherman, 70 years old', voiceHint: 'deep and slow' }).description).toBe('male, elderly, very low pitch')
    expect(fallbackSpec({ key: 'c', name: 'C', looks: 'Ten years old, she plays', voiceHint: '' }).description).toBe('female, child, high pitch')
  })
  it('does not take the pitch from the looks (light hair, bright eyes)', () => {
    expect(fallbackSpec({ key: 'd', name: 'D', looks: 'A woman with light hair and bright eyes', voiceHint: '' }).description).toBe('female, young adult')
  })
  it('gives the narrator a calm middle-aged voice, and is stable', () => {
    const n = { key: 'narrator', name: 'Narrator', looks: '', voiceHint: '' }
    expect(fallbackSpec(n).description).toBe('female, middle-aged, moderate pitch')
    expect(fallbackSpec(n)).toEqual(fallbackSpec(n))
    expect(fallbackSpec(mara).seed).toBe(fallbackSpec(mara).seed)
    expect(fallbackSpec(mara).seed).not.toBe(fallbackSpec({ ...mara, key: 'tomas', name: 'Tomas' }).seed)
  })
  it('sanitizes the voice-director answer and fills a missing gender or age from the bible', () => {
    const s = completeSpec({ description: 'gravelly, high pitch, whisper', seed: -3 }, mara)
    expect(s.description).toBe('female, teenager, high pitch, whisper')
    expect(allAllowed(s.description)).toBe(true)
    expect(s.seed).toBe(fallbackSpec(mara).seed)
    expect(completeSpec({ description: 'male, elderly', seed: 12 }, mara)).toEqual({ description: 'male, elderly', seed: 12 })
  })
  it('reads the old and the new answer shape', () => {
    const r = planVoicesSchema.parse({ voices: [{ speakerKey: 'mara', description: 'female' }, { voiceRefId: 'voice_narrator', description: 'male', suggestedRef: null }] })
    expect(r.voices.map(speakerOf)).toEqual(['mara', 'narrator'])
    expect(r.voices[0]!.voiceName).toBe('')
  })
})
