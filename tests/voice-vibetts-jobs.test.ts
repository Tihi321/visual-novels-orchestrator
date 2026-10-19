import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPERTONIC_HINT, voiceGender } from '../src/engine/voice/catalog'
import { VibeTtsError, NOT_RUNNING_HINT } from '../src/engine/voice/vibetts'
import type { BatchItem, BatchResult, FileResult, VibeTtsClient, VibeVoice, VibeVoiceList } from '../src/engine/voice/vibetts'
import { voiceSubjects } from '../src/engine/vn/agents/voice-director'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

const KOKORO: VibeVoice[] = ['af_heart', 'af_bella', 'bf_emma', 'am_adam', 'bm_george'].map((id) => ({ id, label: `${id} (Kokoro)`, engine: 'kokoro', languages: ['en'] }))
const SUPERTONIC: VibeVoice[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((id) => ({ id: `supertonic:${id}`, label: `${id} (Supertonic)`, engine: 'supertonic', languages: ['en', 'hr', 'de'] }))

/** A VibeTTS with the fixed voices (Supertonic only when "installed") that writes tiny "audio" files. */
class FakeVibeTts implements VibeTtsClient {
  url = 'http://fake/mcp'
  supertonic = true
  batches: BatchItem[][] = []
  files: { text: string; output: string; voice?: string; lang?: string }[] = []
  down = false
  failOutputs = new Set<string>()
  failAll = false

  private check() {
    if (this.down) throw new VibeTtsError(NOT_RUNNING_HINT, 'unreachable')
  }
  async listVoices(): Promise<VibeVoiceList> {
    this.check()
    return {
      voices: [...KOKORO, ...(this.supertonic ? SUPERTONIC : [])],
      languages: [{ code: 'en', name: 'English' }, { code: 'hr', name: 'Croatian' }],
      english: { engine: 'kokoro', voice: 'af_heart' },
      other: { language: 'hr', voice: 'supertonic:F1' },
      language_mode: 'auto',
      supertonic_installed: this.supertonic
    }
  }
  async synthesizeToFile(a: { text: string; output: string; voice?: string; lang?: string }): Promise<FileResult> {
    this.check()
    this.files.push(a)
    await mkdir(path.dirname(a.output), { recursive: true })
    await writeFile(a.output, `AUDIO:${a.text}`)
    return { path: a.output, duration_seconds: 1.2 }
  }
  async synthesizeBatch(items: BatchItem[]): Promise<BatchResult> {
    this.check()
    this.batches.push(items)
    const results = []
    for (const i of items) {
      const bad = this.failAll || this.failOutputs.has(path.basename(i.output))
      if (!bad) await writeFile(i.output, `AUDIO:${i.voice}:${i.lang}:${i.text}`)
      results.push({ output: i.output, duration_s: bad ? 0 : 2, ok: !bad, error: bad ? 'boom' : null })
    }
    return { results }
  }
  async stop() {}
  get clips(): BatchItem[] {
    return this.batches.flat()
  }
}

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

async function setup(o: { chunkSize?: number } = {}) {
  env = await makeVnEnv({ sdk: false })
  const fake = new FakeVibeTts()
  const svc = env.engine.vn
  ;(svc.deps as { vibetts?: VibeTtsClient }).vibetts = fake
  await writeFile(path.join(env.dir, 'config', 'voice.md'), `---\nkind: voice\nchunkSize: ${o.chunkSize ?? 20}\n---\n`)
  const { slug } = await svc.importProject(book('linear-en'))
  return { env, fake, svc, slug }
}
type Harness = Awaited<ReturnType<typeof setup>>

const vdir = (e: VnEnv, slug: string, lang: string) => path.join(e.dir, 'projects', slug, 'voice', lang)
const readIndex = async (e: VnEnv, slug: string, lang: string) => JSON.parse(await readFile(path.join(vdir(e, slug, lang), 'index.json'), 'utf8')) as Record<string, { hash: string; file: string; speaker?: string }>
const voicesOf = async (h: Harness) => (await h.svc.store.loadSettings(h.slug)).settings.voice.voices

async function planned(h: Harness, langs: ('en' | 'hr')[] = ['en']) {
  await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs } })
  await h.svc.planVoices(h.slug)
  const r = await waitIdle(h.env, h.slug)
  expect(r.failed, (await failures(h.env)).join(' | ')).toEqual([])
}

