import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planVoicesSchema } from '../src/engine/vn/agents/voice-director'
import type { PlanVoices } from '../src/engine/vn/agents/voice-director'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { FakeFlow } from './flow-fakes'

/**
 * `vn.voice.plan` for the local engines: the voice-director names a delivery style per speaker and a TTS engine per language; only
 * installed engines that read the language are kept and known values stay unless `overwrite`. Uploaded reference clips are never
 * touched, and a missing agent answer leaves the settings as they are. The Flow plan still fills `voice.voices`.
 */

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const clipFile = async (e: VnEnv, name = 'ref.wav'): Promise<string> => {
  const file = path.join(e.dir, name)
  await writeFile(file, `VOICE ${name}`)
  return file
}

async function plan(h: { svc: VnEnv['engine']['vn']; env: VnEnv; slug: string }, answer: PlanVoices | string, o: { overwrite?: boolean } = {}) {
  h.env.mock.on({ task: 'vn.voice.plan' }, typeof answer === 'string' ? answer : JSON.stringify(answer))
  await h.svc.planVoices(h.slug, o)
  return waitIdle(h.env, h.slug)
}

const settingsVoice = async (h: { svc: VnEnv['engine']['vn']; slug: string }) => (await h.svc.store.loadSettings(h.slug)).settings.voice
const stepOf = async (h: { svc: VnEnv['engine']['vn']; slug: string }) => (await h.svc.pipelineStatus(h.slug))?.steps.voice

