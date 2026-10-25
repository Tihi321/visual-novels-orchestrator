import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flowVoiceList, flowVoiceProblem, parseFlowVoice } from '../src/engine/voice/flow-catalog'
import { generateFlowClips, parseRetryDelayMs } from '../src/engine/voice/flow'
import { voiceSubjects } from '../src/engine/vn/agents/voice-director'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { FakeFlow, GEMINI } from './flow-fakes'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

async function setup(o: { pauseMs?: number } = {}) {
  const flow = new FakeFlow()
  env = await makeVnEnv({ sdk: false, engine: { flow } })
  const svc = env.engine.vn
  await writeFile(path.join(env.dir, 'config', 'studios.md'), `---\nkind: studios\nflowVoicePauseMs: ${o.pauseMs ?? 0}\nflowVoiceRetries: 1\n---\n`)
  const { slug } = await svc.importProject(book('linear-en'))
  await svc.updateSettings(slug, { voice: { provider: 'flow', enabled: true, langs: ['en'] } })
  return { env, flow, svc, slug }
}
type Harness = Awaited<ReturnType<typeof setup>>

const vdir = (h: Harness, lang: string) => path.join(h.env.dir, 'projects', h.slug, 'voice', lang)
const readIndex = async (h: Harness, lang: string) => JSON.parse(await readFile(path.join(vdir(h, lang), 'index.json'), 'utf8')) as Record<string, { hash: string; file: string; speaker?: string; imported?: boolean }>
const voicesOf = async (h: Harness) => (await h.svc.store.loadSettings(h.slug)).settings.voice.voices

async function plan(h: Harness, langs: ('en' | 'hr')[] = ['en']) {
  await h.svc.updateSettings(h.slug, { voice: { langs } })
  await h.svc.planVoices(h.slug)
  return waitIdle(h.env, h.slug)
}
async function withHr(h: Harness) {
  await h.svc.addEdition(h.slug, book('linear-hr'), 'hr')
  await waitIdle(h.env, h.slug)
}

describe('flow voice catalog', () => {
  it('parses ids, never the paid engine, and says why a voice cannot speak', () => {
    expect(parseFlowVoice('gemini:Charon')).toEqual({ engine: 'gemini', voice: 'Charon' })
    expect(parseFlowVoice('windows:Microsoft Zira Desktop')).toEqual({ engine: 'windows', voice: 'Microsoft Zira Desktop' })
    expect(parseFlowVoice('flow:Aoede')).toBeNull()
    expect(parseFlowVoice('af_heart')).toBeNull()
    const v = { gemini: GEMINI, geminiModel: 'm', geminiReady: true, windows: [{ name: 'Microsoft Zira Desktop', culture: 'en-US', gender: 'female' as const }] }
    expect(flowVoiceProblem(v, 'gemini:Charon', 'hr')).toBeNull()
    expect(flowVoiceProblem(v, 'gemini:Nobody', 'hr')).toMatch(/no voice "Nobody"/)
    expect(flowVoiceProblem(v, 'windows:Microsoft Zira Desktop', 'en')).toBeNull()
    expect(flowVoiceProblem(v, 'windows:Microsoft Zira Desktop', 'hr')).toMatch(/reads en-US, not hr/)
    expect(flowVoiceProblem({ ...v, geminiReady: false }, 'gemini:Charon', 'en')).toMatch(/no Google AI Studio key/)
    expect(flowVoiceProblem(v, 'flow:Aoede', 'en')).toMatch(/not a Flow voice/)
  })

  it('lists the Gemini voices for every language, and Windows voices only without a key and only for their culture', () => {
    const v = { gemini: GEMINI, geminiModel: 'm', geminiReady: true, windows: [{ name: 'Zira', culture: 'en-US', gender: 'female' as const }, { name: 'Matej', culture: 'hr-HR' }] }
    const withKey = flowVoiceList(v, ['en', 'hr'])
    expect(withKey.every((x) => x.engine === 'gemini' && x.languages.join() === 'en,hr')).toBe(true)
    const noKey = flowVoiceList({ ...v, geminiReady: false }, ['en', 'hr'])
    expect(noKey.map((x) => [x.id, x.languages])).toEqual([['windows:Zira', ['en']], ['windows:Matej', ['hr']]])
  })
})

