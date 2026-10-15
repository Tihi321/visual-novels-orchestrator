import fs from 'node:fs'
import path from 'node:path'
import type { Theme } from '../themes/load'
import type { Resolution } from './images'
import { runRenpy } from './run'

/**
 * Menu images (buttons, sliders, bars, overlays) in the theme colours: Ren'Py's own GUI generator
 * (`renpy.exe launcher generate_gui <target> --width --height --accent --boring [--light] --start --template <sdk>/gui`)
 * is run into a scratch folder and its `gui/` images are copied over the template's.
 */

function copyTree(src: string, dst: string): number {
  let n = 0
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) n += copyTree(s, d)
    else {
      fs.copyFileSync(s, d)
      n++
    }
  }
  return n
}

export interface GuiImagesInput {
  sdkPath: string
  theme: Theme
  /** The `game/` folder of the Ren'Py project. */
  gameSubdir: string
  /** A scratch folder (removed afterwards). */
  tmpDir: string
  resolution: Resolution
  warnings: string[]
}

export async function generateGuiImages(inp: GuiImagesInput): Promise<number> {
  const target = path.join(inp.tmpDir, 'gui-project')
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(inp.tmpDir, { recursive: true })
  const args = [
    path.join(inp.sdkPath, 'launcher'),
    'generate_gui',
    target,
    '--width',
    String(inp.resolution.w),
    '--height',
    String(inp.resolution.h),
    '--accent',
    inp.theme.colors.accent.slice(0, 7),
    '--boring',
    inp.theme.colors.background.slice(0, 7),
    ...(inp.theme.light ? ['--light'] : []),
    '--start',
    '--template',
    path.join(inp.sdkPath, 'gui')
  ]
  const r = await runRenpy(inp.sdkPath, args, { timeoutMs: 120000 })
  const gen = path.join(target, 'game', 'gui')
  if (r.code !== 0 || !fs.existsSync(gen)) throw new Error(`generate_gui failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 400)}`)
  // The button, slider and bar images are made by the generated project itself (what the launcher's "Generate Images" does):
  // once for phones and once for the desktop.
  for (const env of [{ RENPY_VARIANT: 'small phone' }, {}]) {
    const g = await runRenpy(inp.sdkPath, [target, 'gui_images'], { timeoutMs: 120000, env })
    if (g.code !== 0) throw new Error(`gui_images failed (exit ${g.code}): ${(g.stderr || g.stdout).slice(0, 400)}`)
  }
  if (!fs.existsSync(path.join(gen, 'button', 'idle_background.png'))) throw new Error('gui_images did not make the button images')
  const n = copyTree(gen, path.join(inp.gameSubdir, 'gui'))
  fs.rmSync(target, { recursive: true, force: true })
  return n
}
