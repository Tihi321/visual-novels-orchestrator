import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Lang } from '../../shared/vn'
import { FlowError } from '../studios/flow'
import type { FlowClient } from '../studios/flow'
import type { VnService } from '../vn/service'
import { NARRATOR } from './catalog'
import { flowVoiceProblem, parseFlowVoice } from './flow-catalog'
import { PLAN_HINT, importedClipsNote, invalidateSpeaker, readVoiceIndexIn, sampleText, voiceDirOf, writeVoiceIndex } from './jobs'
import type { GenerateResult, VoicePreview } from './jobs'
import { sha1, slugVoiceName } from './vocab'

/** Clips and previews from Google Flow's free narration engines (`gemini`, `windows`) through flow-music-mcp. The paid engine `flow` is never used. */

/** The text a `flow_narrate` call takes (gemini and windows). */
export const FLOW_TEXT_MAX = 4000

export interface FlowVoiceSettings {
  /** Pause between two calls (ms), so the free Gemini tier is not hit at once. */
  pauseMs: number
  /** How often a clip is retried on a rate limit. */
  retries: number
  /** The waits before each retry (ms). Default 10 s, 30 s, 90 s. */
  backoffMs?: number[]
}

export interface FlowGenerateOpts {
  beatId?: string
  limit?: number
  flow: FlowClient
  settings: FlowVoiceSettings
  /** The clip format of `config/voice.md`. */
  format: 'mp3' | 'wav'
  log: (message: string) => void
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * The wait Google asks for in a 429 text: `Please retry in 21h21m47.5s`, `retry in 45s`, or a `retryDelay` of `"76907s"`. Undefined when the text has none.
 */
export function parseRetryDelayMs(message: string): number | undefined {
  const unit = { h: 3_600_000, m: 60_000, s: 1000 } as const
  const sum = (text: string): number => [...text.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)].reduce((t, m) => t + Number(m[1]) * unit[m[2]!.toLowerCase() as keyof typeof unit], 0)
  const retryIn = /retry in\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/i.exec(message)
  if (retryIn) return Math.round(sum(retryIn[1]!))
  const delay = /retryDelay\W+(\d+(?:\.\d+)?)\s*s/i.exec(message)
  return delay ? Math.round(Number(delay[1]) * 1000) : undefined
}

/** A retry time longer than this (and than the whole retry schedule) is a daily quota, not a burst: waiting it out in the job makes no sense. */
export const QUOTA_MIN_MS = 300_000

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/**
 * vn.voice.generate with the Flow provider, for one language: one beat is one `flow_narrate` call and one file. The hash is
 * `flow|voice|lang|style|format|text`, so a changed voice, style, format or text makes the clip again and nothing else. Clips you
 * imported are kept. One call at a time with a pause; a rate limit is retried with a growing wait, then that clip fails and the others
 * go on. The index is saved after every clip, so a stopped job continues where it was.
 */
