import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VibeTtsError, NOT_RUNNING_HINT } from '../src/engine/voice/vibetts'
import type { BatchItem, BatchResult, CreatedVoice, FileResult, VibeTtsClient, VibeVoiceList } from '../src/engine/voice/vibetts'
import { VOICE_VOCAB } from '../src/shared/voice-vocab'
import { voiceNameFor } from '../src/engine/voice/vocab'
import { voiceSubjects } from '../src/engine/vn/agents/voice-director'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/** A VibeTTS that keeps its voices in memory and writes tiny "audio" files. */
class FakeVibeTts implements VibeTtsClient {
  url = 'http://fake/mcp'
  voices = new Map<string, { description: string; lang: string }>([['omni:default', { description: '', lang: 'hr' }]])
  created: { name: string; description?: string; seed?: number; lang?: string; overwrite?: boolean }[] = []
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
    return { voices: [...this.voices].map(([id, v]) => ({ id, label: id, engine: 'omnivoice', kind: 'description', description: v.description, lang: v.lang })), omnivoice_installed: true }
  }
  async createVoice(a: { name: string; description?: string; seed?: number; lang?: string; overwrite?: boolean }): Promise<CreatedVoice> {
    this.check()
    this.created.push(a)
    const id = `omni:${a.name}`
    if (this.voices.has(id) && !a.overwrite) throw new VibeTtsError(`A voice named '${a.name}' already exists`, 'tool')
    this.voices.set(id, { description: a.description ?? '', lang: a.lang ?? 'en' })
    return { voice: id, name: a.name, description: a.description ?? '', seed: a.seed ?? 0, lang: a.lang ?? 'en' }
  }
  async deleteVoice(name: string) {
    this.voices.delete(`omni:${name}`)
    return { deleted: `omni:${name}` }
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

const vdir = (e: VnEnv, slug: string, lang: string) => path.join(e.dir, 'projects', slug, 'voice', lang)
const readIndex = async (e: VnEnv, slug: string, lang: string) => JSON.parse(await readFile(path.join(vdir(e, slug, lang), 'index.json'), 'utf8')) as Record<string, { hash: string; file: string; speaker?: string }>
const allowed = new Set(Object.values(VOICE_VOCAB).flat() as string[])

async function planned(h: Awaited<ReturnType<typeof setup>>) {
  await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs: ['en'] } })
  await h.svc.planVoices(h.slug)
  const r = await waitIdle(h.env, h.slug)
  expect(r.failed, (await failures(h.env)).join(' | ')).toEqual([])
}