describe('voice plan (local ComfyUI engines)', () => {
  async function setup() {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.addEdition(slug, book('linear-hr'), 'hr')
    await waitIdle(env, slug)
    await svc.updateSettings(slug, {
      voice: { enabled: true, langs: ['en', 'hr'], provider: 'comfy', engine: 'omnivoice', engines: { en: 'omnivoice' }, styles: { mara: 'old style' }, refTexts: { narrator: 'the narrator transcript' }, voices: {} }
    })
    await svc.setVoiceRef(slug, 'mara', await clipFile(env))
    return { env, svc, slug }
  }
  type Harness = Awaited<ReturnType<typeof setup>>
  const voiceRef = async (h: Harness) => (await h.svc.store.loadAssets(h.slug)).assets.find((a) => a.id === 'voice_mara')!

  it('persists the styles and the usable per-language engines, keeps known values without overwrite, and never touches the reference clips', async () => {
    const h = await setup()
    const refBefore = JSON.parse(JSON.stringify(await voiceRef(h)))
    const answer: PlanVoices = {
      voices: [
        { speakerKey: 'mara', description: 'new style', engines: { en: 'chatterbox-23lang', hr: 'higgs-audio-v3' } },
        { speakerKey: 'tomas', description: 'low and calm', engines: { en: 'not-an-engine', hr: 'chatterbox-23lang' } },
        { speakerKey: 'narrator', description: 'warm storyteller', engines: { en: 'custom:chatterbox-multilingual' } }
      ]
    }
    expect((await plan(h, answer)).failed, (await failures(h.env)).join(' | ')).toEqual([])
    let voice = await settingsVoice(h)
    // a known style stays; the others are added. The existing en engine stays (Chatterbox would read en), so only hr is planned
    expect(voice.styles).toEqual({ mara: 'old style', tomas: 'low and calm', narrator: 'warm storyteller' })
    expect(voice.engines).toEqual({ en: 'omnivoice', hr: 'higgs-audio-v3' })
    expect(voice.refTexts).toEqual({ narrator: 'the narrator transcript' })
    expect((await stepOf(h))?.message).toBe('2 voice style(s) and 1 engine(s) planned')

    // overwrite replaces a known style and engine
    expect((await plan(h, { voices: [{ speakerKey: 'mara', description: 'new style', engines: { en: 'chatterbox-23lang', hr: 'higgs-audio-v3' } }] }, { overwrite: true })).failed).toEqual([])
    voice = await settingsVoice(h)
    expect(voice.styles.mara).toBe('new style')
    expect(voice.engines).toEqual({ en: 'chatterbox-23lang', hr: 'higgs-audio-v3' })
    expect((await stepOf(h))?.message).toBe('1 voice style(s) and 1 engine(s) planned')

    // a custom TTS workflow that declares the language is accepted
    expect((await plan(h, { voices: [{ speakerKey: 'narrator', description: '', engines: { en: 'custom:chatterbox-multilingual' } }] }, { overwrite: true })).failed).toEqual([])
    expect((await settingsVoice(h)).engines).toEqual({ en: 'custom:chatterbox-multilingual', hr: 'higgs-audio-v3' })
    expect((await stepOf(h))?.message).toBe('0 voice style(s) and 1 engine(s) planned')

    // an unknown engine or one that does not read the language is ignored, and nothing is written for it
    const before = await settingsVoice(h)
    expect((await plan(h, { voices: [{ speakerKey: 'mara', description: '', engines: { en: 'not-an-engine', hr: 'vibevoice' } }] }, { overwrite: true })).failed).toEqual([])
    expect(await settingsVoice(h)).toEqual(before)
    expect((await stepOf(h))?.message).toBe('0 voice style(s) and 0 engine(s) planned')

    // the uploaded reference clip is untouched by every plan (only its stub engine follows the settings)
    const refAfter = await voiceRef(h)
    expect(refAfter).toMatchObject({ id: refBefore.id, customFile: refBefore.customFile, locked: true, source: 'custom', versions: refBefore.versions, selected: refBefore.selected })
    expect(refAfter.customFile).toBe('custom.wav')
  })

  it('a missing agent answer changes nothing and says the clips fall back to the default engine', async () => {
    const h = await setup()
    const before = await settingsVoice(h)
    expect((await plan(h, 'sorry, I cannot')).failed).toEqual([])
    expect(await settingsVoice(h)).toEqual(before)
    const st = await stepOf(h)
    expect(st?.status).toBe('done')
    expect(st?.message).toMatch(/voice-director did not answer/)
    expect(st?.message).toMatch(/the clips use omnivoice with no delivery style/)
  })

  it('assigns Flow voices when the project uses the Flow provider', async () => {
    const flow = new FakeFlow()
    env = await makeVnEnv({ sdk: false, engine: { flow } })
    const svc = env.engine.vn
    await writeFile(path.join(env.dir, 'config', 'studios.md'), '---\nkind: studios\nflowVoicePauseMs: 0\nflowVoiceRetries: 1\n---\n')
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { voice: { enabled: true, langs: ['en'], provider: 'flow' } })
    const r = await plan(
      { env, svc, slug },
      {
        voices: [
          { speakerKey: 'mara', gender: 'female', description: '', voices: { en: 'gemini:Gacrux' } },
          { speakerKey: 'tomas', gender: 'male', description: '', voices: { en: 'gemini:Charon' } }
        ]
      }
    )
    expect(r.failed, (await failures(env)).join(' | ')).toEqual([])
    const voice = await settingsVoice({ svc, slug })
    expect(voice.voices.mara).toEqual({ en: 'gemini:Gacrux' })
    expect(voice.voices.tomas).toEqual({ en: 'gemini:Charon' })
    expect(voice.voices.narrator!.en).toMatch(/^gemini:/)
    expect(voice.engines).toEqual({}) // the Flow plan sets no local engines
    expect(voice.styles).toEqual({})
    expect(flow.calls.some((c) => c.tool === 'flow_voices')).toBe(true)
    expect((await stepOf({ svc, slug }))?.message).toMatch(/voice\(s\) assigned/)
  })

  it('parses the voice-director answer with per-language engines', () => {
    const parsed = planVoicesSchema.parse({ voices: [{ speakerKey: 'mara', engines: { en: 'omnivoice', hr: 'higgs-audio-v3' }, description: 'bright' }] })
    expect(parsed.voices[0]!.engines).toEqual({ en: 'omnivoice', hr: 'higgs-audio-v3' })
    expect(parsed.voices[0]!.voices).toBeUndefined()
  })
})
