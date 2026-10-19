import { describe, expect, it } from 'vitest'
import { describeVoices, guessGender, parseGender, pickVoices, readsLang, voiceGender, voiceLangsOf, voicesFor } from '../src/engine/voice/catalog'
import { slugVoiceName } from '../src/engine/voice/vocab'
import { planVoicesSchema, speakerOf } from '../src/engine/vn/agents/voice-director'
import { projectSettingsSchema } from '../src/shared/vn'
import type { VibeVoice } from '../src/engine/voice/vibetts'

const ALL_LANGS = ['en', 'hr', 'de']
const kokoro = (id: string): VibeVoice => ({ id, label: id, engine: 'kokoro', languages: ['en'] })
const supertonic = (id: string): VibeVoice => ({ id: `supertonic:${id}`, label: id, engine: 'supertonic', languages: ALL_LANGS })
const VOICES: VibeVoice[] = [
  ...['af_heart', 'af_bella', 'bf_emma', 'am_adam', 'bm_george'].map(kokoro),
  ...['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map(supertonic)
]

describe('voice gender and the language filter', () => {
  it('reads the gender from Kokoro and Supertonic ids', () => {
    expect(voiceGender('af_heart')).toBe('female')
    expect(voiceGender('bf_emma')).toBe('female')
    expect(voiceGender('am_adam')).toBe('male')
    expect(voiceGender('bm_george')).toBe('male')
    expect(voiceGender('supertonic:F3')).toBe('female')
    expect(voiceGender('supertonic:M5')).toBe('male')
    expect(voiceGender('omni:petra')).toBeNull()
    expect(parseGender(' Female ')).toBe('female')
    expect(parseGender('man')).toBe('male')
    expect(parseGender('robot')).toBeNull()
  })
  it('English uses the chosen engine, other languages Supertonic', () => {
    expect(voicesFor(VOICES, 'en').every((v) => v.engine === 'kokoro')).toBe(true)
    expect(voicesFor(VOICES, 'en', 'supertonic').every((v) => v.engine === 'supertonic')).toBe(true)
    expect(voicesFor(VOICES, 'hr', 'kokoro').every((v) => v.engine === 'supertonic')).toBe(true)
    expect(voicesFor(VOICES, 'fr')).toEqual([])
    // no Kokoro voice listed: any voice that reads English
    expect(voicesFor(VOICES.filter((v) => v.engine === 'supertonic'), 'en', 'kokoro')).toHaveLength(10)
    expect(readsLang(VOICES, 'af_heart', 'hr')).toBe(false)
    expect(readsLang(VOICES, 'supertonic:F1', 'hr')).toBe(true)
    expect(readsLang(VOICES, 'supertonic:Z9', 'hr')).toBe(false)
  })
  it('lists the voices per language for the prompt', () => {
    const text = describeVoices(VOICES.slice(0, 1).concat(VOICES.slice(5, 6)), ['en', 'hr'])
    expect(text).toContain('en: af_heart (female, af_heart)')
    expect(text).toContain('hr: supertonic:F1 (female, F1)')
    expect(describeVoices(VOICES.slice(0, 1), ['hr'])).toContain('(no voice reads this language)')
  })
})

describe('guessGender', () => {
  const h = (looks: string, voiceHint = '', key = 'x') => ({ key, name: key, looks, voiceHint })
  it('reads the bible, and gives the narrator a female voice and others a stable one', () => {
    expect(guessGender(h('Seventeen, the keeper’s daughter'))).toBe('female')
    expect(guessGender(h('An old fisherman, he is 70 years old'))).toBe('male')
    expect(guessGender(h('', '', 'narrator'))).toBe('female')
    expect(guessGender(h('a shape in the fog', '', 'ghost'))).toBe(guessGender(h('a shape in the fog', '', 'ghost')))
  })
})

describe('pickVoices', () => {
  const kokoroVoices = VOICES.filter((v) => v.engine === 'kokoro')
  const st = VOICES.filter((v) => v.engine === 'supertonic')
  it('is deterministic, matches the gender and spreads the cast', () => {
    const cast = [
      { key: 'mara', gender: 'female' as const },
      { key: 'tomas', gender: 'male' as const },
      { key: 'ivo', gender: 'male' as const },
      { key: 'narrator', gender: 'female' as const }
    ]
    const a = pickVoices(cast, st)
    expect(pickVoices(cast, st)).toEqual(a)
    expect(voiceGender(a.mara!)).toBe('female')
    expect(voiceGender(a.tomas!)).toBe('male')
    expect(a.tomas).not.toBe(a.ivo)
    expect(a.narrator).not.toBe(a.mara) // a free female voice exists
    expect(new Set(Object.values(a)).size).toBe(4)
    for (const v of Object.values(pickVoices(cast, kokoroVoices))) expect(kokoroVoices.map((k) => k.id)).toContain(v)
  })
  it('reuses voices round-robin when a gender runs out', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, gender: 'female' as const }))
    const a = pickVoices(many, st)
    const counts = new Map<string, number>()
    for (const v of Object.values(a)) counts.set(v, (counts.get(v) ?? 0) + 1)
    expect([...counts.keys()].every((id) => voiceGender(id) === 'female')).toBe(true)
    expect(counts.size).toBe(5)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3)
  })
  it('honours a preferred voice that is a free candidate, and avoids taken ones', () => {
    const a = pickVoices([{ key: 'mara', gender: 'female', preferred: 'supertonic:F4' }], st)
    expect(a.mara).toBe('supertonic:F4')
    const b = pickVoices([{ key: 'mara', gender: 'female', preferred: 'supertonic:F4' }], st, ['supertonic:F4'])
    expect(b.mara).not.toBe('supertonic:F4')
    const c = pickVoices([{ key: 'mara', gender: 'female', preferred: 'af_heart' }], st) // not a candidate
    expect(c.mara).toMatch(/^supertonic:F/)
    expect(pickVoices([{ key: 'tomas', gender: 'male', preferred: 'supertonic:F4' }], st).tomas).toMatch(/^supertonic:M/) // wrong gender
    expect(pickVoices([{ key: 'mara', gender: 'female' }], [])).toEqual({})
  })
})

