import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Lang } from '../../shared/vn'
import type { PlanVoices } from '../vn/agents/voice-director'
import { speakerOf, voiceSubjects } from '../vn/agents/voice-director'
import type { VnService } from '../vn/service'
import type { VoiceConfig } from './config'
import { VibeTtsError } from './vibetts'
import type { BatchItem, VibeTtsClient } from './vibetts'
import { completeSpec, fallbackSpec, sanitizeDescription, sanitizeSeed, sha1, slugVoiceName, uniqueName, voiceNameFor } from './vocab'

/** One clip in `voice/<lang>/index.json`: the hash of what it was made from, and the file. `speaker` is the voice slot it used. */
export interface VoiceIndexEntry {
  hash: string
  file: string
  speaker?: string
}

export const voiceDirOf = (svc: VnService, slug: string, lang: Lang): string => path.join(svc.store.dir(slug), 'voice', lang)

export async function readVoiceIndexIn(dir: string): Promise<Record<string, VoiceIndexEntry>> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8')) as Record<string, VoiceIndexEntry>
  } catch {
    return {}
  }
}

const writeVoiceIndex = (dir: string, index: Record<string, VoiceIndexEntry>): Promise<void> => fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2))

interface RunOpts {
  log: (message: string) => void
  signal?: AbortSignal
}

/** Forgets the clips of one voice slot (they are made again by the next generate). The files stay until they are replaced. */
export async function invalidateSpeaker(svc: VnService, slug: string, speaker: string): Promise<number> {
  let n = 0
  const root = path.join(svc.store.dir(slug), 'voice')
  if (!existsSync(root)) return 0
  for (const lang of await fs.readdir(root)) {
    const dir = path.join(root, lang)
    const index = await readVoiceIndexIn(dir)
    let changed = false
    for (const [beat, e] of Object.entries(index))
      if (e.speaker === speaker) {
        delete index[beat]
        changed = true
        n++
      }
    if (changed) await writeVoiceIndex(dir, index)
  }
  return n
}

/**
 * vn.voice.plan with the VibeTTS provider: a voice for every speaking character and the narrator. `plan` is the voice-director's
 * answer (null when it did not answer: the deterministic voices from the bible are used). A voice that is already mapped and
 * still exists in VibeTTS is kept unless `overwrite`. The mapping goes to the project's `voice.voices`.
 */
export async function planVibeVoices(svc: VnService, slug: string, plan: PlanVoices | null, opts: RunOpts & { overwrite?: boolean }): Promise<string> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const { client } = await svc.vibetts()
  const listed = await client.listVoices(opts.signal)
  const known = new Set(listed.voices.map((v) => v.id))
  const taken = new Set(listed.voices.map((v) => v.id.replace(/^omni:/, '')))
  const voices = { ...settings.voice.voices }
  let made = 0
  let kept = 0
  try {
    for (const s of voiceSubjects(book)) {
      opts.signal?.throwIfAborted()
      const cur = voices[s.speakerKey]
      if (cur && known.has(cur) && !opts.overwrite) {
        kept++
        continue
      }
      const proposed = plan?.voices.find((v) => speakerOf(v) === s.speakerKey)
      const hints = { key: s.speakerKey, name: s.name, looks: s.looks, voiceHint: s.voiceHint }
      const spec = proposed ? completeSpec(proposed, hints) : fallbackSpec(hints)
      const own = cur?.startsWith('omni:') && cur !== 'omni:default' ? cur.slice(5) : ''
      const reuse = own !== '' && (opts.overwrite || !known.has(cur!))
      const name = reuse ? own : uniqueName(voiceNameFor(slug, s.speakerKey, proposed?.voiceName), taken)
      const r = await client.createVoice({ name, description: spec.description, seed: spec.seed, lang: book.primaryLang, overwrite: reuse && known.has(cur!) }, opts.signal)
      voices[s.speakerKey] = r.voice
      taken.add(name)
      known.add(r.voice)
      if (opts.overwrite) await invalidateSpeaker(svc, slug, s.speakerKey)
      opts.log(`voice ${r.voice} for ${s.speakerKey}: ${r.description || '(random)'} (seed ${r.seed})${proposed ? '' : ' [from the bible]'}`)
      made++
    }
  } finally {
    if (made) await svc.updateSettings(slug, { voice: { voices } })
  }
  return `${made} voice(s) created in VibeTTS, ${kept} kept${plan ? '' : ' (descriptions from the bible: the voice-director did not answer)'}`
}

