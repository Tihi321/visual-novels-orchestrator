import { describe, expect, it } from 'vitest'
import { ambienceChoices, engineChoices, sfxChoices, ttsChoices } from '../src/renderer/lib/engines'
import { engineReadsLang, ttsEngineLabel, ttsSupport } from '../src/renderer/lib/voice'
import { initialVn, reduceVn } from '../src/renderer/store/vn'
import type { CustomWorkflowInfo, EngineEvent, EngineInfo, VoiceEngineView } from '../src/shared/protocol'

const audioEng = (id: string, task: EngineInfo['task'], languages: EngineInfo['languages'] = []): EngineInfo => ({ id, kind: 'audio', label: id.toUpperCase(), edit: false, task, languages })

/** The engines `listEngines` reports: music, the sound-effect engine and the voice engines, in registry order. */
const audio: EngineInfo[] = [
  audioEng('ace-step-v1', 'music'),
  audioEng('yue2', 'music'),
  audioEng('moss-soundeffect-v2', 'sfx'),
  audioEng('omnivoice', 'tts', '*'),
  audioEng('higgs-audio-v3', 'tts', '*'),
  audioEng('chatterbox-23lang', 'tts', ['en', 'de']),
  audioEng('f5-tts', 'tts', ['en'])
]

/** `voiceStatus` reports the same TTS/SFX engines with their readiness. */
const voiceEngines: VoiceEngineView[] = [
  { id: 'omnivoice', label: 'OmniVoice (600+ languages)', task: 'tts', languages: '*', ready: true, missing: [] },
  { id: 'higgs-audio-v3', label: 'Higgs Audio v3 (100+ languages)', task: 'tts', languages: '*', ready: true, missing: [] },
  { id: 'chatterbox-23lang', label: 'Chatterbox 23 languages', task: 'tts', languages: ['en', 'de'], ready: true, missing: [] },
  { id: 'f5-tts', label: 'F5-TTS (10 languages, cloning)', task: 'tts', languages: ['en'], ready: false, missing: ['node:F5TTSEngineNode'] },
  { id: 'moss-soundeffect-v2', label: 'MOSS-SoundEffect v2 (sound effects)', task: 'sfx', languages: [], ready: true, missing: [] }
]

const workflows: CustomWorkflowInfo[] = [
  { name: 'chatterbox', kind: 'audio', languages: ['en', 'de'] },
  { name: 'song', kind: 'audio', languages: [] },
  { name: 'pic', kind: 'image', languages: [] }
]

describe('ttsChoices', () => {
  it('offers only the local voice engines, in registry order, then the custom TTS workflows', () => {
    expect(ttsChoices(audio, workflows).map((c) => c.id)).toEqual(['omnivoice', 'higgs-audio-v3', 'chatterbox-23lang', 'f5-tts', 'custom:chatterbox'])
    expect(ttsChoices(audio, workflows).find((c) => c.id === 'custom:chatterbox')?.label).toBe('custom: chatterbox')
  })
  it('keeps the current engine last, without duplicating one the list has', () => {
    expect(ttsChoices(audio, workflows, 'f5-tts').map((c) => c.id)).toEqual(['omnivoice', 'higgs-audio-v3', 'chatterbox-23lang', 'f5-tts', 'custom:chatterbox'])
    expect(ttsChoices(audio, workflows, 'old').at(-1)).toEqual({ id: 'old', label: 'old' })
    expect(ttsChoices(audio, workflows, 'custom:chatterbox').at(-1)?.id).toBe('custom:chatterbox')
  })
  it('offers the current engine before the lists are known', () => {
    expect(ttsChoices(null, [], 'omnivoice').map((c) => c.id)).toEqual(['omnivoice'])
  })
})

describe('engineChoices by task', () => {
  const lists = { image: [] as EngineInfo[], audio }
  it('offers music engines only for music and ambience (no speech, no sound-effect engine)', () => {
    expect(engineChoices('music', lists, workflows).map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'custom:song'])
    expect(engineChoices('ambience', lists, workflows).map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'custom:song'])
  })
  it('offers MOSS for a sound effect, but never a speech engine', () => {
    expect(engineChoices('sfx', lists, workflows).map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'moss-soundeffect-v2', 'custom:song'])
    expect(engineChoices('sfx', lists, workflows)).not.toContainEqual(expect.objectContaining({ id: 'omnivoice' }))
  })
})

describe('sfxChoices and ambienceChoices', () => {
  const lists = { image: [] as EngineInfo[], audio }
  it('adds Chiptune Studio for a sound effect and keeps the current engine last', () => {
    expect(sfxChoices(lists, workflows).map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'moss-soundeffect-v2', 'custom:song', 'chiptune'])
    expect(sfxChoices(lists, workflows, 'chiptune').map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'moss-soundeffect-v2', 'custom:song', 'chiptune'])
    expect(sfxChoices(lists, workflows, 'old').at(-1)).toEqual({ id: 'old', label: 'old' })
  })
  it('offers the music engines and Chiptune Studio for an ambience (not MOSS, the effect engine)', () => {
    expect(ambienceChoices(lists, workflows).map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'custom:song', 'chiptune'])
    expect(ambienceChoices(lists, workflows, 'ace-step-v1').map((c) => c.id)).toEqual(['ace-step-v1', 'yue2', 'custom:song', 'chiptune'])
  })
  it('works before the engines are known', () => {
    expect(sfxChoices(null, [], 'moss-soundeffect-v2').map((c) => c.id)).toEqual(['chiptune', 'moss-soundeffect-v2'])
    expect(ambienceChoices(null, [], 'ace-step-v1').map((c) => c.id)).toEqual(['chiptune', 'ace-step-v1'])
  })
})