describe('voice plan (Google Flow)', () => {
  it('gives each speaker a Gemini voice of its gender for en and hr', async () => {
    const h = await setup()
    await withHr(h)
    h.env.mock.on({ task: 'vn.voice.plan' }, JSON.stringify({ voices: [{ speakerKey: 'mara', gender: 'female', voices: {} }, { speakerKey: 'tomas', gender: 'male', voices: {} }] }))
    const r = await plan(h, ['en', 'hr'])
    expect(r.failed, (await failures(h.env)).join(' | ')).toEqual([])
    const voices = await voicesOf(h)
    const subjects = voiceSubjects(await h.svc.store.loadBook(h.slug)).map((s) => s.speakerKey)
    expect(Object.keys(voices).sort()).toEqual([...subjects].sort())
    const gender = (id: string) => GEMINI.find((g) => `gemini:${g.name}` === id)?.gender
    for (const k of subjects) for (const lang of ['en', 'hr'] as const) expect(voices[k]![lang], `${k} ${lang}`).toMatch(/^gemini:/)
    expect(gender(voices.mara!.hr!)).toBe('female')
    expect(gender(voices.tomas!.en!)).toBe('male')
    expect(h.flow.calls.some((c) => c.tool === 'flow_voices')).toBe(true)
  })

  it('without a Gemini key it uses a Windows voice for its own language only, and fails for a language no voice reads', async () => {
    const h = await setup()
    h.flow.geminiReady = false
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    expect((await plan(h, ['en'])).failed).toEqual([])
    for (const v of Object.values(await voicesOf(h))) expect(v.en).toMatch(/^windows:Microsoft (Zira|David) Desktop$/)
    await withHr(h)
    const r = await plan(h, ['en', 'hr'])
    expect(r.failed.length).toBeGreaterThan(0)
    expect((await failures(h.env)).join('|')).toMatch(/Google Flow has no voice that reads hr/)
  })

  it('fails with the start hint when flow-music-mcp is down', async () => {
    const h = await setup()
    h.flow.up = false
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    expect((await plan(h)).failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toContain('hub.ps1 start flow-music-mcp')
  })
})

describe('voice clips (Google Flow)', () => {
  it('makes one clip per beat in the voice-config format, saves the index, keeps unchanged clips, and never sends the paid engine', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    h.env.mock.on({ task: 'vn.voice.generate' }, 'x')
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    const r = await waitIdle(h.env, h.slug)
    expect(r.failed, (await failures(h.env)).join(' | ')).toEqual([])
    const index = await readIndex(h, 'en')
    const beats = Object.keys(index)
    expect(beats.length).toBeGreaterThan(3)
    for (const b of beats) {
      expect(index[b]!.file).toBe(`${b}.mp3`)
      expect(existsSync(path.join(vdir(h, 'en'), `${b}.mp3`))).toBe(true)
    }
    const narrations = h.flow.calls.filter((c) => c.tool === 'flow_narrate').map((c) => c.args as { engine: string; voice: string; format: string; name: string })
    expect(narrations).toHaveLength(beats.length)
    expect(narrations.every((n) => (n.engine === 'gemini' || n.engine === 'windows') && n.format === 'mp3')).toBe(true)
    // run again: nothing is made
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.flow.calls.filter((c) => c.tool === 'flow_narrate')).toHaveLength(beats.length)
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toMatch(/0 clip\(s\) made, \d+ unchanged/)
  })

  it('keeps an imported clip, and a style note changes only the clips of that speaker', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    const index = await readIndex(h, 'en')
    const maraBeats = Object.entries(index).filter(([, e]) => e.speaker === 'mara').map(([b]) => b)
    const other = Object.keys(index).find((b) => index[b]!.speaker !== 'mara')!
    expect(maraBeats.length).toBeGreaterThan(0)
    const clip = path.join(h.env.dir, 'mine.mp3')
    await writeFile(clip, 'MINE')
    await h.svc.importVoice(h.slug, 'en', { beatId: other, file: clip })
    const before = h.flow.calls.filter((c) => c.tool === 'flow_narrate').length
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'gruffly, tired' } } })
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    const again = h.flow.calls.filter((c) => c.tool === 'flow_narrate').slice(before).map((c) => c.args as { name: string; style?: string })
    expect(again.map((a) => a.name).sort()).toEqual([...maraBeats].sort())
    expect(again.every((a) => a.style === 'gruffly, tired')).toBe(true)
    expect(await readFile(path.join(vdir(h, 'en'), (await readIndex(h, 'en'))[other]!.file), 'utf8')).toBe('MINE')
  })

  it('a rate limit is retried after a wait, then that clip fails and the others go on', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    const waits: number[] = []
    const run = (o: { retries: number }) => generateFlowClips(h.svc, h.slug, 'en', { flow: h.flow, format: 'mp3', settings: { pauseMs: 0, retries: o.retries }, log: () => undefined, sleep: async (ms) => void waits.push(ms) })
    h.flow.rateLimited = 1
    const ok = await run({ retries: 2 })
    expect(ok.failed).toBe(0)
    expect(waits).toEqual([10_000])

    // forget the clips, and let every call fail: all clips fail after the retries
    await writeFile(path.join(vdir(h, 'en'), 'index.json'), '{}')
    h.flow.alwaysRateLimited = true
    await expect(run({ retries: 1 })).rejects.toThrow(/all \d+ clip\(s\) failed.*rate limited/)
  })

  it('parses the retry time of a Gemini 429', () => {
    expect(parseRetryDelayMs('Please retry in 21h21m47.5s.')).toBe(76_907_500)
    expect(parseRetryDelayMs('retry in 45s')).toBe(45_000)
    expect(parseRetryDelayMs('{"retryDelay":"76800s"}')).toBe(76_800_000)
    expect(parseRetryDelayMs('wait about a minute')).toBeUndefined()
  })

  it('a daily quota (a retry time of hours) stops the job after the first clip, without waiting or calling Flow again; a short retry time still retries', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    const waits: number[] = []
    const run = () => generateFlowClips(h.svc, h.slug, 'en', { flow: h.flow, format: 'mp3', settings: { pauseMs: 0, retries: 3 }, log: () => undefined, sleep: async (ms) => void waits.push(ms) })
    h.flow.alwaysRateLimited = true
    h.flow.rateLimitText = 'Gemini TTS rate limited (HTTP 429): Please retry in 45s'
    await expect(run()).rejects.toThrow(/rate limited/)
    expect(waits.length).toBeGreaterThan(3) // every clip retried 3 times

    await writeFile(path.join(vdir(h, 'en'), 'index.json'), '{}')
    waits.length = 0
    const before = h.flow.calls.filter((c) => c.tool === 'flow_narrate').length
    h.flow.rateLimitText = 'Gemini TTS rate limited (HTTP 429): Please retry in 21h21m47.5s'
    await expect(run()).rejects.toThrow(/daily voice quota is used up/)
    expect(h.flow.calls.filter((c) => c.tool === 'flow_narrate').length - before).toBe(1)
    expect(waits).toEqual([])
  })

  it('clips made before the quota ran out are kept and the message says how many failed', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    h.flow.rateLimitText = 'Please retry in 20h'
    const orig = h.flow.narrate.bind(h.flow)
    let n = 0
    h.flow.narrate = async (a) => {
      if (++n === 3) h.flow.alwaysRateLimited = true
      return orig(a)
    }
    const r = await generateFlowClips(h.svc, h.slug, 'en', { flow: h.flow, format: 'mp3', settings: { pauseMs: 0, retries: 3 }, log: () => undefined, sleep: async () => undefined })
    expect(r.made).toBe(2)
    expect(r.failed).toBeGreaterThan(0)
    expect(r.message).toMatch(/daily voice quota is used up/)
    expect(Object.keys(await readIndex(h, 'en'))).toHaveLength(2)
    expect(n).toBe(3)
  })

  it('a beat over the tool limit fails alone with a clear error, and a persistent failure of the others is not hidden', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    const edition = await h.svc.store.loadEdition(h.slug, 'en')
    const longBeat = Object.keys(edition.beats).find((b) => edition.beats[b]!.trim())!
    edition.beats[longBeat] = 'x'.repeat(4001)
    await h.svc.store.saveEdition(h.slug, edition)
    const r = await generateFlowClips(h.svc, h.slug, 'en', { flow: h.flow, format: 'mp3', settings: { pauseMs: 0, retries: 0 }, log: () => undefined })
    expect(r.failed).toBe(1)
    expect(r.made).toBeGreaterThan(2)
    expect(r.message).toMatch(new RegExp(`${longBeat.replace(/\./g, '\\.')}: the text is 4001 characters, over the 4000`))
    expect(h.flow.calls.some((c) => c.tool === 'flow_narrate' && (c.args as { text: string }).text.length > 4000)).toBe(false)
  })

  it('set and preview a voice: checked against the list, saved, clips of that speaker forgotten, preview file written', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await plan(h)
    await expect(h.svc.setVoice(h.slug, 'mara', 'en', 'gemini:Nobody')).rejects.toThrow(/no voice "Nobody"/)
    await expect(h.svc.setVoice(h.slug, 'ghost', 'en', 'gemini:Charon')).rejects.toThrow(/no character/)
    const p = await h.svc.setVoice(h.slug, 'mara', 'en', 'gemini:Gacrux')
    expect((await voicesOf(h)).mara!.en).toBe('gemini:Gacrux')
    expect(p.file).toBe('preview/voice-mara.mp3')
    expect(existsSync(path.join(h.env.dir, 'projects', h.slug, 'preview', 'voice-mara.mp3'))).toBe(true)
    const last = h.flow.calls.filter((c) => c.tool === 'flow_narrate').at(-1)!.args as { engine: string; voice: string }
    expect(last).toMatchObject({ engine: 'gemini', voice: 'Gacrux' })
    await expect(h.svc.previewVoice(h.slug, 'mara', 'flow:Aoede')).rejects.toThrow(/not a Flow voice/)
  })
})
