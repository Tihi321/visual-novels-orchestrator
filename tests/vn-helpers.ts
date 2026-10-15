import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { ComfyClient, ComfyRequest, ComfyResult } from '../src/engine/comfy/client'
import type { ChatRequest } from '../src/engine/models/types'
import { ROLES } from '../src/shared/schemas'
import { makeEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

export const booksDir = path.resolve(__dirname, 'fixtures', 'books')
export const book = (name: string) => path.join(booksDir, name)

/** A ComfyUI client that makes small images and fake audio, and records every request. */
export class FakeComfy implements ComfyClient {
  requests: ComfyRequest[] = []
  /** Prompts (or `text`) that make the request fail. */
  fail = new Set<string>()
  /** Languages the fake TTS refuses, like a workflow without them. */
  async generate(req: ComfyRequest): Promise<ComfyResult> {
    this.requests.push(req)
    const key = req.prompt ?? req.text ?? ''
    if (this.fail.has(key)) throw new Error('ComfyUI exploded')
    const isAudio = req.engine.startsWith('ace-step') || req.engine.startsWith('custom:')
    if (isAudio) return { bytes: Buffer.from(`AUDIO:${key}`), ext: req.engine.startsWith('custom:') ? 'flac' : 'mp3', kind: 'audio', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
    const w = 128
    const h = 128
    const bytes = req.references?.length
      ? await sharp({ create: { width: w, height: h * 2, channels: 3, background: '#ffffff' } })
          .composite([{ input: await sharp({ create: { width: 40, height: 120, channels: 3, background: '#2a5db0' } }).png().toBuffer(), gravity: 'center' }])
          .png()
          .toBuffer()
      : await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 40 + (key.length % 100), g: 100, b: 160 } } }).png().toBuffer()
    return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
  }
  async removeBackground(): Promise<Buffer | null> {
    return null // the flat-colour key is used
  }
}

export interface VnEnv extends TestEnv {
  comfy: FakeComfy
}

/** A mock-model engine with all eight agents, a fake ComfyUI, and no Ren'Py SDK (build and lint run without it). */
export async function makeVnEnv(o: { sdk?: string | false } = {}): Promise<VnEnv> {
  const comfy = new FakeComfy()
  const env = await makeEnv(
    { roles: Object.fromEntries(ROLES.map((r) => [r, ['loc/m1']])), agents: ROLES.map((r) => ({ role: r, name: 'Test' })) },
    { comfy }
  )
  if (o.sdk !== undefined) {
    const sdkPath = o.sdk === false ? path.join(env.dir, 'no-renpy-sdk') : o.sdk
    await mkdir(path.join(env.dir, 'config'), { recursive: true })
    await writeFile(path.join(env.dir, 'config', 'renpy.md'), `---\nkind: renpy\nsdkPath: ${JSON.stringify(sdkPath)}\nresolution: 1920x1080\nimageFormat: webp\n---\n`)
  }
  return Object.assign(env, { comfy })
}

/** The JSON array that follows a label line in a rendered prompt (`Items to settle...:` then the JSON). */
export function jsonAfter(req: ChatRequest, label: RegExp): unknown {
  const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
  const lines = text.split('\n')
  const i = lines.findIndex((l) => label.test(l))
  if (i < 0) throw new Error(`no line matching ${label}`)
  return JSON.parse(lines[i + 1]!)
}

export async function waitIdle(env: VnEnv, slug: string, ms = 60_000): Promise<{ failed: string[] }> {
  const r = await waitFor(async () => {
    const x = await env.engine.vn.waitIdle(slug, { timeoutMs: 1 })
    return x.timedOut ? null : x
  }, ms, `project ${slug} to be idle`)
  return { failed: r.failed }
}

/** The failure text of every failed job (for a useful assertion message). */
export async function failures(env: VnEnv): Promise<string[]> {
  const jobs = await env.engine.jobs.list('failed')
  return jobs.map((j) => `${j.id}: ${String((j.data as Record<string, unknown>).failure ?? '')}`)
}
