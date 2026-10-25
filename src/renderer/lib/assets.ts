import type { AssetView } from '../../shared/protocol'
import { IMAGE_KINDS, SFX_IMPORT_ONLY } from '../../shared/vn'

export interface CharacterGroup {
  key: string
  sheet?: AssetView
  sprites: AssetView[]
}

export interface AssetGroups {
  backgrounds: AssetView[]
  characters: CharacterGroup[]
  cover: AssetView[]
  /** CGs and inserts (`cg_<key>`). */
  images: AssetView[]
  /** Sound effects and ambiences (`sfx_<key>`, `amb_<key>`). */
  sounds: AssetView[]
  music: AssetView[]
  /** Voice references (`voice_<char|narrator>`). */
  voice: AssetView[]
}

/** The character key of a `sheet_<key>`, `sprite_<key>_<expression>` or `voice_<key>` id; null for other ids. */
export function charKeyOf(id: string): string | null {
  if (id.startsWith('sheet_')) return id.slice('sheet_'.length) || null
  if (id.startsWith('voice_')) return id.slice('voice_'.length) || null
  if (id.startsWith('sprite_')) {
    const rest = id.slice('sprite_'.length)
    const cut = rest.lastIndexOf('_')
    return cut > 0 ? rest.slice(0, cut) : rest || null
  }
  return null
}

const byId = (a: AssetView, b: AssetView): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Groups the assets for the gallery: backgrounds, characters (sheet and sprites together), cover, music, voice references. */
export function groupAssets(assets: readonly AssetView[]): AssetGroups {
  const groups: AssetGroups = { backgrounds: [], characters: [], cover: [], images: [], sounds: [], music: [], voice: [] }
  const chars = new Map<string, CharacterGroup>()
  const charOf = (key: string): CharacterGroup => {
    let g = chars.get(key)
    if (!g) {
      g = { key, sprites: [] }
      chars.set(key, g)
    }
    return g
  }
  for (const a of [...assets].sort(byId)) {
    switch (a.kind) {
      case 'background':
        groups.backgrounds.push(a)
        break
      case 'cover':
        groups.cover.push(a)
        break
      case 'cg':
        groups.images.push(a)
        break
      case 'sfx':
      case 'ambience':
        groups.sounds.push(a)
        break
      case 'music':
        groups.music.push(a)
        break
      case 'voiceRef':
        groups.voice.push(a)
        break
      case 'sheet': {
        const key = charKeyOf(a.id)
        if (key) charOf(key).sheet = a
        break
      }
      case 'sprite': {
        const key = charKeyOf(a.id)
        if (key) charOf(key).sprites.push(a)
        break
      }
    }
  }
  groups.characters = [...chars.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  return groups
}

/** A file the gallery can show as an image. */
export function isImagePath(rel: string | null | undefined): boolean {
  return !!rel && /\.(png|jpe?g|webp|gif|svg)$/i.test(rel)
}

export function isAudioPath(rel: string | null | undefined): boolean {
  return !!rel && /\.(mp3|ogg|wav|flac|opus|m4a)$/i.test(rel)
}

/** How an asset's state reads in a badge: its review, else whether it has a file. */
export function reviewBadge(a: Pick<AssetView, 'review' | 'fileRel'>): { label: string; tone: 'good' | 'bad' | 'warn' | 'dim' } {
  if (a.review?.status === 'approved') return { label: 'approved', tone: 'good' }
  if (a.review?.status === 'rejected') return { label: 'rejected', tone: 'bad' }
  if (a.review?.status === 'pending') return { label: 'review pending', tone: 'warn' }
  return a.fileRel ? { label: 'not reviewed', tone: 'dim' } : { label: 'no file yet', tone: 'warn' }
}

/** Counts for a group header: ready of total. */
export function readyCount(assets: readonly AssetView[]): { ready: number; total: number } {
  return { ready: assets.filter((a) => !!a.fileRel).length, total: assets.length }
}

/**
 * The assets that still have no file. `all` matches the project summary's missing count (the unused ones and, with hand-made art,
 * the character sheets are left out); `generatable` keeps only what the generate step may make: locked, custom and voice-reference
 * assets need an import or an upload, hand-made art is never generated, and a sound effect set to `none` is import-only.
 */
export function missingAssets(assets: readonly AssetView[], opts: { handArt: boolean }): { all: AssetView[]; generatable: AssetView[] } {
  const all = assets.filter((a) => !a.orphaned && !a.fileRel && !(opts.handArt && a.kind === 'sheet'))
  const generatable = all.filter(
    (a) =>
      a.kind !== 'voiceRef' &&
      !a.locked &&
      a.source !== 'custom' &&
      !(opts.handArt && IMAGE_KINDS.has(a.kind)) &&
      !(a.kind === 'sfx' && a.engine === SFX_IMPORT_ONLY)
  )
  return { all, generatable }
}