async function withHr(h: Harness) {
  await h.svc.addEdition(h.slug, book('linear-hr'), 'hr')
  await waitIdle(h.env, h.slug)
}

describe('voice plan (VibeTTS)', () => {
  it('gives each speaker a Kokoro voice for en and a Supertonic voice for hr, by the voice-director gender and preference', async () => {
    const h = await setup()
    await withHr(h)
    h.env.mock.on(
      { task: 'vn.voice.plan' },
      JSON.stringify({
        voices: [
          { speakerKey: 'mara', gender: 'Female', voices: { en: 'bf_emma', hr: 'supertonic:F4' }, description: 'a teenage girl' },
          { speakerKey: 'tomas', gender: 'male', voices: { en: 'af_heart', hr: 'supertonic:F1' } }, // female voices for a male character: not used
          { speakerKey: 'narrator', gender: 'female', voices: { en: 'omni:petra' } }
        ]
      })
    )
    await planned(h, ['en', 'hr'])
    const subjects = voiceSubjects(await h.svc.store.loadBook(h.slug)).map((s) => s.speakerKey)
    const voices = await voicesOf(h)
    expect(Object.keys(voices).sort()).toEqual([...subjects].sort())
    for (const k of subjects) {
      expect(KOKORO.map((v) => v.id), `${k} en`).toContain(voices[k]!.en)
      expect(voices[k]!.hr, `${k} hr`).toMatch(/^supertonic:[FM][1-5]$/)
    }
    expect(voices.mara).toEqual({ en: 'bf_emma', hr: 'supertonic:F4' })
    expect(voiceGender(voices.tomas!.en!)).toBe('male')
    expect(voiceGender(voices.tomas!.hr!)).toBe('male')
    expect(voiceGender(voices.narrator!.en!)).toBe('female') // the unknown id was ignored
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.status).toBe('done')
  })

  it('uses the bible when the voice-director gives nothing usable, keeps existing voices and replaces them on overwrite', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'sorry, I cannot')
    await planned(h)
    const first = await voicesOf(h)
    expect(voiceGender(first.mara!.en!)).toBe('female') // "daughter" in the bible
    expect(voiceGender(first.narrator!.en!)).toBe('female')
    expect(first.hr).toBeUndefined()

    // an existing voice is kept, one VibeTTS no longer lists is replaced
    await h.svc.updateSettings(h.slug, { voice: { voices: { ...first, tomas: { en: 'gone_voice' } } } })
    await h.svc.planVoices(h.slug)
    await waitIdle(h.env, h.slug)
    const second = await voicesOf(h)
    expect(second.mara).toEqual(first.mara)
    expect(second.tomas!.en).toMatch(/^[ab]m_/)
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toMatch(/1 voice\(s\) assigned, 2 kept/)

    await h.svc.updateSettings(h.slug, { voice: { voices: { ...second, mara: { en: 'bm_george' } } } })
    await h.svc.planVoices(h.slug, { overwrite: true })
    await waitIdle(h.env, h.slug)
    expect((await voicesOf(h)).mara!.en).toBe(first.mara!.en)
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toMatch(/3 voice\(s\) assigned, 0 kept/)
  })

  it('forgets the clips of a speaker whose voice changed', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    const before = Object.values(await readIndex(h.env, h.slug, 'en')).filter((e) => e.speaker === 'mara').length
    expect(before).toBeGreaterThan(0)
    const voices = await voicesOf(h)
    await h.svc.updateSettings(h.slug, { voice: { voices: { ...voices, mara: { en: 'gone_voice' } } } })
    await h.svc.planVoices(h.slug)
    await waitIdle(h.env, h.slug)
    expect(Object.values(await readIndex(h.env, h.slug, 'en')).filter((e) => e.speaker === 'mara')).toHaveLength(0)
  })

  it('fails with the download hint when a non-English edition needs Supertonic and it is missing, but plans English alone', async () => {
    const h = await setup()
    await withHr(h)
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    h.fake.supertonic = false
    await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs: ['en', 'hr'] } })
    await h.svc.planVoices(h.slug)
    expect((await waitIdle(h.env, h.slug)).failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toContain(SUPERTONIC_HINT)
    expect(SUPERTONIC_HINT).toContain('Settings > Supertonic')
    expect(await voicesOf(h)).toEqual({}) // nothing half-planned
    await planned(h, ['en'])
    expect(Object.values(await voicesOf(h)).every((v) => v.en && !v.hr)).toBe(true)
  })

  it('uses the Supertonic voices for English when the project asks for them', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await h.svc.updateSettings(h.slug, { voice: { englishEngine: 'supertonic' } })
    await planned(h)
    for (const v of Object.values(await voicesOf(h))) expect(v.en).toMatch(/^supertonic:/)
  })

  it('fails with the "not running" message when VibeTTS is down, and does nothing when voice is off', async () => {
    const h = await setup()
    expect(await h.svc.planVoices(h.slug)).toEqual([]) // voice is off
    h.fake.down = true
    await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs: ['en'] } })
    await h.svc.planVoices(h.slug)
    const r = await waitIdle(h.env, h.slug)
    expect(r.failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toContain('python -m vibetts --mcp-only')
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.status).toBe('failed')
  })
})

