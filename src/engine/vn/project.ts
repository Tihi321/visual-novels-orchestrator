import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseMdWith } from '../../shared/md'
import { editionSchema, projectSettingsSchema, vnBookSchema } from '../../shared/vn'
import type { AssetEntry, AssetManifest, Edition, Lang, ProjectSettings, VnBook } from '../../shared/vn'
import { assetDir, loadManifest, resolveFile, saveManifest } from '../assets/manifest'
import { loadComfyConfig } from '../comfy/client'
import type { ComfyConfig } from '../comfy/client'
import { workflowDirs } from '../comfy/custom-workflow'
import { DEFAULT_SDK_PATH } from '../renpy/run'
import { atomicWrite, readMd, writeMd } from '../store/atomic'
import type { AlignReport } from './align'
import { asciiSlug } from './ids'
import type { Uncertain } from './script'

/**
 * The project store: `projects/<slug>/` in the data folder.
 *
 *   project.md          ProjectSettings (frontmatter) and your notes
 *   vn.json             structure and the primary-language text
 *   editions/<lang>.json   the text of one language, keyed by beat id
 *   assets.json         the asset manifest; assets/<id>/v1.png ... custom.png
 *   align-<lang>.json   the alignment report of an added edition
 *   uncertain.json      what the parser could not settle (the script-analyst's work list)
 *   music.json          the composer's plan (seconds per track, chapter -> track)
 *   cues.json           the stage-director's cues (StageCues)
 *   pipeline.json       the state of each pipeline step
 *   build.json, lint.json   the last build and lint results
 *   voice/<lang>/       the TTS clips, voice/<lang>/index.json their hashes
 *   game/               the Ren'Py project
 */

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/

/** A folder-safe project slug from any text: `Война и мир` -> `voina-i-mir`, `红楼梦` -> `book-1a2b3c` (see `asciiSlug`). */
export function projectSlug(text: string): string {
  return asciiSlug(text, { sep: '-', fallback: 'book', max: 60 })
}

export function assertSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug.includes('..')) throw new Error(`invalid project slug "${slug}"`)
  return slug
}

export interface ProjectFiles {
  settings: ProjectSettings
  /** The text of project.md under the frontmatter. */
  notes: string
}

/** Serialises async work per project, so two jobs never write the same file at once. */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>()
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return next
  }
}

const NOTES = '# Project notes\n\nSettings for this book: the frontmatter above is read by the app (theme, art engines, voice). Your own notes can go here.\n'

export class ProjectStore {
  private readonly mutex = new KeyedMutex()

  constructor(readonly dataDir: string) {}

  get root(): string {
    return path.join(this.dataDir, 'projects')
  }

  dir(slug: string): string {
    return path.join(this.root, assertSlug(slug))
  }

  file(slug: string, ...parts: string[]): string {
    return path.join(this.dir(slug), ...parts)
  }