export interface GenerateOpts extends RunOpts {
  beatId?: string
  /** Makes at most this many clips (for a quick try). */
  limit?: number
  client: VibeTtsClient
  config: VoiceConfig
}

export interface GenerateResult {
  made: number
  kept: number
  failed: number
  skipped: number
  message: string
  /** `skipped` when nothing could be done (no edition, no voices). */
  status: 'done' | 'skipped'
}

/**
 * vn.voice.generate with the VibeTTS provider, for one language: clips of beats whose text, voice, language, speed and format
 * changed go through `synthesize_batch` in chunks (`config.chunkSize`), the index is saved after each chunk, so a stopped job
 * continues where it was. Lines use their speaker's voice; narration, and speakers without a voice, the narrator's.
 */
export async function generateVibeClips(svc: VnService, slug: string, lang: Lang, o: GenerateOpts): Promise<GenerateResult> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const edition = await svc.store.loadEdition(slug, lang).catch(() => null)
  if (!edition) return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: the project has no ${lang} edition` }
  const voices = settings.voice.voices
  if (!Object.keys(voices).length) {
    return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: no voices are planned yet (run Plan voices: it creates a VibeTTS voice per character)` }
  }
  const { speed, format } = o.config
  const dir = voiceDirOf(svc, slug, lang)
  await fs.mkdir(dir, { recursive: true })
  const index = await readVoiceIndexIn(dir)
  let kept = 0
  let skipped = 0
  const todo: { beatId: string; slot: string; voice: string; text: string; hash: string; file: string }[] = []
  for (const chapter of book.chapters)
    for (const scene of chapter.scenes)
      for (const beat of scene.beats) {
        if (beat.type === 'cast' || (o.beatId && beat.id !== o.beatId)) continue
        const text = edition.beats[beat.id]?.trim()
        if (!text) continue
        const own = beat.type === 'line' && beat.speakerKey && voices[beat.speakerKey] ? beat.speakerKey : 'narrator'
        const voice = voices[own]
        if (!voice) {
          skipped++
          continue
        }
        const hash = sha1(['vibetts', voice, lang, speed, format, text].join('\u0000'))
        const file = `${beat.id}.${format}`
        const known = index[beat.id]
        if (known && known.hash === hash && known.file === file && existsSync(path.join(dir, file))) {
          kept++
          continue
        }
        todo.push({ beatId: beat.id, slot: own, voice, text, hash, file })
      }
  const work = o.limit ? todo.slice(0, o.limit) : todo
  let made = 0
  let failed = 0
  const errors: string[] = []
  for (let i = 0; i < work.length; i += o.config.chunkSize) {
    o.signal?.throwIfAborted()
    const chunk = work.slice(i, i + o.config.chunkSize)
    const items: BatchItem[] = chunk.map((t) => ({ text: t.text, output: path.join(dir, t.file), voice: t.voice, lang, speed }))
    let rows
    try {
      rows = (await o.client.synthesizeBatch(items, { overwrite: true, signal: o.signal })).results
    } catch (e) {
      if (o.signal?.aborted) void o.client.stop(true)
      throw e
    }
    chunk.forEach((t, k) => {
      const row = rows[k]
      if (row?.ok) {
        const old = index[t.beatId]
        if (old && old.file !== t.file) void fs.rm(path.join(dir, old.file), { force: true })
        index[t.beatId] = { hash: t.hash, file: t.file, speaker: t.slot }
        made++
      } else {
        failed++
        if (errors.length < 3) errors.push(`${t.beatId}: ${row?.error ?? 'no result'}`)
      }
    })
    await writeVoiceIndex(dir, index)
    o.log(`voice ${lang}: ${made + failed}/${work.length} clips`)
    await svc.setStep(slug, 'voice', 'running', `voice ${lang}: ${made + failed}/${work.length} clips`, { done: made + failed, total: work.length })
  }
  if (!work.length) await writeVoiceIndex(dir, index)
  if (failed && !made) throw new Error(`voice ${lang}: all ${failed} clip(s) failed: ${errors.join('; ')}`)
  const parts = [`${made} clip(s) made, ${kept} unchanged`]
  if (todo.length > work.length) parts.push(`${todo.length - work.length} left (limit ${o.limit})`)
  if (failed) parts.push(`${failed} failed (${errors.join('; ')})`)
  if (skipped) parts.push(`${skipped} skipped: no narrator voice`)
  return { made, kept, failed, skipped, status: 'done', message: `voice ${lang}: ${parts.join('; ')}` }
}