describe('voice generate (VibeTTS)', () => {
  it('batches the beats in chunks, writes mp3 files, skips unchanged clips and redoes a changed one', async () => {
    const h = await setup({ chunkSize: 3 })
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    const voices = await voicesOf(h)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    expect((await waitIdle(h.env, h.slug)).failed, (await failures(h.env)).join(' | ')).toEqual([])
    const index = await readIndex(h.env, h.slug, 'en')
    const beats = Object.keys(index)
    expect(beats.length).toBeGreaterThan(5)
    expect(h.fake.batches.every((b) => b.length <= 3)).toBe(true)
    expect(h.fake.batches).toHaveLength(Math.ceil(beats.length / 3))
    for (const [id, e] of Object.entries(index)) {
      expect(e.file).toBe(`${id}.mp3`)
      expect(existsSync(path.join(vdir(h.env, h.slug, 'en'), e.file))).toBe(true)
    }
    for (const item of h.fake.clips) {
      expect(path.isAbsolute(item.output)).toBe(true)
      expect(item.output.endsWith('.mp3')).toBe(true)
      expect(item.lang).toBe('en')
    }
    // lines use their speaker's voice, narration the narrator's
    const bk = await h.svc.store.loadBook(h.slug)
    const speakerOf = new Map<string, string>()
    for (const c of bk.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.type === 'line' && b.speakerKey) speakerOf.set(b.id, b.speakerKey)
    for (const item of h.fake.clips) {
      const id = path.basename(item.output, '.mp3')
      expect(item.voice).toBe(voices[speakerOf.get(id) ?? 'narrator']!.en)
    }
    expect(new Set(h.fake.clips.map((c) => c.voice)).size).toBeGreaterThan(1)

    const before = h.fake.clips.length
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips).toHaveLength(before) // the hashes match: nothing new

    await h.svc.updateEditionBeat(h.slug, 'en', beats[1]!, 'A new sentence for this beat.')
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips).toHaveLength(before + 1)
    expect(h.fake.clips.at(-1)).toMatchObject({ text: 'A new sentence for this beat.' })

    // another voice for a speaker: only that speaker's clips are made again
    const maraBeats = [...speakerOf].filter(([, k]) => k === 'mara').map(([id]) => id)
    await h.svc.updateSettings(h.slug, { voice: { voices: { ...voices, mara: { ...voices.mara, en: 'bm_george' } } } })
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips).toHaveLength(before + 1 + maraBeats.length)

    // the game uses the clips
    await h.svc.enqueueBuild(h.slug)
    await waitIdle(h.env, h.slug)
    const ch1 = await readFile(path.join(h.svc.store.dir(h.slug), 'game', 'game', 'ch01.rpy'), 'utf8')
    expect(ch1).toMatch(/voice "voice\/en\/ch01\.s01\.b\d+\.mp3"/)
    expect(existsSync(path.join(h.svc.store.dir(h.slug), 'game', 'game', 'voice', 'en', `${beats[0]}.mp3`))).toBe(true)
  })

  it('makes at most `limit` clips and a speaker without a voice in that language uses the narrator', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    const voices = await voicesOf(h)
    const rest = { ...voices }
    delete rest.tomas
    await h.svc.updateSettings(h.slug, { voice: { voices: rest } })
    await h.svc.generateVoice(h.slug, { lang: 'en', limit: 4 })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips).toHaveLength(4)
    expect(Object.keys(await readIndex(h.env, h.slug, 'en'))).toHaveLength(4)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips.map((c) => c.voice)).not.toContain(voices.tomas!.en)
  })

  it('speaks the edition text of another language with that language’s own voices', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await withHr(h)
    await planned(h, ['en', 'hr'])
    await h.svc.generateVoice(h.slug)
    expect((await waitIdle(h.env, h.slug)).failed, (await failures(h.env)).join(' | ')).toEqual([])
    const voices = await voicesOf(h)
    const en = h.fake.clips.filter((c) => c.lang === 'en')
    const hr = h.fake.clips.filter((c) => c.lang === 'hr')
    expect(en.length).toBeGreaterThan(5)
    expect(hr).toHaveLength(en.length)
    const hrEdition = await h.svc.getEdition(h.slug, 'hr')
    for (const c of hr) expect(c.text).toBe(hrEdition.beats[path.basename(c.output, '.mp3')]!.trim())
    for (const c of hr) expect(c.output).toContain(`${path.sep}hr${path.sep}`)
    for (const c of en) expect(KOKORO.map((v) => v.id)).toContain(c.voice)
    for (const c of hr) expect(c.voice).toMatch(/^supertonic:/)
    expect(new Set(hr.map((c) => c.voice))).toEqual(new Set(Object.values(voices).map((v) => v.hr)))
  })

  it('skips a language that has no voice planned, and says which speakers lack one', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await withHr(h)
    await planned(h, ['en'])
    await h.svc.updateSettings(h.slug, { voice: { langs: ['en', 'hr'] } })
    await h.svc.generateVoice(h.slug, { lang: 'hr' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.batches).toEqual([])
    const step = (await h.svc.pipelineStatus(h.slug))?.steps.voice
    expect(step).toMatchObject({ status: 'skipped' })
    expect(step?.message).toContain('no hr voices')
    expect(step?.message).toContain('Plan voices')

    // only the narrator has an hr voice: lines fall back to it, and nothing is skipped
    const voices = await voicesOf(h)
    await h.svc.updateSettings(h.slug, { voice: { voices: { ...voices, narrator: { ...voices.narrator, hr: 'supertonic:F1' } } } })
    await h.svc.generateVoice(h.slug, { lang: 'hr' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips.length).toBeGreaterThan(5)
    expect(new Set(h.fake.clips.map((c) => c.voice))).toEqual(new Set(['supertonic:F1']))

    // only a character has an hr voice: narration has no one to speak it and is skipped with a hint
    h.fake.batches.length = 0
    await h.svc.updateSettings(h.slug, { voice: { voices: { mara: { hr: 'supertonic:F2' } } } })
    await h.svc.generateVoice(h.slug, { lang: 'hr' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips.every((c) => c.voice === 'supertonic:F2')).toBe(true)
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toMatch(/skipped: no hr voice for narrator.*Plan voices/)
  })

  it('reports failed clips, and fails the job when every clip fails', async () => {
    const h = await setup({ chunkSize: 4 })
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    const bk = await h.svc.store.loadBook(h.slug)
    const firstBeat = bk.chapters[0]!.scenes[0]!.beats.find((b) => b.type !== 'cast')!.id
    h.fake.failOutputs.add(`${firstBeat}.mp3`)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    expect((await waitIdle(h.env, h.slug)).failed).toEqual([])
    expect(Object.keys(await readIndex(h.env, h.slug, 'en'))).not.toContain(firstBeat)
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toMatch(/1 failed \(.*boom/)
    h.fake.failOutputs.clear()
    h.fake.failAll = true
    await h.svc.updateEditionBeat(h.slug, 'en', firstBeat, 'Changed text for the first beat.')
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    const r = await waitIdle(h.env, h.slug)
    expect(r.failed).toHaveLength(1)
  })

  it('fails with the "not running" message when VibeTTS is down, and writes nothing', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    h.fake.down = true
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    expect((await waitIdle(h.env, h.slug)).failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toContain(NOT_RUNNING_HINT)
    expect(existsSync(path.join(vdir(h.env, h.slug, 'en'), 'index.json'))).toBe(false)
  })

  it('does nothing when voice is off for the book', async () => {
    const h = await setup()
    expect(await h.svc.generateVoice(h.slug)).toEqual([])
    await h.svc.runPipeline(h.slug, 'art')
    await waitIdle(h.env, h.slug)
    expect(h.fake.batches).toEqual([])
    expect(h.fake.files).toEqual([])
    expect(existsSync(path.join(h.svc.store.dir(h.slug), 'voice'))).toBe(false)
    const ch1 = await readFile(path.join(h.svc.store.dir(h.slug), 'game', 'game', 'ch01.rpy'), 'utf8')
    expect(ch1).not.toMatch(/^\s*voice /m)
  })

  it('is skipped, with a hint, when no voices are planned yet', async () => {
    const h = await setup()
    await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs: ['en'] } })
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.batches).toEqual([])
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice).toMatchObject({ status: 'skipped' })
    expect((await h.svc.pipelineStatus(h.slug))?.steps.voice?.message).toContain('Plan voices')
  })
})

