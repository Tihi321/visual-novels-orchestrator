import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { BuildResult, PipelineStep } from '../../shared/protocol'
import { IMAGE_KINDS, isHandArt } from '../../shared/vn'
import type { AssetEntry, Lang, ProjectSettings } from '../../shared/vn'
import { fallbackNegative, fallbackPrompt } from '../assets/derive'
import { runsOnFlow } from '../assets/flow-image'
import type { FlowOptions } from '../assets/flow-image'
import { countFlowSongs } from '../studios/flow-music'
import { generateAsset } from '../assets/generate'
import type { GenerateOptions } from '../assets/generate'
import { pickVersion, resolveFile } from '../assets/manifest'
import { lanesOf } from '../comfy/client'
import { ENGINES } from '../comfy/graphs'
import { BudgetError, isAbortError } from '../models/types'
import type { ChatMessage } from '../models/types'
import type { JobFile } from '../queue/jobs'
import type { HandlerOptions, JobContext } from '../queue/scheduler'
import type { Scheduler } from '../queue/scheduler'
import { buildGame } from '../game/build'
import type { VoiceSource } from '../game/emit'
import { lint } from '../game/run'
import { addScenePlan, defaultCues, fillCues } from '../game/stage'
import type { StageCues } from '../game/stage'
import { alignEdition } from './align'
import { primaryEditionProblems } from './pack'
import { planArt } from './agents/art-director'
import { reviewImage } from './agents/art-critic'
import { chipOptionsFor, fallbackChipPlans, planMusic } from './agents/composer'
import type { MusicPlan } from './agents/composer'
import { DEFAULT_SECONDS } from './agents/composer'
import { planSummary } from '../studios/chip-plan'
import { summarizeRun } from './agents/director'
import { resolveAlignment } from './agents/edition-aligner'
import { resolveUncertain } from './agents/script-analyst'
import type { ExistingArt } from './agents/script-analyst'
import { mergeChapterCues, stageChapter } from './agents/stage-director'
import { planVoices, speakerOf } from './agents/voice-director'
import type { PlanVoices } from './agents/voice-director'
import { NARRATOR, describeTtsEngines, describeVoices, voiceLangsOf } from '../voice/catalog'
import type { TtsEngineInfo } from '../voice/catalog'
import { generateFlowClips } from '../voice/flow'
import { flowAsVoiceList } from '../voice/flow-catalog'
import { planListVoices, readVoiceIndexIn } from '../voice/jobs'
import { generateComfyTtsClips } from '../voice/comfy-tts'
import type { VoiceIndexEntry } from '../voice/jobs'
import type { AgentCall } from './agents/common'
import { applyAlignmentFixes, applyDecisions } from './fixes'
import { bodyOf, isStep, Semaphore, STEP_OF_TASK, TASKS } from './pipeline'
import type { VnTask } from './pipeline'
import { resolveDrawMode } from '../studios/config'
import type { StudiosConfig } from '../studios/config'
import { dataFolders, loadComfyConfigFor, loadRenpyConfig } from './project'
import { VnService } from './service'
import type { VnDeps } from './service'

export type { VnDeps } from './service'

// sharp keeps the files it read open (a cache); on Windows that blocks replacing and deleting an asset or a project.
sharp.cache(false)

/** The agent retries of the art-critic: after this many revised prompts the best version is kept and marked rejected. */
export const REVIEW_RETRIES = 2

const nowIso = () => new Date().toISOString()

/** A failure that must stop the job (stopped by the user, over budget), not fall back to the deterministic path. */
function fatal(ctx: JobContext, e: unknown): boolean {
  return ctx.signal.aborted || isAbortError(e) || e instanceof BudgetError
}

/** An agent call that may fail without stopping the pipeline: the caller falls back to the deterministic path. */
async function tryAgent<T>(ctx: JobContext, what: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    if (fatal(ctx, e)) throw e
    const error = (e as Error).message
    ctx.log(`${what}: the agent did not answer (${error}); using the deterministic path`)
    return { ok: false, error }
  }
}

export type { VoiceIndexEntry } from '../voice/jobs'

/**
 * Persists the voice-director's local answer: a delivery style per speaker and, per language, a TTS engine that reads the language.
 * A known style or engine is kept unless `overwrite`; the uploaded reference clips are never touched. Returns the message the voice
 * step reports.
 */
async function planComfyVoices(
  svc: VnService,
  slug: string,
  plan: PlanVoices,
  engines: readonly TtsEngineInfo[],
  opts: { overwrite?: boolean; log: (message: string) => void }
): Promise<string> {
  const { settings } = await svc.store.loadSettings(slug)
  const book = await svc.store.loadBook(slug)
  const speakers = new Set([NARRATOR, ...book.characters.map((c) => c.key)])
  const styles = { ...settings.voice.styles }
  const perLanguage = { ...settings.voice.engines }
  const known = new Map(engines.map((e) => [e.id, e]))
  let styled = 0
  let assigned = 0
  for (const v of plan.voices) {
    const speaker = speakerOf(v)
    if (!speaker || !speakers.has(speaker)) continue
    const description = v.description.trim()
    if (description && (opts.overwrite || !styles[speaker]?.trim())) {
      styles[speaker] = description
      styled++
      opts.log(`voice style of ${speaker}: "${description}"`)
    }
    for (const [lang, engineId] of Object.entries(v.engines ?? {})) {
      const engine = known.get(engineId)
      if (!engine || !(engine.languages === '*' || engine.languages.includes(lang))) continue
      if (!opts.overwrite && perLanguage[lang]) continue
      if (perLanguage[lang] !== engineId) assigned++
      perLanguage[lang] = engineId
      opts.log(`voice engine of ${lang}: ${engineId}`)
    }
  }
  if (styled || assigned) await svc.updateSettings(slug, { voice: { styles, engines: perLanguage } })
  return `${styled} voice style(s) and ${assigned} engine(s) planned`
}

/**
 * Registers the VN pipeline's job handlers (`sched.register('<task>', ...)`) and returns the service the engine, the CLI and the MCP
 * server use. Jobs that never need a model (import, generate, build, lint, voice clips ...) are `noModel`; the agent jobs
 * (analyse, art plan, music plan, stage, align, voice plan, review, summary) fall back to the deterministic path when no model answers.
 */