describe('voice-director answer and project settings', () => {
  it('parses the new answer and the old one (voiceRefId, description and seed)', () => {
    const r = planVoicesSchema.parse({ voices: [{ speakerKey: 'mara', gender: 'female', voices: { en: 'af_heart', hr: 'supertonic:F2' }, description: 'bright' }, { voiceRefId: 'voice_tomas', voiceName: 'tomas', description: 'male', seed: 4 }] })
    expect(r.voices.map(speakerOf)).toEqual(['mara', 'tomas'])
    expect(r.voices[0]!.voices).toEqual({ en: 'af_heart', hr: 'supertonic:F2' })
  })
  it('migrates the old one-id-per-speaker voices', () => {
    const base = { slug: 's', source: 'x', primaryLang: 'en' }
    const old = projectSettingsSchema.parse({ ...base, voice: { enabled: true, voices: { narrator: 'omni:petra', mara: 'supertonic:F2', tomas: 'am_adam', ivo: { en: 'af_heart', hr: 'supertonic:M1' } } } })
    expect(old.voice.voices).toEqual({ mara: { en: 'supertonic:F2', hr: 'supertonic:F2' }, tomas: { en: 'am_adam' }, ivo: { en: 'af_heart', hr: 'supertonic:M1' } })
    expect(old.voice.englishEngine).toBeUndefined()
    expect(projectSettingsSchema.parse(base).voice.voices).toEqual({}) // no voice block
  })
  it('knows the voice languages of a project', () => {
    expect(voiceLangsOf({ primaryLang: 'hr', voice: { langs: [] } } as never)).toEqual(['hr'])
    expect(voiceLangsOf({ primaryLang: 'hr', voice: { langs: ['en', 'hr'] } } as never)).toEqual(['en', 'hr'])
    expect(slugVoiceName('Mara Čuvar!')).toBe('mara-cuvar')
  })
})