describe('voice tab commands', () => {
  it('reports VibeTTS status without throwing', async () => {
    const h = await setup()
    const ok = await h.svc.voiceStatus()
    expect(ok).toMatchObject({ type: 'voice.status', ok: true, url: 'http://fake/mcp', supertonicInstalled: true, languages: ['en', 'hr'] })
    expect(ok.english).toMatchObject({ engine: 'kokoro', voice: 'af_heart' })
    expect(ok.other).toMatchObject({ language: 'hr', voice: 'supertonic:F1' })
    expect(ok.voices[0]).toEqual({ id: 'af_heart', label: 'af_heart (Kokoro)', engine: 'kokoro', languages: ['en'] })
    h.fake.supertonic = false
    expect(await h.svc.voiceStatus()).toMatchObject({ ok: true, supertonicInstalled: false })
    h.fake.down = true
    const bad = await h.svc.voiceStatus()
    expect(bad).toMatchObject({ ok: false, error: NOT_RUNNING_HINT, supertonicInstalled: false, voices: [] })
  })

  it('sets a voice for one language, forgets that speaker’s clips in it and makes a preview', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await withHr(h)
    await planned(h, ['en', 'hr'])
    await h.svc.generateVoice(h.slug)
    await waitIdle(h.env, h.slug)
    const maraClips = (lang: string) => readIndex(h.env, h.slug, lang).then((i) => Object.values(i).filter((e) => e.speaker === 'mara').length)
    expect(await maraClips('en')).toBeGreaterThan(0)
    expect(await maraClips('hr')).toBeGreaterThan(0)
    const before = await voicesOf(h)

    const p = await h.svc.setVoice(h.slug, 'mara', 'hr', 'supertonic:M3')
    expect(p).toMatchObject({ slug: h.slug, speakerKey: 'mara', voice: 'supertonic:M3', file: 'preview/voice-mara.mp3', lang: 'hr' })
    expect(existsSync(path.join(h.svc.store.dir(h.slug), 'preview', 'voice-mara.mp3'))).toBe(true)
    expect(h.fake.files.at(-1)).toMatchObject({ voice: 'supertonic:M3', lang: 'hr' })
    expect((await voicesOf(h)).mara).toEqual({ en: before.mara!.en, hr: 'supertonic:M3' })
    expect(await maraClips('hr')).toBe(0)
    expect(await maraClips('en')).toBeGreaterThan(0) // the other language is untouched

    // the narrator can be set too, and a preview takes any listed voice
    await h.svc.setVoice(h.slug, 'narrator', 'en', 'bf_emma')
    expect((await voicesOf(h)).narrator!.en).toBe('bf_emma')
    const q = await h.svc.previewVoice(h.slug, 'tomas', 'supertonic:M1', 'hr')
    expect(q).toMatchObject({ speakerKey: 'tomas', voice: 'supertonic:M1', lang: 'hr' })
    expect(h.fake.files.at(-1)!.lang).toBe('hr')
  })

  it('refuses a voice that is unknown or cannot read the language, and an unknown character', async () => {
    const h = await setup()
    await expect(h.svc.setVoice(h.slug, 'nobody', 'en', 'af_heart')).rejects.toThrow(/no character/)
    await expect(h.svc.setVoice(h.slug, 'mara', 'hr', 'af_heart')).rejects.toThrow(/no voice "af_heart" that reads hr/)
    await expect(h.svc.setVoice(h.slug, 'mara', 'en', 'omni:petra')).rejects.toThrow(/no voice "omni:petra"/)
    h.fake.supertonic = false
    await expect(h.svc.setVoice(h.slug, 'mara', 'hr', 'supertonic:F1')).rejects.toThrow(/Supertonic is not installed/)
    expect((await voicesOf(h)).mara).toBeUndefined()
    expect(h.fake.files).toEqual([])
  })
})
