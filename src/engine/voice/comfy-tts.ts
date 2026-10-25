import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { AssetManifest, Lang, ProjectSettings } from '../../shared/vn'
import { resolveVoiceEngine } from '../../shared/vn'
import { resolveFile } from '../assets/manifest'
import type { ComfyClient } from '../comfy/client'
import { loadCustomWorkflow } from '../comfy/custom-workflow'
import type { CustomWorkflow } from '../comfy/custom-workflow'
import { ENGINES, randomSeed } from '../comfy/graphs'
import type { EngineDef } from '../comfy/graphs'
import { VOICE_ENGINE_IDS, engineLanguageValue, engineReadsLanguage } from '../comfy/tts-engines'
import { dataFolders } from '../vn/project'
import type { VnService } from '../vn/service'
import { NARRATOR } from './catalog'
import type { VoiceConfig } from './config'
import { importedClipsNote, readVoiceIndexIn, sampleText, voiceDirOf, writeVoiceIndex } from './jobs'
import type { GenerateResult, VoiceIndexEntry, VoicePreview } from './jobs'
import { sha1, slugVoiceName } from './vocab'

/**
 * Voice clips from the local ComfyUI TTS engines (the TTS Audio Suite), built-in or `custom:<workflow>`.
 *
 * Each clip is hashed from everything that changes its sound (`tts1|engine|lang|reference hash|transcript|style|format|chunk
 * length|speed|text`), so a second run of an unchanged project makes no ComfyUI request. The index is saved after every clip, so
 * a stopped job continues where it was. A clip made by hand (`imported`) is never replaced and is counted when its text changed.
 */

interface RunOpts {
  log: (message: string) => void
  signal?: AbortSignal
}

export interface ComfyTtsOptions extends RunOpts {
  /** The engine to use instead of the project's (`voice.engines[lang]` / `voice.engine`). */
  engine?: string
  beatId?: string
  /** Makes at most this many clips (for a quick try). */
  limit?: number
  /** Regenerates the matching clips even when their text did not change. */
  force?: boolean
  /** Regenerates only this speaker's clips (with `force`). */
  speakerKey?: string
  comfy: ComfyClient
  config: VoiceConfig
}

/** A voice engine resolved for one language: the built-in spec, or a custom TTS workflow. */
interface ResolvedEngine {
  /** The id the index records and the preview reports. */
  id: string
  /** The engine id `comfy.generate` takes: the built-in id, or `custom:<name>`. */
  target: string
  def?: EngineDef
  workflow?: CustomWorkflow
  /** The language codes it reads, for a message. */
  languages: string[] | '*'
  reads: (lang: string) => boolean
}

const fileHash = async (file: string): Promise<string> => createHash('sha1').update(await fs.readFile(file)).digest('hex')

const unsupportedMessage = (id: string, lang: string, reads: string): string =>
  `voice for ${lang} skipped: the engine "${id}" does not read ${lang} (it reads: ${reads}). Pick another engine for ${lang} in the project's voice.engines (or voice.engine).`

/** The built-in spec or the custom TTS workflow a project language uses. Throws an unknown engine; the caller skips unsupported languages. */
async function resolveEngine(svc: VnService, settings: Pick<ProjectSettings, 'voice'>, lang: string, engineId?: string): Promise<ResolvedEngine> {
  const id = engineId ?? resolveVoiceEngine(settings, lang)
  if (id.startsWith('custom:')) {
    const name = id.slice('custom:'.length)
    const workflow = await loadCustomWorkflow(dataFolders(svc.dataDir).workflows, name)
    const supported = Object.keys(workflow.mapping.languages ?? {})
    // a mapping with a language input and a table must list the code; one without a table passes the code through
    const table = !!workflow.mapping.language && supported.length > 0
    const reads = (code: string) => !table || supported.includes(code)
    return { id, target: id, workflow, languages: table ? supported : '*', reads }
  }
  const def = ENGINES[id]
  if (!def || def.task !== 'tts') {
    throw new Error(`"${id}" is not a voice engine: use one of ${VOICE_ENGINE_IDS.join(', ')} or custom:<workflow>`)
  }
  return { id, target: id, def, languages: def.languages ?? '*', reads: (code: string) => engineReadsLanguage(def, code) }
}

