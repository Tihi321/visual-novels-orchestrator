import { z } from 'zod'
import type { PipelineStep, ProjectSettingsPatch } from '../../shared/protocol'
import { languages } from '../../shared/languages'
import { langSchema } from '../../shared/vn'
import { jsonSchemaOf } from '../pipeline/llm'
import { isStep, STEPS, TASKS } from '../vn/pipeline'
import type { VnService } from '../vn/service'
import type { ClientTaskQueue } from '../models/client'
import { clientTools } from './tools-client'
import { importTools } from './tools-import'
import { langTools } from './tools-lang'
import { planTools } from './tools-plan'
import { storyTools } from './tools-story'

/**
 * The MCP tools. They drive the same `VnService` as the app and the CLI, so a shared engine shows what an agent does in the UI
 * (the service emits its own events). `server.ts` serves them over HTTP and stdio, `callTool` runs one.
 */

export interface Tool {
  name: string
  description: string
  schema: z.ZodType
  run: (args: never) => Promise<unknown>
}

export interface McpOptions {
  /** How long a `wait` call waits at most (ms). Default 10 minutes. */
  waitTimeoutMs?: number
  /** The queue switches of the engine (`vno_pause_all`, `vno_resume_all`, `vno_stop_now`). Without it those tools say they are unavailable. */
  control?: { setPaused(paused: boolean): Promise<void>; stopNow(opts?: { drop?: boolean; slug?: string }): Promise<void>; clearQueue(slug?: string): Promise<{ dropped: number; projects: string[] }> }
  /** The engine's client task queue (model calls of `client/...` models). Default: the one of the service's registry. */
  clientQueue?: ClientTaskQueue
  /** Sets the Scriptorium library folder (`scriptoriumData` in config/settings.md) and returns it resolved. Without it `vno_set_library` says it is unavailable. */
  setScriptoriumData?: (folder: string) => Promise<string>
  /** The fetch `vno_fonts_fetch` downloads with (tests pass a fake). Default: the global one. */
  fetchImpl?: typeof fetch
}

/** Makes a tool: the arguments are parsed with `schema` before `run` sees them. */
export type ToolDef = <S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.output<S>) => Promise<unknown>) => Tool
export const def: ToolDef = (name, description, schema, run) => ({ name, description, schema, run: run as Tool['run'] })

/** A tool result with extra content blocks (images) besides its data. */
export class ToolOutput {
  constructor(
    readonly data: unknown,
    readonly extra: { type: 'image'; data: string; mimeType: string }[]
  ) {}
}

