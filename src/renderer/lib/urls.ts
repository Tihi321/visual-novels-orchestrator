import { fileUrl } from '../hostApi'

/**
 * URL of a project file (`assets/<id>/v1.webp`, `preview/...`) for the `vnstudio-file://` protocol, which main limits to
 * `projects/<slug>/assets|preview/`. `rev` busts the cache for a file that is replaced under the same name (`custom.png`).
 */
export function projectAssetUrl(slug: string, rel: string, rev?: number | string): string {
  const url = fileUrl(`projects/${slug}/${rel}`)
  return rev === undefined ? url : `${url}?v=${encodeURIComponent(String(rev))}`
}

/** The path relative to the data folder, for `openFolder`. */
export function projectRel(slug: string, rel = ''): string {
  return rel ? `projects/${slug}/${rel.replace(/^\/+/, '')}` : `projects/${slug}`
}

/** The folder of a file path (forward or back slashes), for "Open folder" on a build output. */
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

/** Path of an absolute folder inside the data folder, relative to it, or null when it is outside. */
export function relativeToData(dataDir: string, absolute: string): string | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = norm(dataDir)
  const full = norm(absolute)
  if (!root || !full.toLowerCase().startsWith(root.toLowerCase() + '/')) return null
  return full.slice(root.length + 1)
}
