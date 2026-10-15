import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The folders that ship with the app (not the data folder): the game themes, the Ren'Py template, the seed.
 * They are found relative to this code (the repo root for `yarn engine`, tests and the Electron build), never the working
 * directory. `VNO_THEMES`, `VNO_TEMPLATES` and `VNO_SEED` override them.
 */
export interface AppDirs {
  themes: string
  /** The Ren'Py project template (`templates/renpy`). */
  templates: string
  seed: string
}

/** Walks up from `start` to the first `<dir>/<rel>` that `ok` accepts (the check keeps `src/engine/themes` from passing for `themes/`). */
function walkUp(rel: string[], start: string, ok: (dir: string) => boolean): string | undefined {
  let dir = start
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ...rel)
    if (existsSync(candidate) && ok(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

const hasThemes = (dir: string) => readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'theme.yaml')))

export function findAppDirs(env: NodeJS.ProcessEnv = process.env, start: string = __dirname): AppDirs {
  const themes = env.VNO_THEMES ? path.resolve(env.VNO_THEMES) : (walkUp(['themes'], start, hasThemes) ?? path.resolve(process.cwd(), 'themes'))
  const templates = env.VNO_TEMPLATES
    ? path.resolve(env.VNO_TEMPLATES)
    : (walkUp(['templates', 'renpy'], start, (d) => existsSync(path.join(d, 'game'))) ?? path.resolve(process.cwd(), 'templates', 'renpy'))
  const seed = env.VNO_SEED ? path.resolve(env.VNO_SEED) : (walkUp(['seed'], start, (d) => existsSync(path.join(d, 'config'))) ?? path.resolve(process.cwd(), 'seed'))
  return { themes, templates, seed }
}
