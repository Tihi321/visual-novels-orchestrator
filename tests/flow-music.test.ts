import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { generateAsset } from '../src/engine/assets/generate'
import type { GenerateContext } from '../src/engine/assets/generate'
import { runsOnFlow } from '../src/engine/assets/flow-image'
import { FlowError } from '../src/engine/studios/flow'
import { countFlowSongs } from '../src/engine/studios/flow-music'
import { engineFor } from '../src/engine/vn/service'
import { resolveMusicProvider } from '../src/shared/vn'
import type { AssetEntry } from '../src/shared/vn'
import { book as fixtureBook, settings } from './assets-fixtures'
import { FakeFlow } from './flow-fakes'
import { book as pipelineBook, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { FakeComfy } from './vn-helpers'

let dir: string
let env: VnEnv | undefined
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vno-flow-music-'))
})
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const flowMusic = (art: Record<string, unknown> = {}) => settings({ art: { style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'key', ...art }, music: { engine: 'ace-step-v1-instrumental', tracks: 2, provider: 'flow' } } as never)
const stub = (id: string, s = flowMusic()): AssetEntry => deriveAssets(fixtureBook, s).find((a) => a.id === id)!
const mk = (flow: FakeFlow, over: Partial<GenerateContext> = {}): GenerateContext => ({ book: fixtureBook, settings: flowMusic(), projectDir: dir, comfy: new FakeComfy(), flow, ...over })
const made = (r: Awaited<ReturnType<typeof generateAsset>>) => {
  if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
  return r
}

