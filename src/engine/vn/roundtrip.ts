import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { AssetEntry, AssetVersion } from '../../shared/vn'
import { resolvePixel } from '../../shared/vn'
import { addVersion, assetDir, lock, nextVersionN, resolveFile } from '../assets/manifest'
import { chiptuneClientFor, loadStudiosConfig, pixelClientFor, STUDIO_NAMES, startHint } from '../studios/config'
import type { StudioId } from '../studios/config'
import { launchPlan, launchStudio, watchFile } from '../studios/launch'
import type { OpenArgs } from '../studios/launch'
import type { VnService } from './service'

/** The studio that edits a kind of asset: Pixel Studio for the images, Chiptune Studio for the music. */
export function studioFor(kind: AssetEntry['kind']): StudioId {
  if (kind === 'music') return 'chiptune'
  if (kind === 'voiceRef') throw new Error('voice references have no studio: upload a clip instead')
  return 'pixel'
}

export interface OpenOptions {
  /** `launch`: start the window with the command line. `mcp`: ask a running studio to open it. `auto` (default): launch, and try MCP if that fails. */
  via?: 'auto' | 'launch' | 'mcp'
  /** Called after each save of the studio, with the new (custom, locked, selected) version. */
  onVersion?: (entry: AssetEntry, version: AssetVersion) => void
  /** Poll interval of the export file watcher (ms). */
  pollMs?: number
  /** Stop watching after this long (ms). Default 8 hours. */
  maxMs?: number
  /** Queue a build after each new version. Default true. */
  rebuild?: boolean
  /** The launcher (tests pass a fake). */
  launch?: typeof launchStudio
}

export interface OpenResult {
  studio: StudioId
  /** `window`: a window was started with the file. `mcp`: a running studio was asked to open it. */
  mode: 'window' | 'mcp'
  /** The copy of the asset the studio edits. */
  source: string
  /** The file the studio exports to on every save, which VN Studio watches. */
  exportTo: string
  message: string
}

