import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Lang } from '../../shared/vn'
import type { PlanVoices } from '../vn/agents/voice-director'
import { speakerOf, voiceSubjects } from '../vn/agents/voice-director'
import type { VnService } from '../vn/service'
import { NARRATOR, SUPERTONIC_HINT, guessGender, parseGender, pickVoices, readsLang, voiceLangsOf, voicesFor } from './catalog'
import type { VoiceWish } from './catalog'
import type { VoiceConfig } from './config'
import { VibeTtsError } from './vibetts'
import type { BatchItem, VibeTtsClient, VibeVoiceList } from './vibetts'
import { sha1, slugVoiceName } from './vocab'

export const PLAN_HINT = 'run Plan voices: it assigns a VibeTTS voice per character and language'

/** One clip in `voice/<lang>/index.json`: the hash of what it was made from, and the file. `speaker` is the voice slot it used. */
export interface VoiceIndexEntry {
  hash: string
  file: string
  speaker?: string
  /** A clip you imported (`vno_voice_import`): generation keeps it, and a speaker change does not drop it. */
  imported?: true
  /** The hash of the edition text the imported clip was made for (to tell when the text changed since). */
  textHash?: string
}

export const voiceDirOf = (svc: VnService, slug: string, lang: Lang): string => path.join(svc.store.dir(slug), 'voice', lang)

export async function readVoiceIndexIn(dir: string): Promise<Record<string, VoiceIndexEntry>> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8')) as Record<string, VoiceIndexEntry>
  } catch {
    return {}
  }
}

export const writeVoiceIndex = (dir: string, index: Record<string, VoiceIndexEntry>): Promise<void> => fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2))

interface RunOpts {
  log: (message: string) => void
  signal?: AbortSignal
}

/** Forgets the clips of one voice slot, in one language or in all (they are made again by the next generate). The files stay until they are replaced. */
export async function invalidateSpeaker(svc: VnService, slug: string, speaker: string, only?: Lang): Promise<number> {
  let n = 0
  const root = path.join(svc.store.dir(slug), 'voice')
  if (!existsSync(root)) return 0
  for (const lang of await fs.readdir(root)) {
    if (only && lang !== only) continue
    const dir = path.join(root, lang)
    const index = await readVoiceIndexIn(dir)
    let changed = false
    for (const [beat, e] of Object.entries(index))
      if (e.speaker === speaker && !e.imported) {
        delete index[beat]
        changed = true
        n++
      }
    if (changed) await writeVoiceIndex(dir, index)
  }
  return n
}

/**
 * vn.voice.plan with the VibeTTS provider: a voice for every speaking character and the narrator, in every language of the project.
 * `plan` is the voice-director's answer (null when it did not answer: gender and voices come from the bible). A voice that is already
 * mapped and still reads its language is kept unless `overwrite`. The mapping goes to the project's `voice.voices`.
 */
