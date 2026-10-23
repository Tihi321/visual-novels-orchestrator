import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Running the Ren'Py SDK: lint, run the game, and a generic runner for the other commands. */

export const DEFAULT_SDK_PATH = 'C:/projects/Local/renpy/renpy-8.5.3-sdk'

/** The SDK launcher executable for this platform. */
export function renpyExe(sdkPath: string): string {
  if (process.platform === 'win32') return path.join(sdkPath, 'renpy.exe')
  return path.join(sdkPath, 'renpy.sh')
}

export function sdkExists(sdkPath: string): boolean {
  return fs.existsSync(renpyExe(sdkPath))
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Run `renpy <args>` and collect the output. */
export function runRenpy(sdkPath: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const exe = renpyExe(sdkPath)
    if (!fs.existsSync(exe)) {
      reject(new Error(`Ren'Py SDK not found: ${exe} does not exist. Set sdkPath in config/renpy.md.`))
      return
    }
    const child = spawn(exe, args, { cwd: opts.cwd ?? sdkPath, env: { ...process.env, ...opts.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : null
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** The Python that ships with the SDK (3.12, standard library only), for this platform. Null when the SDK has none. */
export function sdkPython(sdkPath: string): string | null {
  const rel = process.platform === 'win32' ? ['lib', 'py3-windows-x86_64', 'python.exe'] : process.platform === 'darwin' ? ['lib', 'py3-mac-universal', 'python'] : ['lib', 'py3-linux-x86_64', 'python']
  const exe = path.join(sdkPath, ...rel)
  return fs.existsSync(exe) ? exe : null
}

/** Run the SDK's own Python with these arguments (`input` goes to its stdin). Resolves with the output; rejects when the SDK has no Python. */
export function runSdkPython(sdkPath: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const exe = sdkPython(sdkPath)
    if (!exe) {
      reject(new Error(`the Ren'Py SDK at ${sdkPath} has no Python for this platform. Set sdkPath in config/renpy.md.`))
      return
    }
    const child = spawn(exe, args, { cwd: opts.cwd ?? sdkPath, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...opts.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : null
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(opts.input ?? '')
  })
}

export interface LintResult {
  /** No problems were reported (exit code 0). */
  ok: boolean
  /** Problem lines (`game/ch01.rpy:12 ...`) and tracebacks. */
  messages: string[]
  /** The "Statistics" block, when present. */
  statistics: string
  /** The raw output. */
  output: string
  code: number | null
}

/**
 * Parse Ren'Py's lint report: a header line, then one paragraph per problem (`game/ch01.rpy:12 The image ...`),
 * then a blank line and the `Statistics:` block.
 */
export function parseLint(output: string): { statistics: string; messages: string[] } {
  const text = output.charCodeAt(0) === 0xfeff ? output.slice(1) : output
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^Statistics:/i.test(l.trim()))
  const head = start >= 0 ? lines.slice(0, start) : lines
  const statistics = start >= 0 ? lines.slice(start).join('\n').trim() : ''
  const messages = head.map((l) => l.trimEnd()).filter((l) => l.trim() !== '' && !/^Ren'Py .* lint report/i.test(l.trim()))
  return { statistics, messages }
}

/** `renpy <project> lint --error-code`. */
export async function lint(gameDir: string, opts: { sdkPath?: string; timeoutMs?: number } = {}): Promise<LintResult> {
  const sdkPath = opts.sdkPath ?? DEFAULT_SDK_PATH
  const r = await runRenpy(sdkPath, [gameDir, 'lint', '--error-code'], { timeoutMs: opts.timeoutMs ?? 180000 })
  const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`
  const parsed = parseLint(output)
  const messages = [...parsed.messages]
  if (r.timedOut) messages.push('lint timed out')
  return { ok: r.code === 0 && !r.timedOut, messages, statistics: parsed.statistics, output, code: r.code }
}

/** Start the game and let it run on its own (the engine does not wait for it). */
export function run(gameDir: string, opts: { sdkPath?: string } = {}): { pid: number | undefined } {
  const sdkPath = opts.sdkPath ?? DEFAULT_SDK_PATH
  const exe = renpyExe(sdkPath)
  if (!fs.existsSync(exe)) throw new Error(`Ren'Py SDK not found: ${exe} does not exist. Set sdkPath in config/renpy.md.`)
  const child = spawn(exe, [gameDir, 'run'], { cwd: sdkPath, detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  return { pid: child.pid }
}