/** The result of a `tools/call`: a readable text item plus the same data as `structuredContent`. */
export interface ToolResult {
  [key: string]: unknown
  /** The first block is the text; image blocks may follow. */
  content: [{ type: 'text'; text: string }, ...{ type: 'image'; data: string; mimeType: string }[]]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const slug = z.string().describe('The project slug (see vno_list_projects)')
const lang = langSchema.describe('A language code such as en, hr, de or ja (vno_languages lists them)')
const wait = z.boolean().optional().describe('Wait until the jobs finish before answering')
const assetKind = z.enum(['background', 'sheet', 'sprite', 'cover', 'cg', 'music', 'sfx', 'ambience', 'voiceRef'])

/** What `wait` says when jobs wait for the client: how many tasks, and what to do. */
export function clientHint(n: number): { clientTasks?: number; hint?: string } {
  return n > 0 ? { clientTasks: n, hint: 'Model calls are waiting for you: call vno_get_task, answer with vno_submit_task, repeat until none, then vno_wait again.' } : {}
}

/** The tool list, bound to a service. */
export function buildTools(svc: VnService, opts: McpOptions = {}): Tool[] {
  const timeoutMs = opts.waitTimeoutMs ?? 10 * 60_000
  const queue = () => opts.clientQueue ?? svc.deps.registry.clientQueue
  const settle = async (s: string, doWait: boolean | undefined) => {
    if (!doWait) return { waited: false }
    const r = await svc.waitIdle(s, { timeoutMs })
    return { waited: true, timedOut: r.timedOut, failedJobs: r.failed, ...clientHint(r.clientTasks) }
  }
  const control = () => {
    if (!opts.control) throw new Error('the queue switches are not available here')
    return opts.control
  }

  return [
    def('vno_list_books', 'List the books in the Scriptorium library that can become visual novels (slug, title, format, folder).', z.object({}), async () => ({ scriptoriumData: svc.scriptoriumDir(), books: await svc.listSourceBooks() })),
    def(
      'vno_import',
      'Import a book (a book folder, or a Scriptorium library slug) into a new VN Studio project. The language is detected; pass lang to override it. Returns the project slug and the detected language.',
      z.object({ source: z.string().describe('A book folder path or a library slug'), lang: lang.optional(), run: z.boolean().optional().describe('Start the pipeline after the import') }),
      async (a) => {
        const r = await svc.importProject(a.source, { lang: a.lang })
        const run = a.run ? await svc.runPipeline(r.slug, 'analyse') : null
        return { slug: r.slug, preview: r.preview, run }
      }
    ),
    def('vno_list_projects', 'List the projects with their language, editions, asset counts and pipeline state.', z.object({}), async () => ({ projects: await svc.listProjects() })),
    def(
      'vno_run_pipeline',
      `Run the pipeline for a project from a step (${STEPS.join(', ')}); default: analyse. It is restartable from any step. Use vno_status to follow it, or pass wait.`,
      z.object({ slug, from: z.string().optional().describe(`One of ${STEPS.join(', ')}`), force: z.boolean().optional().describe('Plan and generate again, even for assets that have a file'), wait }),
      async (a) => {
        if (a.from !== undefined && !isStep(a.from)) throw new Error(`from must be one of ${STEPS.join(', ')}`)
        const r = await svc.runPipeline(a.slug, a.from as PipelineStep | undefined, { force: a.force })
        return { ...r, ...(await settle(a.slug, a.wait)), status: await svc.status(a.slug) }
      }
    ),
    def(
      'vno_status',
      'The pipeline state of a project: each step, the jobs queued, running, done and failed, and the failures. models: the models set for this project, per role, each with usable (false and a reason when a job would skip it, for example no key). clientTasks: the model calls waiting for you or leased (see vno_get_task).',
      z.object({ slug }),
      async (a) => ({ ...(await svc.status(a.slug)), models: await svc.projectModels(a.slug), clientTasks: queue().counts() })
    ),
    def(
      'vno_asset_list',
      'List the assets of a project (backgrounds, character sheets, sprites, CGs and inserts, cover, music, sound effects, ambiences, voice references) with their prompt, versions, lock and file.',
      z.object({ slug, kind: assetKind.optional() }),
      async (a) => {
        const assets = await svc.listAssets(a.slug)
        return { assets: assets.filter((x) => !a.kind || x.kind === a.kind).map((x) => ({ id: x.id, kind: x.kind, prompt: x.prompt, engine: x.engine, selected: x.selected, versions: x.versions.length, source: x.source, locked: x.locked, review: x.review, file: x.fileRel, unused: x.orphaned })) }
      }
    ),
    def(
      'vno_asset_replace',
      'Use your own file for an asset (it becomes custom and locked, and the next build uses it). Rebuilds the game unless rebuild is false.',
      z.object({ slug, id: z.string().describe('The asset id, for example bg_harbour_dusk or sprite_mara_happy'), file: z.string().describe('Absolute path of the image or audio file'), rebuild: z.boolean().optional(), wait }),
      async (a) => {
        const entry = await svc.replaceAsset(a.slug, a.id, a.file, { rebuild: a.rebuild })
        return { asset: svc.assetView(a.slug, entry), ...(a.rebuild === false ? {} : await settle(a.slug, a.wait)) }
      }
    ),
    def(
      'vno_asset_regen',
      'Generate a new version of an asset with ComfyUI (optionally with a new prompt, engine or seed), select it, and rebuild. It runs before the older jobs of the pipeline. A regenerated character sheet is made before the sprite jobs already queued for it; the sprites already made from the old sheet come back as staleSprites, and sprites: true makes them again after the sheet (every unlocked, generated sprite of it). An image of a hand-made art project (art.provider hand) is refused: use vno_asset_replace.',
      z.object({ slug, id: z.string(), prompt: z.string().optional(), engine: z.string().optional(), seed: z.number().int().optional(), sprites: z.boolean().optional().describe('A sheet: also make its sprites again, after the sheet'), wait }),
      async (a) => {
        const r = await svc.regenerateAsset(a.slug, a.id, { prompt: a.prompt, engine: a.engine, seed: a.seed, sprites: a.sprites })
        return { jobs: r.jobs, ...(r.staleSprites.length ? { staleSprites: r.staleSprites, hint: 'These sprites were made from the old sheet: vno_asset_regen {id: <sheet>, sprites: true} makes them again, or regenerate them one by one.' } : {}), ...(await settle(a.slug, a.wait)) }
      }
    ),
    def(
      'vno_build',
      "Build the Ren'Py game of a project (waits for the build by default). Returns the game folder, the theme, which assets are still placeholders and the build warnings.",
      z.object({ slug, wait }),
      async (a) => {
        const job = await svc.enqueueBuild(a.slug)
        const w = await settle(a.slug, a.wait ?? true)
        return { job, ...w, build: (await svc.detail(a.slug).catch(() => null))?.build ?? null }
      }
    ),
    def(
      'vno_lint',
      "Run Ren'Py lint on the built game (waits by default). Returns ok and the problems; skipped when the SDK is missing or the game is not built.",
      z.object({ slug, wait }),
      async (a) => {
        const job = await svc.enqueueLint(a.slug)
        const w = await settle(a.slug, a.wait ?? true)
        return { job, ...w, lint: (await svc.detail(a.slug).catch(() => null))?.lint ?? null }
      }
    ),
    def(
      'vno_add_edition',
      'Add a translated edition (a book folder in the same format, translated by a person or by Book Translator) to a project. It reuses every asset and only adds text. Without lang the language of the folder is detected. Returns the alignment report.',
      z.object({ slug, source: z.string().describe('The translated book folder (or library slug)'), lang: lang.optional(), wait }),
      async (a) => {
        const r = await svc.addEdition(a.slug, a.source, a.lang)
        const w = await settle(a.slug, a.wait ?? true)
        return { job: r.job, lang: r.lang, detected: r.detected, ...w, report: await svc.alignReport(a.slug, r.lang) }
      }
    ),

    // ---- projects and settings ----
    def('vno_get_project', 'One project in full: its settings (theme, art, music, voice), editions, assets, pipeline state, build and lint results.', z.object({ slug }), async (a) => ({ project: { ...(await svc.detail(a.slug)), models: await svc.projectModels(a.slug) } })),
    def(
      'vno_update_settings',
      'Change the settings of a project: each part is merged into the current one, and the asset list follows. theme: a theme name (vno_themes) or null. art: style (pixel or illustrated), palette, stylePrompt, provider (comfy, pixel-studio-draw, or hand: images are made by you and set with vno_asset_replace, ComfyUI is never called for an image), pixelProvider, pixel {width,height,dither,outline}. music: provider, chip, tracks. voice: provider, englishEngine and the other voice settings (vno_get_project shows them). models: {role: provider/model, ...} the models this project uses for those roles, before the agent and role lists of config/roles.md (the way to have an MCP client do one project: {"art-director": "client/claude-code"}); null for a role clears it. A new art.stylePrompt (or art style) is also written into the prompts that have no image yet (restyle in the answer lists the assets: kept, and generated, which keep the old style until regenerated). A model whose provider has no key (or is down) is saved but not used: the answer has warnings, and vno_status shows models with usable and the reason. null clears an optional field.',
      z.object({
        slug,
        theme: z.string().nullable().optional(),
        art: z.record(z.string(), z.unknown()).optional(),
        music: z.record(z.string(), z.unknown()).optional(),
        voice: z.record(z.string(), z.unknown()).optional(),
        models: z.record(z.string(), z.string().nullable()).optional().describe('role -> provider/model, for example {"art-director": "client/claude-code"}; null clears a role')
      }),
      async (a) => {
        const patch = { ...(a.theme !== undefined ? { theme: a.theme } : {}), ...(a.art ? { art: a.art } : {}), ...(a.music ? { music: a.music } : {}), ...(a.voice ? { voice: a.voice } : {}), ...(a.models ? { models: a.models } : {}) } as ProjectSettingsPatch
        const r = await svc.updateSettings(a.slug, patch)
        const rs = r.restyle
        const restyle = rs
          ? {
              restyled: rs.restyled,
              kept: rs.kept,
              generated: rs.generated,
              ...(rs.kept.length || rs.generated.length
                ? { hint: `${rs.kept.length ? `vno_plan {refreshPrompts: true} writes the prompts again for ${rs.kept.length} asset(s) whose prompt did not start with the old style words. ` : ''}${rs.generated.length ? `vno_asset_regen makes the ${rs.generated.length} asset(s) that already have an image again in the new style.` : ''}`.trim() }
                : {})
            }
          : undefined
        return { settings: r.settings, ...(r.warnings.length ? { warnings: r.warnings } : {}), ...(restyle ? { restyle } : {}) }
      }
    ),
    def(
      'vno_delete_project',
      'Delete a project folder with everything in it (assets, editions, the built game). It cannot be undone: pass confirm: true.',
      z.object({ slug, confirm: z.literal(true).describe('Must be true') }),
      async (a) => {
        await svc.deleteProject(a.slug)
        return { deleted: a.slug }
      }
    ),

    // ---- editions ----
    def('vno_get_edition', 'The text of an edition: every beat id with its text.', z.object({ slug, lang }), async (a) => ({ edition: await svc.getEdition(a.slug, a.lang) })),
    def(
      'vno_update_beat',
      'Change the text of one beat (or a title, choice or ending by its key) of an edition. Build again to see it in the game.',
      z.object({ slug, lang, beatId: z.string(), text: z.string() }),
      async (a) => {
        await svc.updateEditionBeat(a.slug, a.lang, a.beatId, a.text)
        return { slug: a.slug, lang: a.lang, beatId: a.beatId }
      }
    ),
    def('vno_align_report', 'The alignment report of an edition: matched, missing and extra beats, and warnings.', z.object({ slug, lang }), async (a) => ({ report: await svc.alignReport(a.slug, a.lang) })),

    // ---- assets ----
    def(
      'vno_asset_pick',
      'Use another version of an asset (versions are numbered from 1, see vno_asset_list). Rebuilds the game unless rebuild is false.',
      z.object({ slug, id: z.string(), version: z.number().int().min(1), rebuild: z.boolean().optional(), wait }),
      async (a) => {
        const entry = await svc.pickAssetVersion(a.slug, a.id, a.version, { rebuild: a.rebuild })
        return { asset: svc.assetView(a.slug, entry), ...(a.rebuild === false ? {} : await settle(a.slug, a.wait)) }
      }
    ),
    def('vno_asset_lock', 'Lock an asset: the pipeline will not generate it again.', z.object({ slug, id: z.string() }), async (a) => ({ asset: svc.assetView(a.slug, await svc.lockAsset(a.slug, a.id, true)) })),
    def('vno_asset_unlock', 'Unlock an asset, so the pipeline may generate it again.', z.object({ slug, id: z.string() }), async (a) => ({ asset: svc.assetView(a.slug, await svc.lockAsset(a.slug, a.id, false)) })),
    def(
      'vno_asset_generate',
      'Generate the assets that have no file yet (all, or the given kind or ids). force: also those that have one (locked and custom ones stay). Uses the prompts already planned. With art.provider hand no image is generated (naming an image is an error: use vno_asset_replace); music and voice are.',
      z.object({ slug, kind: assetKind.optional(), only: z.array(z.string()).optional().describe('Asset ids'), force: z.boolean().optional(), wait }),
      async (a) => {
        await svc.reconcileAssets(a.slug)
        let ids: string[] | undefined
        if (a.only || a.kind) {
          const assets = await svc.listAssets(a.slug)
          const matched = assets.filter((x) => (!a.only || a.only.includes(x.id)) && (!a.kind || x.kind === a.kind) && !x.orphaned)
          ids = matched.map((x) => x.id)
          if (!ids.length) throw new Error('no asset matches kind/only')
          const { settings } = await svc.store.loadSettings(a.slug)
          for (const x of matched) svc.assertNotHandImage(settings, x)
        }
        const job = await svc.enqueue(a.slug, TASKS.generate, 'all', await svc.nextRun(a.slug), { body: { dispatch: true, force: !!a.force, ids, tail: false }, priority: 1 })
        return { job, ...(await settle(a.slug, a.wait)) }
      }
    ),

    // ---- voice (VibeTTS: each character has one voice per edition language) ----
    def(
      'vno_voice_status',
      'Is VibeTTS (the local text-to-speech app) reachable, and which voices it has (id, label, engine, languages) and whether Supertonic is installed. Voices are fixed: Kokoro voices read English only, supertonic:F1..F5 and supertonic:M1..M5 read any language.',
      z.object({}),
      async () => {
        const { type: _type, ...status } = await svc.voiceStatus()
        return status
      }
    ),
    def(
      'vno_voice_plan',
      'Assign a VibeTTS voice to every character and the narrator, one voice per edition language (existing voices are kept unless overwrite). Kokoro reads English only, supertonic:* reads any language (a non-English edition needs Supertonic installed). The project needs voice.enabled (vno_update_settings). Queues a job: pass wait to wait for it.',
      z.object({ slug, overwrite: z.boolean().optional(), wait }),
      async (a) => {
        const jobs = await svc.planVoices(a.slug, { overwrite: a.overwrite })
        return { jobs, ...(await settle(a.slug, a.wait)), voices: (await svc.store.loadSettings(a.slug)).settings.voice.voices }
      }
    ),
    def(
      'vno_voice_set',
      'Give a speaker (a character key, or narrator) a voice for one edition language, and make a preview clip. Kokoro voices read English only; supertonic:F1..F5 / supertonic:M1..M5 read any language. Ids are in vno_voice_status.',
      z.object({ slug, speakerKey: z.string().describe('A character key or narrator'), lang, voice: z.string().describe('A voice id, for example af_heart or supertonic:F2') }),
      async (a) => ({ preview: await svc.setVoice(a.slug, a.speakerKey, a.lang, a.voice) })
    ),
    def(
      'vno_voice_preview',
      "Make a short preview clip of a voice in a language, without assigning it. Without voice: the speaker's assigned voice for that language. Kokoro voices read English only, supertonic:* any language.",
      z.object({ slug, speakerKey: z.string(), lang, voice: z.string().optional() }),
      async (a) => {
        const voice = a.voice ?? (await svc.store.loadSettings(a.slug)).settings.voice.voices[a.speakerKey]?.[a.lang]
        if (!voice) throw new Error(`${a.speakerKey} has no voice for ${a.lang} yet: pass voice, or run vno_voice_plan or vno_voice_set`)
        return { preview: await svc.previewVoice(a.slug, a.speakerKey, voice, a.lang) }
      }
    ),
    def(
      'vno_voice_generate',
      'Generate the spoken clips of a project (all its edition languages, or one lang, one beatId, at most limit clips per language). Each language uses the voices set for it. Nothing is made when the project voice is off (voice.enabled). Queues jobs: pass wait to wait for them.',
      z.object({ slug, lang: lang.optional(), beatId: z.string().optional(), limit: z.number().int().positive().optional(), wait }),
      async (a) => {
        const jobs = await svc.generateVoice(a.slug, { lang: a.lang, beatId: a.beatId, limit: a.limit })
        return { jobs, ...(await settle(a.slug, a.wait)) }
      }
    ),

    // ---- generators ----
    def('vno_studios_status', 'Are Pixel Studio and Chiptune Studio (the apps that make pixel art and music) reachable, and how to start them if not.', z.object({}), async () => ({ studios: await svc.studiosStatus() })),
    def('vno_comfy_status', 'Is ComfyUI reachable: its lanes, the image and audio engines, custom workflows and background removal.', z.object({}), async () => {
      const { type: _type, ...status } = await svc.comfyStatus()
      return status
    }),
    def('vno_comfy_free', 'Free the VRAM of the ComfyUI lanes (unload models).', z.object({}), async () => ({ results: await svc.comfyFree() })),
    def(
      'vno_languages',
      "The languages a project or edition can use: code, English name, native name, the Ren'Py language name, right-to-left, script, whether VibeTTS Supertonic reads it and whether the game menus are translated. Add more in config/languages.md.",
      z.object({}),
      async () => ({ languages: languages().map((l) => ({ code: l.code, name: l.name, native: l.native, renpy: l.renpy, rtl: !!l.rtl, script: l.script, supertonic: !!l.supertonic, uiStrings: !!l.ui })) })
    ),
    def('vno_themes', 'The game themes a project can use (name, label, description, light, pixel).', z.object({}), async () => ({ themes: svc.listThemes().map((t) => ({ name: t.name, label: t.label, description: t.description, light: t.light, pixel: t.pixel })) })),

    // ---- build ----
    def('vno_android_preflight', 'Check that the Android build can run (SDK, Java, signing). Returns ok and what is missing.', z.object({ slug }), async (a) => ({ result: await svc.androidPreflight(a.slug) })),
    def(
      'vno_android_build',
      'Build the Android package of a built game (waits by default). bundle: an app bundle (aab) instead of an apk.',
      z.object({ slug, bundle: z.boolean().optional(), wait }),
      async (a) => {
        const job = await svc.enqueueAndroid(a.slug, !!a.bundle)
        return { job, ...(await settle(a.slug, a.wait ?? true)) }
      }
    ),
    def('vno_renpy_config_get', "The Ren'Py settings: SDK folder, resolution, image format, and whether the SDK was found.", z.object({}), async () => ({ config: await svc.renpyConfigView() })),
    def(
      'vno_renpy_config_set',
      "Change the Ren'Py settings (config/renpy.md); fields left out keep their value.",
      z.object({ sdkPath: z.string().optional(), resolution: z.string().optional().describe('WIDTHxHEIGHT, for example 1280x720'), imageFormat: z.enum(['webp', 'png']).optional() }),
      async (a) => ({ config: await svc.saveRenpyConfig(a) })
    ),

    // ---- queue ----
    def(
      'vno_wait',
      'Wait until a project has nothing left to run (or the timeout passes), then say how it ended. Other calls keep working while this one waits.',
      z.object({ slug, timeoutSeconds: z.number().positive().optional().describe('Default: 600') }),
      async (a) => {
        const r = await svc.waitIdle(a.slug, { timeoutMs: (a.timeoutSeconds ?? 600) * 1000 })
        return { timedOut: r.timedOut, failedJobs: r.failed, ...clientHint(r.clientTasks), status: await svc.status(a.slug) }
      }
    ),
    // ---- story: make and edit a visual novel without a book folder ----
    ...storyTools(svc, def),

    // ---- plans, music, cues, library ----
    ...planTools(svc, def, opts),

    // ---- files you made: an image or track for an asset, voice clips ----
    ...importTools(svc, def, opts),

    // ---- fonts for the languages the theme font lacks ----
    ...langTools(svc, def, opts),

    // ---- model work done by the MCP client (client/... models) ----
    ...clientTools(svc, def, opts),

    def('vno_pause_all', 'Pause the whole queue: running jobs finish, no new job starts (it stays paused after a restart).', z.object({}), async () => {
      await control().setPaused(true)
      return { paused: true }
    }),
    def('vno_resume_all', 'Resume the queue.', z.object({}), async () => {
      await control().setPaused(false)
      return { paused: false }
    }),
    def(
      'vno_stop_now',
      'Pause the queue and stop every running job at once (they go back to the queue, and run again after vno_resume_all, oldest first). drop: true also deletes the queued jobs (of the project slug, or of every project) and marks their pipeline steps skipped, so a resume has nothing old to start and a new vno_plan or vno_run_pipeline is all that runs.',
      z.object({ drop: z.boolean().optional().describe('Also drop the queued jobs'), slug: z.string().optional().describe('With drop: only the jobs of this project') }),
      async (a) => {
        await control().stopNow({ drop: a.drop, slug: a.slug })
        return { paused: true, stopped: true, ...(a.drop ? { dropped: true } : {}) }
      }
    ),
    def(
      'vno_clear_queue',
      'Delete the queued jobs of a project (or of every project) and mark their pipeline steps skipped, without stopping the jobs that are running now. Pass confirm: true.',
      z.object({ slug: z.string().optional().describe('Only this project'), confirm: z.literal(true).describe('Must be true') }),
      async (a) => ({ ...(await control().clearQueue(a.slug)) })
    )
  ]
}

/** Runs one tool: the arguments are checked against its schema; a failure is an error result, never a throw. */
export async function callTool(tools: readonly Tool[], name: string, args: unknown): Promise<ToolResult> {
  const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] })
  const tool = tools.find((t) => t.name === name)
  if (!tool) return fail(`unknown tool "${name}"`)
  const parsed = tool.schema.safeParse(args ?? {})
  if (!parsed.success) return fail(`invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  try {
    const out = await tool.run(parsed.data as never)
    const result = out instanceof ToolOutput ? out.data : out
    const extra = out instanceof ToolOutput ? out.extra : []
    const structured = (result !== null && typeof result === 'object' && !Array.isArray(result) ? result : { result }) as Record<string, unknown>
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...extra], structuredContent: JSON.parse(JSON.stringify(structured)) as Record<string, unknown> }
  } catch (e) {
    return fail((e as Error).message)
  }
}

/** The tools as `tools/list` shows them. */
export function toolList(tools: readonly Tool[]): { name: string; description: string; inputSchema: { type: 'object'; [k: string]: unknown } }[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.schema) as { type: 'object'; [k: string]: unknown } }))
}
