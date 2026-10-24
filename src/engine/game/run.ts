import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { lint, parseLint, type LintResult } from './lint'

export { lint, parseLint, type LintResult }

export const DEFAULT_SDK_PATH = ''
export const sdkExists = (_path?: string): boolean => true

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runRenpy(_sdkPath: string, _args: string[], _opts: Record<string, unknown> = {}): Promise<RunResult> {
  return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false })
}

export function sdkPython(_sdkPath: string): string | null {
  return null
}

export function runSdkPython(sdkPath: string, _args: string[], _opts: Record<string, unknown> = {}): Promise<RunResult> {
  const py = sdkPython(sdkPath)
  if (!py) {
    return Promise.reject(new Error(`no Python found in ${sdkPath}`))
  }
  return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false })
}

export interface RunGameResult {
  pid: number | undefined
  url: string
  indexHtml: string
}

/**
 * Runs the HTML5 Visual Novel game.
 * Resolves index.html in gameDir (or gameDir/game), ensures it exists,
 * and launches it in the system browser or Electron runner.
 */
export function run(gameDir: string, _opts: { sdkPath?: string } = {}): RunGameResult {
  let indexHtml = path.join(gameDir, 'index.html')
  if (!fs.existsSync(indexHtml) && fs.existsSync(path.join(gameDir, 'game', 'index.html'))) {
    indexHtml = path.join(gameDir, 'game', 'index.html')
  }

  if (!fs.existsSync(indexHtml)) {
    throw new Error(`Game not built: ${indexHtml} does not exist. Run build first.`)
  }

  const url = pathToFileURL(indexHtml).href

  // If running headless or in test environment
  if (process.env.VNO_HEADLESS_RUN === '1' || process.env.NODE_ENV === 'test') {
    return { pid: undefined, url, indexHtml }
  }

  let child: ReturnType<typeof spawn> | null = null
  try {
    if (process.platform === 'win32') {
      child = spawn('cmd.exe', ['/c', 'start', '', indexHtml], { detached: true, stdio: 'ignore', windowsHide: false })
    } else if (process.platform === 'darwin') {
      child = spawn('open', [indexHtml], { detached: true, stdio: 'ignore' })
    } else {
      child = spawn('xdg-open', [indexHtml], { detached: true, stdio: 'ignore' })
    }
    child?.unref()
  } catch {
    // If opening browser fails, we still return the url
  }

  return {
    pid: child?.pid,
    url,
    indexHtml
  }
}