/** A PNG of the asset at the size you edit it: the native pixel art when Pixel Studio made it, else the file scaled down (nearest) to the grid, else fitted in 512 px. */
async function imageSource(svc: VnService, slug: string, entry: AssetEntry, dest: string): Promise<{ w: number; h: number }> {
  const dir = svc.store.dir(slug)
  const file = resolveFile(dir, entry)
  if (!file) throw new Error(`${entry.id} has no file yet: generate it first`)
  const full = await sharp(file).metadata()
  const w = full.width ?? 1
  const h = full.height ?? 1
  const version = entry.source === 'generated' ? entry.versions.find((v) => v.n === entry.selected) : undefined
  const native = version?.nativeFile ? path.join(assetDir(dir, entry.id), version.nativeFile) : null
  if (native && existsSync(native)) await fs.copyFile(native, dest)
  else {
    const { settings } = await svc.store.loadSettings(slug)
    let target = { w, h }
    if (settings.art.style === 'pixel') {
      const px = resolvePixel(settings.art)
      const factor = px.width / (await svc.renpyResolution()).w
      target = { w: Math.max(8, Math.round(w * factor)), h: Math.max(8, Math.round(h * factor)) }
    } else if (Math.max(w, h) > 512) {
      const k = 512 / Math.max(w, h)
      target = { w: Math.round(w * k), h: Math.round(h * k) }
    }
    await fs.writeFile(dest, await sharp(file).resize(target.w, target.h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer())
  }
  return { w, h }
}

async function readSidecar(exportTo: string): Promise<{ loopStartSec?: number | null; loopEndSec?: number | null } | null> {
  for (const f of [`${exportTo}.json`, exportTo.replace(/\.[^.\\/]+$/, '.json')]) {
    try {
      const j = JSON.parse(await fs.readFile(f, 'utf8')) as { loopStartSec?: unknown; loopEndSec?: unknown }
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      return { loopStartSec: num(j.loopStartSec), loopEndSec: num(j.loopEndSec) }
    } catch {
      /* no sidecar */
    }
  }
  return null
}

/**
 * Round trip: opens the selected version of an asset in its studio (images in Pixel Studio, music in Chiptune Studio) and watches the file the
 * studio exports on every save. Each save becomes a new version of the asset: custom (made by hand) and locked, so the pipeline never replaces it.
 * The studio edits a copy in the project's `.vno-tmp`, never the version file.
 */
export async function openAssetInStudio(svc: VnService, slug: string, id: string, o: OpenOptions = {}): Promise<OpenResult> {
  const entry = await svc.requireAsset(slug, id)
  const studio = studioFor(entry.kind)
  const cfg = await loadStudiosConfig(svc.dataDir)
  const projectDir = svc.store.dir(slug)
  const dir = path.resolve(projectDir, '.vno-tmp', 'roundtrip', id)
  await fs.mkdir(dir, { recursive: true })
  const stamp = Date.now().toString(36)
  const base = entry.source === 'generated' ? entry.versions.find((v) => v.n === entry.selected) : undefined
  let args: OpenArgs
  if (studio === 'pixel') {
    const source = path.join(dir, `${id}-${stamp}.png`)
    const size = await imageSource(svc, slug, entry, source)
    args = { open: source, exportTo: path.join(dir, `${id}-${stamp}.export.png`), exportWidth: size.w, exportHeight: size.h }
  } else {
    if (!base?.songFile) throw new Error(`${id} has no song file: only music made by Chiptune Studio can be opened there (regenerate it with the chiptune engine)`)
    const song = path.join(assetDir(projectDir, id), base.songFile)
    if (!existsSync(song)) throw new Error(`the song file ${song} is missing`)
    const source = path.join(dir, `${id}-${stamp}.song`)
    await fs.copyFile(song, source)
    args = { open: source, exportTo: path.join(dir, `${id}-${stamp}.export.ogg`), exportFormat: 'ogg' }
  }

  const ingest = async (file: string) => {
    try {
      const made = await svc.store.updateAsset(slug, id, async (cur) => {
        const n = nextVersionN(cur)
        const ad = assetDir(projectDir, id)
        await fs.mkdir(ad, { recursive: true })
        let version: AssetVersion
        if (studio === 'pixel') {
          const name = `v${n}.webp`
          await fs.writeFile(path.join(ad, name), await sharp(await fs.readFile(file)).ensureAlpha().webp({ lossless: true }).toBuffer())
          version = { n, file: name, createdAt: new Date().toISOString(), seed: null, engine: 'custom:pixel-studio', prompt: 'edited in Pixel Studio', custom: true }
        } else {
          const name = `v${n}${path.extname(file) || '.ogg'}`
          await fs.copyFile(file, path.join(ad, name))
          const side = await readSidecar(file)
          const warnings: string[] = []
          let start = side?.loopStartSec ?? null
          let end = side?.loopEndSec ?? null
          if (!side && base) {
            start = base.loopStartSec ?? null
            end = base.loopEndSec ?? null
            if (start !== null) warnings.push(`loop points copied from version ${base.n}: check them if you changed the intro`)
          }
          let songFile: string | undefined
          if (existsSync(args.open)) {
            songFile = `v${n}.song`
            await fs.copyFile(args.open, path.join(ad, songFile))
          }
          version = { n, file: name, createdAt: new Date().toISOString(), seed: null, engine: 'custom:chiptune-studio', prompt: 'edited in Chiptune Studio', custom: true, loopStartSec: start, loopEndSec: end, ...(songFile ? { songFile } : {}), ...(warnings.length ? { warnings } : {}) }
        }
        return lock(addVersion(cur, version))
      })
      if (!made) return
      const version = made.versions[made.versions.length - 1]!
      svc.log(`${slug}/${id}: version ${version.n} saved from ${STUDIO_NAMES[studio]}`)
      await svc.emitAsset(slug, made)
      if (o.rebuild !== false) await svc.rebuildAfterEdit(slug)
      o.onVersion?.(made, version)
    } catch (e) {
      svc.log(`${slug}/${id}: could not take the file from ${STUDIO_NAMES[studio]}: ${(e as Error).message}`)
      svc.emit({ type: 'command.error', command: 'openInStudio', message: `could not take the file saved in ${STUDIO_NAMES[studio]}: ${(e as Error).message}`, slug })
    }
  }

  const watch = watchFile(args.exportTo, ingest, { intervalMs: o.pollMs, maxMs: o.maxMs ?? 8 * 3600_000 })
  svc.keepWatch(`${slug}:${id}`, watch)

  const via = o.via ?? 'auto'
  let launchError = ''
  if (via !== 'mcp') {
    try {
      await (o.launch ?? launchStudio)(launchPlan(cfg, studio, args))
      return { studio, mode: 'window', source: args.open, exportTo: args.exportTo, message: `opened ${id} in ${STUDIO_NAMES[studio]}: save there (Ctrl+S) and a new version appears` }
    } catch (e) {
      launchError = (e as Error).message
      if (via === 'launch') {
        watch.stop()
        throw new Error(launchError, { cause: e })
      }
    }
  }
  try {
    if (studio === 'pixel') await pixelClientFor(cfg).openDocument({ path: args.open, exportTo: args.exportTo, exportWidth: args.exportWidth, exportHeight: args.exportHeight })
    else await chiptuneClientFor(cfg).openSong({ path: args.open, exportTo: args.exportTo, exportFormat: args.exportFormat })
    return { studio, mode: 'mcp', source: args.open, exportTo: args.exportTo, message: `asked the running ${STUDIO_NAMES[studio]} to open ${id}; if it runs headless, start its window instead` }
  } catch (e) {
    watch.stop()
    throw new Error(`could not open ${id} in ${STUDIO_NAMES[studio]}${launchError ? ` (${launchError})` : ''}: ${(e as Error).message.includes('not running') ? startHint(cfg, studio) : (e as Error).message}`, { cause: e })
  }
}