export async function planVibeVoices(svc: VnService, slug: string, plan: PlanVoices | null, opts: RunOpts & { overwrite?: boolean; listed?: VibeVoiceList; /** Where the voices come from, for the messages. Default VibeTTS. */ source?: string }): Promise<string> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const langs = voiceLangsOf(settings)
  const listed = opts.listed ?? (await (await svc.vibetts()).client.listVoices(opts.signal))
  if (langs.some((l) => l !== 'en') && listed.supertonic_installed === false) throw new Error(SUPERTONIC_HINT)
  const engine = settings.voice.englishEngine ?? 'kokoro'
  const subjects = voiceSubjects(book)
  const voices = Object.fromEntries(Object.entries(settings.voice.voices).map(([k, v]) => [k, { ...v }]))
  const changed: { key: string; lang: Lang }[] = []
  let made = 0
  let kept = 0
  try {
    for (const lang of langs) {
      opts.signal?.throwIfAborted()
      const candidates = voicesFor(listed.voices, lang, engine)
      const source = opts.source ?? 'VibeTTS'
      if (!candidates.length) throw new Error(lang === 'en' ? `${source} lists no voice that reads English` : source === 'VibeTTS' ? `${SUPERTONIC_HINT} (no listed voice reads ${lang})` : `${source} has no voice that reads ${lang}: set up the Gemini key in flow-music-mcp (flow_set_key) or install a Windows voice for it`)
      const wishes: VoiceWish[] = []
      const given: string[] = []
      for (const s of subjects) {
        const cur = voices[s.speakerKey]?.[lang]
        if (cur && readsLang(listed.voices, cur, lang) && !opts.overwrite) {
          kept++
          given.push(cur)
          continue
        }
        const proposed = plan?.voices.find((v) => speakerOf(v) === s.speakerKey)
        const asked = proposed?.voices?.[lang]
        const preferred = asked && candidates.some((v) => v.id === asked) ? asked : undefined
        wishes.push({ key: s.speakerKey, gender: parseGender(proposed?.gender) ?? guessGender({ key: s.speakerKey, name: s.name, looks: s.looks, voiceHint: s.voiceHint }), preferred })
      }
      const picked = pickVoices(wishes, candidates, given)
      for (const [key, id] of Object.entries(picked)) {
        const old = voices[key]?.[lang]
        voices[key] = { ...voices[key], [lang]: id }
        if (old !== id) changed.push({ key, lang })
        opts.log(`voice ${id} for ${key} (${lang})${plan ? '' : ' [from the bible]'}`)
        made++
      }
    }
  } finally {
    if (changed.length) {
      await svc.updateSettings(slug, { voice: { voices } })
      for (const c of changed) await invalidateSpeaker(svc, slug, c.key, c.lang)
    }
  }
  return `${made} voice(s) assigned, ${kept} kept${plan ? '' : ' (from the bible: the voice-director did not answer)'}`
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
  const voiceOf = (speaker: string): string | undefined => settings.voice.voices[speaker]?.[lang]
  if (!Object.keys(settings.voice.voices).some((k) => voiceOf(k))) {
    return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: no ${lang} voices are planned yet (${PLAN_HINT})` }
  }
  const { speed, format } = o.config
  const dir = voiceDirOf(svc, slug, lang)
  await fs.mkdir(dir, { recursive: true })
  const index = await readVoiceIndexIn(dir)
  let kept = 0
  let skipped = 0
  let importedKept = 0
  let importedStale = 0
  const missing = new Set<string>()
  const todo: { beatId: string; slot: string; voice: string; text: string; hash: string; file: string }[] = []
  for (const chapter of book.chapters)
    for (const scene of chapter.scenes)
      for (const beat of scene.beats) {
        if (beat.type === 'cast' || (o.beatId && beat.id !== o.beatId)) continue
        const text = edition.beats[beat.id]?.trim()
        if (!text) continue
        // a clip you imported is never made again
        const mine = index[beat.id]
        if (mine?.imported && existsSync(path.join(dir, mine.file))) {
          importedKept++
          if (mine.textHash !== sha1(text)) importedStale++
          continue
        }
        const own = beat.type === 'line' && beat.speakerKey && voiceOf(beat.speakerKey) ? beat.speakerKey : NARRATOR
        const voice = voiceOf(own)
        if (!voice) {
          skipped++
          missing.add(own)
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
  if (importedKept) parts.push(importedClipsNote(importedKept, importedStale))
  if (todo.length > work.length) parts.push(`${todo.length - work.length} left (limit ${o.limit})`)
  if (failed) parts.push(`${failed} failed (${errors.join('; ')})`)
  if (skipped) parts.push(`${skipped} skipped: no ${lang} voice for ${[...missing].join(', ')} (${PLAN_HINT})`)
  return { made, kept, failed, skipped, status: 'done', message: `voice ${lang}: ${parts.join('; ')}` }
}

/** `2 imported clip(s) kept` (and `1 of them for text that changed`). */
export const importedClipsNote = (kept: number, stale: number): string => `${kept} imported clip(s) kept${stale ? ` (${stale} of them for text that changed)` : ''}`

export interface VoiceImportResult {
  lang: Lang
  /** Beat ids that now have an imported clip. */
  imported: string[]
  /** File names (or beat ids) that match no text beat of the project. */
  unknown: string[]
}

const CLIP_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.opus', '.flac', '.m4a']

/**
 * Takes voice clips you made (or recorded) for one language: a single `file` for `beatId`, or a `folder` whose files are named
 * `<beatId>.<ext>`. They are copied to `voice/<lang>/<beatId>.<ext>` and recorded as imported, so the generators keep them. A name that is
 * not a text beat of the book is reported in `unknown`, and nothing is done for it.
 */
export async function importVoiceClips(svc: VnService, slug: string, lang: Lang, from: { beatId: string; file: string } | { folder: string }): Promise<VoiceImportResult> {
  const book = await svc.store.loadBook(slug)
  const edition = await svc.store.loadEdition(slug, lang).catch(() => null)
  if (!edition) throw new Error(`${slug} has no ${lang} edition: add it first`)
  const textBeats = new Set<string>()
  for (const c of book.chapters) for (const s of c.scenes) for (const b of s.beats) if (b.type !== 'cast') textBeats.add(b.id)
  const files: { beatId: string; file: string }[] = []
  const unknown: string[] = []
  if ('folder' in from) {
    if (!existsSync(from.folder)) throw new Error(`no such folder: ${from.folder}`)
    for (const name of (await fs.readdir(from.folder)).sort()) {
      const ext = path.extname(name).toLowerCase()
      if (!CLIP_EXTENSIONS.includes(ext)) continue
      const beatId = path.basename(name, path.extname(name))
      if (textBeats.has(beatId)) files.push({ beatId, file: path.join(from.folder, name) })
      else unknown.push(name)
    }
  } else {
    if (!existsSync(from.file)) throw new Error(`no such file: ${from.file}`)
    if (!CLIP_EXTENSIONS.includes(path.extname(from.file).toLowerCase())) throw new Error(`a voice clip is ${CLIP_EXTENSIONS.join(', ')} (got ${path.extname(from.file) || 'no extension'})`)
    if (!textBeats.has(from.beatId)) throw new Error(`no text beat ${from.beatId} in ${slug} (vno_get_edition lists them)`)
    files.push(from)
  }
  const dir = voiceDirOf(svc, slug, lang)
  await fs.mkdir(dir, { recursive: true })
  const index = await readVoiceIndexIn(dir)
  const imported: string[] = []
  for (const f of files) {
    const ext = path.extname(f.file).toLowerCase()
    const name = `${f.beatId}${ext}`
    const old = index[f.beatId]
    if (old && old.file !== name) await fs.rm(path.join(dir, old.file), { force: true })
    await fs.copyFile(f.file, path.join(dir, name))
    const bytes = await fs.readFile(path.join(dir, name))
    index[f.beatId] = { hash: `import:${sha1(bytes.toString('latin1'))}`, file: name, imported: true, textHash: sha1(edition.beats[f.beatId]?.trim() ?? '') }
    imported.push(f.beatId)
  }
  await writeVoiceIndex(dir, index)
  return { lang, imported, unknown }
}

// ---- the Voice tab: set a voice, preview a voice ----

const SAMPLE: Record<string, string> = {
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
  lang: Lang
}

/**
 * A sample sentence for a speaker: one of their lines in this language, else a fixed sentence (English and Croatian have one),
 * else any line of the edition, else its title.
 */
export async function sampleText(svc: VnService, slug: string, speakerKey: string, lang: Lang): Promise<string> {
  const clip = (text: string): string => (text.length > 180 ? text.slice(0, 180).replace(/\s+\S*$/, '') + '...' : text)
  let any = ''
  let title = ''
  try {
    const book = await svc.store.loadBook(slug)
    const edition = await svc.store.loadEdition(slug, lang)
    title = edition.title?.trim() ?? ''
    for (const c of book.chapters)
      for (const s of c.scenes)
        for (const b of s.beats) {
          const text = edition.beats[b.id]?.trim()
          if (!text) continue
          const mine = speakerKey === 'narrator' ? b.type === 'narration' : b.type === 'line' && b.speakerKey === speakerKey
          if (mine && text.length >= 20) return clip(text)
          if (!any) any = text
        }
  } catch {
    /* the fixed sentence */
  }
  return SAMPLE[lang] ?? (any ? clip(any) : title || 'Hello.')
}

/** Makes the preview clip of a voice (`preview/voice-<key>.mp3`, replaced each time). */
export async function previewVoice(svc: VnService, slug: string, speakerKey: string, voice: string, lang: Lang): Promise<VoicePreview> {
  const { client, config } = await svc.vibetts()
  const rel = `preview/voice-${slugVoiceName(speakerKey) || 'speaker'}.mp3`
  const out = path.join(svc.store.dir(slug), ...rel.split('/'))
  await fs.mkdir(path.dirname(out), { recursive: true })
  await client.synthesizeToFile({ text: await sampleText(svc, slug, speakerKey, lang), output: out, voice, lang, speed: config.speed, overwrite: true })
  return { slug, speakerKey, voice, file: rel, rev: Date.now(), lang }
}

/**
 * Gives a speaker the VibeTTS voice `voice` for one language, forgets that speaker's clips in it and returns a preview clip.
 * The voice must be listed by VibeTTS and read the language (a Kokoro voice cannot read Croatian).
 */
export async function setVoice(svc: VnService, slug: string, speakerKey: string, lang: Lang, voice: string): Promise<VoicePreview> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  if (speakerKey !== NARRATOR && !book.characters.some((c) => c.key === speakerKey)) throw new Error(`no character "${speakerKey}" in ${slug}`)
  const { client } = await svc.vibetts()
  const listed = await client.listVoices()
  if (!readsLang(listed.voices, voice, lang)) {
    const hint = voice.startsWith('supertonic:') && listed.supertonic_installed === false ? `: ${SUPERTONIC_HINT}` : ''
    throw new Error(`VibeTTS has no voice "${voice}" that reads ${lang}${hint}`)
  }
  const cur = settings.voice.voices
  await svc.updateSettings(slug, { voice: { voices: { ...cur, [speakerKey]: { ...cur[speakerKey], [lang]: voice } } } })
  await invalidateSpeaker(svc, slug, speakerKey, lang)
  return previewVoice(svc, slug, speakerKey, voice, lang)
}

/** True for the error that means VibeTTS is not reachable (the Voice tab shows its message). */
export const isUnreachable = (e: unknown): boolean => e instanceof VibeTtsError && e.kind === 'unreachable'
