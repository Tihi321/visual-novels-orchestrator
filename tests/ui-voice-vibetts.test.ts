import { describe, expect, it } from 'vitest'
import { reduceVn, initialVn } from '../src/renderer/store/vn'
import { vibettsSupport, voiceOptions, voiceProgress, voiceSupport } from '../src/renderer/lib/voice'

describe('VibeTTS voice tab helpers', () => {
  it('says Croatian is supported by VibeTTS (and still not by the ComfyUI workflows)', () => {
    expect(vibettsSupport('hr').status).toBe('ok')
    expect(vibettsSupport('en').status).toBe('ok')
    expect(vibettsSupport('hr').message).not.toContain('not supported')
    expect(voiceSupport('custom:chatterbox', 'hr', [{ name: 'chatterbox', kind: 'audio', languages: ['en'] }]).message).toContain('Croatian is not supported yet')
  })
  it('offers the OmniVoice presets, and keeps a voice VibeTTS no longer lists', () => {
    const voices = [
      { id: 'af_heart', kind: '', description: '' },
      { id: 'omni:default', kind: 'default', description: '' },
      { id: 'omni:petra', kind: 'description', description: 'female, teenager' }
    ]
    expect(voiceOptions(voices, 'omni:petra')).toEqual([
      { id: 'omni:default', label: 'default' },
      { id: 'omni:petra', label: 'petra (female, teenager)' }
    ])
    expect(voiceOptions(voices, 'omni:gone').at(-1)).toEqual({ id: 'omni:gone', label: 'omni:gone (not in VibeTTS)' })
  })
  it('shows progress only while the voice step runs', () => {
    expect(voiceProgress(undefined)).toBeNull()
    expect(voiceProgress({ status: 'done', message: 'x' })).toBeNull()
    expect(voiceProgress({ status: 'running', message: 'voice en: 5/20 clips', done: 5, total: 20 })).toEqual({ text: 'voice en: 5/20 clips', fraction: 0.25 })
    expect(voiceProgress({ status: 'running', message: 'planning' })?.fraction).toBeNull()
  })
  it('keeps the VibeTTS status and the last preview per speaker in the store', () => {
    const s = initialVn()
    const a = reduceVn(s, { type: 'voice.status', ok: false, url: 'http://x/mcp', error: 'not running', omniInstalled: false, voices: [] })
    expect(a.vibetts).toEqual({ ok: false, url: 'http://x/mcp', error: 'not running', omniInstalled: false, voices: [] })
    const b = reduceVn(s, { type: 'voice.preview', slug: 'b', speakerKey: 'petra', voice: 'omni:petra', file: 'preview/voice-petra.mp3', rev: 5, description: 'female', seed: 3, lang: 'en' })
    expect(b.voicePreviews?.['b:petra']).toMatchObject({ voice: 'omni:petra', file: 'preview/voice-petra.mp3', rev: 5, seed: 3 })
  })
})
