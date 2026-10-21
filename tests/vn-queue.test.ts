import { afterEach, describe, expect, it } from 'vitest'
import { buildTools, callTool } from '../src/engine/mcp/tools'
import type { ToolResult } from '../src/engine/mcp/tools'
import { TASKS } from '../src/engine/vn/pipeline'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'
import { waitFor } from './helpers'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are free-form JSON, read by path in the assertions */
const data = (r: ToolResult): Record<string, any> => {
  if (r.isError) throw new Error(r.content[0]?.text)
  return r.structuredContent as Record<string, any>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A project of the linear fixture with every asset generated, and the tools bound to the engine (with the queue switches). */
async function generatedProject(e: VnEnv) {
  const svc = e.engine.vn
  const { slug } = await svc.importProject(book('linear-en'))
  await svc.reconcileAssets(slug)
  await svc.runPipeline(slug, 'art')
  const { failed } = await waitIdle(e, slug)
  expect(failed, (await failures(e)).join(' | ')).toEqual([])
  const tools = buildTools(svc, { control: e.engine.mcpControl() })
  const call = async (name: string, args: object) => data(await callTool(tools, name, args))
  return { svc, slug, tools, call }
}

describe('a regenerated sheet is made before its sprites (V10)', () => {
  const sheetWithSprites = async (e: VnEnv, slug: string) => {
    const assets = (await e.engine.vn.store.loadAssets(slug)).assets
    const sheet = assets.find((a) => a.kind === 'sheet' && assets.filter((s) => s.kind === 'sprite' && s.refs?.[0] === a.id).length >= 2)!
    return { sheet, sprites: assets.filter((s) => s.kind === 'sprite' && s.refs?.[0] === sheet.id) }
  }

  it('queued sprite jobs of the sheet wait for the regen job, and run from the new sheet', async () => {
    env = await makeVnEnv({ sdk: false })
    const { svc, slug, call } = await generatedProject(env)
    const { sheet, sprites } = await sheetWithSprites(env, slug)
    await env.engine.setPaused(true)
    const run = await svc.nextRun(slug)
    // sprite jobs somebody queued earlier, at the same priority as the regen that comes later: by age they would go first
    const spriteJobs: string[] = []
    for (const s of sprites.slice(0, 2)) spriteJobs.push(await svc.enqueue(slug, TASKS.generate, s.id, run, { body: { force: true }, priority: 1 }))
    const before = env.comfy.requests.length

    const r = await call('vno_asset_regen', { slug, id: sheet.id })
    const regen = r.jobs[0] as string
    expect(r.staleSprites).toEqual(expect.arrayContaining(sprites.map((s) => s.id)))
    for (const id of spriteJobs) expect((await env.engine.jobs.read('queued', id))!.data.depends_on).toEqual([regen])
    expect((await env.engine.jobs.read('queued', regen))!.data.priority).toBe(1)

    await env.engine.setPaused(false)
    await waitIdle(env, slug)
    const made = env.comfy.requests.slice(before).filter((q) => !q.engine.startsWith('ace-step'))
    expect(made).toHaveLength(3)
    expect(made[0]!.references).toBeUndefined() // the sheet
    for (const q of made.slice(1)) expect(String(q.references![0])).toMatch(/v2\.png$/) // the sprites used the new sheet
    expect((await env.engine.vn.store.loadAssets(slug)).assets.find((a) => a.id === sheet.id)!.selected).toBe(2)
  })

  it('sprites: true makes the sprites of the sheet again, after the sheet', async () => {
    env = await makeVnEnv({ sdk: false })
    const { svc, slug, call } = await generatedProject(env)
    const { sheet, sprites } = await sheetWithSprites(env, slug)
    const before = env.comfy.requests.length
    await env.engine.setPaused(true)
    const r = await call('vno_asset_regen', { slug, id: sheet.id, sprites: true })
    expect(r.staleSprites).toBeUndefined()
    expect(r.jobs).toHaveLength(sprites.length + 2) // the sheet, its sprites, the build
    for (const id of (r.jobs as string[]).slice(1, -1)) expect((await env.engine.jobs.read('queued', id))!.data.depends_on).toEqual([r.jobs[0]])
    expect((await env.engine.jobs.read('queued', r.jobs.at(-1)))!.data.depends_on).toEqual(r.jobs.slice(0, -1))
    await env.engine.setPaused(false)
    await waitIdle(env, slug)
    const made = env.comfy.requests.slice(before).filter((q) => !q.engine.startsWith('ace-step'))
    expect(made).toHaveLength(sprites.length + 1)
    expect(made[0]!.references).toBeUndefined()
    for (const s of (await svc.store.loadAssets(slug)).assets.filter((a) => sprites.some((x) => x.id === a.id))) expect(s.selected).toBe(2)
  })

  it('a regenerated sprite waits for a sheet job that is queued', async () => {
    env = await makeVnEnv({ sdk: false })
    const { svc, slug, call } = await generatedProject(env)
    const { sheet, sprites } = await sheetWithSprites(env, slug)
    await env.engine.setPaused(true)
    const sheetJob = (await call('vno_asset_regen', { slug, id: sheet.id })).jobs[0] as string
    const spriteJob = (await call('vno_asset_regen', { slug, id: sprites[0]!.id })).jobs[0] as string
    expect((await env.engine.jobs.read('queued', spriteJob))!.data.depends_on).toEqual([sheetJob])
    await env.engine.setPaused(false)
    await waitIdle(env, slug)
    expect((await svc.store.loadAssets(slug)).assets.find((a) => a.id === sprites[0]!.id)!.selected).toBe(2)
  })
})

describe('stopping, resuming and what is queued (V11)', () => {
  const queueUpPipeline = async (e: VnEnv) => {
    const svc = e.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    await e.engine.setPaused(true)
    await svc.runPipeline(slug, 'art') // the pipeline's own job, priority 0
    const tools = buildTools(svc, { control: e.engine.mcpControl() })
    return { svc, slug, call: async (name: string, args: object) => data(await callTool(tools, name, args)) }
  }
  const startedTasks = (e: VnEnv) => e.events.flatMap((ev) => (ev.type === 'job.started' ? [ev.jobId.split('--')[1]!] : []))

  it('without drop, a vno_plan asked for after a stop goes first, then the old queue runs', async () => {
    env = await makeVnEnv({ sdk: false })
    const { slug, call } = await queueUpPipeline(env)
    await call('vno_stop_now', {})
    const planned = await call('vno_plan', { slug })
    expect(planned.jobs).toHaveLength(2)
    await call('vno_resume_all', {})
    await waitIdle(env, slug)
    const tasks = startedTasks(env)
    expect(tasks[0]).toBe('vn.art.plan')
    expect(tasks).toContain('vn.pipeline.run') // the old job was kept
    expect(tasks.indexOf('vn.pipeline.run')).toBeGreaterThan(tasks.indexOf('vn.art.plan'))
  })

  it('with drop, nothing old is left to start: only the plan jobs run after the resume', async () => {
    env = await makeVnEnv({ sdk: false })
    const { slug, svc, call } = await queueUpPipeline(env)
    expect((await env.engine.jobs.ids('queued')).length).toBeGreaterThan(0)
    expect((await svc.pipelineStatus(slug))?.steps.art?.status).toBe('queued')
    const r = await call('vno_stop_now', { drop: true, slug })
    expect(r).toMatchObject({ paused: true, stopped: true, dropped: true })
    expect(await env.engine.jobs.ids('queued')).toEqual([])
    const st = await svc.pipelineStatus(slug)
    expect(Object.values(st!.steps).every((s) => s!.status !== 'queued' && s!.status !== 'running')).toBe(true)
    expect(st!.steps.art).toMatchObject({ status: 'skipped', message: 'dropped (vno_stop_now)' })
    await call('vno_plan', { slug })
    await call('vno_resume_all', {})
    await waitIdle(env, slug)
    expect(startedTasks(env).sort()).toEqual(['vn.art.plan', 'vn.music.plan'])
  })

  it('vno_clear_queue drops the queued jobs without stopping running ones, and needs confirm', async () => {
    env = await makeVnEnv({ sdk: false })
    const { slug, call } = await queueUpPipeline(env)
    const bad = await callTool(buildTools(env.engine.vn, { control: env.engine.mcpControl() }), 'vno_clear_queue', { slug })
    expect(bad.isError).toBe(true)
    const r = await call('vno_clear_queue', { slug, confirm: true })
    expect(r.dropped).toBeGreaterThan(0)
    expect(r.projects).toEqual([slug])
    expect(await env.engine.jobs.ids('queued')).toEqual([])
    // other projects are not touched
    const other = (await env.engine.vn.importProject(book('linear-hr'))).slug
    await env.engine.vn.enqueue(other, TASKS.build, 'now', 1)
    await call('vno_clear_queue', { slug, confirm: true })
    expect((await env.engine.jobs.ids('queued')).some((id) => id.startsWith(`${other}--`))).toBe(true)
    await waitFor(async () => (await env!.engine.jobs.ids('queued')).length > 0, 2000, 'the other project keeps its job')
  })
})
