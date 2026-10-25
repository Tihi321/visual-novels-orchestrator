import { z } from 'zod'
import { langSchema } from '../../shared/vn'
import { clientHint } from './tools'
import type { McpOptions, Tool, ToolDef } from './tools'
import type { VnService } from '../vn/service'

const slug = z.string().describe('The project slug (see vno_list_projects)')
const wait = z.boolean().optional().describe('Wait until the jobs finish before answering')

/** Importing files you made: an image or a track for an asset, and voice clips. */
export function importTools(svc: VnService, def: ToolDef, opts: McpOptions): Tool[] {
  const settle = async (s: string, doWait: boolean | undefined) => {
    if (!doWait) return { waited: false }
    const r = await svc.waitIdle(s, { timeoutMs: opts.waitTimeoutMs ?? 10 * 60_000 })
    return { waited: true, timedOut: r.timedOut, failedJobs: r.failed, ...clientHint(r.clientTasks) }
  }
  return [
    def(
      'vno_asset_import',
      'Use a file you made (or found) for an asset, with the post-processing a generated image gets. A sprite on a plain background is cut out, trimmed and scaled to the sprite height (an image that is transparent already is left alone; in hand-made art mode the flat-colour key is used and ComfyUI is never called unless removeBackground is birefnet); a background or the cover is fitted to the screen (a portrait cover is kept whole: the menu shows it centred); a pixel project gets pixel art; a sheet and music are kept as they are. The result is a new locked version (custom:import) and the original file stays next to it. process: none keeps the file exactly as it is (like vno_asset_replace). Audio kinds (music) take ogg, mp3, wav, opus or flac. Rebuilds the game unless rebuild is false.',
      z.object({
        slug,
        id: z.string().describe('The asset id, for example sprite_mara_happy, bg_harbour_dusk, cover or music_01'),
        file: z.string().describe('Absolute path of the image or audio file'),
        process: z.enum(['auto', 'none']).optional().describe('auto (default): post-process by kind. none: keep the file as it is'),
        removeBackground: z.enum(['auto', 'birefnet', 'key', 'none']).optional().describe('Sprites. auto (default): skip an image that is transparent already, else the flat-colour key in hand-made art mode, else the project setting. birefnet calls ComfyUI.'),
        trim: z.boolean().optional().describe('Sprites: trim to the figure and scale to the sprite height (default true)'),
        pixelate: z.boolean().optional().describe('Pixel projects: make pixel art of the image (default true)'),
        rebuild: z.boolean().optional(),
        wait
      }),
      async (a) => {
        const r = await svc.importAsset(a.slug, a.id, a.file, { process: a.process, removeBackground: a.removeBackground, trim: a.trim, pixelate: a.pixelate, rebuild: a.rebuild })
        return { asset: svc.assetView(a.slug, r.entry), version: r.version, ...(a.rebuild === false ? {} : await settle(a.slug, a.wait)) }
      }
    ),
    def(
      'vno_voice_import',
      'Use voice clips you made or recorded, for one language: one file for a beat (beatId and file), or a folder whose files are named <beatId>.<ext> (mp3, wav, ogg, opus, flac, m4a; the beat ids are those of vno_get_edition). The clips are copied into the project and recorded as imported: voice generation (the local ComfyUI TTS engines or Google Flow) keeps them and says how many it kept, and changing a speaker\'s voice does not drop them. File names that match no text beat are listed in unknown. Rebuilds the game unless rebuild is false.',
      z.object({
        slug,
        lang: langSchema.describe('The language of the clips (an edition of the project)'),
        beatId: z.string().optional().describe('With file: the beat the clip is for'),
        file: z.string().optional().describe('Absolute path of one clip'),
        folder: z.string().optional().describe('Absolute path of a folder of <beatId>.<ext> clips'),
        rebuild: z.boolean().optional(),
        wait
      }),
      async (a) => {
        if (!!a.folder === !!(a.file || a.beatId)) throw new Error('give a folder, or a file with its beatId')
        if (!a.folder && !(a.file && a.beatId)) throw new Error('a single clip needs both file and beatId')
        const r = await svc.importVoice(a.slug, a.lang, a.folder ? { folder: a.folder } : { beatId: a.beatId!, file: a.file! }, { rebuild: a.rebuild })
        return { ...r, ...(a.rebuild === false || !r.imported.length ? {} : await settle(a.slug, a.wait)) }
      }
    )
  ]
}
