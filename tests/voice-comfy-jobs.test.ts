import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFile } from '../src/engine/assets/manifest'
import type { ComfyRequest } from '../src/engine/comfy/client'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

/**
 * Voice clips from the local ComfyUI TTS engines: the default OmniVoice, per-language overrides, the hash skip, force regeneration,
 * reference clips and their transcripts, custom TTS workflows, per-clip failures, the preview and the index.
 */

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

interface Beat {
  id: string
  type: string
  speakerKey?: string | null
  text: string
}

async function setup(o: { hr?: boolean; langs?: ('en' | 'hr')[]; voice?: string; speed?: number } = {}) {
  env = await makeVnEnv({ sdk: false })
  const svc = env.engine.vn
  await writeVoiceConfig(env, o)
  const { slug } = await svc.importProject(book('linear-en'))
  if (o.hr) {
    await svc.addEdition(slug, book('linear-hr'), 'hr')
    await waitIdle(env, slug)
  }
  await svc.updateSettings(slug, { voice: { enabled: true, langs: o.langs ?? ['en'], ...(o.voice ? { engine: o.voice } : {}) } })
  return { env, svc, slug }
}
type Harness = Awaited<ReturnType<typeof setup>>

async function writeVoiceConfig(e: VnEnv, o: { speed?: number } = {}): Promise<void> {
  await mkdir(path.join(e.dir, 'config'), { recursive: true })
  await writeFile(path.join(e.dir, 'config', 'voice.md'), `---\nkind: voice\nformat: mp3\nspeed: ${o.speed ?? 1}\nchunkChars: 400\n---\n`)
}

const vdir = (h: Harness, lang = 'en') => path.join(h.env.dir, 'projects', h.slug, 'voice', lang)
const readIndex = async (h: Harness, lang = 'en'): Promise<Record<string, { hash: string; file: string; speaker?: string; engine?: string; seed?: number; imported?: boolean }>> =>
  JSON.parse(await readFile(path.join(vdir(h, lang), 'index.json'), 'utf8')) as Record<string, { hash: string; file: string; speaker?: string; engine?: string; seed?: number; imported?: boolean }>
const step = async (h: Harness) => (await h.svc.pipelineStatus(h.slug))?.steps.voice

/** The text beats of one language edition, in book order. */
async function beats(h: Harness, lang: 'en' | 'hr' = 'en'): Promise<Beat[]> {
  const bk = await h.svc.store.loadBook(h.slug)
  const edition = await h.svc.store.loadEdition(h.slug, lang)
  const out: Beat[] = []
  for (const c of bk.chapters)
    for (const s of c.scenes)
      for (const b of s.beats) {
        const text = edition.beats[b.id]?.trim()
        if (b.type === 'cast' || !text) continue
        out.push({ id: b.id, type: b.type, ...(b.type === 'line' ? { speakerKey: b.speakerKey } : {}), text })
      }
  return out
}

const tts = (h: Harness, engine = 'omnivoice') => h.env.comfy.requests.filter((r) => r.engine === engine)
const requestFor = (h: Harness, text: string, engine = 'omnivoice'): ComfyRequest => {
  const r = tts(h, engine).find((x) => x.text === text)
  if (!r) throw new Error(`no ${engine} request for "${text}"`)
  return r
}

async function generate(h: Harness, o: { lang?: 'en' | 'hr'; beatId?: string; limit?: number; force?: boolean; speakerKey?: string } = {}) {
  await h.svc.generateVoice(h.slug, { lang: 'en', ...o })
  return waitIdle(h.env, h.slug)
}

async function clip(h: Harness, name: string, content: string): Promise<string> {
  const dir = path.join(h.env.dir, 'clips')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, content)
  return file
}

async function voiceRefFile(h: Harness, key: string): Promise<string> {
  const entry = (await h.svc.store.loadAssets(h.slug)).assets.find((a) => a.id === `voice_${key}`)
  const file = entry ? resolveFile(h.svc.store.dir(h.slug), entry) : null
  if (!file) throw new Error(`no voice_${key} asset file`)
  return file
}

