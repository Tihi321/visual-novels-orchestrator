import { z } from 'zod'
import type { MusicPlan } from '../vn/agents/composer'
import { TASKS } from '../vn/pipeline'
import type { StageCues } from '../renpy/stage'
import type { VnService } from '../vn/service'
import type { McpOptions, Tool, ToolDef } from './tools'

const slug = z.string().describe('The project slug (see vno_list_projects)')
const wait = z.boolean().optional().describe('Wait until the jobs finish before answering')

/** Asset prompts without generating, music.json, cues.json and the library path. */
export function planTools(svc: VnService, def: ToolDef, opts: McpOptions): Tool[] {
  const need = async (s: string): Promise<void> => {
    if (!(await svc.store.exists(s))) throw new Error(`no project "${s}"`)
  }
  const settle = async (s: string, doWait: boolean | undefined) => {
    if (!doWait) return { waited: false }
    const r = await svc.waitIdle(s, { timeoutMs: opts.waitTimeoutMs ?? 10 * 60_000 })
    return { waited: true, timedOut: r.timedOut, failedJobs: r.failed }
  }
  const musicTracks = async (s: string): Promise<string[]> => (await svc.listAssets(s)).filter((a) => a.kind === 'music' && !a.orphaned).map((a) => a.id).sort()

  return [
    def(
      'vno_asset_set',
      'Write the prompt (and optionally the negative prompt, size, engine or seed) of one asset yourself, without generating anything. The art-director and the composer then keep your prompt, even when the plan runs again with refreshPrompts. Use vno_asset_list for the ids, vno_asset_generate or vno_asset_regen to make the image or track. An empty prompt clears it (and the planner may write one again). A locked asset is refused: unlock it first.',
      z.object({
        slug,
        id: z.string().describe('The asset id, for example bg_harbour_dusk, sheet_mara, sprite_mara_happy, cover or music_01'),
        prompt: z.string().optional().describe('The generation prompt; empty clears it'),
        negative: z.string().optional().describe('The negative prompt; empty clears it'),
        size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).nullable().optional().describe('Image size in pixels, or null for the default'),
        engine: z.string().optional().describe('The engine id (see vno_comfy_status), for example the image or music engine to use'),
        seed: z.number().int().nullable().optional().describe('A fixed seed, or null for a random one')
      }),
      async (a) => {
        const entry = await svc.setAssetPlan(a.slug, a.id, { prompt: a.prompt, negative: a.negative, size: a.size, engine: a.engine, seed: a.seed })
        return { asset: svc.assetView(a.slug, entry) }
      }
    ),
    def(
      'vno_plan',
      'Plan the art prompts and the music plan of a project, and nothing else (no image or track is generated, no build runs). The art-director writes a prompt for every image asset that has none, the composer plans the tracks, the menu music and the chapter music. Prompts you set with vno_asset_set and a music plan you set with vno_set_music are kept. refreshPrompts: also write the prompts again for assets that have a prompt but no file. Pass wait to wait; the result then lists the assets with their prompts.',
      z.object({ slug, refreshPrompts: z.boolean().optional().describe('Plan the prompts again, even for assets that already have one (not those set by hand, locked or custom)'), wait }),
      async (a) => {
        await need(a.slug)
        const run = await svc.nextRun(a.slug)
        const art = await svc.enqueue(a.slug, TASKS.artPlan, 'all', run, { body: { force: !!a.refreshPrompts }, label: 'plan the art prompts' })
        const music = await svc.enqueue(a.slug, TASKS.musicPlan, 'all', run, { depends_on: [art], body: { force: !!a.refreshPrompts }, label: 'plan the music' })
        const w = await settle(a.slug, a.wait)
        if (!w.waited) return { jobs: [art, music], ...w }
        const assets = (await svc.listAssets(a.slug)).filter((x) => !x.orphaned && x.kind !== 'voiceRef').map((x) => ({ id: x.id, kind: x.kind, prompt: x.prompt, byHand: !!x.promptByHand, engine: x.engine, size: x.size, locked: x.locked }))
        return { jobs: [art, music], ...w, assets }
      }
    ),
    def(
      'vno_set_music',
      'Set which music plays: the menu track, the track of each chapter and the length of each track. Tracks are the project music assets (music_01, music_02 ... see vno_asset_list kind music). Call it with only slug to read the plan. Your entries are kept when the music plan runs again (it only fills what is missing). Build to hear it. Needs music tracks (music.tracks in vno_update_settings).',
      z.object({
        slug,
        menu: z.string().nullable().optional().describe('Track id for the main menu, or null for none'),
        chapters: z.record(z.string(), z.string().nullable()).optional().describe('Chapter number -> track id, for example {"1":"music_02"}; null drops the entry (the default rotation applies)'),
        seconds: z.record(z.string(), z.number()).optional().describe('Track id -> length in seconds (60 to 180)'),
        replace: z.boolean().optional().describe('Start from an empty plan instead of changing the current one')
      }),
      async (a) => {
        await need(a.slug)
        const tracks = await musicTracks(a.slug)
        const patch = { menu: a.menu, chapters: a.chapters, seconds: a.seconds, replace: a.replace }
        const changed = a.menu !== undefined || a.chapters !== undefined || a.seconds !== undefined || a.replace
        const plan: MusicPlan | null = changed ? await svc.setMusicPlan(a.slug, patch) : await svc.store.readJson<MusicPlan>(a.slug, 'music.json')
        return { plan, tracks }
      }
    ),
    def(
      'vno_set_cues',
      'Set the stage cues of a project: the menu music, the music of each chapter, how each scene is shown (transition, pause) and where each character stands in a cast beat. Call it with only slug to read the cues (null until the stage step or this tool made them). Scene ids look like ch01.s02, cast beat ids like ch01.s02.b001 (vno_get_story). Your cues are kept by the stage step, which then does not ask the stage-director and only adds defaults for chapters, scenes and casts you left out. Build to see it.',
      z.object({
        slug,
        menuMusic: z.string().nullable().optional().describe('Music track id for the main menu, or null for none'),
        chapters: z.record(z.string(), z.string().nullable()).optional().describe('Chapter number -> music track id (null: no music for that chapter)'),
        scenes: z.record(z.string(), z.object({ transition: z.enum(['dissolve', 'fade', 'none']).optional(), pause: z.number().min(0).optional().describe('Seconds to wait after the scene is shown') })).optional().describe('Scene id -> how it is shown'),
        casts: z.record(z.string(), z.record(z.string(), z.enum(['left', 'center', 'right']))).optional().describe('Cast beat id -> character key -> slot. Characters left out are not shown. At most three, one per slot'),
        replace: z.boolean().optional().describe('Drop the cues so far and start from the defaults')
      }),
      async (a) => {
        await need(a.slug)
        const patch = {
          menuMusic: a.menuMusic,
          chapters: a.chapters,
          scenes: a.scenes,
          casts: a.casts,
          replace: a.replace
        }
        const changed = a.menuMusic !== undefined || a.chapters !== undefined || a.scenes !== undefined || a.casts !== undefined || a.replace
        if (changed) return { cues: await svc.setCues(a.slug, patch) }
        const cues = await svc.store.readJson<StageCues>(a.slug, 'cues.json')
        return cues ? { cues } : { cues: null, note: 'no cues yet: the stage step (or vno_set_cues with some entries) makes them' }
      }
    ),
    def(
      'vno_set_library',
      'Set the folder of the Scriptorium library (the one with a books folder inside) that vno_list_books and vno_import read, and save it in config/settings.md. Returns the folder and the books found there. Needs a running VN Studio engine.',
      z.object({ path: z.string().describe('The Scriptorium data folder; it must exist (~ is the home folder)') }),
      async (a) => {
        if (!opts.setScriptoriumData) throw new Error('setting the library folder is not available here')
        const scriptoriumData = await opts.setScriptoriumData(a.path)
        const books = await svc.listSourceBooks()
        return { scriptoriumData, books, ...(books.length ? {} : { warning: `no books found in ${scriptoriumData}: a Scriptorium library has a books folder with a folder per book (each with a book.md)` }) }
      }
    )
  ]
}
