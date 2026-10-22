import type { Chip } from '../../shared/vn'
import { McpHttpError, createMcpClient } from './mcp-http'
import type { McpHttpClient, McpToolInfo } from './mcp-http'

/** A Chiptune Studio / Pixel Studio call that failed. `kind` is the `McpHttpError` kind, or `contract` when the answer lacked what `contracts.md` promises. */
export class StudioError extends Error {
  constructor(
    message: string,
    readonly kind: McpHttpError['kind'] | 'contract'
  ) {
    super(message)
    this.name = 'StudioError'
  }
}

/** Runs `fn`, turning an `McpHttpError` into a `StudioError`. */
export async function asStudioError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof McpHttpError) throw new StudioError(e.message, e.kind)
    throw e
  }
}

export interface ComposeArgs {
  mood: string
  chip?: Chip
  bpm?: number
  key?: string
  scale?: string
  bars?: number
  seconds?: number
  loop?: boolean
  seed?: number
  instruments?: Record<string, string>
  name?: string
}

export interface ComposeResult {
  songId: string
  name: string
  chip: string
  bpm: number
  key: string
  scale?: string
  mood: string
  bars: number
  seed: number
  durationSec: number
  loop: { startBar: number; endBar: number } | null
  channels: string[]
}

export interface RenderArgs {
  song?: string
  /** Absolute path. */
  path: string
  format?: 'ogg' | 'wav' | 'mp3'
  loops?: number
  fadeOutSec?: number
  sampleRate?: 44100 | 48000
}

export interface RenderResult {
  /** The file actually written (a `.wav` next to the requested path when the studio has no ffmpeg). */
  path: string
  format: string
  sampleRate: number
  durationSec: number
  loopStartSec: number | null
  loopEndSec: number | null
  loopStartSample?: number | null
  loopEndSample?: number | null
  warning?: string
}

export interface SongInfo {
  songId: string
  name: string
  path: string | null
  chip: string
  bpm: number
  current: boolean
}

/** What VN Studio needs from Chiptune Studio (the contract in `contracts.md`). Tests pass a fake. */
export interface ChiptuneClient {
  readonly url: string
  composeTrack(args: ComposeArgs, signal?: AbortSignal): Promise<ComposeResult>
  renderAudio(args: RenderArgs, signal?: AbortSignal): Promise<RenderResult>
  saveSong(args: { song?: string; path: string }, signal?: AbortSignal): Promise<{ songId: string; path: string }>
  listSongs(signal?: AbortSignal): Promise<SongInfo[]>
  openSong(args: { path: string; exportTo?: string; exportFormat?: 'ogg' | 'wav' }, signal?: AbortSignal): Promise<{ songId: string; name: string; path: string }>
  deleteSong(song: string, signal?: AbortSignal): Promise<{ deleted: boolean }>
  /** The tools the server offers (also the "is it up" check). */
  listTools(signal?: AbortSignal): Promise<McpToolInfo[]>
}

export interface ChiptuneClientOptions {
  url: string
  notRunningHint: string
  timeoutMs?: number
  /** Timeout of `compose_track` and `render_audio`. Default 300 s. */
  renderTimeoutMs?: number
  fetchImpl?: typeof fetch
  /** An existing MCP client (tests, sharing). */
  mcp?: McpHttpClient
  /** The bearer token of Chiptune Studio's MCP server (`CHIPTUNE_STUDIO_MCP_TOKEN`). */
  token?: string | null
}

function need<T>(json: Record<string, unknown> | null, tool: string, key: string): T {
  if (!json || json[key] === undefined) throw new StudioError(`Chiptune Studio: ${tool} did not return "${key}" (is the studio older than the VN Studio contract?)`, 'contract')
  return json as T
}

export function createChiptuneClient(opts: ChiptuneClientOptions): ChiptuneClient {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const renderMs = opts.renderTimeoutMs ?? 300_000
  const mcp = opts.mcp ?? createMcpClient({ url: opts.url, label: 'Chiptune Studio', notRunningHint: opts.notRunningHint, timeoutMs, fetchImpl: opts.fetchImpl, token: opts.token, tokenVar: 'CHIPTUNE_STUDIO_MCP_TOKEN' })
  const call = (tool: string, args: object, ms: number, signal?: AbortSignal) => asStudioError(() => mcp.callTool(tool, args, { timeoutMs: ms, signal }))
  return {
    url: mcp.url,
    composeTrack: async (args, signal) => need<ComposeResult>((await call('compose_track', { loop: true, ...args }, renderMs, signal)).json, 'compose_track', 'songId'),
    renderAudio: async (args, signal) => need<RenderResult>((await call('render_audio', { format: 'ogg', ...args }, renderMs, signal)).json, 'render_audio', 'path'),
    saveSong: async (args, signal) => need<{ songId: string; path: string }>((await call('save_song', args, timeoutMs, signal)).json, 'save_song', 'path'),
    listSongs: async (signal) => ((await call('list_songs', {}, timeoutMs, signal)).json?.songs as SongInfo[] | undefined) ?? [],
    openSong: async (args, signal) => need<{ songId: string; name: string; path: string }>((await call('open_song', args, timeoutMs, signal)).json, 'open_song', 'songId'),
    deleteSong: async (song, signal) => need<{ deleted: boolean }>((await call('delete_song', { song }, timeoutMs, signal)).json, 'delete_song', 'deleted'),
    listTools: (signal) => asStudioError(() => mcp.listTools({ timeoutMs, signal }))
  }
}