export function registerVnHandlers(sched: Scheduler, deps: VnDeps): VnService {
  const svc = new VnService(deps)
  const store = svc.store
  const comfySem = new Semaphore(1)
  /** One Flow job at a time from VN Studio, so a job's timeout measures its own work and not a queue it filled itself. */
  const flowSem = new Semaphore(1)
  const flowOptionsOf = (c: StudiosConfig): FlowOptions => ({ quality: c.flowImageQuality, jobTimeoutMs: c.flowJobTimeoutS * 1000, musicTimeoutMs: c.flowMusicTimeoutS * 1000, maxSongs: c.flowMusicMaxSongs })
  const call = (ctx: JobContext): AgentCall => ({ ctx, dataDir: deps.dataDir })

  /**
   * For the agent jobs: a cheap look at the project's files that says this job will not ask a model this time, because its handler would return
   * before the call (see `HandlerOptions.skipModel`). Such a job starts at once instead of waiting for a model slot, which a down server or a
   * full client queue would hold back. Each check mirrors an early return of its handler.
   */
  const noModelThisTime: Partial<Record<VnTask, (slug: string, job: JobFile) => Promise<boolean>>> = {
    [TASKS.analyse]: async (slug) => (await store.loadUncertain(slug)).length === 0,
    [TASKS.editionAlign]: async (slug, job) => {
      const lang = (bodyOf<{ lang: Lang }>(job.body).lang ?? job.data.unit) as Lang
      const report = await store.loadAlignReport(slug, lang)
      return !report || (!report.missing.length && !report.extra.length)
    },
    [TASKS.artPlan]: async (slug, job) => isHandArt((await store.loadSettings(slug)).settings.art) && !bodyOf<{ explicit: boolean }>(job.body).explicit,
    [TASKS.musicPlan]: async (slug) => (await store.loadSettings(slug)).settings.music.tracks <= 0,
    [TASKS.stage]: async (slug) => !!(await store.readJson<StageCues>(slug, 'cues.json'))?.byHand,
    [TASKS.voicePlan]: async (slug) => !(await store.loadSettings(slug)).settings.voice.enabled,
    [TASKS.review]: async (slug, job) => {
      const entry = job.data.unit ? (await store.loadAssets(slug)).assets.find((a) => a.id === job.data.unit) : undefined
      return !!entry && (entry.locked || entry.source === 'custom' || !resolveFile(store.dir(slug), entry))
    },
    [TASKS.draw]: async (slug, job) => {
      const entry = job.data.unit ? (await store.loadAssets(slug)).assets.find((a) => a.id === job.data.unit) : undefined
      if (!entry) return false
      if (IMAGE_KINDS.has(entry.kind) && isHandArt((await store.loadSettings(slug)).settings.art)) return true
      return !bodyOf<{ force: boolean }>(job.body).force && !!resolveFile(store.dir(slug), entry)
    }
  }

  /**
   * Registers a handler that works on a project (`ctx.job.book`). `step` is the pipeline step it reports on: it is shown running,
   * then done with the handler's message, or failed with the error (not when the job was only stopped).
   */
  const reg = (task: VnTask, fn: (ctx: JobContext, slug: string) => Promise<string>, opts: HandlerOptions & { step?: PipelineStep | false } = {}): void => {
    const { step: stepOpt, ...rest } = opts
    const check = noModelThisTime[task]
    const hopts: HandlerOptions = { ...rest, ...(check ? { skipModel: async (job: JobFile) => (job.data.book ? check(job.data.book, job) : false) } : {}) }
    const step = stepOpt === false ? undefined : (stepOpt ?? STEP_OF_TASK[task])
    sched.register(
      task,
      async (ctx) => {
        const slug = ctx.job.book
        if (!slug) throw new Error(`${task} needs a project`)
        if (step) await svc.setStep(slug, step, 'running', ctx.job.label ?? `${task} running`)
        try {
          const result = await fn(ctx, slug)
          if (step) await svc.setStep(slug, step, 'done', result)
          return { result }
        } catch (e) {
          if (step && !fatal(ctx, e)) await svc.setStep(slug, step, 'failed', (e as Error).message)
          throw e
        }
      },
      hopts
    )
  }

  // ---- the director: the job graph ----

  reg(
    TASKS.pipeline,
    async (ctx, slug) => {
      const body = bodyOf<{ from: string; force: boolean }>(ctx.jobBody)
      const from = body.from && isStep(body.from) ? body.from : 'analyse'
      const ids = await svc.enqueueChain(slug, ctx.job.round, from, !!body.force)
      return `run ${ctx.job.round}: ${ids.length} job(s) queued from ${from}`
    },
    { noModel: true, step: false }
  )

  // ---- import and analyse ----

  reg(
    TASKS.import,
    async (_ctx, slug) => {
      const { settings } = await store.loadSettings(slug)
      if (settings.source === '') return 'made over MCP: nothing to import'
      const r = await svc.importProject(settings.source, { lang: settings.primaryLang })
      return `imported ${r.preview.chapters} chapter(s), ${r.preview.characters} character(s), ${r.preview.uncertain} item(s) for the script-analyst`
    },
    { noModel: true }
  )

  reg(TASKS.analyse, async (ctx, slug) => {
    const items = await store.loadUncertain(slug)
    if (!items.length) return 'nothing for the script-analyst to settle'
    const book = await store.loadBook(slug)
    // what already has art: the analysis picks a time or an expression from it instead of asking for a new image
    const manifest = await store.loadAssets(slug)
    const dir = store.dir(slug)
    const withFile = new Set(manifest.assets.filter((a) => resolveFile(dir, a)).map((a) => a.id))
    const art: ExistingArt = { backgrounds: {}, sprites: {} }
    for (const id of withFile) {
      const bg = /^bg_(.+)_([a-z]+)$/.exec(id)
      if (bg) (art.backgrounds[bg[1]!] ??= []).push(bg[2]!)
      const sp = /^sprite_(.+)_([a-z0-9]+)$/.exec(id)
      if (sp) (art.sprites[sp[1]!] ??= []).push(sp[2]!)
    }
    const r = await tryAgent(ctx, 'script-analyst', () => resolveUncertain(call(ctx), book, items, art))
    const decisions = r.ok ? r.value.decisions : []
    const error = r.ok ? r.value.errors.join('; ') : r.error
    if (!decisions.length) return `the script-analyst gave no answer${error ? ` (${error})` : ''}: ${items.length} item(s) keep the parser's defaults`
    const out = await store.withLock(slug, async () => {
      const { settings } = await store.loadSettings(slug)
      const cur = await store.loadBook(slug)
      const ed = await store.loadEdition(slug, settings.primaryLang).catch(() => undefined)
      const res = applyDecisions(cur, ed, items, decisions, { hasFile: (id) => withFile.has(id) })
      await store.saveBook(slug, res.book)
      if (res.edition) await store.saveEdition(slug, res.edition)
      await store.saveUncertain(slug, res.unresolved)
      return res
    })
    for (const n of out.notes) ctx.log(`script-analyst: ${n}`)
    await svc.reconcileAssets(slug)
    return `${out.applied} of ${items.length} item(s) settled, ${out.unresolved.length} left with the parser's defaults${error ? ` (${error})` : ''}`
  })

  // ---- editions ----

  reg(
    TASKS.editionAdd,
    async (ctx, slug) => {
      const body = bodyOf<{ source: string; lang: Lang; pack?: boolean; force?: boolean }>(ctx.jobBody)
      const lang = body.lang ?? (ctx.job.unit as Lang)
      if (!body.source) throw new Error('vn.edition.add has no source folder')
      if (body.pack) {
        // a pack catalogue: key-set validation only; no alignEdition, no edition-aligner, no asset job
        const r = await svc.importPackEdition(slug, body.source, lang, { force: body.force })
        return `${lang} pack edition added: ${r.report.keyCount ?? 0} key(s), ${r.report.missing.length} missing${r.warnings.length ? `; ${r.warnings.length} warning(s)` : ''}`
      }
      const book = await store.loadBook(slug)
      const { edition, report } = await alignEdition(book, body.source, lang)
      await store.withLock(slug, async () => {
        await store.saveEdition(slug, edition)
        await store.saveAlignReport(slug, lang, report)
        const { settings } = await store.loadSettings(slug)
        if (!settings.editions.includes(lang)) await store.saveSettings({ ...settings, editions: [...settings.editions, lang].sort() })
      })
      let queued = ''
      if (report.missing.length || report.extra.length) {
        await svc.enqueue(slug, TASKS.editionAlign, lang, ctx.job.round, { body: { lang }, label: `align the ${lang} edition` })
        queued = '; the edition-aligner will look at the leftovers'
      }
      await svc.emitProject(slug)
      return `${lang} edition added: ${report.matched} beat(s) matched, ${report.missing.length} missing, ${report.extra.length} extra${queued}`
    },
    { noModel: true, step: false }
  )

  reg(
    TASKS.editionAlign,
    async (ctx, slug) => {
      const lang = (bodyOf<{ lang: Lang }>(ctx.jobBody).lang ?? ctx.job.unit) as Lang
      const report = await store.loadAlignReport(slug, lang)
      if (!report) return `no alignment report for ${lang}`
      if (!report.missing.length && !report.extra.length) return `the ${lang} edition has nothing left to align`
      const book = await store.loadBook(slug)
      const r = await tryAgent(ctx, 'edition-aligner', () => resolveAlignment(call(ctx), book, report, lang))
      if (!r.ok) return `the edition-aligner did not answer (${r.error}): ${report.missing.length} missing and ${report.extra.length} extra beat(s) stay in the report`
      const res = await store.withLock(slug, async () => {
        const edition = await store.loadEdition(slug, lang)
        const out = applyAlignmentFixes(book, edition, report, r.value.fixes, r.value.names)
        await store.saveEdition(slug, out.edition)
        await store.saveAlignReport(slug, lang, out.report)
        return out
      })
      for (const n of res.notes) ctx.log(`edition-aligner: ${n}`)
      await svc.emitProject(slug)
      return `${res.fixed} beat(s) matched, ${res.names} name(s) confirmed; ${res.report.missing.length} missing and ${res.report.extra.length} extra left`
    },
    { step: false }
  )

  // ---- art plan, music plan ----

  reg(TASKS.artPlan, async (ctx, slug) => {
    const force = !!bodyOf<{ force: boolean }>(ctx.jobBody).force
    await svc.reconcileAssets(slug)
    const { settings } = await store.loadSettings(slug)
    if (isHandArt(settings.art) && !bodyOf<{ explicit: boolean }>(ctx.jobBody).explicit) return 'hand-made art: no prompts planned'
    const book = await store.loadBook(slug)
    const manifest = await store.loadAssets(slug)
    const orphans = svc.orphanIds(book, settings, manifest.assets)
    const need = manifest.assets.filter((a) => IMAGE_KINDS.has(a.kind) && !orphans.has(a.id) && !a.locked && !a.promptByHand && a.source === 'generated' && (force || (a.versions.length === 0 && a.prompt === '')))
    if (!need.length) return 'every asset already has a prompt'
    const r = await tryAgent(ctx, 'art-director', () => planArt(call(ctx), book, settings, need))
    const pixel = settings.art.style === 'pixel'
    let fromAgent = 0
    await store.withLock(slug, async () => {
      const cur = await store.loadAssets(slug)
      const ids = new Set(need.map((a) => a.id))
      const assets = cur.assets.map((a) => {
        if (!ids.has(a.id)) return a
        const planned = r.ok ? r.value.prompts.get(a.id) : undefined
        if (planned) fromAgent++
        return { ...a, prompt: planned?.prompt ?? fallbackPrompt(a, book, { pixel, stylePrompt: settings.art.stylePrompt }), negative: planned?.negative ?? fallbackNegative(a.kind) }
      })
      await store.saveAssets(slug, { assets })
    })
    await svc.emitProject(slug)
    return r.ok ? `${fromAgent} of ${need.length} prompt(s) from the art-director (style: ${r.value.stylePrefix || 'none'}), the rest from the book` : `${need.length} prompt(s) built from the book (the art-director did not answer: ${r.error})`
  })

  reg(TASKS.musicPlan, async (ctx, slug) => {
    const force = !!bodyOf<{ force: boolean }>(ctx.jobBody).force
    const { settings } = await store.loadSettings(slug)
    if (settings.music.tracks <= 0) return 'the project has no music tracks'
    const book = await store.loadBook(slug)
    await svc.reconcileAssets(slug) // the tracks follow the music provider
    const manifest = await store.loadAssets(slug)
    const orphans = svc.orphanIds(book, settings, manifest.assets)
    const music = manifest.assets.filter((a) => a.kind === 'music' && !orphans.has(a.id))
    if (!music.length) return 'the project has no music assets'
    const ids = music.map((a) => a.id).sort()
    const need = music.filter((a) => !a.locked && !a.promptByHand && a.source === 'generated' && a.versions.length === 0 && (force || a.prompt === ''))
    const existing = await store.readJson<MusicPlan>(slug, 'music.json')
    const wantsChips = chipOptionsFor(book, settings).chiptune
    if (!need.length && existing && (!wantsChips || ids.every((id) => existing.tracks?.[id]))) return 'every track already has a prompt and a plan'
    const r = await tryAgent(ctx, 'composer', () => planMusic(call(ctx), book, settings, ids))
    // the deterministic plan: the first track is the menu theme, the chapters take turns on the others
    const rotation = ids.length > 1 ? ids.slice(1) : ids
    const chipOpts = chipOptionsFor(book, settings)
    const seconds = Object.fromEntries(ids.map((id) => [id, DEFAULT_SECONDS]))
    const fallback: MusicPlan = {
      menu: ids[0] ?? null,
      chapters: Object.fromEntries(book.chapters.map((c, i) => [c.n, rotation[i % rotation.length]!])),
      seconds,
      ...(chipOpts.chiptune ? { tracks: fallbackChipPlans(ids, chipOpts, seconds) } : {})
    }
    const planned: MusicPlan = r.ok
      ? {
          menu: r.value.plan.menu ?? fallback.menu,
          chapters: { ...fallback.chapters, ...r.value.plan.chapters },
          seconds: { ...fallback.seconds, ...r.value.plan.seconds },
          ...(chipOpts.chiptune ? { tracks: { ...fallback.tracks, ...r.value.plan.tracks } } : {})
        }
      : fallback
    // a plan set with vno_set_music wins: the planner only fills what it lacks (a new chapter, a new track)
    const plan: MusicPlan = existing?.byHand
      ? {
          menu: 'menu' in existing ? existing.menu : planned.menu,
          chapters: { ...planned.chapters, ...existing.chapters },
          seconds: { ...planned.seconds, ...existing.seconds },
          ...(planned.tracks || existing.tracks ? { tracks: { ...planned.tracks, ...existing.tracks } } : {}),
          byHand: true
        }
      : planned
    await store.withLock(slug, async () => {
      const cur = await store.loadAssets(slug)
      const wanted = new Set(need.map((a) => a.id))
      const fallbackFor = (a: AssetEntry) => (plan.tracks?.[a.id] ? planSummary(plan.tracks[a.id]!) : fallbackPrompt(a, book))
      const assets = cur.assets.map((a) => (wanted.has(a.id) ? { ...a, prompt: (r.ok ? r.value.prompts.get(a.id) : undefined) ?? fallbackFor(a) } : a))
      await store.saveAssets(slug, { assets })
      await store.writeJson(slug, 'music.json', plan)
    })
    const kept = existing?.byHand ? '; the menu, chapters and lengths set by hand were kept' : ''
    return r.ok ? `${ids.length} track(s) planned by the composer${kept}` : `${ids.length} track(s) planned from the book (the composer did not answer: ${r.error})${kept}`
  })

  // ---- generate ----

  /**
   * The drawing agent of a sprite: how it asks the model, the mode and the limits (see `resolveDrawMode`).
   */
  const drawing = (ctx: JobContext, config: StudiosConfig) => {
    const { mode, ms } = resolveDrawMode(config, ctx.model?.provider.kind === 'client')
    return {
      ask: async (messages: ChatMessage[], schema?: Record<string, unknown>) => (await ctx.chat({ messages, schema, maxTokens: mode === 'grid' ? 8000 : 3000, temperature: mode === 'grid' ? 0.2 : 0.3 })).text,
      draw: { steps: config.drawSteps, ms, mode }
    }
  }

  /** Generates one asset (a new version) and records it. Throws when ComfyUI fails, so the job retries. */
  const generateOne = async (ctx: JobContext, slug: string, id: string, o: GenerateOptions, mode: { draw?: boolean } = {}): Promise<{ skipped?: string; entry: AssetEntry }> => {
    const { settings } = await store.loadSettings(slug)
    const book = await store.loadBook(slug)
    const config = await loadComfyConfigFor(deps.dataDir)
    const renpy = await loadRenpyConfig(deps.dataDir)
    comfySem.setPermits(lanesOf(config).length) // one job per ComfyUI lane
    const manifest = await store.loadAssets(slug)
    const entry = manifest.assets.find((a) => a.id === id)
    if (!entry) throw new Error(`project ${slug} has no asset "${id}"`)
    const music = await store.readJson<MusicPlan>(slug, 'music.json')
    const comfy = await svc.comfy({ autoStart: true, log: ctx.log })
    const studios = await svc.studios({ autoStart: true, log: ctx.log })
    const res = renpy.resolution
    const projectDir = store.dir(slug)
    const r = await (runsOnFlow(entry, settings, o.engine) ? flowSem : comfySem).run(
      () =>
        generateAsset(
          {
            book,
            settings,
            projectDir,
            comfy,
            flow: studios.flow,
            flowOptions: flowOptionsOf(studios.config),
            flowSongsMade: countFlowSongs(manifest.assets),
            resolveRefEntry: (rid) => manifest.assets.find((a) => a.id === rid) ?? null,
            palettesDir: dataFolders(deps.dataDir).palettes,
            pixel: studios.pixel,
            chiptune: studios.chiptune,
            chipPlan: music?.tracks?.[id],
            ...(mode.draw ? drawing(ctx, studios.config) : {}),
            resolveRef: (rid) => {
              const e = manifest.assets.find((a) => a.id === rid)
              return e ? resolveFile(projectDir, e) : null
            },
            sizes: { background: { w: res.w, h: res.h }, cover: { w: res.w, h: res.h }, spriteHeight: Math.round(res.h * 0.9), musicSeconds: music?.seconds[id] ?? DEFAULT_SECONDS, musicFormat: config.audioFormat },
            onProgress: (p) => {
              if (p.stage !== 'comfy') ctx.log(`${p.id}: ${p.stage} ${p.message}`)
            },
            signal: ctx.signal
          },
          entry,
          o
        ),
      ctx.signal
    )
    if (!r.ok) throw new Error(`${id}: ${r.error}`)
    if (r.skipped) return { skipped: r.reason, entry }
    for (const w of r.warnings ?? []) ctx.log(`${id}: warning: ${w}`)
    const next = (await store.updateAsset(slug, id, (cur) => ({
      ...cur,
      versions: r.entry.versions,
      selected: r.entry.selected,
      source: r.entry.source,
      prompt: r.entry.prompt,
      negative: r.entry.negative,
      engine: r.entry.engine,
      seed: r.entry.seed,
      review: undefined
    })))!
    await svc.emitAsset(slug, next)
    return { entry: next }
  }

  /** In hand-made art mode: how many images still wait for a file (sheets are only a reference), as a suffix for the step message. */
  const handWaiting = async (slug: string): Promise<string> => {
    const { settings } = await store.loadSettings(slug)
    if (!isHandArt(settings.art)) return ''
    const book = await store.loadBook(slug)
    const manifest = await store.loadAssets(slug)
    const orphans = svc.orphanIds(book, settings, manifest.assets)
    const n = manifest.assets.filter((a) => IMAGE_KINDS.has(a.kind) && a.kind !== 'sheet' && !orphans.has(a.id) && !resolveFile(store.dir(slug), a)).length
    return n ? `; ${n} image(s) wait for a hand-made file (vno_asset_replace)` : ''
  }

  /** One asset job: generates it unless it has a file already (`draw`: the sprite is drawn by the agent in Pixel Studio). */
  const generateJob = async (ctx: JobContext, slug: string, draw: boolean): Promise<string> => {
    const body = bodyOf<{ force: boolean; prompt: string; engine: string; seed: number }>(ctx.jobBody)
    const id = ctx.job.unit
    if (!id) throw new Error(`${ctx.job.task} has no asset id`)
    const explicit = !!body.force && (body.prompt !== undefined || body.engine !== undefined || body.seed !== undefined)
    const entry = await svc.requireAsset(slug, id)
    if (IMAGE_KINDS.has(entry.kind) && isHandArt((await store.loadSettings(slug)).settings.art)) return `${id}: hand-made art, not generated (set it with vno_asset_replace)`
    if (!body.force && resolveFile(store.dir(slug), entry)) {
      await svc.bumpStep(slug, 'generate', `${id}: already has a file${await handWaiting(slug)}`)
      return `${id}: already has a file, skipped`
    }
    const r = await generateOne(ctx, slug, id, { force: !!body.force, ...(explicit ? { prompt: body.prompt, engine: body.engine, seed: body.seed } : {}) }, { draw })
    await svc.bumpStep(slug, 'generate', `${r.skipped ? `${id}: ${r.skipped}, skipped` : `${id}: version ${r.entry.selected}`}${await handWaiting(slug)}`)
    return r.skipped ? `${id}: ${r.skipped}, skipped` : `${id}: new version ${r.entry.selected} (${r.entry.engine})`
  }

  reg(
    TASKS.generate,
    async (ctx, slug) => {
      const body = bodyOf<{ dispatch: boolean; force: boolean; ids: string[]; tail: boolean }>(ctx.jobBody)
      if (body.dispatch) return dispatchGenerate(ctx, slug, body)
      return generateJob(ctx, slug, false)
    },
    { noModel: true, step: false }
  )

  // a sprite drawn by the agent in Pixel Studio: the same job, but it asks a model, so it is not `noModel`
  reg(TASKS.draw, (ctx, slug) => generateJob(ctx, slug, true), { step: false })

  /** The fan-out: one job per asset that needs a file, the reviews when they are on, then the rest of the chain. */
  const dispatchGenerate = async (ctx: JobContext, slug: string, body: { force?: boolean; ids?: string[]; tail?: boolean }): Promise<string> => {
    const run = ctx.job.round
    await svc.reconcileAssets(slug)
    const { settings } = await store.loadSettings(slug)
    const book = await store.loadBook(slug)
    const manifest = await store.loadAssets(slug)
    const orphans = svc.orphanIds(book, settings, manifest.assets)
    const hand = isHandArt(settings.art)
    const todo = manifest.assets
      .filter((a) => a.kind !== 'voiceRef' && !(hand && IMAGE_KINDS.has(a.kind)) && !orphans.has(a.id) && (!body.ids || body.ids.includes(a.id)))
      .filter((a) => !a.locked && a.source === 'generated' && (body.force || !resolveFile(store.dir(slug), a)))
      .sort((a, b) => (a.kind === 'sheet' ? 0 : 1) - (b.kind === 'sheet' ? 0 : 1))
    // Flow is checked once, before the fan-out: not running or not signed in fails the step at once with the hint, not every asset one by one
    if (todo.some((a) => runsOnFlow(a, settings))) {
      const { flow } = await svc.studios()
      const s = await flow.status().catch((e: Error) => ({ up: false, signedIn: null, uploadRights: false, hint: e.message }))
      if (!s.up || s.signedIn === false) throw new Error(`Google Flow is not ready: ${s.hint ?? 'flow-music-mcp does not answer'}`)
    }
    const waiting = await handWaiting(slug)
    await svc.setStep(slug, 'generate', todo.length ? 'running' : 'done', todo.length ? `${todo.length} asset(s) to generate${waiting}` : `${hand ? 'hand-made art: nothing to generate' : 'every asset already has a file'}${waiting}`, { done: 0, total: todo.length })
    const reviewOn = settings.art.review && deps.router.candidates('art-critic', { visionOnly: true }).length > 0
    if (settings.art.review && !reviewOn) ctx.log('art review is on but no vision model is available: the images are not reviewed')
    const generated = new Map<string, string>()
    const all: string[] = []
    const priority = ctx.job.priority ?? 0 // an explicit request (vno_asset_generate) keeps its priority for the jobs it fans out
    for (const a of todo) {
      // a sprite waits for its sheet, a CG for the sheets of its characters, and both for a sheet job of another run that is still queued or running (a regenerated sheet)
      const refs = a.kind === 'sprite' || a.kind === 'cg' ? (a.refs ?? []) : []
      const sheets = refs.flatMap((r) => generated.get(r) ?? [])
      const otherSheet = refs.length ? (await svc.activeGenerateJobs(slug, refs)).filter((j) => j.data.round !== run).map((j) => j.id) : []
      const id = await svc.enqueue(slug, svc.generateTask(settings, a), a.id, run, { depends_on: [...sheets, ...otherSheet], body: { force: !!body.force }, label: `generate ${a.id}`, priority, max_attempts: svc.maxAttempts(settings, a), lane: svc.generateLane(settings, a) })
      generated.set(a.id, id)
      all.push(id)
      if (reviewOn && IMAGE_KINDS.has(a.kind)) all.push(await svc.enqueue(slug, TASKS.review, a.id, run, { depends_on: [id], vision: true, label: `review ${a.id}`, priority }))
    }
    if (body.tail !== false) await svc.enqueueTail(slug, run, 'voice', all, priority)
    return `${todo.length} asset job(s) queued${reviewOn ? ' with reviews' : ''}${waiting}`
  }

  // ---- review ----

  reg(
    TASKS.review,
    async (ctx, slug) => {
      const id = ctx.job.unit
      if (!id) throw new Error('vn.assets.review has no asset id')
      const dir = store.dir(slug)
      let entry = await svc.requireAsset(slug, id)
      if (entry.locked || entry.source === 'custom') return `${id}: locked or custom, not reviewed`
      if (!resolveFile(dir, entry)) return `${id}: no file to review`
      const attempts: { n: number; problems: string[] }[] = []
      for (let attempt = 0; attempt <= REVIEW_RETRIES; attempt++) {
        const file = resolveFile(dir, entry)
        if (!file) break
        const manifest = await store.loadAssets(slug)
        const sheetEntry = entry.kind === 'sprite' ? manifest.assets.find((a) => a.id === entry.refs?.[0]) : undefined
        const sheetFile = sheetEntry ? resolveFile(dir, sheetEntry) : null
        const r = await tryAgent(ctx, 'art-critic', async () =>
          reviewImage(call(ctx), { entry, prompt: entry.prompt || entry.versions.find((v) => v.n === entry.selected)?.prompt || '', image: await fs.readFile(file), sheet: sheetFile ? await fs.readFile(sheetFile) : undefined })
        )
        if (!r.ok) {
          const note = `the review could not run: ${r.error}`
          const next = await store.updateAsset(slug, id, (cur) => ({ ...cur, review: { status: 'pending', note } }))
          if (next) await svc.emitAsset(slug, next)
          return `${id}: ${note}`
        }
        const review = r.value
        attempts.push({ n: entry.selected ?? 1, problems: review.problems })
        if (review.approved) {
          const next = await store.updateAsset(slug, id, (cur) => ({ ...cur, review: { status: 'approved' } }))
          if (next) await svc.emitAsset(slug, next)
          return `${id}: approved${attempt ? ` after ${attempt} retry(ies)` : ''}`
        }
        ctx.log(`art-critic rejected ${id} (attempt ${attempt + 1}): ${review.problems.join('; ') || 'no reason given'}`)
        const revised = review.revisedPrompt?.trim()
        if (attempt === REVIEW_RETRIES || !revised) break
        entry = (await generateOne(ctx, slug, id, { force: true, prompt: revised })).entry
      }
      // out of retries: keep the version with the fewest problems (the latest on a tie) and say what was wrong
      const best = attempts.reduce((b, a) => (a.problems.length <= b.problems.length ? a : b), attempts[0]!)
      const note = best.problems.join('; ') || 'rejected by the art-critic'
      const next = await store.updateAsset(slug, id, (cur) => ({ ...(cur.versions.some((v) => v.n === best.n) ? pickVersion(cur, best.n) : cur), review: { status: 'rejected', note } }))
      if (next) await svc.emitAsset(slug, next)
      return `${id}: kept version ${best.n}, review rejected: ${note}`
    },
    { reviewing: true, step: false }
  )

  // ---- stage ----

  reg(TASKS.stage, async (ctx, slug) => {
    const book = await store.loadBook(slug)
    const manifest = await store.loadAssets(slug)
    const dir = store.dir(slug)
    const musicIds = manifest.assets.filter((a) => a.kind === 'music' && resolveFile(dir, a)).map((a) => a.id).sort()
    const warnings: string[] = []
    // cues set with vno_set_cues win: the stage-director is not asked, only what they lack (a new scene or cast) gets the defaults
    const current = await store.readJson<StageCues>(slug, 'cues.json')
    if (current?.byHand) {
      const filled = fillCues(current, book, { musicIds, warn: (m) => warnings.push(m) })
      addScenePlan(filled.cues, book, (await store.readJson<MusicPlan>(slug, 'music.json'))?.scenes, musicIds)
      for (const w of warnings) ctx.log(`stage: ${w}`)
      await store.writeJson(slug, 'cues.json', { ...filled.cues, byHand: true })
      return `cues set by hand kept${filled.added ? `, ${filled.added} default cue(s) added for new chapters, scenes or casts` : ''}; the stage-director was not asked`
    }
    let cues: StageCues = defaultCues(book, { musicIds, warn: (m) => warnings.push(m) })
    // the composer's plan decides the music; the stage-director may still choose another track per chapter
    const plan = await store.readJson<MusicPlan>(slug, 'music.json')
    if (plan) {
      if (plan.menu && musicIds.includes(plan.menu)) cues.menuMusic = plan.menu
      for (const c of book.chapters) {
        const id = plan.chapters[c.n]
        if (id && musicIds.includes(id)) cues.chapters[c.n] = { music: id }
      }
      addScenePlan(cues, book, plan.scenes, musicIds)
    }
    let staged = 0
    let down = ''
    for (const chapter of book.chapters) {
      if (down) break
      const r = await tryAgent(ctx, `stage-director (chapter ${chapter.n})`, () => stageChapter(call(ctx), book, chapter, musicIds))
      if (!r.ok) {
        down = r.error
        break
      }
      const merged = mergeChapterCues(cues, chapter, r.value, musicIds, book.sounds ?? [])
      cues = merged.cues
      for (const n of merged.notes) ctx.log(`stage-director: ${n}`)
      staged++
    }
    for (const w of warnings) ctx.log(`stage: ${w}`)
    await store.writeJson(slug, 'cues.json', cues)
    return down ? `${staged} of ${book.chapters.length} chapter(s) staged by the stage-director; the rest use the default cues (${down})` : `${staged} chapter(s) staged by the stage-director`
  })

  // ---- voice ----

  const voiceDir = (slug: string, lang: Lang) => path.join(store.dir(slug), 'voice', lang)
  const readVoiceIndex = (slug: string, lang: Lang): Promise<Record<string, VoiceIndexEntry>> => readVoiceIndexIn(voiceDir(slug, lang))

  reg(
    TASKS.voicePlan,
    async (ctx, slug) => {
      const { settings } = await store.loadSettings(slug)
      if (!settings.voice.enabled) return 'voice is off for this project'
      const body = bodyOf<{ overwrite?: boolean; standalone?: boolean }>(ctx.jobBody)
      await svc.setStep(slug, 'voice', 'running', 'planning the voices')
      try {
        const book = await store.loadBook(slug)
        await svc.reconcileAssets(slug)
        const langs = voiceLangsOf(settings)
        const flowProvider = settings.voice.provider === 'flow'
        const folders = dataFolders(deps.dataDir)
        // the clips uploaded for the local engines: the director may name one for a speaker (but nothing is set on them)
        const library = !flowProvider && existsSync(folders.voices) ? (await fs.readdir(folders.voices)).filter((f) => /\.(wav|mp3|flac|ogg|opus)$/i.test(f)).sort() : []
        let msg: string
        if (flowProvider) {
          // Flow: the free Gemini voices (every language) or the Windows voices of a language's culture; an unreachable flow-music-mcp fails here
          const listed = flowAsVoiceList(await (await svc.studios()).flow.voices(ctx.signal), langs)
          const r = await tryAgent(ctx, 'voice-director', () => planVoices(call(ctx), book, [], describeVoices(listed.voices, langs)))
          msg = await planListVoices(svc, slug, r.ok ? r.value : null, { overwrite: body.overwrite, listed, source: 'Google Flow', log: (m) => ctx.log(m), signal: ctx.signal })
        } else {
          // Local: the TTS Audio Suite engines and the custom TTS workflows that read each language
          const engines: TtsEngineInfo[] = [
            ...Object.entries(ENGINES)
              .filter(([, e]) => e.task === 'tts')
              .map(([id, e]) => ({ id, label: e.label, languages: e.languages ?? '*' })),
            ...(await svc.customWorkflows())
              .filter((w) => w.kind === 'audio' && w.languages.length > 0)
              .map((w) => ({ id: `custom:${w.name}`, label: `${w.name} (custom workflow)`, languages: w.languages }))
          ]
          const r = await tryAgent(ctx, 'voice-director', () => planVoices(call(ctx), book, library, '', describeTtsEngines(engines, langs)))
          msg = r.ok
            ? await planComfyVoices(svc, slug, r.value, engines, { overwrite: body.overwrite, log: (m) => ctx.log(m) })
            : `the voice-director did not answer (${r.error}): the clips use ${settings.voice.engine} with no delivery style`
        }
        await svc.emitProject(slug)
        if (body.standalone) await svc.setStep(slug, 'voice', 'done', msg)
        return msg
      } catch (e) {
        if (!fatal(ctx, e)) await svc.setStep(slug, 'voice', 'failed', (e as Error).message)
        throw e
      }
    },
    { step: false }
  )

  reg(
    TASKS.voiceGenerate,
    async (ctx, slug) => {
      const lang = ctx.job.unit as Lang
      const body = bodyOf<{ beatId?: string; limit?: number; force?: boolean; speakerKey?: string }>(ctx.jobBody)
      const { settings } = await store.loadSettings(slug)
      if (!settings.voice.enabled) return 'voice is off for this project: no clips generated'
      try {
        const r =
          settings.voice.provider === 'flow'
            ? await (async () => {
                const { flow, config: studiosConfig } = await svc.studios()
                const config = await svc.voiceConfig()
                return generateFlowClips(svc, slug, lang, {
                  beatId: body.beatId,
                  limit: body.limit,
                  flow,
                  format: config.format,
                  settings: { pauseMs: studiosConfig.flowVoicePauseMs, retries: studiosConfig.flowVoiceRetries },
                  log: (m) => ctx.log(m),
                  signal: ctx.signal
                })
              })()
            : await generateComfyTtsClips(svc, slug, lang, {
                beatId: body.beatId,
                limit: body.limit,
                force: body.force,
                speakerKey: body.speakerKey,
                comfy: await svc.comfy({ autoStart: true, log: ctx.log }),
                config: await svc.voiceConfig(),
                log: (m) => ctx.log(m),
                signal: ctx.signal
              })
        ctx.log(r.message)
        await svc.setStep(slug, 'voice', r.status, r.message)
        return r.message
      } catch (e) {
        if (!fatal(ctx, e)) await svc.setStep(slug, 'voice', 'failed', (e as Error).message)
        throw e
      }
    },
    { noModel: true, step: false }
  )

  // ---- build, lint ----

  /** The voice clips of the project, for the web game emitter. Voices are per language: every edition language is included. */
  const voiceSource = async (slug: string, settings: ProjectSettings): Promise<VoiceSource | undefined> => {
    if (!settings.voice.enabled) return undefined
    const indexes = new Map<Lang, Record<string, VoiceIndexEntry>>()
    for (const lang of new Set<Lang>(voiceLangsOf(settings))) indexes.set(lang, await readVoiceIndex(slug, lang))
    return {
      has: (lang, beatId) => {
        const e = indexes.get(lang)?.[beatId]
        const f = e ? path.join(voiceDir(slug, lang), e.file) : null
        return f && existsSync(f) ? f : null
      }
    }
  }

  reg(
    TASKS.build,
    async (ctx, slug) => {
      const { settings } = await store.loadSettings(slug)
      const book = await store.loadBook(slug)
      const renpy = await loadRenpyConfig(deps.dataDir)
      const editions = await store.loadEditions(slug, settings.primaryLang)
      const manifest = await store.loadAssets(slug)
      const dir = store.dir(slug)
      const byId = new Map(manifest.assets.map((a) => [a.id, a]))
      const cues = (await store.readJson<StageCues>(slug, 'cues.json')) ?? undefined
      const r = await buildGame({
        projectDir: dir,
        book,
        editions,
        settings: { ...settings, editions: editions.map((e) => e.lang) },
        resolveAsset: (id) => {
          const e = byId.get(id)
          return e ? resolveFile(dir, e) : null
        },
        voice: await voiceSource(slug, settings),
        musicLoops: (id) => {
          const e = byId.get(id)
          // a custom file (uploaded by hand) has no known loop points: it plays from the start as before
          return e && e.source === 'generated' ? e.versions.find((v) => v.n === e.selected)?.loopStartSec : undefined
        },
        cues,
        sdkPath: renpy.sdkPath,
        resolution: renpy.resolution,
        imageFormat: renpy.imageFormat,
        templateDir: svc.dirs.templates,
        themesDir: svc.dirs.themes,
        fontsDir: dataFolders(deps.dataDir).fonts
      })
      const messages = [...r.warnings]
      const primary = editions.find((e) => e.lang === settings.primaryLang)
      if (primary) for (const p of primaryEditionProblems(book, primary)) messages.push(`primary text: ${p}`)
      for (const s of await svc.staleEditions(slug)) messages.push(`edition ${s.lang} was made for pack ${s.editionPackHash}, the project uses ${settings.packHash}: re-add it from the translated catalogue`)
      const result: BuildResult = { slug, action: 'build', ok: true, messages, at: nowIso(), gameDir: r.gameDir, theme: r.theme, placeholders: r.placeholders, translated: r.translated }
      await store.writeJson(slug, 'build.json', result)
      deps.emit({ type: 'build.result', result })
      for (const m of messages.slice(0, 20)) ctx.log(`build: ${m}`)
      return `built ${r.gameDir} (theme ${r.theme}, ${r.placeholders.length} placeholder image(s), ${r.translated.length} translation(s), ${messages.length} warning(s))`
    },
    { noModel: true }
  )

  reg(
    TASKS.lint,
    async (_ctx, slug) => {
      const renpy = await loadRenpyConfig(deps.dataDir)
      const gameDir = svc.gameDir(slug)
      let result: BuildResult
      let warningCount = 0
      if (!existsSync(path.join(gameDir, 'index.html')) && !existsSync(path.join(gameDir, 'game', 'index.html')) && !existsSync(path.join(gameDir, 'game-data.json'))) {
        result = { slug, action: 'lint', ok: false, skipped: true, messages: ['lint skipped: the game has not been built yet'], at: nowIso(), gameDir }
      } else {
        const l = await lint(gameDir, { sdkPath: renpy.sdkPath })
        const { settings } = await store.loadSettings(slug)
        const book = await store.loadBook(slug)
        const primary = await store.loadEdition(slug, settings.primaryLang).catch(() => null)
        const projectProblems = primary ? primaryEditionProblems(book, primary) : []
        for (const s of await svc.staleEditions(slug)) projectProblems.push(`edition ${s.lang} was made for pack ${s.editionPackHash}, the project uses ${settings.packHash}: re-add it from the translated catalogue`)
        // the run's warnings (a picture-book page without text, left-over sprites) are shown but do not fail the lint
        warningCount = l.warnings.length
        const messages = [...l.warnings.map((w) => `warning: ${w}`), ...l.messages, ...projectProblems]
        result = { slug, action: 'lint', ok: l.ok && !projectProblems.length, messages, statistics: l.statistics, at: nowIso(), gameDir }
      }
      await store.writeJson(slug, 'lint.json', result)
      deps.emit({ type: 'build.result', result })
      const blocks = /The game contains (\d[\d,]*) dialogue blocks/.exec(result.statistics ?? '')?.[1]
      const pages = /The game contains (\d[\d,]*) pages/.exec(result.statistics ?? '')?.[1]
      return result.skipped
        ? result.messages[0]!
        : result.ok
          ? `lint is clean${warningCount ? ` (${warningCount} warning(s))` : ''}${pages ? ` (${pages} pages)` : blocks ? ` (${blocks} dialogue blocks)` : ''}`
          : `lint found ${result.messages.length} problem(s)`
    },
    { noModel: true }
  )

  // ---- summary ----

  reg(
    TASKS.summary,
    async (ctx, slug) => {
      const status = await svc.pipelineStatus(slug)
      const steps = Object.entries(status?.steps ?? {}).map(([step, s]) => ({ step, status: s!.status, message: s!.message }))
      const book = await store.loadBook(slug)
      const r = await tryAgent(ctx, 'director', () => summarizeRun(call(ctx), { slug, title: book.title }, steps))
      const text = r.ok ? r.value.summary : steps.map((s) => `${s.step}: ${s.status}`).join(', ')
      ctx.log(`Run summary: ${text}`)
      await store.writeJson(slug, 'summary.json', { at: nowIso(), run: status?.run ?? 0, summary: text, redo: r.ok ? r.value.redo : [] })
      return text
    },
    { step: false }
  )

  return svc
}