describe('voice plan (VibeTTS)', () => {
  it('creates one voice per speaker with only allowed words, and stores the mapping', async () => {
    const h = await setup()
    h.env.mock.on(
      { task: 'vn.voice.plan' },
      JSON.stringify({
        voices: [
          { speakerKey: 'mara', voiceName: 'Mara Keeper!', description: 'girl, teen, gravelly, high pitch', seed: 11 },
          { speakerKey: 'tomas', voiceName: 'default', description: 'male, young adult, loud', seed: -5 },
          { speakerKey: 'narrator', voiceName: 'narrator', description: 'woman, middle aged, moderate pitch', seed: 3 }
        ]
      })
    )
    await planned(h)
    const book1 = await h.svc.store.loadBook(h.slug)
    const subjects = voiceSubjects(book1).map((s) => s.speakerKey)
    expect(subjects).toContain('narrator')
    expect(h.fake.created.map((c) => c.name).sort()).toHaveLength(subjects.length)
    for (const c of h.fake.created) {
      expect(c.description!.split(', ').every((w) => allowed.has(w)), c.description).toBe(true)
      expect(c.name).toMatch(/^[a-z0-9_-]{1,32}$/)
      expect(c.name).not.toBe('default')
      expect(c.overwrite).toBe(false)
      expect(c.lang).toBe('en')
    }
    const mara = h.fake.created.find((c) => c.name === 'mara-keeper')!
    expect(mara).toMatchObject({ description: 'female, teenager, high pitch', seed: 11 })
    const tomas = h.fake.created.find((c) => c.name === voiceNameFor(h.slug, 'tomas'))!
    expect(tomas.seed).toBeGreaterThanOrEqual(0) // the bad seed was replaced
    const { settings } = await h.svc.store.loadSettings(h.slug)
    expect(settings.voice.voices.mara).toBe('omni:mara-keeper')
    expect(Object.keys(settings.voice.voices).sort()).toEqual([...subjects].sort())
    const st = await h.svc.pipelineStatus(h.slug)
    expect(st?.steps.voice?.status).toBe('done')
  })

  it('uses the bible when the voice-director gives nothing usable, and keeps existing voices', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'sorry, I cannot')
    await planned(h)
    const mara = h.fake.created.find((c) => c.name.endsWith('mara'))!
    expect(mara.description).toBe('female, teenager') // from "Seventeen ... daughter" in the bible
    const n = h.fake.created.length
    await h.svc.planVoices(h.slug)
    await waitIdle(h.env, h.slug)
    expect(h.fake.created).toHaveLength(n) // nothing recreated
    await h.svc.planVoices(h.slug, { overwrite: true })
    await waitIdle(h.env, h.slug)
    expect(h.fake.created).toHaveLength(2 * n)
    expect(h.fake.created.slice(n).every((c) => c.overwrite === true)).toBe(true)
    expect(new Set(h.fake.created.map((c) => c.name)).size).toBe(n) // same names reused
  })

  it('does not take a name that is already in VibeTTS, and does nothing when voice is off', async () => {
    const h = await setup()
    const taken = voiceNameFor(h.slug, 'mara')
    h.fake.voices.set(`omni:${taken}`, { description: 'someone else', lang: 'en' })
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    expect(await h.svc.planVoices(h.slug)).toEqual([]) // voice is off
    expect(h.fake.created).toEqual([])
    await planned(h)
    expect(h.fake.created.find((c) => c.name === `${taken}-2`)).toBeTruthy()
    expect(h.fake.voices.get(`omni:${taken}`)!.description).toBe('someone else')
  })

  it('fails with the "not running" message when VibeTTS is down', async () => {
    const h = await setup()
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
    const { settings } = await h.svc.store.loadSettings(h.slug)
    const voices = settings.voice.voices
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
      expect(Object.values(voices)).toContain(item.voice)
    }
    // lines use their speaker's voice, narration the narrator's
    const bk = await h.svc.store.loadBook(h.slug)
    const speakerOf = new Map<string, string>()
    for (const c of bk.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.type === 'line' && b.speakerKey) speakerOf.set(b.id, b.speakerKey)
    for (const item of h.fake.clips) {
      const id = path.basename(item.output, '.mp3')
      expect(item.voice).toBe(voices[speakerOf.get(id) ?? 'narrator'])
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
    await h.svc.updateSettings(h.slug, { voice: { voices: { ...voices, mara: 'omni:default' } } })
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

  it('makes at most `limit` clips and a speaker without a voice uses the narrator', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    const { settings } = await h.svc.store.loadSettings(h.slug)
    const rest = { ...settings.voice.voices }
    delete rest.tomas
    await h.svc.updateSettings(h.slug, { voice: { voices: rest } })
    await h.svc.generateVoice(h.slug, { lang: 'en', limit: 4 })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips).toHaveLength(4)
    expect(Object.keys(await readIndex(h.env, h.slug, 'en'))).toHaveLength(4)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    expect(h.fake.clips.every((c) => c.voice !== undefined && c.voice !== 'omni:default')).toBe(true)
    expect(h.fake.clips.map((c) => c.voice)).not.toContain(settings.voice.voices.tomas)
  })

  it('speaks the edition text of another language with the same voices', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await h.svc.addEdition(h.slug, book('linear-hr'), 'hr')
    await waitIdle(h.env, h.slug)
    await h.svc.updateSettings(h.slug, { voice: { enabled: true, langs: ['en', 'hr'] } })
    await h.svc.planVoices(h.slug)
    await waitIdle(h.env, h.slug)
    await h.svc.generateVoice(h.slug)
    expect((await waitIdle(h.env, h.slug)).failed, (await failures(h.env)).join(' | ')).toEqual([])
    const en = h.fake.clips.filter((c) => c.lang === 'en')
    const hr = h.fake.clips.filter((c) => c.lang === 'hr')
    expect(en.length).toBeGreaterThan(5)
    expect(hr).toHaveLength(en.length)
    const hrEdition = await h.svc.getEdition(h.slug, 'hr')
    for (const c of hr) expect(c.text).toBe(hrEdition.beats[path.basename(c.output, '.mp3')]!.trim())
    for (const c of hr) expect(c.output).toContain(`${path.sep}hr${path.sep}`)
    const voiceOf = (list: BatchItem[]) => new Map(list.map((c) => [path.basename(c.output, '.mp3'), c.voice]))
    const enVoices = voiceOf(en)
    for (const [id, v] of voiceOf(hr)) expect(enVoices.get(id)).toBe(v) // same voice in both languages
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
    expect(h.fake.created).toEqual([])
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
    expect(ok).toMatchObject({ type: 'voice.status', ok: true, url: 'http://fake/mcp' })
    expect(ok.voices[0]).toMatchObject({ id: 'omni:default' })
    h.fake.down = true
    const bad = await h.svc.voiceStatus()
    expect(bad).toMatchObject({ ok: false, error: NOT_RUNNING_HINT, voices: [] })
  })

  it('designs a voice, assigns it, forgets that speaker’s clips and makes a preview', async () => {
    const h = await setup()
    h.env.mock.on({ task: 'vn.voice.plan' }, 'no')
    await planned(h)
    await h.svc.generateVoice(h.slug, { lang: 'en' })
    await waitIdle(h.env, h.slug)
    const idx = await readIndex(h.env, h.slug, 'en')
    const maraClips = Object.values(idx).filter((e) => e.speaker === 'mara').length
    expect(maraClips).toBeGreaterThan(0)
    const name = (await h.svc.store.loadSettings(h.slug)).settings.voice.voices.mara!.slice(5)

    const p = await h.svc.designVoice(h.slug, { speakerKey: 'mara', description: 'Female, child, nonsense', seed: 77, lang: 'en' })
    const call = h.fake.created.at(-1)!
    expect(call).toMatchObject({ name, description: 'female, child', seed: 77, overwrite: true })
    expect(p).toMatchObject({ slug: h.slug, speakerKey: 'mara', voice: `omni:${name}`, file: 'preview/voice-mara.mp3', seed: 77, lang: 'en' })
    expect(existsSync(path.join(h.svc.store.dir(h.slug), 'preview', 'voice-mara.mp3'))).toBe(true)
    expect(h.fake.files.at(-1)).toMatchObject({ voice: `omni:${name}`, lang: 'en' })
    const after = await readIndex(h.env, h.slug, 'en')
    expect(Object.values(after).filter((e) => e.speaker === 'mara')).toHaveLength(0)

    const q = await h.svc.previewVoice(h.slug, 'tomas', 'omni:default', 'hr')
    expect(q).toMatchObject({ speakerKey: 'tomas', voice: 'omni:default', lang: 'hr' })
    expect(h.fake.files.at(-1)!.lang).toBe('hr')
    await expect(h.svc.designVoice(h.slug, { speakerKey: 'nobody', description: 'male' })).rejects.toThrow(/no character/)
  })
})