describe('engines', () => {
  it('flow music is never a default: a pixel book still picks chiptune, a plain one ComfyUI; only provider flow picks it', () => {
    const pixel = settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' } } as never)
    expect(resolveMusicProvider(pixel)).toBe('chiptune')
    expect(engineFor('music', pixel)).toBe('chiptune')
    expect(engineFor('music', settings())).toBe('ace-step-v1-instrumental')
    expect(engineFor('music', flowMusic())).toBe('flow-music')
    expect(stub('music_01').engine).toBe('flow-music')
    // the art provider flow does not choose music
    expect(engineFor('music', settings({ art: { style: 'illustrated', generator: 'qwen-image-2.1', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet', provider: 'flow' } } as never))).toBe('ace-step-v1-instrumental')
  })

  it('runsOnFlow: a flow music track, an image of a flow project, an engine given for the run', () => {
    expect(runsOnFlow(stub('music_01'), flowMusic())).toBe(true)
    expect(runsOnFlow(stub('music_01', settings()), settings())).toBe(false)
    expect(runsOnFlow(stub('music_01'), flowMusic(), 'ace-step-v1-instrumental')).toBe(false)
  })

  it('counts the songs a project has made from its versions', () => {
    const v = (engine: string) => ({ n: 1, file: 'v1.mp3', createdAt: 'x', seed: null, engine, prompt: 'p' })
    expect(countFlowSongs([{ versions: [v('flow-music'), v('flow-music')] }, { versions: [v('chiptune')] }, { versions: [v('flow-music')] }])).toBe(3)
  })
})

describe('making a track with Flow Music', () => {
  it('asks for an instrumental song, finds the loop, keeps the whole song, and records the song id', async () => {
    const flow = new FakeFlow()
    const r = made(await generateAsset(mk(flow), stub('music_01')))
    expect(r.version).toMatchObject({ n: 1, file: 'v1.mp3', engine: 'flow-music', seed: null, loopStartSec: 0, loopEndSec: 52, remote: { provider: 'flow-music', id: expect.stringMatching(/^song-/) } })
    const song = flow.calls.find((c) => c.tool === 'music_generate')!.args as { sound: string; title: string; format: string; loopFriendly: boolean; name: string; out: string }
    expect(song).toMatchObject({ title: 'The Soother music_01', format: 'mp3', loopFriendly: true, name: 'v1.src' })
    expect(song.sound).toMatch(/main menu theme/)
    expect(flow.calls.map((c) => c.tool)).toEqual(['music_generate', 'music_loop'])
    expect(flow.calls[1]!.args).toMatchObject({ input: path.join(dir, 'assets', 'music_01', 'v1.src.mp3'), name: 'v1' })
    expect(await readFile(path.join(dir, 'assets', 'music_01', 'v1.mp3'), 'utf8')).toBe('LOOP')
    expect(existsSync(path.join(dir, 'assets', 'music_01', 'v1.src.mp3'))).toBe(true)
    expect(r.version.warnings?.join(' ')).toMatch(/spent 5 credit/)
  })

  it('a prompt left over from chiptune is not sent as the sound', async () => {
    const flow = new FakeFlow()
    made(await generateAsset(mk(flow), { ...stub('music_01'), prompt: 'chiptune: ambient, nes, 60 bpm' }))
    expect((flow.calls[0]!.args as { sound: string }).sound).not.toMatch(/^chiptune:/)
  })

  it('at the song cap nothing is called', async () => {
    const flow = new FakeFlow()
    const r = await generateAsset(mk(flow, { flowSongsMade: 4 }), stub('music_01'))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Flow Music cap reached \(4 song\(s\)\).*flowMusicMaxSongs/) })
    expect(flow.calls).toHaveLength(0)
    const raised = made(await generateAsset(mk(flow, { flowSongsMade: 4, flowOptions: { quality: { background: 'upscaled', cover: 'upscaled', cg: 'upscaled', sheet: 'original', sprite: 'original', insert: 'original' }, jobTimeoutMs: 1000, musicTimeoutMs: 1000, maxSongs: 5 } }), stub('music_01')))
    expect(raised.version.engine).toBe('flow-music')
  })

  it('a loop that is not good, or a loop tool that fails, leaves the whole song without loop points and a warning', async () => {
    const weak = new FakeFlow()
    weak.loopScore = 0.2
    const a = made(await generateAsset(mk(weak), stub('music_01')))
    expect(a.version).toMatchObject({ file: 'v1.mp3', loopStartSec: null, loopEndSec: null })
    expect(a.version.warnings?.join(' ')).toMatch(/no seamless loop was found \(seam score 0\.20\).*repeats from its start/)
    expect(await readFile(path.join(dir, 'assets', 'music_01', 'v1.mp3'), 'utf8')).toBe('SONG:' + (weak.calls[0]!.args as { sound: string }).sound)

    const broken = new FakeFlow()
    broken.loopError = new Error('ffmpeg is not installed')
    const b = made(await generateAsset(mk(broken, { projectDir: path.join(dir, 'b') }), stub('music_01')))
    expect(b.version).toMatchObject({ loopStartSec: null })
    expect(b.version.warnings?.join(' ')).toMatch(/no loop was made \(ffmpeg is not installed\)/)
  })

  it('a song that fails is an error and the entry is unchanged; a locked or custom track is not touched', async () => {
    const flow = new FakeFlow()
    flow.songError = new FlowError('Flow Music is out of credits', 'tool')
    const entry = stub('music_01')
    expect(await generateAsset(mk(flow), entry)).toMatchObject({ ok: false, error: 'Flow Music is out of credits' })
    flow.songError = null
    expect(await generateAsset(mk(flow), { ...entry, locked: true })).toMatchObject({ ok: true, skipped: true })
    expect(flow.calls.filter((c) => c.tool === 'music_generate')).toHaveLength(1)
  })

  it('a track made by another engine follows the provider back (and to flow) like chiptune does', async () => {
    const flow = new FakeFlow()
    const comfy = new FakeComfy()
    const ace: AssetEntry = { ...stub('music_01', settings()), engine: 'ace-step-v1-instrumental', versions: [{ n: 1, file: 'v1.mp3', createdAt: 'x', seed: 1, engine: 'ace-step-v1-instrumental', prompt: 'p' }], selected: 1 }
    const toFlow = made(await generateAsset(mk(flow, { comfy }), ace, { force: true }))
    expect(toFlow.version).toMatchObject({ n: 2, engine: 'flow-music' })
    const back = made(await generateAsset(mk(flow, { comfy, settings: settings() }), toFlow.entry, { force: true }))
    expect(back.version.engine).toBe('ace-step-v1-instrumental')
    expect(comfy.requests).toHaveLength(1)
  })
})

describe('the pipeline with Flow Music', () => {
  it('a failed song is not retried by the scheduler, and the step reports it', async () => {
    const flow = new FakeFlow()
    flow.songError = new FlowError('Flow Music did not make a take', 'tool')
    env = await makeVnEnv({ sdk: false, engine: { flow } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(pipelineBook('linear-en'))
    await svc.updateSettings(slug, { music: { provider: 'flow', tracks: 1 } })
    expect((await svc.store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!.engine).toBe('flow-music')
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug, 120_000)
    expect(failed.some((id) => id.includes('music_01'))).toBe(true)
    expect((await failures(env)).join('|')).toContain('Flow Music did not make a take')
    expect(flow.calls.filter((c) => c.tool === 'music_generate')).toHaveLength(1) // one attempt: max_attempts is 1
  }, 180_000)

  it('a good run makes the track, keeps its remote id, and the game plays the loop file from its start', async () => {
    const flow = new FakeFlow()
    env = await makeVnEnv({ sdk: false, engine: { flow } })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(pipelineBook('linear-en'))
    await svc.updateSettings(slug, { music: { provider: 'flow', tracks: 1 } })
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug, 120_000)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const m = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === 'music_01')!
    expect(m.versions[0]).toMatchObject({ engine: 'flow-music', loopStartSec: 0, remote: { provider: 'flow-music' } })
    const rpy = await readFile(path.join(svc.gameDir(slug), 'game', 'ch01.rpy'), 'utf8')
    expect(rpy).toContain('play music "<loop 0>audio/music_0')
  }, 180_000)
})
