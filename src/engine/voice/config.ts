import path from 'node:path'
import { z } from 'zod'
import { readMd } from '../store/atomic'
import { resolveToken } from '../studios/mcp-http'
import { DEFAULT_VIBETTS_URL, createVibeTtsClient } from './vibetts'
import type { VibeTtsClient } from './vibetts'

/** `config/voice.md`: where VibeTTS is and how the clips are made. */
export const voiceConfigSchema = z.object({
  vibettsUrl: z.string().default(DEFAULT_VIBETTS_URL),
  speed: z.number().min(0.5).max(2).default(1),
  format: z.enum(['mp3', 'wav']).default('mp3'),
  chunkSize: z.number().int().min(1).max(200).default(20),
  timeoutS: z.number().positive().default(15),
  voiceTimeoutS: z.number().positive().default(180),
  batchTimeoutS: z.number().positive().default(900),
  /** The bearer token of VibeTTS's MCP server. `VIBETTS_MCP_TOKEN` (environment or credential store) wins over this. */
  vibettsToken: z.string().default('')
})
export type VoiceConfig = z.infer<typeof voiceConfigSchema>

/** `config/voice.md`; a missing or broken file gives the defaults. `VNO_VIBETTS_URL` overrides the URL. */
export async function loadVoiceConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<VoiceConfig> {
  let data: Record<string, unknown> = {}
  try {
    data = (await readMd(path.join(dataDir, 'config', 'voice.md'))).data
  } catch {
    /* defaults */
  }
  const parsed = voiceConfigSchema.safeParse(data)
  const c = parsed.success ? parsed.data : voiceConfigSchema.parse({})
  return env.VNO_VIBETTS_URL ? { ...c, vibettsUrl: env.VNO_VIBETTS_URL } : c
}

/** The client for a config. */
export function clientFor(c: VoiceConfig): VibeTtsClient {
  return createVibeTtsClient({ url: c.vibettsUrl, token: resolveToken('VIBETTS_MCP_TOKEN', c.vibettsToken), timeoutMs: c.timeoutS * 1000, voiceTimeoutMs: c.voiceTimeoutS * 1000, batchTimeoutMs: c.batchTimeoutS * 1000 })
}