describe('voice clips from the local TTS engines', () => {
  it('makes one OmniVoice clip per beat in both languages, with the text, language, seed and format, and the speaker’s reference', async () => {
    const h = await setup({ hr: true, langs: ['en', 'hr'] })
    await h.svc.setVoiceRef(h.slug, 'mara', await clip(h, 'mara.wav', 'MARA VOICE'))
    await h.svc.setVoiceRef(h.slug, 'narrator', await clip(h, 'narrator.wav', 'NARRATOR VOICE'))
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'bright and quick' }, refTexts: { mara: 'mara transcript', narrator: 'the narrator speaks' } } })
    const en = await beats(h)
    const hr = await beats(h, 'hr')
    const r = await generate(h, { lang: undefined })
    expect(r.failed, (await failures(h.env)).join(' | ')).toEqual([])

    const requests = tts(h)
    expect(requests).toHaveLength(en.length + hr.length)
    for (const lang of ['en', 'hr'] as const) {
      const texts = requests.filter((x) => x.language === lang).map((x) => x.text)
      expect(texts.sort()).toEqual((lang === 'en' ? en : hr).map((b) => b.text).sort())
      for (const x of requests.filter((y) => y.language === lang)) {
        expect(x).toMatchObject({ language: lang, languageName: lang === 'en' ? 'English' : 'Croatian', format: 'mp3' })
        expect(typeof x.seed).toBe('number')
        expect(x.engine).toBe('omnivoice')
      }
    }
    // the mara clip clones Mara; the tomas line and the narration fall back to the narrator's clip
    const mara = en.find((b) => b.speakerKey === 'mara')!
    const tomas = en.find((b) => b.speakerKey === 'tomas')!
    const narration = en.find((b) => b.type === 'narration')!
    expect(requestFor(h, mara.text).voiceRef).toBe(await voiceRefFile(h, 'mara'))
    expect(requestFor(h, mara.text).voiceRefText).toBe('mara transcript')
    expect(requestFor(h, mara.text).instruct).toBe('bright and quick')
    expect(requestFor(h, tomas.text).voiceRef).toBe(await voiceRefFile(h, 'narrator'))
    expect(requestFor(h, tomas.text).voiceRefText).toBe('the narrator speaks')
    expect(requestFor(h, tomas.text).instruct).toBeUndefined()
    expect(requestFor(h, narration.text).voiceRef).toBe(await voiceRefFile(h, 'narrator'))

    // the index records the engine, the seed and the speaker of every clip
    const index = await readIndex(h)
    expect(Object.keys(index).sort()).toEqual(en.map((b) => b.id).sort())
    for (const [id, e] of Object.entries(index)) {
      expect(e).toMatchObject({ file: `${id}.mp3`, engine: 'omnivoice', speaker: en.find((b) => b.id === id)!.speakerKey ?? 'narrator' })
      expect(e.seed).toBe(requestFor(h, en.find((b) => b.id === id)!.text).seed)
      expect(existsSync(path.join(vdir(h), e.file))).toBe(true)
    }
    // the hr index has the same beats, made by the default engine too
    expect(Object.keys(await readIndex(h, 'hr')).sort()).toEqual(hr.map((b) => b.id).sort())
  })

  it('a per-language override is used, maps its language label, and skips the language it cannot read with the supported list', async () => {
    const h = await setup({ hr: true, langs: ['en', 'hr'] })
    await h.svc.updateSettings(h.slug, { voice: { engines: { hr: 'higgs-audio-v3' } } })
    expect((await generate(h, { lang: 'hr' })).failed).toEqual([])
    const higgs = tts(h, 'higgs-audio-v3')
    expect(higgs).toHaveLength((await beats(h, 'hr')).length)
    // Higgs infers the language from the text: no language input, so no languageName is sent
    expect(higgs.every((r) => r.language === 'hr' && r.languageName === undefined)).toBe(true)

    await h.svc.updateSettings(h.slug, { voice: { engines: { en: 'chatterbox-23lang' } } })
    expect((await generate(h, { lang: 'en' })).failed).toEqual([])
    const chat = tts(h, 'chatterbox-23lang')
    expect(chat).toHaveLength((await beats(h)).length)
    expect(chat.every((r) => r.engine === 'chatterbox-23lang' && r.languageName === 'English')).toBe(true)

    // Croatian is not a Chatterbox language: the job is skipped, and the message lists the codes it reads
    const before = h.env.comfy.requests.length
    await h.svc.updateSettings(h.slug, { voice: { engines: { hr: 'chatterbox-23lang' } } })
    expect((await generate(h, { lang: 'hr' })).failed).toEqual([])
    expect(h.env.comfy.requests).toHaveLength(before)
    const st = await step(h)
    expect(st?.status).toBe('skipped')
    expect(st?.message).toMatch(/voice for hr skipped: the engine "chatterbox-23lang" does not read hr \(it reads: ar, da,/)
  })

  it('keeps unchanged clips (no request), and a text, style, transcript, clip or speed change makes the matching clips again', async () => {
    const h = await setup()
    await h.svc.setVoiceRef(h.slug, 'mara', await clip(h, 'mara.wav', 'MARA V1'))
    await h.svc.setVoiceRef(h.slug, 'narrator', await clip(h, 'narrator.wav', 'NARRATOR V1'))
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'bright' }, refTexts: { mara: 'mara transcript', narrator: 'narrator transcript' } } })
    const en = await beats(h)
    expect((await generate(h)).failed).toEqual([])
    const total = tts(h).length
    expect(total).toBe(en.length)

    // run again: nothing changed, nothing is asked of ComfyUI
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h)).toHaveLength(total)
    expect((await step(h))?.message).toMatch(new RegExp(`voice en: 0 clip\\(s\\) made, ${total} unchanged`))

    // the edition text: one clip
    const firstMara = en.find((b) => b.speakerKey === 'mara')!
    await h.svc.updateEditionBeat(h.slug, 'en', firstMara.id, 'A completely new line for Mara.')
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h)).toHaveLength(total + 1)
    expect(tts(h).at(-1)!.text).toBe('A completely new line for Mara.')

    const maraIndex = async () => Object.values(await readIndex(h)).filter((e) => e.speaker === 'mara').length
    const maraClips = await maraIndex()
    // the delivery style of one speaker: only that speaker's clips
    let before = tts(h).length
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'gruff and slow' }, refTexts: { mara: 'mara transcript', narrator: 'narrator transcript' } } })
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h).length).toBe(before + maraClips)
    expect(tts(h).slice(before).every((r) => r.instruct === 'gruff and slow')).toBe(true)

    // the transcript of the clip: the speaker's clips again
    before = tts(h).length
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'gruff and slow' }, refTexts: { mara: 'a longer transcript', narrator: 'narrator transcript' } } })
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h).length).toBe(before + maraClips)
    expect(tts(h).slice(before).every((r) => r.voiceRefText === 'a longer transcript')).toBe(true)

    // a replaced reference clip: the speaker's clips again
    before = tts(h).length
    await h.svc.setVoiceRef(h.slug, 'mara', await clip(h, 'mara-v2.wav', 'MARA V2'))
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h).length).toBe(before + maraClips)

    // the configured speed changes the sound of every built-in clip
    before = tts(h).length
    await writeVoiceConfig(h.env, { speed: 1.5 })
    expect((await generate(h)).failed).toEqual([])
    expect(tts(h).length).toBe(before + total)
    expect(tts(h).slice(-total).every((r) => r.speed === 1.5)).toBe(true)
  })

  it('keeps imported clips on a regeneration and says how many were kept', async () => {
    const h = await setup()
    await h.svc.updateSettings(h.slug, { voice: { styles: { narrator: 'calm' } } })
    expect((await generate(h)).failed).toEqual([])
    const en = await beats(h)
    const narration = en.find((b) => b.type === 'narration')!
    await h.svc.importVoice(h.slug, 'en', { beatId: narration.id, file: await clip(h, 'mine.mp3', 'MY CLIP') }, { rebuild: false })
    const before = tts(h).length
    await h.svc.updateSettings(h.slug, { voice: { styles: { narrator: 'a different calm' } } })
    expect((await generate(h)).failed).toEqual([])
    const made = tts(h).slice(before)
    expect(made.some((r) => r.text === narration.text)).toBe(false)
    expect((await step(h))?.message).toMatch(/1 imported clip\(s\) kept/)
    expect((await readIndex(h))[narration.id]).toMatchObject({ imported: true, file: `${narration.id}.mp3` })
    expect(await readFile(path.join(vdir(h), `${narration.id}.mp3`), 'utf8')).toBe('MY CLIP')
  })

  it('force regenerates unchanged clips with fresh seeds, and speakerKey, beatId and limit scope it', async () => {
    const h = await setup()
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'bright' } } })
    expect((await generate(h)).failed).toEqual([])
    const en = await beats(h)
    const total = tts(h).length

    // force: every clip again, with a new seed
    const seeds = new Map(en.map((b) => [b.text, requestFor(h, b.text).seed]))
    expect((await generate(h, { force: true })).failed).toEqual([])
    const forced = tts(h).slice(total)
    expect(forced).toHaveLength(total)
    for (const b of en) expect(forced.find((r) => r.text === b.text)!.seed).not.toBe(seeds.get(b.text))

    // speakerKey: only Mara's clips
    const maraBeats = en.filter((b) => b.speakerKey === 'mara')
    let before = tts(h).length
    expect((await generate(h, { force: true, speakerKey: 'mara' })).failed).toEqual([])
    expect(tts(h).slice(before)).toHaveLength(maraBeats.length)
    expect(new Set(tts(h).slice(before).map((r) => r.text))).toEqual(new Set(maraBeats.map((b) => b.text)))

    // beatId: one clip; limit: at most N
    const one = maraBeats[0]!
    before = tts(h).length
    expect((await generate(h, { force: true, beatId: one.id })).failed).toEqual([])
    expect(tts(h).slice(before)).toHaveLength(1)
    expect(tts(h).at(-1)!.text).toBe(one.text)
    before = tts(h).length
    expect((await generate(h, { force: true, limit: 2 })).failed).toEqual([])
    expect(tts(h).slice(before)).toHaveLength(2)
    expect((await step(h))?.message).toMatch(/left \(limit 2\)/)
  })

  it('counts a failed clip and continues; fails the job when every clip fails', async () => {
    const h = await setup()
    const en = await beats(h)
    const bad = en[0]!
    h.env.comfy.fail.add(bad.text)
    expect((await generate(h)).failed).toEqual([])
    expect(Object.keys(await readIndex(h))).not.toContain(bad.id)
    expect((await step(h))?.message).toMatch(/1 failed \(.*ComfyUI exploded/)
    expect((await step(h))?.message).toMatch(/clip\(s\) made/)
    expect(tts(h)).toHaveLength(en.length) // the other clips went on

    h.env.comfy.fail.clear()
    for (const b of en) h.env.comfy.fail.add(b.text)
    const r = await generate(h, { force: true })
    expect(r.failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toMatch(/voice en: all \d+ clip\(s\) failed/)
  })

  it('keeps an OmniVoice clip without a transcript readable by generating ref-free from the style, and says how to clone', async () => {
    const h = await setup()
    await h.svc.setVoiceRef(h.slug, 'mara', await clip(h, 'mara.wav', 'MARA VOICE'))
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'a warm whisper' } } })
    expect((await generate(h)).failed).toEqual([])
    const mara = (await beats(h)).find((b) => b.speakerKey === 'mara')!
    const r = requestFor(h, mara.text)
    expect(r.voiceRef).toBeUndefined() // only used with its transcript
    expect(r.voiceRefText).toBeUndefined()
    expect(r.instruct).toBe('a warm whisper')
  })

  it('rejects an unknown or non-TTS engine with the ids it can use', async () => {
    const h = await setup()
    await h.svc.updateSettings(h.slug, { voice: { engine: 'not-an-engine' } })
    const r = await generate(h)
    expect(r.failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toMatch(/"not-an-engine" is not a voice engine: use one of omnivoice, higgs-audio-v3, chatterbox-23lang/)

    await h.svc.updateSettings(h.slug, { voice: { engine: 'moss-soundeffect-v2' } })
    const r2 = await generate(h)
    expect(r2.failed).toHaveLength(1)
    expect((await failures(h.env)).join('|')).toMatch(/"moss-soundeffect-v2" is not a voice engine/)
    expect(h.env.comfy.requests).toHaveLength(0)
  })

  it('runs a custom TTS workflow for a language its mapping declares, and skips one it does not', async () => {
    const h = await setup({ hr: true, langs: ['en', 'hr'] })
    await h.svc.setVoiceRef(h.slug, 'narrator', await clip(h, 'narrator.wav', 'NARRATOR VOICE'))
    await h.svc.updateSettings(h.slug, { voice: { engines: { en: 'custom:chatterbox-multilingual' } } })
    expect((await generate(h, { lang: 'en' })).failed).toEqual([])
    const en = await beats(h)
    const custom = tts(h, 'custom:chatterbox-multilingual')
    expect(custom).toHaveLength(en.length)
    expect(custom[0]).toMatchObject({ language: 'en', format: 'mp3' })
    expect(custom[0]!.voiceRef).toBe(await voiceRefFile(h, 'narrator'))
    const index = await readIndex(h)
    expect(Object.values(index).every((e) => e.file.endsWith('.flac') && e.engine === 'custom:chatterbox-multilingual')).toBe(true)

    // Croatian is deliberately missing from the seed mapping: nothing is submitted, and the message lists the codes it declares
    const before = h.env.comfy.requests.length
    await h.svc.updateSettings(h.slug, { voice: { engines: { hr: 'custom:chatterbox-multilingual' } } })
    expect((await generate(h, { lang: 'hr' })).failed).toEqual([])
    expect(h.env.comfy.requests).toHaveLength(before)
    expect((await step(h))?.status).toBe('skipped')
    expect((await step(h))?.message).toMatch(/voice for hr skipped: the engine "custom:chatterbox-multilingual" does not read hr \(it reads: en,/)
  })

  it('a preview writes preview/voice-<speaker>.<ext> and reports the engine that made it', async () => {
    const h = await setup()
    await h.svc.updateSettings(h.slug, { voice: { styles: { mara: 'bright' } } })
    const p = await h.svc.previewVoice(h.slug, 'mara', undefined, 'en')
    expect(p).toMatchObject({ slug: h.slug, speakerKey: 'mara', voice: 'omnivoice', file: 'preview/voice-mara.mp3', lang: 'en' })
    expect(existsSync(path.join(h.svc.store.dir(h.slug), 'preview', 'voice-mara.mp3'))).toBe(true)
    const req = h.env.comfy.requests.at(-1)!
    expect(req).toMatchObject({ engine: 'omnivoice', language: 'en', languageName: 'English', instruct: 'bright', format: 'mp3' })
    expect((req.text ?? '').length).toBeGreaterThan(0)
    await expect(h.svc.previewVoice(h.slug, 'ghost', undefined, 'en')).rejects.toThrow(/no character "ghost"/)
  })
})