// ---- the Voice tab: design a voice, preview a voice ----

const SAMPLE: Record<Lang, string> = {
  en: 'Good evening. I hope you are ready for what comes next.',
  hr: 'Dobra večer. Nadam se da ste spremni za ono što slijedi.'
}

export interface VoicePreview {
  slug: string
  speakerKey: string
  voice: string
  /** Relative to the project folder (`preview/voice-<key>.mp3`). */
  file: string
  rev: number
  description: string
  seed: number | null
  lang: Lang
}

/** A sample sentence for a speaker: one of their lines in this language, else a fixed sentence. */
async function sampleText(svc: VnService, slug: string, speakerKey: string, lang: Lang): Promise<string> {
  try {
    const book = await svc.store.loadBook(slug)
    const edition = await svc.store.loadEdition(slug, lang)
    for (const c of book.chapters)
      for (const s of c.scenes)
        for (const b of s.beats) {
          const mine = speakerKey === 'narrator' ? b.type === 'narration' : b.type === 'line' && b.speakerKey === speakerKey
          const text = mine ? edition.beats[b.id]?.trim() : ''
          if (text && text.length >= 20) return text.length > 180 ? text.slice(0, 180).replace(/\s+\S*$/, '') + '...' : text
        }
  } catch {
    /* the fixed sentence */
  }
  return SAMPLE[lang]
}

/** Makes the preview clip of a voice (`preview/voice-<key>.mp3`, replaced each time). */
export async function previewVoice(svc: VnService, slug: string, speakerKey: string, voice: string, lang: Lang, extra: { description?: string; seed?: number | null } = {}): Promise<VoicePreview> {
  const { client, config } = await svc.vibetts()
  const rel = `preview/voice-${slugVoiceName(speakerKey) || 'speaker'}.mp3`
  const out = path.join(svc.store.dir(slug), ...rel.split('/'))
  await fs.mkdir(path.dirname(out), { recursive: true })
  await client.synthesizeToFile({ text: await sampleText(svc, slug, speakerKey, lang), output: out, voice, lang, speed: config.speed, overwrite: true })
  return { slug, speakerKey, voice, file: rel, rev: Date.now(), description: extra.description ?? '', seed: extra.seed ?? null, lang }
}

/**
 * Creates (or, for "Try another", replaces) the voice of a speaker from a description and a seed, assigns it to the speaker,
 * forgets that speaker's clips and returns a preview clip.
 */
export async function designVoice(svc: VnService, slug: string, a: { speakerKey: string; description: string; seed?: number; lang?: Lang }): Promise<VoicePreview> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  if (a.speakerKey !== 'narrator' && !book.characters.some((c) => c.key === a.speakerKey)) throw new Error(`no character "${a.speakerKey}" in ${slug}`)
  const { client } = await svc.vibetts()
  const listed = await client.listVoices()
  const known = new Set(listed.voices.map((v) => v.id))
  const taken = new Set(listed.voices.map((v) => v.id.replace(/^omni:/, '')))
  const cur = settings.voice.voices[a.speakerKey]
  const own = cur?.startsWith('omni:') && cur !== 'omni:default' ? cur.slice(5) : ''
  const name = own || uniqueName(voiceNameFor(slug, a.speakerKey), taken)
  const seed = sanitizeSeed(a.seed, Math.floor(Math.random() * 1_000_000))
  const description = sanitizeDescription(a.description)
  const r = await client.createVoice({ name, description, seed, lang: settings.primaryLang, overwrite: own !== '' && known.has(cur!) })
  await svc.updateSettings(slug, { voice: { voices: { ...settings.voice.voices, [a.speakerKey]: r.voice } } })
  await invalidateSpeaker(svc, slug, a.speakerKey)
  return previewVoice(svc, slug, a.speakerKey, r.voice, a.lang ?? settings.primaryLang, { description: r.description, seed: r.seed })
}

/** True for the error that means VibeTTS is not reachable (the Voice tab shows its message). */
export const isUnreachable = (e: unknown): boolean => e instanceof VibeTtsError && e.kind === 'unreachable'