/** The absolute files of the project's uploaded voice reference clips, by speaker (a `voice_<speaker>` asset). */
async function referenceFiles(svc: VnService, slug: string, manifest: Pick<AssetManifest, 'assets'>): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const a of manifest.assets) {
    if (a.kind !== 'voiceRef') continue
    const file = resolveFile(svc.store.dir(slug), a)
    if (file) files.set(a.id.replace(/^voice_/, ''), file)
  }
  return files
}

/** The clip that clones a speaker: their own, else the narrator's. */
function pickClip(refs: ReadonlyMap<string, string>, own: string): { speaker: string; file: string } | null {
  const ownFile = refs.get(own)
  if (ownFile) return { speaker: own, file: ownFile }
  const narrator = refs.get(NARRATOR)
  return narrator ? { speaker: NARRATOR, file: narrator } : null
}

/**
 * What the engine may send for a speaker: the reference clip (or none) and its transcript. A `problem` skips that clip with a hint
 * (F5 without a clip or transcript, any clone-required engine without a clip). `dropped`: OmniVoice has a clip but no transcript, so it
 * reads ref-free from the style instead.
 */
function clipPolicy(def: EngineDef, own: string, ref: { speaker: string; file: string } | null, refTexts: Record<string, string>): { file?: string; text: string; problem?: string; dropped?: boolean } {
  if (def.clone === 'none') return { text: '' }
  const text = ref ? (refTexts[ref.speaker] ?? '').trim() : ''
  if (!ref && def.clone === 'required') return { text: '', problem: `${own} needs a reference clip: upload one in the Voice tab` }
  if (ref && def.refText === 'required' && !text) return { text: '', problem: `${own} has a reference clip without its transcript: add it in the Voice tab` }
  if (ref && !text && def.refFreeWithoutTranscript) return { text: '', dropped: true }
  return { ...(ref ? { file: ref.file } : {}), text: def.refText === 'none' ? '' : text }
}

/**
 * vn.voice.generate with the local ComfyUI engines, for one language: the clips whose text, engine, reference clip, transcript, style,
 * format, chunk length or speed changed go through the TTS Audio Suite, one call at a time. `force` invalidates the matching non-imported
 * clips first, so a regenerate makes a fresh seed. Every clip failure is counted and the others go on; only a job that made nothing
 * throws. Imported clips are kept.
 */