  /** Runs `fn` while holding this project's lock (for read-modify-write of vn.json, assets.json ...). */
  withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(slug, fn)
  }

  async exists(slug: string): Promise<boolean> {
    return existsSync(this.file(slug, 'project.md'))
  }

  async slugs(): Promise<string[]> {
    try {
      return (await fs.readdir(this.root, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && SLUG_RE.test(d.name) && existsSync(path.join(this.root, d.name, 'project.md')))
        .map((d) => d.name)
        .sort()
    } catch {
      return []
    }
  }

  // ---- project.md ----

  /** The `models` of every project's settings, kept so the scheduler can read them without waiting for a file (see `projectModel`). */
  private models = new Map<string, Record<string, string>>()

  /** The model a project chose for a role, or undefined. */
  projectModel(slug: string, role: string): string | undefined {
    return this.models.get(slug)?.[role]
  }

  /** Reads the settings of every project once, to fill the `models` cache (at engine start). */
  async warmModels(): Promise<void> {
    for (const slug of await this.slugs()) await this.loadSettings(slug).catch(() => undefined)
  }

  async loadSettings(slug: string): Promise<ProjectFiles> {
    const file = this.file(slug, 'project.md')
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      throw new Error(`no project "${slug}"`)
    }
    const doc = parseMdWith(text, projectSettingsSchema, file)
    this.models.set(slug, doc.data.models)
    return { settings: doc.data, notes: doc.body }
  }

  async saveSettings(settings: ProjectSettings, notes?: string): Promise<void> {
    const file = this.file(settings.slug, 'project.md')
    let body = notes
    if (body === undefined) {
      try {
        body = parseMdWith(await fs.readFile(file, 'utf8'), projectSettingsSchema, file).body
      } catch {
        body = NOTES
      }
    }
    const parsed = projectSettingsSchema.parse(settings)
    await writeMd(file, { kind: 'project', ...parsed }, body)
    this.models.set(parsed.slug, parsed.models)
  }

  // ---- vn.json and editions ----

  async loadBook(slug: string): Promise<VnBook> {
    const file = this.file(slug, 'vn.json')
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      throw new Error(`project "${slug}" has no vn.json: import it first`)
    }
    return vnBookSchema.parse(JSON.parse(text))
  }

  async saveBook(slug: string, book: VnBook): Promise<void> {
    await atomicWrite(this.file(slug, 'vn.json'), JSON.stringify(vnBookSchema.parse(book), null, 2) + '\n')
  }

  async editionLangs(slug: string): Promise<Lang[]> {
    try {
      return (await fs.readdir(this.file(slug, 'editions'))).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2) as Lang).sort()
    } catch {
      return []
    }
  }

  async loadEdition(slug: string, lang: Lang): Promise<Edition> {
    const file = this.file(slug, 'editions', `${lang}.json`)
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      throw new Error(`project "${slug}" has no ${lang} edition`)
    }
    return editionSchema.parse(JSON.parse(text))
  }

  async saveEdition(slug: string, edition: Edition): Promise<void> {
    await atomicWrite(this.file(slug, 'editions', `${edition.lang}.json`), JSON.stringify(editionSchema.parse(edition), null, 2) + '\n')
  }

  /** The primary edition first, then the others. */
  async loadEditions(slug: string, primary: Lang): Promise<Edition[]> {
    const langs = await this.editionLangs(slug)
    const ordered = [primary, ...langs.filter((l) => l !== primary)].filter((l) => langs.includes(l))
    return Promise.all(ordered.map((l) => this.loadEdition(slug, l)))
  }

  // ---- json side files ----

  async readJson<T>(slug: string, name: string, schema?: z.ZodType<T>): Promise<T | null> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file(slug, name), 'utf8'))
      return schema ? schema.parse(raw) : (raw as T)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
  }

  async writeJson(slug: string, name: string, value: unknown): Promise<void> {
    await atomicWrite(this.file(slug, name), JSON.stringify(value, null, 2) + '\n')
  }

  loadAlignReport(slug: string, lang: Lang): Promise<AlignReport | null> {
    return this.readJson<AlignReport>(slug, `align-${lang}.json`)
  }
  saveAlignReport(slug: string, lang: Lang, report: AlignReport): Promise<void> {
    return this.writeJson(slug, `align-${lang}.json`, report)
  }
  async loadUncertain(slug: string): Promise<Uncertain[]> {
    return (await this.readJson<Uncertain[]>(slug, 'uncertain.json')) ?? []
  }
  saveUncertain(slug: string, items: Uncertain[]): Promise<void> {
    return this.writeJson(slug, 'uncertain.json', items)
  }

  // ---- assets ----

  loadAssets(slug: string): Promise<AssetManifest> {
    return loadManifest(this.dir(slug))
  }
  saveAssets(slug: string, manifest: AssetManifest): Promise<void> {
    return saveManifest(this.dir(slug), manifest)
  }

  /** Read-modify-write of one asset under the project lock; returns the new entry (or undefined when `fn` returns undefined). */
  updateAsset(slug: string, id: string, fn: (entry: AssetEntry) => AssetEntry | undefined | Promise<AssetEntry | undefined>): Promise<AssetEntry | undefined> {
    return this.withLock(slug, async () => {
      const manifest = await this.loadAssets(slug)
      const cur = manifest.assets.find((a) => a.id === id)
      if (!cur) throw new Error(`project ${slug} has no asset "${id}"`)
      const next = await fn(cur)
      if (!next) return undefined
      await this.saveAssets(slug, { assets: manifest.assets.map((a) => (a.id === id ? next : a)) })
      return next
    })
  }

  resolveAsset(slug: string, entry: AssetEntry): string | null {
    return resolveFile(this.dir(slug), entry)
  }

  assetDir(slug: string, id: string): string {
    return assetDir(this.dir(slug), id)
  }

  // ---- lifecycle ----

  /** Deletes the project folder. Only ever called for an explicit delete command. */
  async remove(slug: string): Promise<void> {
    await fs.rm(this.dir(slug), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// ---- config files in the data folder ----

export const renpyConfigSchema = z.object({
  sdkPath: z.string().default(DEFAULT_SDK_PATH),
  resolution: z.string().regex(/^\d{3,5}x\d{3,5}$/, 'WIDTHxHEIGHT').default('1920x1080'),
  imageFormat: z.enum(['webp', 'png']).default('webp')
})

export interface RenpyConfig {
  sdkPath: string
  resolution: { w: number; h: number }
  imageFormat: 'webp' | 'png'
}

/** `config/renpy.md`; a missing or broken file gives the defaults. `VNO_RENPY_SDK` overrides the SDK path. */
export async function loadRenpyConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<RenpyConfig> {
  let data: Record<string, unknown> = {}
  try {
    data = (await readMd(path.join(dataDir, 'config', 'renpy.md'))).data
  } catch {
    /* defaults */
  }
  const parsed = renpyConfigSchema.safeParse(data)
  const c = parsed.success ? parsed.data : renpyConfigSchema.parse({})
  const [w, h] = c.resolution.split('x').map(Number) as [number, number]
  return { sdkPath: env.VNO_RENPY_SDK ?? c.sdkPath, resolution: { w, h }, imageFormat: c.imageFormat }
}

export function loadComfyConfigFor(dataDir: string): Promise<ComfyConfig> {
  return loadComfyConfig(path.join(dataDir, 'config', 'comfy.md'))
}

/** Where the custom workflows and palettes are (both seeded into the data folder from `seed/`), and the fonts you drop in for the languages the theme font lacks. */
export function dataFolders(dataDir: string): { workflows: string[]; palettes: string; voices: string; fonts: string } {
  return { workflows: workflowDirs(dataDir), palettes: path.join(dataDir, 'palettes'), voices: path.join(dataDir, 'voices'), fonts: path.join(dataDir, 'fonts') }
}
