import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../src/shared/protocol'
import { COMMAND_TYPES, isCommand } from '../src/shared/protocol'
import { initialVn, reduceVn } from '../src/renderer/store/vn'
import { waitFor } from './helpers'
import { book, makeVnEnv } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await env?.cleanup()
  env = undefined
})

describe('protocol registration for stopPipeline, suggestAssetPrompt, updateSceneCues, updateSceneStory', () => {
  it('registers all four commands in COMMAND_TYPES and isCommand', () => {
    for (const type of ['stopPipeline', 'suggestAssetPrompt', 'updateSceneCues', 'updateSceneStory'] as const) {
      expect(COMMAND_TYPES).toContain(type)
      expect(isCommand({ type, slug: 'test' })).toBe(true)
    }
  })

  it('reduces asset.prompt.suggested in reduceVn and increments rev', () => {
    let s = initialVn()
    s = { ...s, ...reduceVn(s, { type: 'asset.prompt.suggested', slug: 'b1', id: 'cover', prompt: 'first prompt', source: 'ai' }) }
    expect(s.promptSuggestions['b1:cover']).toEqual({ prompt: 'first prompt', source: 'ai', rev: 1 })
    s = { ...s, ...reduceVn(s, { type: 'asset.prompt.suggested', slug: 'b1', id: 'cover', prompt: 'second prompt', source: 'fallback' }) }
    expect(s.promptSuggestions['b1:cover']).toEqual({ prompt: 'second prompt', source: 'fallback', rev: 2 })
  })
})

describe('Scheduler.stopBook & VnService.stopPipeline', () => {
  it('aborts running jobs of the target book, drops its queued jobs, and marks pipeline steps skipped with "stopped"', async () => {
    env = await makeVnEnv({ sdk: false })
    const { slug } = await env.engine.vn.importProject(book('linear-en'))
    const { slug: otherSlug } = await env.engine.vn.importProject(book('soother'))

    await env.engine.setPaused(true)
    await env.engine.vn.runPipeline(slug, 'art')
    await env.engine.vn.runPipeline(otherSlug, 'art')

    expect((await env.engine.vn.status(slug)).jobs.queued).toBeGreaterThan(0)
    expect((await env.engine.vn.status(otherSlug)).jobs.queued).toBeGreaterThan(0)

    await env.engine.handleCommand({ type: 'stopPipeline', slug })

    const st = await env.engine.vn.status(slug)
    expect(st.jobs.queued).toBe(0)
    expect(st.jobs.running).toBe(0)
    expect(st.pipeline?.steps.art?.status).toBe('skipped')
    expect(st.pipeline?.steps.art?.message).toBe('stopped')

    // Other book's queued jobs are untouched
    const otherSt = await env.engine.vn.status(otherSlug)
    expect(otherSt.jobs.queued).toBeGreaterThan(0)
  })

  it('aborts an in-flight running job for the target book via stopBook and drops it', async () => {
    env = await makeVnEnv({ sdk: false })
    env.mock.onAny({ text: 'slow '.repeat(50), chunkDelayMs: 40, chunks: 50 })
    const { slug } = await env.engine.vn.importProject(book('linear-en'))

    // Register a custom slow task that uses mock streaming chat
    env.engine.scheduler.register('slow-task', async (ctx) => {
      await ctx.chat({ messages: [{ role: 'user', content: 'hello' }] })
      return { result: 'done' }
    })

    await env.engine.jobs.enqueue({ id: `${slug}--slow-task--u1--r1`, task: 'slow-task', book: slug, role: 'art-director' })
    await waitFor(() => env!.engine.scheduler.runningJobs().length === 1, 4000, 'job running')

    const res = await env.engine.vn.stopPipeline(slug)
    expect(res.stoppedRunning).toBe(1)

    const st = await env.engine.vn.status(slug)
    expect(st.jobs.running).toBe(0)
    expect(st.jobs.queued).toBe(0)
  })
})

