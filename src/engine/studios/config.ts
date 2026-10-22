import path from 'node:path'
import { z } from 'zod'
import { readMd } from '../store/atomic'
import type { StoredKeyGetter } from '../models/keys'
import { createChiptuneClient } from './chiptune'
import type { ChiptuneClient } from './chiptune'
import { resolveToken } from './mcp-http'
import { createPixelClient } from './pixel'
import type { PixelClient } from './pixel'

export type StudioId = 'pixel' | 'chiptune'

export const DEFAULT_PIXEL_STUDIO_URL = 'http://127.0.0.1:7457/mcp'
export const DEFAULT_CHIPTUNE_STUDIO_URL = 'http://127.0.0.1:7458/mcp'

/** `config/studios.md`: where Pixel Studio and Chiptune Studio are, and where their code is (for the start hints and "Open in"). */
export const studiosConfigSchema = z.object({
  pixelStudioUrl: z.string().default(DEFAULT_PIXEL_STUDIO_URL),
  chiptuneStudioUrl: z.string().default(DEFAULT_CHIPTUNE_STUDIO_URL),
  pixelStudioRepo: z.string().default('C:\\projects\\Personal\\pixel-art-generator'),
  chiptuneStudioRepo: z.string().default('C:\\projects\\Personal\\midi-generator'),
  /** A packaged app to launch instead of `yarn electron .` from the repo. Empty: use the repo. */
  pixelStudioExe: z.string().default(''),
  chiptuneStudioExe: z.string().default(''),
  /** Bearer tokens of the apps' MCP servers. `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN` (environment or credential store) win over these. */
  pixelStudioToken: z.string().default(''),
  chiptuneStudioToken: z.string().default(''),
  /** Timeouts in seconds: short calls, an image import and export, a track render. */
  timeoutS: z.number().positive().default(15),
  importTimeoutS: z.number().positive().default(120),
  renderTimeoutS: z.number().positive().default(300),
  /** The pixel-studio-draw agent: at most this many model steps and seconds per sprite (0 seconds: no time limit). */
  drawSteps: z.number().int().min(1).max(60).default(12),
  drawTimeoutS: z.number().min(0).default(240),
  /**
   * How the sprite is drawn. `loop`: the model calls Pixel Studio's drawing tools turn by turn. `grid`: one request for the whole sprite as rows of
   * text, painted from here (made for a model that takes minutes per answer). `auto` (default): `grid` when the job's model is a client model, else `loop`.
   */
  drawMode: z.enum(['auto', 'loop', 'grid']).default('auto')
})
export type StudiosConfig = z.infer<typeof studiosConfigSchema>

/** `config/studios.md`; a missing or broken file gives the defaults. `VNO_PIXEL_STUDIO_URL` and `VNO_CHIPTUNE_STUDIO_URL` override the URLs. */
export async function loadStudiosConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<StudiosConfig> {
  let data: Record<string, unknown> = {}
  try {
    data = (await readMd(path.join(dataDir, 'config', 'studios.md'))).data
  } catch {
    /* defaults */
  }
  const parsed = studiosConfigSchema.safeParse(data)
  const c = parsed.success ? parsed.data : studiosConfigSchema.parse({})
  return {
    ...c,
    ...(env.VNO_PIXEL_STUDIO_URL ? { pixelStudioUrl: env.VNO_PIXEL_STUDIO_URL } : {}),
    ...(env.VNO_CHIPTUNE_STUDIO_URL ? { chiptuneStudioUrl: env.VNO_CHIPTUNE_STUDIO_URL } : {})
  }
}

/**
 * How a sprite is drawn and how long the model may take. `drawMode: auto` draws from a grid (one request) when the job's model is a client model
 * and with the loop otherwise. A client model can take minutes per answer, so the loop has no time limit then (`drawSteps` still bounds it),
 * and `drawTimeoutS: 0` means no limit either. `ms` is Infinity for no limit.
 */
export function resolveDrawMode(c: Pick<StudiosConfig, 'drawMode' | 'drawTimeoutS'>, clientModel: boolean): { mode: 'loop' | 'grid'; ms: number } {
  const mode = c.drawMode === 'auto' ? (clientModel ? 'grid' : 'loop') : c.drawMode
  return { mode, ms: c.drawTimeoutS === 0 || (mode === 'loop' && clientModel) ? Infinity : c.drawTimeoutS * 1000 }
}

export const STUDIO_NAMES: Record<StudioId, string> = { pixel: 'Pixel Studio', chiptune: 'Chiptune Studio' }

export const studioUrl = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioUrl : c.chiptuneStudioUrl)
export const studioRepo = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioRepo : c.chiptuneStudioRepo)
export const studioExe = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioExe : c.chiptuneStudioExe)

/** How to start the studio headless (the text of the "not running" error). */
export function startHint(c: StudiosConfig, id: StudioId): string {
  const exe = studioExe(c, id)
  const how = exe ? `${exe} --mcp-only` : `cd ${studioRepo(c, id)} && yarn build && yarn mcp`
  return `${STUDIO_NAMES[id]} is not running at ${studioUrl(c, id)}. Start it headless: ${how}`
}

/** The bearer token of a studio: its environment variable, the credential store, then the field in config/studios.md. Null when none is set. */
export function studioToken(c: StudiosConfig, id: StudioId, env: NodeJS.ProcessEnv = process.env, getKey?: StoredKeyGetter): string | null {
  return id === 'pixel' ? resolveToken('PIXEL_STUDIO_MCP_TOKEN', c.pixelStudioToken, env, getKey) : resolveToken('CHIPTUNE_STUDIO_MCP_TOKEN', c.chiptuneStudioToken, env, getKey)
}

export function pixelClientFor(c: StudiosConfig): PixelClient {
  return createPixelClient({ url: c.pixelStudioUrl, token: studioToken(c, 'pixel'), notRunningHint: startHint(c, 'pixel'), timeoutMs: c.timeoutS * 1000, importTimeoutMs: c.importTimeoutS * 1000 })
}

export function chiptuneClientFor(c: StudiosConfig): ChiptuneClient {
  return createChiptuneClient({ url: c.chiptuneStudioUrl, token: studioToken(c, 'chiptune'), notRunningHint: startHint(c, 'chiptune'), timeoutMs: c.timeoutS * 1000, renderTimeoutMs: c.renderTimeoutS * 1000 })
}
