import { cp, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import type { McpOptions, ToolResult } from '../src/engine/mcp/tools'
import type { MusicPlan } from '../src/engine/vn/agents/composer'
import { TASKS } from '../src/engine/vn/pipeline'
import type { StageCues } from '../src/engine/renpy/stage'
import type { VnBook } from '../src/shared/vn'
import { book, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv
let slug = ''
const svc = () => env.engine.vn

/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are free-form JSON, read by path in the assertions */
const data = (r: ToolResult): Record<string, any> => {
  if (r.isError) throw new Error(r.content[0]?.text)
  return r.structuredContent as Record<string, any>
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const call = (name: string, args: object, opts?: McpOptions) => callTool(buildTools(svc(), opts), name, args)
const ok = async (name: string, args: object, opts?: McpOptions) => data(await call(name, args, opts))
const error = async (name: string, args: object) => {
  const r = await call(name, args)
  expect(r.isError).toBe(true)
  return r.content[0]!.text
}
/** Runs one pipeline task and waits for it. */
const runTask = async (task: (typeof TASKS)[keyof typeof TASKS]) => {
  await svc().enqueue(slug, task, 'all', await svc().nextRun(slug))
  expect((await waitIdle(env, slug)).failed).toEqual([])
}
const asset = async (id: string) => (await svc().store.loadAssets(slug)).assets.find((a) => a.id === id)!

beforeEach(async () => {
  env = await makeVnEnv({ sdk: false })
  slug = (await svc().importProject(book('linear-en'))).slug
  await svc().reconcileAssets(slug)
})
afterEach(async () => {
  await env.cleanup()
})

describe('vno_asset_set and vno_plan', () => {
  it('sets a prompt without a job, keeps it through a forced plan, and refuses a locked asset', async () => {
    const bg = (await svc().listAssets(slug)).find((a) => a.kind === 'background')!
    const r = await ok('vno_asset_set', { slug, id: bg.id, prompt: '  a lighthouse at dusk  ', negative: 'people', size: { w: 640, h: 360 }, seed: 7 })
    expect(r.asset).toMatchObject({ id: bg.id, prompt: 'a lighthouse at dusk', negative: 'people', size: { w: 640, h: 360 }, seed: 7, promptByHand: true })
    expect(await env.engine.jobs.list('queued')).toEqual([])

    const planned = await ok('vno_plan', { slug, refreshPrompts: true, wait: true })
    expect(planned.jobs).toHaveLength(2)
    expect((await asset(bg.id)).prompt).toBe('a lighthouse at dusk')
    const others = planned.assets.filter((a: { id: string }) => a.id !== bg.id)
    expect(others.length).toBeGreaterThan(0)
    expect(others.filter((a: { kind: string; prompt: string }) => a.kind !== 'music').every((a: { prompt: string }) => a.prompt !== '')).toBe(true)
    // nothing was generated
    expect(env.comfy.requests).toHaveLength(0)
    expect((await svc().store.loadAssets(slug)).assets.every((a) => a.versions.length === 0)).toBe(true)

    // an empty prompt clears it and the mark: the planner may write one again
    await ok('vno_asset_set', { slug, id: bg.id, prompt: '' })
    expect(await asset(bg.id)).toMatchObject({ prompt: '' })
    expect((await asset(bg.id)).promptByHand).toBeUndefined()
    await ok('vno_plan', { slug, wait: true })
    expect((await asset(bg.id)).prompt).not.toBe('')

    await ok('vno_asset_lock', { slug, id: bg.id })
    expect(await error('vno_asset_set', { slug, id: bg.id, prompt: 'x' })).toMatch(/locked/)
    expect(await error('vno_asset_set', { slug, id: 'no_such', prompt: 'x' })).toMatch(/no asset/)
  }, 60_000)

  it('uses the size set by hand when the asset is generated', async () => {
    const bg = (await svc().listAssets(slug)).find((a) => a.kind === 'background')!
    await ok('vno_asset_set', { slug, id: bg.id, prompt: 'a small harbour', size: { w: 512, h: 288 } })
    await ok('vno_asset_generate', { slug, only: [bg.id], wait: true })
    const req = env.comfy.requests.find((r) => r.prompt?.includes('a small harbour'))
    expect(req).toMatchObject({ width: 512, height: 288 })
  }, 60_000)

  it('plans a project that does not exist', async () => {
    expect(await error('vno_plan', { slug: 'nope' })).toMatch(/no project/)
  })
})

describe('vno_set_music', () => {
  it('validates, reads, and is kept by the music step', async () => {
    await runTask(TASKS.musicPlan)
    const tracks = (await ok('vno_set_music', { slug })).tracks as string[]
    expect(tracks.length).toBeGreaterThan(1)
    const b = await svc().store.loadBook(slug)
    const n = b.chapters[0]!.n

    expect(await error('vno_set_music', { slug, menu: 'music_99' })).toMatch(/not a music track/)
    expect(await error('vno_set_music', { slug, chapters: { '99': tracks[0] } })).toMatch(/no chapter 99/)
    expect(await error('vno_set_music', { slug, chapters: { [n]: 'nope' } })).toMatch(/not a music track/)
    expect(await error('vno_set_music', { slug, seconds: { nope: 90 } })).toMatch(/not a music track/)

    const set = await ok('vno_set_music', { slug, menu: tracks[1], chapters: { [n]: tracks[0] }, seconds: { [tracks[0]!]: 500, [tracks[1]!]: 10 } })
    expect(set.plan).toMatchObject({ menu: tracks[1], chapters: { [n]: tracks[0] }, byHand: true })
    expect(set.plan.seconds[tracks[0]!]).toBe(180)
    expect(set.plan.seconds[tracks[1]!]).toBe(60)

    // a forced plan keeps what was set by hand
    await runTask(TASKS.musicPlan)
    const saved = JSON.parse(await readFile(svc().store.file(slug, 'music.json'), 'utf8')) as MusicPlan
    await svc().enqueue(slug, TASKS.musicPlan, 'all', await svc().nextRun(slug), { body: { force: true } })
    await waitIdle(env, slug)
    const forced = JSON.parse(await readFile(svc().store.file(slug, 'music.json'), 'utf8')) as MusicPlan
    expect(forced).toMatchObject({ menu: tracks[1], byHand: true })
    expect(forced.chapters[n]).toBe(tracks[0])
    expect(forced.seconds[tracks[0]!]).toBe(180)
    expect(saved.byHand).toBe(true)

    // null drops a chapter entry; replace starts over
    const dropped = await ok('vno_set_music', { slug, chapters: { [n]: null } })
    expect(dropped.plan.chapters[n]).toBeUndefined()
    const fresh = await ok('vno_set_music', { slug, menu: tracks[0], replace: true })
    expect(fresh.plan).toMatchObject({ menu: tracks[0], chapters: {}, seconds: {}, byHand: true })
  }, 60_000)

  it('keeps a track prompt set by hand through a forced music plan', async () => {
    await runTask(TASKS.musicPlan)
    await ok('vno_asset_set', { slug, id: 'music_01', prompt: 'slow strings, rain' })
    await svc().enqueue(slug, TASKS.musicPlan, 'all', await svc().nextRun(slug), { body: { force: true } })
    await waitIdle(env, slug)
    expect((await asset('music_01')).prompt).toBe('slow strings, rain')
    expect((await asset('music_02')).prompt).not.toBe('')
  }, 60_000)
})

describe('vno_set_cues', () => {
  const firstCast = (b: VnBook) => {
    for (const c of b.chapters) for (const s of c.scenes) for (const x of s.beats) if (x.type === 'cast') return { sceneId: s.id, beatId: x.id, keys: x.cast.map((m) => m.charKey) }
    throw new Error('the fixture has no cast beat')
  }

  it('validates, merges and is kept by the stage step', async () => {
    await runTask(TASKS.musicPlan)
    const b = await svc().store.loadBook(slug)
    const { sceneId, beatId, keys } = firstCast(b)
    const key = keys[0]!
    const n = b.chapters[0]!.n
    const read = await ok('vno_set_cues', { slug })
    expect(read.cues).toBeNull()

    expect(await error('vno_set_cues', { slug, menuMusic: 'nope' })).toMatch(/not a music track/)
    expect(await error('vno_set_cues', { slug, chapters: { '99': null } })).toMatch(/no chapter 99/)
    expect(await error('vno_set_cues', { slug, scenes: { 'ch99.s01': { transition: 'fade' } } })).toMatch(/no scene/)
    expect(await error('vno_set_cues', { slug, scenes: { [sceneId]: { transition: 'wipe' } } })).toMatch(/invalid arguments/)
    expect(await error('vno_set_cues', { slug, scenes: { [sceneId]: { pause: -1 } } })).toMatch(/invalid arguments/)
    expect(await error('vno_set_cues', { slug, casts: { 'ch99.s01.b001': {} } })).toMatch(/no cast beat/)
    expect(await error('vno_set_cues', { slug, casts: { [beatId]: { nobody: 'left' } } })).toMatch(/not in that cast/)
    expect(await error('vno_set_cues', { slug, casts: { [beatId]: { [key]: 'middle' } } })).toMatch(/invalid arguments/)
    expect((await svc().store.readJson(slug, 'cues.json'))).toBeNull() // a bad call changes nothing

    const set = await ok('vno_set_cues', { slug, menuMusic: null, chapters: { [n]: null }, scenes: { [sceneId]: { transition: 'fade', pause: 2 } }, casts: { [beatId]: { [key]: 'right' } } })
    expect(set.cues).toMatchObject({ menuMusic: null, byHand: true, scenes: { [sceneId]: { transition: 'fade', pause: 2 } }, casts: { [beatId]: { [key]: 'right' } } })
    expect(set.cues.chapters[n]).toEqual({ music: null })

    // the stage step keeps them and does not ask the stage-director
    const before = env.mock.calls.length
    await runTask(TASKS.stage)
    const after = JSON.parse(await readFile(svc().store.file(slug, 'cues.json'), 'utf8')) as StageCues
    expect(after).toMatchObject({ menuMusic: null, byHand: true, scenes: { [sceneId]: { transition: 'fade', pause: 2 } }, casts: { [beatId]: { [key]: 'right' } } })
    expect(after.chapters[n]).toEqual({ music: null })
    expect(env.mock.calls.length).toBe(before)
    expect((await svc().pipelineStatus(slug))?.steps.stage?.message).toMatch(/set by hand/)

    // a scene that came later gets the default cue; the cues set by hand stay
    const added = JSON.parse(JSON.stringify(after)) as StageCues
    delete added.scenes[sceneId]
    await svc().store.writeJson(slug, 'cues.json', added)
    await runTask(TASKS.stage)
    const again = JSON.parse(await readFile(svc().store.file(slug, 'cues.json'), 'utf8')) as StageCues
    expect(again.scenes[sceneId]).toBeDefined()
    expect(again.casts[beatId]).toEqual({ [key]: 'right' })
    expect(again.menuMusic).toBeNull()
    expect((await svc().pipelineStatus(slug))?.steps.stage?.message).toMatch(/default cue/)

    // replace starts again from the defaults
    const reset = await ok('vno_set_cues', { slug, replace: true })
    expect(reset.cues.casts[beatId]).not.toEqual({ [key]: 'right' })
  }, 60_000)
})

describe('projects made over MCP', () => {
  it('does not import a project with no source, and starts its pipeline at analyse', async () => {
    const { settings } = await svc().store.loadSettings(slug)
    await svc().store.saveSettings({ ...settings, source: '' })
    const r = await svc().runPipeline(slug)
    expect(r.from).toBe('analyse')
    await waitIdle(env, slug)

    await svc().enqueue(slug, TASKS.import, 'all', await svc().nextRun(slug))
    const w = await waitIdle(env, slug)
    expect(w.failed).toEqual([])
    expect((await svc().pipelineStatus(slug))?.steps.import).toMatchObject({ status: 'done', message: 'made over MCP: nothing to import' })
  }, 60_000)
})

describe('vno_set_library', () => {
  it('is unavailable without the option, and passes the path to it', async () => {
    expect(await error('vno_set_library', { path: env.dir })).toMatch(/not available/)
    const seen: string[] = []
    const r = await ok('vno_set_library', { path: 'somewhere' }, { setScriptoriumData: async (p) => (seen.push(p), path.resolve(env.dir, 'lib')) })
    expect(seen).toEqual(['somewhere'])
    expect(r.scriptoriumData).toBe(path.resolve(env.dir, 'lib'))
  })

  it('through the engine: saves the folder, lists its books, refuses a missing folder', async () => {
    const lib = path.join(env.dir, 'lib')
    await mkdir(path.join(lib, 'books'), { recursive: true })
    await cp(book('linear-en'), path.join(lib, 'books', 'linear-en'), { recursive: true })
    const tools = buildTools(svc(), { setScriptoriumData: (p) => env.engine.setScriptoriumData(p) })
    const r = data(await callTool(tools, 'vno_set_library', { path: lib }))
    expect(r.scriptoriumData).toBe(path.resolve(lib))
    expect(r.books.map((b: { slug: string }) => b.slug)).toContain('lighthouse-letters')
    expect(env.engine.scriptoriumDataPath()).toBe(path.resolve(lib))
    expect(await readFile(path.join(env.dir, 'config', 'settings.md'), 'utf8')).toContain('scriptoriumData')
    expect(data(await callTool(tools, 'vno_list_books', {})).scriptoriumData).toBe(path.resolve(lib))

    const bad = await callTool(tools, 'vno_set_library', { path: path.join(env.dir, 'missing') })
    expect(bad.isError).toBe(true)
    expect(bad.content[0]!.text).toMatch(/no such folder/)
    expect(env.engine.scriptoriumDataPath()).toBe(path.resolve(lib))

    // the settings command still works and keeps the library folder
    await env.engine.handleCommand({ type: 'saveSettings', lmstudioParallel: 3 })
    expect(env.engine.scriptoriumDataPath()).toBe(path.resolve(lib))
    expect(env.engine.settingsSummary().lmstudioParallel).toBe(3)
  })
})