describe('ttsSupport', () => {
  it('accepts the language an engine reads (any language for OmniVoice and Higgs)', () => {
    const omni = ttsSupport('omnivoice', 'hr', voiceEngines, workflows)
    expect(omni.status).toBe('ok')
    expect(omni.supported).toEqual([])
    expect(omni.message).toContain('any language')
    expect(ttsSupport('higgs-audio-v3', 'hr', voiceEngines, workflows).status).toBe('ok')
  })
  it('says which languages an engine reads, with the Croatian hint, instead of failing later', () => {
    const hr = ttsSupport('chatterbox-23lang', 'hr', voiceEngines, workflows)
    expect(hr.status).toBe('unsupported')
    expect(hr.supported).toEqual(['en', 'de'])
    expect(hr.message).toContain('not Croatian')
    expect(hr.message).toContain('Croatian works with OmniVoice')
  })
  it('still supports a language when only the TTS Audio Suite nodes are missing, and says so', () => {
    const f5 = ttsSupport('f5-tts', 'en', voiceEngines, workflows)
    expect(f5.status).toBe('ok')
    expect(f5.message).toContain('nodes are missing')
    expect(f5.message).toContain('node:F5TTSEngineNode')
    expect(f5.message).toContain('TTS Audio Suite')
  })
  it('answers a custom TTS workflow through voiceSupport', () => {
    const custom = ttsSupport('custom:chatterbox', 'hr', voiceEngines, workflows)
    expect(custom.status).toBe('unsupported')
    expect(custom.supported).toEqual(['en', 'de'])
    expect(custom.message).toContain('Croatian is not supported yet')
    expect(ttsSupport('custom:chatterbox', 'en', voiceEngines, workflows).status).toBe('ok')
    expect(ttsSupport('custom:nope', 'en', voiceEngines, workflows).status).toBe('unknown')
  })
  it('reports an absent, unknown or unchecked engine', () => {
    expect(ttsSupport(undefined, 'en', voiceEngines, workflows).status).toBe('no-engine')
    expect(ttsSupport('ghost', 'en', voiceEngines, workflows).status).toBe('unknown')
    expect(ttsSupport('omnivoice', 'en', null, workflows).status).toBe('unknown')
    expect(ttsSupport('omnivoice', 'en', [], workflows).status).toBe('unknown')
  })
  it('does not offer a sound-effect engine as a voice', () => {
    const moss = ttsSupport('moss-soundeffect-v2', 'en', voiceEngines, workflows)
    expect(moss.status).toBe('unsupported')
    expect(moss.message).toContain('sound effects')
  })
  it('has a label fallback and a language helper', () => {
    expect(engineReadsLang({ languages: '*' }, 'hr')).toBe(true)
    expect(engineReadsLang({ languages: ['en'] }, 'hr')).toBe(false)
    expect(ttsEngineLabel(voiceEngines, 'omnivoice')).toContain('OmniVoice')
    expect(ttsEngineLabel(voiceEngines, 'ghost')).toBe('ghost')
    expect(ttsEngineLabel(voiceEngines, 'custom:chatterbox')).toBe('custom: chatterbox')
  })
})

describe('store reducer', () => {
  const statusEvent: Extract<EngineEvent, { type: 'voice.status' }> = {
    type: 'voice.status',
    ok: false,
    error: 'ComfyUI is not reachable',
    comfyUrl: 'http://127.0.0.1:8188',
    defaultEngine: 'omnivoice',
    engines: voiceEngines,
    workflows: [{ name: 'chatterbox', languages: ['en', 'de'] }]
  }
  it('keeps the new voice status', () => {
    const next = reduceVn(initialVn(), statusEvent)
    expect(next.voiceStatus).toEqual({
      ok: false,
      error: 'ComfyUI is not reachable',
      comfyUrl: 'http://127.0.0.1:8188',
      defaultEngine: 'omnivoice',
      engines: voiceEngines,
      workflows: [{ name: 'chatterbox', languages: ['en', 'de'] }]
    })
    expect('vibetts' in next).toBe(false)
  })
  it('does not disturb the previews per speaker and language', () => {
    const first = initialVn()
    const withPreview = { ...first, ...reduceVn(first, { type: 'voice.preview', slug: 'b', speakerKey: 'petra', voice: 'omnivoice', file: 'preview/voice-petra.mp3', rev: 5, lang: 'hr' }) }
    expect(withPreview.voicePreviews['b:petra:hr']).toMatchObject({ voice: 'omnivoice', file: 'preview/voice-petra.mp3', rev: 5, lang: 'hr' })
    const afterStatus = { ...withPreview, ...reduceVn(withPreview, statusEvent) }
    expect(afterStatus.voiceStatus?.defaultEngine).toBe('omnivoice')
    expect(afterStatus.voicePreviews['b:petra:hr']).toMatchObject({ voice: 'omnivoice', rev: 5, lang: 'hr' })
  })
})