export async function generateComfyTtsClips(svc: VnService, slug: string, lang: Lang, o: ComfyTtsOptions): Promise<GenerateResult> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const edition = await svc.store.loadEdition(slug, lang).catch(() => null)
  if (!edition) return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: the project has no ${lang} edition` }
  const engine = await resolveEngine(svc, settings, lang, o.engine)
  if (!engine.reads(lang)) {
    const reads = engine.languages === '*' ? 'any language' : engine.languages.join(', ')
    return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: unsupportedMessage(engine.id, lang, reads || 'none') }
  }
  o.log(`voice ${lang}: engine ${engine.id}`)
  const manifest = await svc.store.loadAssets(slug)
  const refs = await referenceFiles(svc, slug, manifest)
  const dir = voiceDirOf(svc, slug, lang)
  await fs.mkdir(dir, { recursive: true })
  const index = await readVoiceIndexIn(dir)
  const { format, chunkChars, speed } = o.config
  const ownOf = new Map<string, string>()
  for (const chapter of book.chapters)
    for (const scene of chapter.scenes)
      for (const beat of scene.beats) {
        if (beat.type === 'cast') continue
        ownOf.set(beat.id, beat.type === 'line' && beat.speakerKey ? beat.speakerKey : NARRATOR)
      }
  if (o.force) {
    let dropped = 0
    for (const [beatId, entry] of Object.entries(index)) {
      if (entry.imported) continue
      if (o.beatId && beatId !== o.beatId) continue
      if (o.speakerKey) {
        const slot = entry.speaker ?? ownOf.get(beatId)
        if (slot !== o.speakerKey) continue
      }
      delete index[beatId]
      dropped++
    }
    if (dropped) {
      await writeVoiceIndex(dir, index)
      o.log(`voice ${lang}: ${dropped} clip(s) forgotten, they are made again`)
    }
  }
  const hashCache = new Map<string, string>()
  const hashOf = async (file: string): Promise<string> => {
    let h = hashCache.get(file)
    if (!h) hashCache.set(file, (h = await fileHash(file)))
    return h
  }
  let kept = 0
  let skipped = 0
  let importedKept = 0
  let importedStale = 0
  let transcriptHint = false
  const skips: string[] = []
  interface Work {
    beatId: string
    slot: string
    text: string
    hash: string
    file?: string
    refText: string
    style: string
  }
  const todo: Work[] = []
  for (const chapter of book.chapters)
    for (const scene of chapter.scenes)
      for (const beat of scene.beats) {
        if (beat.type === 'cast' || (o.beatId && beat.id !== o.beatId)) continue
        const text = edition.beats[beat.id]?.trim()
        if (!text) continue
        // a clip you imported is never made again, and is counted when the text changed since
        const mine = index[beat.id]
        if (mine?.imported && existsSync(path.join(dir, mine.file))) {
          importedKept++
          if (mine.textHash !== sha1(text)) importedStale++
          continue
        }
        const own = ownOf.get(beat.id) ?? NARRATOR
        const style = (settings.voice.styles[own] ?? '').trim()
        let refText = ''
        let refFile: string | undefined
        if (engine.workflow) {
          // a custom workflow uses the clip only where its mapping has a voiceRef input
          const ref = pickClip(refs, own)
          if (engine.workflow.mapping.voiceRef && !ref) {
            skipped++
            if (skips.length < 3) skips.push(`${beat.id}: no voice reference for ${own}: upload one in the Voice tab`)
            continue
          }
          refFile = engine.workflow.mapping.voiceRef && ref ? ref.file : undefined
        } else {
          const ref = pickClip(refs, own)
          const use = clipPolicy(engine.def!, own, ref, settings.voice.refTexts)
          if (use.problem) {
            skipped++
            if (skips.length < 3) skips.push(`${beat.id}: ${use.problem}`)
            continue
          }
          refFile = use.file
          refText = use.text
          if (use.dropped && !transcriptHint) {
            transcriptHint = true
            o.log(`voice ${lang}: the reference clip of ${ref!.speaker} has no transcript, so it is read without cloning; add it in the Voice tab (transcript) to clone the voice`)
          }
        }
        const refContentHash = refFile ? await hashOf(refFile) : ''
        // one field order for both: the built-in engines that take it (OmniVoice, F5-TTS) change sound with the configured speed,
        // and a custom workflow ignores it, so a speed change is never silently kept as "unchanged"
        const hash = engine.workflow
          ? sha1(['tts1', engine.target, lang, refContentHash, format, String(chunkChars), String(speed), text].join('\u0000'))
          : sha1(['tts1', engine.target, lang, refContentHash, refText, style, format, String(chunkChars), String(speed), text].join('\u0000'))
        const known = index[beat.id]
        if (known && known.hash === hash && existsSync(path.join(dir, known.file))) {
          kept++
          continue
        }
        todo.push({ beatId: beat.id, slot: own, text, hash, ...(refFile ? { file: refFile } : {}), refText, style })
      }
  const work = o.limit ? todo.slice(0, o.limit) : todo
  let made = 0
  let failed = 0
  const errors: string[] = []
  for (const t of work) {
    o.signal?.throwIfAborted()
    try {
      const seed = randomSeed()
      const r = await o.comfy.generate({
        engine: engine.target,
        text: t.text,
        language: lang,
        ...(engine.def?.language ? { languageName: engineLanguageValue(engine.def, lang) } : {}),
        ...(t.file ? { voiceRef: t.file } : {}),
        ...(t.refText ? { voiceRefText: t.refText } : {}),
        ...(t.style ? { instruct: t.style } : {}),
        seed,
        format,
        chunkChars,
        speed,
        filenamePrefix: `vno_voice_${slug}`,
        signal: o.signal
      })
      const file = `${t.beatId}.${r.ext}`
      const old = index[t.beatId]
      if (old && old.file !== file) await fs.rm(path.join(dir, old.file), { force: true })
      await fs.writeFile(path.join(dir, file), r.bytes)
      const entry: VoiceIndexEntry = { hash: t.hash, file, speaker: t.slot, engine: engine.id, seed: r.seed, at: new Date().toISOString() }
      index[t.beatId] = entry
      made++
    } catch (e) {
      if (o.signal?.aborted) throw e
      failed++
      if (errors.length < 3) errors.push(`${t.beatId}: ${(e as Error).message}`)
    }
    // the index follows every clip, so a stopped job continues where it was
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
  if (skipped) parts.push(`${skipped} skipped (${skips.join('; ')})`)
  // a language whose every selected clip was skipped (F5-TTS without a clip or transcript, a clone-required engine without one) did
  // nothing: report `skipped`, not `done`, with the same explanation of what was missing
  const status = made === 0 && kept === 0 && skipped > 0 ? 'skipped' : 'done'
  return { made, kept, failed, skipped, status, message: `voice ${lang}: ${parts.join('; ')}` }
}

export interface ComfyPreviewOptions {
  comfy: ComfyClient
  config: VoiceConfig
  /** The engine to use instead of the project's (`voice.engine`/`voice.engines`). */
  engine?: string
}

/**
 * A short sample of a speaker's voice with the project's local engine (or `engine`): `preview/voice-<key>.<ext>`, replaced each time.
 * The answer reports the engine id that made it, so the Voice tab can say which one spoke.
 */
export async function previewComfyVoice(svc: VnService, slug: string, speakerKey: string, lang: Lang, o: ComfyPreviewOptions): Promise<VoicePreview> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  if (speakerKey !== NARRATOR && !book.characters.some((c) => c.key === speakerKey)) throw new Error(`no character "${speakerKey}" in ${slug}`)
  const engine = await resolveEngine(svc, settings, lang, o.engine)
  if (!engine.reads(lang)) {
    const reads = engine.languages === '*' ? 'any language' : engine.languages.join(', ')
    throw new Error(`the engine "${engine.id}" does not read ${lang} (it reads: ${reads || 'none'}): pick another engine for ${lang} in the project's voice.engines`)
  }
  const manifest = await svc.store.loadAssets(slug)
  const refs = await referenceFiles(svc, slug, manifest)
  const style = (settings.voice.styles[speakerKey] ?? '').trim()
  let refFile: string | undefined
  let refText = ''
  if (!engine.workflow) {
    const use = clipPolicy(engine.def!, speakerKey, pickClip(refs, speakerKey), settings.voice.refTexts)
    if (use.problem) throw new Error(use.problem)
    refFile = use.file
    refText = use.text
  } else {
    const ref = pickClip(refs, speakerKey)
    if (engine.workflow.mapping.voiceRef && !ref) throw new Error(`the TTS workflow "${engine.workflow.name}" needs a voice reference clip: upload one in the Voice tab`)
    refFile = engine.workflow.mapping.voiceRef && ref ? ref.file : undefined
  }
  const { format, chunkChars, speed } = o.config
  const r = await o.comfy.generate({
    engine: engine.target,
    text: await sampleText(svc, slug, speakerKey, lang),
    language: lang,
    ...(engine.def?.language ? { languageName: engineLanguageValue(engine.def, lang) } : {}),
    ...(refFile ? { voiceRef: refFile } : {}),
    ...(refText ? { voiceRefText: refText } : {}),
    ...(style ? { instruct: style } : {}),
    seed: randomSeed(),
    format,
    chunkChars,
    speed,
    filenamePrefix: `vno_preview_${slug}`
  })
  const name = `voice-${slugVoiceName(speakerKey) || 'speaker'}`
  const rel = `preview/${name}.${r.ext}`
  const out = path.join(svc.store.dir(slug), ...rel.split('/'))
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, r.bytes)
  return { slug, speakerKey, voice: engine.id, file: rel, rev: Date.now(), lang }
}