describe('VnService.suggestAssetPrompt', () => {
  it('generates an AI prompt suggestion without modifying assets.json or queueing jobs, and falls back when LLM fails', async () => {
    env = await makeVnEnv({ sdk: false })
    env.mock.onAny('A windswept lighthouse on a rocky cliff at dusk, painterly brushstrokes')

    const { slug } = await env.engine.vn.importProject(book('linear-en'))
    await env.engine.vn.reconcileAssets(slug)
    const beforeAsset = await env.engine.vn.requireAsset(slug, 'cover')
    const queuedBefore = (await env.engine.vn.status(slug)).jobs.queued

    await env.engine.handleCommand({
      type: 'suggestAssetPrompt',
      slug,
      id: 'cover',
      instructions: 'make it dusk with warm lantern light'
    })

    const suggestedEvents = env.events.filter(
      (e): e is Extract<EngineEvent, { type: 'asset.prompt.suggested' }> => e.type === 'asset.prompt.suggested'
    )
    expect(suggestedEvents.length).toBe(1)
    expect(suggestedEvents[0]).toEqual({
      type: 'asset.prompt.suggested',
      slug,
      id: 'cover',
      prompt: 'A windswept lighthouse on a rocky cliff at dusk, painterly brushstrokes',
      source: 'ai'
    })

    // Must not overwrite assets.json or enqueue any job
    const afterAsset = await env.engine.vn.requireAsset(slug, 'cover')
    expect(afterAsset.prompt).toBe(beforeAsset.prompt)
    expect((await env.engine.vn.status(slug)).jobs.queued).toBe(queuedBefore)

    // Fallback path when LLM fails
    env.mock.onAny(() => {
      throw new Error('provider offline')
    })

    await env.engine.handleCommand({
      type: 'suggestAssetPrompt',
      slug,
      id: 'cover',
      instructions: 'dramatic storm clouds'
    })
    const latest = env.events
      .filter((e): e is Extract<EngineEvent, { type: 'asset.prompt.suggested' }> => e.type === 'asset.prompt.suggested')
      .at(-1)!
    expect(latest.source).toBe('fallback')
    expect(latest.prompt).toContain('dramatic storm clouds')
  })
})

describe('VnService.updateSceneCues & VnService.updateSceneStory', () => {
  it('exposes scene music/ambience, beat cues and the menu/chapter tracks on ProjectDetail', async () => {
    env = await makeVnEnv({ sdk: false })
    const { slug } = await env.engine.vn.importProject(book('linear-en'))
    const first = await env.engine.vn.detail(slug)
    const scene = first.book.chapters[0]!.scenes[0]!
    const line = scene.beats.find((b) => b.type === 'line')!
    await env.engine.vn.store.writeJson(slug, 'cues.json', {
      menuMusic: 'music_01',
      chapters: { 1: { music: 'music_02' } },
      scenes: { [scene.id]: { transition: 'fade', pause: 0.5, music: 'music_02', ambience: null } },
      casts: {},
      beats: { [line.id]: { image: 'ledger', sfx: 'bell', ambience: null } }
    })

    const d = await env.engine.vn.detail(slug)
    expect(d.stageMusic).toEqual({ menu: 'music_01', chapters: { '1': 'music_02' } })
    expect(d.cues[scene.id]).toMatchObject({
      transition: 'fade',
      pause: 0.5,
      music: 'music_02',
      ambience: null,
      beats: { [line.id]: { image: 'ledger', sfx: 'bell', ambience: null } }
    })
  })

  it('updates scene cues and story metadata/beats and exposes them on ProjectDetail.cues and ProjectDetail.book', async () => {
    env = await makeVnEnv({ sdk: false })
    await env.engine.setPaused(true)
    const { slug } = await env.engine.vn.importProject(book('linear-en'))
    await env.engine.vn.reconcileAssets(slug)

    const initialDetail = await env.engine.vn.detail(slug)
    const firstScene = initialDetail.book.chapters[0]!.scenes[0]!
    const castBeat = firstScene.beats.find((b) => b.type === 'cast')!
    const lineBeat = firstScene.beats.find((b) => b.type === 'line')!
    const firstChar = castBeat.type === 'cast' ? castBeat.cast[0]!.charKey : initialDetail.book.characters[0]!.key

    await env.engine.handleCommand({
      type: 'updateSceneCues',
      slug,
      scenes: [{ id: firstScene.id, transition: 'fade', pause: 1.5 }],
      casts: [{ beatId: castBeat.id, slots: { [firstChar]: 'right' } }]
    })

    const loadedAfterCues = env.events
      .filter((e): e is Extract<EngineEvent, { type: 'project.loaded' }> => e.type === 'project.loaded' && e.slug === slug)
      .at(-1)!.project
    expect(loadedAfterCues.cues[firstScene.id]?.transition).toBe('fade')
    expect(loadedAfterCues.cues[firstScene.id]?.pause).toBe(1.5)
    expect(loadedAfterCues.cues[firstScene.id]?.casts[castBeat.id]?.[firstChar]).toBe('right')

    // Update scene story metadata and beat expression
    const secondPlace = initialDetail.book.places[1]?.key ?? initialDetail.book.places[0]!.key
    await env.engine.handleCommand({
      type: 'updateSceneStory',
      slug,
      scenes: [{ id: firstScene.id, placeKey: secondPlace, time: 'night' }],
      beats: [{ id: lineBeat.id, expression: 'surprised' }]
    })

    const loadedAfterStory = env.events
      .filter((e): e is Extract<EngineEvent, { type: 'project.loaded' }> => e.type === 'project.loaded' && e.slug === slug)
      .at(-1)!.project
    const updatedScene = loadedAfterStory.book.chapters[0]!.scenes[0]!
    expect(updatedScene.placeKey).toBe(secondPlace)
    expect(updatedScene.time).toBe('night')
    const updatedLine = updatedScene.beats.find((b) => b.id === lineBeat.id)!
    expect(updatedLine.type === 'line' ? updatedLine.expression : '').toBe('surprised')
  })
})
