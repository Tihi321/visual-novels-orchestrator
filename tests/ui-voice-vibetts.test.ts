import { describe, expect, it } from 'vitest'
import { reduceVn, initialVn } from '../src/renderer/store/vn'
import { vibettsSupport, voiceOptions, voiceProgress, voiceSupport } from '../src/renderer/lib/voice'

const status = {
  ok: true,
  supertonicInstalled: true,
  voices: [
    { id: 'af_heart', label: 'Heart (American English, female)', engine: 'kokoro', languages: ['en'] },
    { id: 'am_adam', label: 'Adam (American English, male)', engine: 'kokoro', languages: ['en'] },
    { id: 'supertonic:F1', label: 'F1 (Supertonic, female)', engine: 'supertonic', languages: ['en', 'hr'] },
    { id: 'supertonic:M1', label: 'M1 (Supertonic, male)', engine: 'supertonic', languages: ['en', 'hr'] }
  ]
}

describe('VibeTTS voice tab helpers', () => {
  it('says per language whether VibeTTS has a voice for it (and still not the ComfyUI workflows for Croatian)', () => {
    expect(vibettsSupport(status, 'hr').status).toBe('ok')
    expect(vibettsSupport(status, 'en').status).toBe('ok')
    expect(vibettsSupport(null, 'hr').status).toBe('unknown')
    const kokoroOnly = { ok: true, supertonicInstalled: false, voices: status.voices.slice(0, 2) }
    const hr = vibettsSupport(kokoroOnly, 'hr')
    expect(hr.status).toBe('unsupported')
    expect(hr.message).toContain('Download Supertonic')
    expect(vibettsSupport(kokoroOnly, 'en').status).toBe('ok')
    expect(voiceSupport('custom:chatterbox', 'hr', [{ name: 'chatterbox', kind: 'audio', languages: ['en'] }]).message).toContain('Croatian is not supported yet')
  })
  it('offers the voices that read the language, by engine for English, and keeps a voice VibeTTS no longer lists', () => {
    expect(voiceOptions(status, 'en', 'kokoro', 'af_heart').map((o) => o.id)).toEqual(['af_heart', 'am_adam'])
    expect(voiceOptions(status, 'en', 'supertonic', undefined).map((o) => o.id)).toEqual(['supertonic:F1', 'supertonic:M1'])
    expect(voiceOptions(status, 'hr', 'kokoro', 'supertonic:F1')).toEqual([
      { id: 'supertonic:F1', label: 'F1 (Supertonic, female)' },
      { id: 'supertonic:M1', label: 'M1 (Supertonic, male)' }
    ])
    expect(voiceOptions(status, 'hr', 'kokoro', 'af_heart').at(-1)).toEqual({ id: 'af_heart', label: 'af_heart (not in VibeTTS for hr)' })
    expect(voiceOptions(null, 'en', 'kokoro', undefined)).toEqual([])
  })
  it('shows progress only while the voice step runs', () => {
    expect(voiceProgress(undefined)).toBeNull()
    expect(voiceProgress({ status: 'done', message: 'x' })).toBeNull()
    expect(voiceProgress({ status: 'running', message: 'voice en: 5/20 clips', done: 5, total: 20 })).toEqual({ text: 'voice en: 5/20 clips', fraction: 0.25 })
    expect(voiceProgress({ status: 'running', message: 'planning' })?.fraction).toBeNull()
  })
  it('keeps the VibeTTS status and the last preview per speaker and language in the store', () => {
    const s = initialVn()
    const none = { engine: '', language: '', voice: '' }
    const a = reduceVn(s, { type: 'voice.status', ok: false, url: 'http://x/mcp', error: 'not running', supertonicInstalled: false, languages: [], english: none, other: none, voices: [] })
    expect(a.vibetts).toEqual({ ok: false, url: 'http://x/mcp', error: 'not running', supertonicInstalled: false, languages: [], english: none, other: none, voices: [] })
    const b = reduceVn(s, { type: 'voice.preview', slug: 'b', speakerKey: 'petra', voice: 'supertonic:F2', file: 'preview/voice-petra.mp3', rev: 5, lang: 'hr' })
    expect(b.voicePreviews?.['b:petra:hr']).toMatchObject({ voice: 'supertonic:F2', file: 'preview/voice-petra.mp3', rev: 5, lang: 'hr' })
  })
})
