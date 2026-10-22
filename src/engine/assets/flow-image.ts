import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FLOW_ENGINE, IMAGE_KINDS } from '../../shared/vn'
import type { AssetEntry, AssetVersion, ProjectSettings } from '../../shared/vn'
import type { FlowClient } from '../studios/flow'
import { FlowError } from '../studios/flow'

/** Google Flow as the image provider: the pure parts (aspect, quality, prompt, references) and the run of one image. */

export type FlowQualityKind = 'background' | 'cover' | 'cg' | 'sheet' | 'sprite' | 'insert'

/** The settings of the Flow calls (from `config/studios.md`). */
export interface FlowOptions {
  quality: Record<FlowQualityKind, 'original' | 'upscaled'>
  jobTimeoutMs: number
  musicTimeoutMs: number
  /** The most Flow Music songs one project may make. */
  maxSongs: number
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = {
  quality: { background: 'upscaled', cover: 'upscaled', cg: 'upscaled', sheet: 'original', sprite: 'original', insert: 'original' },
  jobTimeoutMs: 900_000,
  musicTimeoutMs: 600_000,
  maxSongs: 4
}

/** Does this run of the asset go to Flow? `engine` is the engine given for this run: any other engine means ComfyUI (or the studio) for this one. */
export function runsOnFlow(entry: Pick<AssetEntry, 'kind' | 'locked' | 'source' | 'engine'>, settings: Pick<ProjectSettings, 'art' | 'music'>, engine?: string): boolean {
  if (engine !== undefined) return engine === FLOW_ENGINE
  if (entry.locked || entry.source !== 'generated') return entry.engine === FLOW_ENGINE && IMAGE_KINDS.has(entry.kind)
  return IMAGE_KINDS.has(entry.kind) && settings.art.provider === 'flow'
}

/** Flow's aspect ratios: wide for backgrounds, full CGs and the cover; tall for sheets and sprites; square for inserts. */
export function flowAspect(kind: AssetEntry['kind'], display?: 'full' | 'insert'): '16:9' | '9:16' | '1:1' {
  if (kind === 'sheet' || kind === 'sprite') return '9:16'
  if (kind === 'cg' && display === 'insert') return '1:1'
  return '16:9'
}

export function flowQualityKind(kind: AssetEntry['kind'], display?: 'full' | 'insert'): FlowQualityKind {
  if (kind === 'cg') return display === 'insert' ? 'insert' : 'cg'
  return kind as FlowQualityKind
}

/**
 * The prompt of a sprite for Flow: a new image of the same character from the sheet as a reference (not an edit). The planned prompt
 * (or the deterministic one) says who and the expression; this adds a full-body pose on a plain flat background, so the cutout works.
 */
export function flowSpritePrompt(base: string): string {
  const flat = /flat (?:light )?(?:grey|gray|colou?r|background)|plain (?:flat )?(?:light )?(?:grey|gray|background)/i.test(base)
  const tail = ['Full body, standing, facing the viewer, centred.', flat ? '' : 'Plain flat light grey background, nothing else in the picture.'].filter(Boolean).join(' ')
  const lead = /reference image/i.test(base) ? '' : 'The same character as in the reference image. '
  return `${lead}${base.trim().replace(/\.?$/, '.')} ${tail}`
}

export interface FlowRefs {
  /** `asset:<media id>` for a sheet Flow made, else the sheet's file (an upload). */
  refs: string[]
  warnings: string[]
  /** The same references as files, for the retry when a media id is stale. */
  files: string[]
}

/** The references of a sprite (its sheet) or a CG (the sheets of its characters, at most 3). */
export function flowReferences(entry: AssetEntry, o: { entryOf?: (id: string) => AssetEntry | null; fileOf?: (id: string) => string | null }): FlowRefs {
  const warnings: string[] = []
  const ids = entry.refs ?? []
  if (ids.length > 3) warnings.push(`${entry.id}: Flow takes 3 references; ${ids.slice(3).join(', ')} left out`)
  const refs: string[] = []
  const files: string[] = []
  for (const id of ids.slice(0, 3)) {
    const file = o.fileOf?.(id) ?? null
    const ref = o.entryOf?.(id) ?? null
    const version = ref?.versions.find((v) => v.n === ref.selected)
    const media = version?.remote?.provider === 'flow' ? version.remote.id : ''
    if (!file && !media) continue
    if (file) files.push(file)
    refs.push(media ? `asset:${media}` : file!)
  }
  if (ids.length > 0 && refs.length === 0) throw new Error(`the character sheets of ${entry.id} (${ids.join(', ')}) have no file yet: generate them first`)
  return { refs, warnings, files }
}

export interface FlowImageRun {
  bytes: Buffer
  ext: string
  remote: NonNullable<AssetVersion['remote']>
  warnings: string[]
}

/**
 * Makes one image with Flow: `flow_generate` for this asset alone (exact prompt, `max_credits: 0`), the file read from a temporary folder of
 * the project, which is removed. A stale media id (the sheet was edited or trashed in Flow) falls back to the sheet's file once.
 */
export async function makeFlowImage(
  flow: FlowClient,
  o: {
    entry: AssetEntry
    prompt: string
    display?: 'full' | 'insert'
    project: string
    projectDir: string
    model?: string
    options: FlowOptions
    refs?: FlowRefs
    signal?: AbortSignal
    progress?: (message: string) => void
  }
): Promise<FlowImageRun> {
  const { entry } = o
  const dir = path.join(o.projectDir, '.vno-tmp', 'flow', entry.id)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const warnings = [...(o.refs?.warnings ?? [])]
  const prompt = entry.kind === 'sprite' ? flowSpritePrompt(o.prompt) : o.prompt
  const args = {
    prompt,
    aspect: flowAspect(entry.kind, o.display),
    ...(o.model ? { model: o.model } : {}),
    quality: o.options.quality[flowQualityKind(entry.kind, o.display)],
    project: o.project,
    out: dir,
    name: entry.id,
    timeoutMs: o.options.jobTimeoutMs,
    signal: o.signal
  }
  try {
    o.progress?.(`Google Flow: ${args.aspect}, ${args.quality}${o.refs?.refs.length ? `, ${o.refs.refs.length} reference(s)` : ''}`)
    let made
    try {
      made = await flow.generateImage({ ...args, references: o.refs?.refs })
    } catch (e) {
      const stale = e instanceof FlowError && e.kind === 'tool' && o.refs?.refs.some((r) => r.startsWith('asset:')) && o.refs.files.length === o.refs.refs.length
      if (!stale || o.signal?.aborted) throw e
      warnings.push(`a reference media id was not found in Flow (${(e as Error).message.slice(0, 120)}); the sheet files were sent instead`)
      made = await flow.generateImage({ ...args, references: o.refs!.files })
    }
    const bytes = await fs.readFile(made.file)
    const ext = path.extname(made.file).slice(1).toLowerCase() || 'jpeg'
    return { bytes, ext, remote: { provider: 'flow', id: made.mediaId, ...(made.project ? { project: made.project } : {}) }, warnings }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