export async function generateFlowClips(svc: VnService, slug: string, lang: Lang, o: FlowGenerateOpts): Promise<GenerateResult> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const edition = await svc.store.loadEdition(slug, lang).catch(() => null)
  if (!edition) return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: the project has no ${lang} edition` }
  const voiceOf = (speaker: string): string | undefined => settings.voice.voices[speaker]?.[lang]
  if (!Object.keys(settings.voice.voices).some((k) => voiceOf(k))) {
    return { made: 0, kept: 0, failed: 0, skipped: 0, status: 'skipped', message: `voice for ${lang} skipped: no ${lang} voices are planned yet (${PLAN_HINT})` }
  }
  const dir = voiceDirOf(svc, slug, lang)
  await fs.mkdir(dir, { recursive: true })
  const index = await readVoiceIndexIn(dir)
  const sleep = o.sleep ?? realSleep
  const backoff = o.settings.backoffMs ?? [10_000, 30_000, 90_000]
  let kept = 0
  let skipped = 0
  let importedKept = 0
  let importedStale = 0
  const missing = new Set<string>()
  const todo: { beatId: string; slot: string; voice: string; style?: string; text: string; hash: string; file: string }[] = []
  for (const chapter of book.chapters)
    for (const scene of chapter.scenes)
      for (const beat of scene.beats) {
        if (beat.type === 'cast' || (o.beatId && beat.id !== o.beatId)) continue
        const text = edition.beats[beat.id]?.trim()
        if (!text) continue
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
        const style = settings.voice.styles[own]?.trim() || undefined
        const hash = sha1(['flow', voice, lang, style ?? '', o.format, text].join('\u0000'))
        const file = `${beat.id}.${o.format}`
        const known = index[beat.id]
        if (known && known.hash === hash && known.file === file && existsSync(path.join(dir, file))) {
          kept++
          continue
        }
        todo.push({ beatId: beat.id, slot: own, voice, style, text, hash, file })
      }
  const work = o.limit ? todo.slice(0, o.limit) : todo
  let made = 0
  let failed = 0
  let quota: string | undefined // set when Gemini's daily quota is used up: the rest of the job is not tried
  const errors: string[] = []
  const fail = (beatId: string, message: string) => {
    failed++
    if (errors.length < 3) errors.push(`${beatId}: ${message}`)
  }
  for (const [i, t] of work.entries()) {
    o.signal?.throwIfAborted()
    if (quota) {
      failed++
      continue
    }
    const ref = parseFlowVoice(t.voice)
    if (!ref) {
      fail(t.beatId, `"${t.voice}" is not a Flow voice (gemini:<Name> or windows:<Voice Name>)`)
      continue
    }
    if (t.text.length > FLOW_TEXT_MAX) {
      fail(t.beatId, `the text is ${t.text.length} characters, over the ${FLOW_TEXT_MAX} that Flow's narration takes: split the beat`)
      continue
    }
    let result: { file: string } | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        // the engine is always gemini or windows: the paid engine `flow` is never sent
        result = await o.flow.narrate({ text: t.text, engine: ref.engine, voice: ref.voice, ...(t.style ? { style: t.style } : {}), out: dir, name: t.beatId, format: o.format, signal: o.signal })
        break
      } catch (e) {
        if (o.signal?.aborted) throw e
        if (e instanceof FlowError && (e.kind === 'unreachable' || e.kind === 'signedOut')) throw e
        if (e instanceof FlowError && e.kind === 'rateLimit') {
          const retryMs = parseRetryDelayMs(e.message)
          const schedule = Array.from({ length: o.settings.retries }, (_, k) => backoff[Math.min(k, backoff.length - 1)] ?? 90_000).reduce((a, b) => a + b, 0)
          if (retryMs !== undefined && retryMs > Math.max(schedule, QUOTA_MIN_MS)) {
            const resets = new Date(Date.now() + retryMs).toLocaleString()
            quota = `Gemini's daily voice quota is used up (Google asks to retry in ${Math.round(retryMs / 60_000)} min, about ${resets}); the remaining clips were not tried`
            fail(t.beatId, quota)
            break
          }
        }
        if (e instanceof FlowError && e.kind === 'rateLimit' && attempt < o.settings.retries) {
          const wait = backoff[Math.min(attempt, backoff.length - 1)] ?? 90_000
          o.log(`voice ${lang}: ${t.beatId}: rate limited, waiting ${Math.round(wait / 1000)} s (retry ${attempt + 1} of ${o.settings.retries})`)
          await sleep(wait, o.signal)
          continue
        }
        fail(t.beatId, (e as Error).message)
        break
      }
    }
    if (result) {
      const name = path.basename(result.file)
      const old = index[t.beatId]
      if (old && old.file !== name) void fs.rm(path.join(dir, old.file), { force: true })
      index[t.beatId] = { hash: t.hash, file: name, speaker: t.slot }
      made++
    }
    await writeVoiceIndex(dir, index)
    o.log(`voice ${lang}: ${made + failed}/${work.length} clips`)
    await svc.setStep(slug, 'voice', 'running', `voice ${lang}: ${made + failed}/${work.length} clips`, { done: made + failed, total: work.length })
    if (i < work.length - 1 && o.settings.pauseMs > 0) await sleep(o.settings.pauseMs, o.signal)
  }
  if (!work.length) await writeVoiceIndex(dir, index)
  if (quota) o.log(`voice ${lang}: ${quota}`)
  if (failed && !made) throw new Error(`voice ${lang}: all ${failed} clip(s) failed: ${errors.join('; ')}`)
  const parts = [`${made} clip(s) made, ${kept} unchanged`]
  if (importedKept) parts.push(importedClipsNote(importedKept, importedStale))
  if (todo.length > work.length) parts.push(`${todo.length - work.length} left (limit ${o.limit})`)
  if (failed) parts.push(quota ? `${failed} failed: ${quota}` : `${failed} failed (${errors.join('; ')})`)
  if (skipped) parts.push(`${skipped} skipped: no ${lang} voice for ${[...missing].join(', ')} (${PLAN_HINT})`)
  return { made, kept, failed, skipped, status: 'done', message: `voice ${lang}: ${parts.join('; ')}` }
}

/** The preview clip of a Flow voice (`preview/voice-<key>.<format>`, replaced each time). */
export async function previewFlowVoice(svc: VnService, slug: string, speakerKey: string, voice: string, lang: Lang, o: { flow: FlowClient; style?: string; format?: 'mp3' | 'wav' }): Promise<VoicePreview> {
  const ref = parseFlowVoice(voice)
  if (!ref) throw new Error(`"${voice}" is not a Flow voice: use gemini:<Name> or windows:<Voice Name>`)
  const format = o.format ?? 'mp3'
  const name = `voice-${slugVoiceName(speakerKey) || 'speaker'}`
  const out = path.join(svc.store.dir(slug), 'preview')
  await fs.mkdir(out, { recursive: true })
  const made = await o.flow.narrate({ text: await sampleText(svc, slug, speakerKey, lang), engine: ref.engine, voice: ref.voice, ...(o.style ? { style: o.style } : {}), out, name, format })
  return { slug, speakerKey, voice, file: `preview/${path.basename(made.file)}`, rev: Date.now(), lang }
}

/** Checks a voice for a language against the voices flow-music-mcp lists; throws the reason it cannot speak. */
export async function checkFlowVoice(flow: FlowClient, voice: string, lang: Lang): Promise<void> {
  const problem = flowVoiceProblem(await flow.voices(), voice, lang)
  if (problem) throw new Error(problem)
}

/** Gives a speaker the Flow voice for one language (checked against the voices flow-music-mcp lists), forgets that speaker's clips in it and returns a preview. */
export async function setFlowVoice(svc: VnService, slug: string, speakerKey: string, lang: Lang, voice: string, o: { flow: FlowClient; format?: 'mp3' | 'wav' }): Promise<VoicePreview> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  if (speakerKey !== NARRATOR && !book.characters.some((c) => c.key === speakerKey)) throw new Error(`no character "${speakerKey}" in ${slug}`)
  await checkFlowVoice(o.flow, voice, lang)
  const cur = settings.voice.voices
  await svc.updateSettings(slug, { voice: { voices: { ...cur, [speakerKey]: { ...cur[speakerKey], [lang]: voice } } } })
  await invalidateSpeaker(svc, slug, speakerKey, lang)
  return previewFlowVoice(svc, slug, speakerKey, voice, lang, { flow: o.flow, style: settings.voice.styles[speakerKey], format: o.format })
}
