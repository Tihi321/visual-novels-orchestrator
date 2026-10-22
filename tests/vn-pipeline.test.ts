import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeMd } from '../src/engine/store/atomic'
import { REVIEW_RETRIES } from '../src/engine/vn/handlers'
import type { StageCues } from '../src/engine/renpy/stage'
import { DEFAULT_SDK_PATH, sdkExists } from '../src/engine/renpy/run'
import { book, failures, jsonAfter, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobIds = async (e: VnEnv, state: 'queued' | 'running' | 'done' | 'failed') => e.engine.jobs.ids(state)

describe('generate jobs', () => {
  it('one job per asset, sheets before sprites, locked and custom assets skipped, and a second run does nothing', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    const assets = (await svc.store.loadAssets(slug)).assets
    const lockedBg = assets.find((a) => a.kind === 'background')!
    const customSheet = assets.find((a) => a.kind === 'sheet')!
    await svc.lockAsset(slug, lockedBg.id, true)
    const png = path.join(env.dir, 'mine.png')
    await writeFile(png, Buffer.from('89504e470d0a1a0a', 'hex'))
    await svc.replaceAsset(slug, customSheet.id, png, { rebuild: false })

    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])

    const done = await jobIds(env, 'done')
    const genJobs = done.filter((id) => id.includes('--vn.assets.generate--') && !id.includes('--vn.assets.generate--all--'))
    const after = await svc.store.loadAssets(slug)
    const wantedIds = after.assets.filter((a) => !a.locked && a.source === 'generated' && a.kind !== 'voiceRef').map((a) => a.id)
    expect(genJobs.length).toBe(wantedIds.length)
    expect(genJobs.some((id) => id.includes(lockedBg.id))).toBe(false)
    expect(genJobs.some((id) => id.includes(customSheet.id))).toBe(false)
    expect(existsSync(path.join(svc.store.dir(slug), 'assets', lockedBg.id))).toBe(false)

    // the sheet of every sprite was generated before the sprite, and the sprite used the sheet file as its reference
    const imageReqs = env.comfy.requests.filter((r) => !r.engine.startsWith('ace-step'))
    const spriteReqs = imageReqs.filter((r) => r.references?.length)
    expect(spriteReqs.length).toBeGreaterThan(0)
    for (const r of spriteReqs) expect(path.basename(r.references![0] as string)).toMatch(/^(v1\.png|custom\.png)$/)
    const customUsed = spriteReqs.filter((r) => (r.references![0] as string).includes(customSheet.id))
    expect(customUsed.every((r) => (r.references![0] as string).endsWith('custom.png'))).toBe(true)
    // the prompts the art-director (fallback) wrote were the ones sent to ComfyUI
    expect(imageReqs.every((r) => !!r.prompt && r.prompt.length > 10)).toBe(true)
    // a background was fitted to the project resolution and saved as webp
    const bg = after.assets.find((a) => a.kind === 'background' && !a.locked)!
    expect(bg.versions[0]!.file).toBe('v1.webp')
    // the music got the composer's (fallback) seconds and the engine of the project
    const music = env.comfy.requests.find((r) => r.engine.startsWith('ace-step'))!
    expect(music.seconds).toBe(100)

    const requests = env.comfy.requests.length
    await svc.runPipeline(slug, 'generate')
    await waitIdle(env, slug)
    expect(env.comfy.requests.length).toBe(requests) // resumable: everything already has a file
    const st = await svc.pipelineStatus(slug)
    expect(st?.steps.generate?.status).toBe('done')
  })

  it('a failed asset is retried and then fails the job, and the chain waits for it', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    await svc.enqueue(slug, 'vn.art.plan', 'all', 1)
    await waitIdle(env, slug)
    const assets = (await svc.store.loadAssets(slug)).assets
    const cover = assets.find((a) => a.kind === 'cover')!
    env.comfy.fail.add(cover.prompt)
    await svc.runPipeline(slug, 'generate')
    const { failed } = await waitIdle(env, slug, 90_000)
    expect(failed.some((id) => id.includes('cover'))).toBe(true)
    // the build never started: it waits for the failed job
    expect((await jobIds(env, 'done')).some((id) => id.includes('--vn.build--'))).toBe(false)
    const st = await svc.pipelineStatus(slug)
    expect(st?.steps.build?.status).toBe('queued')
  }, 120_000)

  it('regenerating makes a new selected version and a pick goes back; edits only rebuild', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug)
    const bg = (await svc.store.loadAssets(slug)).assets.find((a) => a.kind === 'background')!
    expect(bg.versions).toHaveLength(1)
    await svc.regenerateAsset(slug, bg.id, { prompt: 'a brand new harbour prompt', seed: 7 })
    await waitIdle(env, slug)
    const regen = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === bg.id)!
    expect(regen.versions.map((v) => v.n)).toEqual([1, 2])
    expect(regen.selected).toBe(2)
    expect(regen.prompt).toBe('a brand new harbour prompt')
    expect(env.comfy.requests.at(-1)).toMatchObject({ prompt: 'a brand new harbour prompt', seed: 7 })

    // pick v1: only a build is queued, nothing else
    const before = new Set([...(await jobIds(env, 'done')), ...(await jobIds(env, 'queued')), ...(await jobIds(env, 'running'))])
    await svc.pickAssetVersion(slug, bg.id, 1)
    await waitIdle(env, slug)
    const added = [...(await jobIds(env, 'done'))].filter((id) => !before.has(id))
    expect(added.map((id) => id.split('--')[1])).toEqual(['vn.build'])
    expect((await svc.store.loadAssets(slug)).assets.find((a) => a.id === bg.id)!.selected).toBe(1)
    // locking is not a rebuild
    await svc.lockAsset(slug, bg.id, true)
    expect((await jobIds(env, 'queued')).length).toBe(0)
    await expect(svc.regenerateAsset(slug, 'no_such_asset')).rejects.toThrow(/no asset/)
  })
})

describe('stage and build', () => {
  it('the stage-director overrides the cues, and the game folder is built from them', async () => {
    env = await makeVnEnv({ sdk: false })
    env.mock.on({ task: 'vn.stage' }, (req) => {
      const chapter = jsonAfter(req, /^Chapter:/) as { n: number; scenes: { id: string; beats: { id: string; type: string; cast?: { charKey: string }[] }[] }[] }
      const casts = chapter.scenes.flatMap((s) => s.beats.filter((b) => b.type === 'cast').map((b) => ({ beatId: b.id, slots: (b.cast ?? []).slice(0, 2).map((c, i) => ({ charKey: c.charKey, slot: i === 0 ? 'right' : 'left' })) })))
      return JSON.stringify({ music: null, scenes: chapter.scenes.map((s) => ({ id: s.id, transition: 'fade', pause: 1 })), casts })
    })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.runPipeline(slug, 'art')
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const cues = JSON.parse(await readFile(path.join(svc.store.dir(slug), 'cues.json'), 'utf8')) as StageCues
    const firstScene = Object.values(cues.scenes)[0]!
    expect(firstScene).toMatchObject({ transition: 'fade', pause: 1 })
    const game = path.join(svc.store.dir(slug), 'game', 'game')
    const files = await readdir(game)
    expect(files).toEqual(expect.arrayContaining(['ch01.rpy', 'characters.rpy', 'options.rpy', 'screens.rpy']))
    const ch1 = await readFile(path.join(game, 'ch01.rpy'), 'utf8')
    expect(ch1).toContain('with vn_fade')
    expect(ch1).toMatch(/pause 1/)
    // generated assets were copied in: music and images
    expect((await readdir(path.join(game, 'audio'))).length).toBeGreaterThan(0)
    expect((await readdir(path.join(game, 'images'))).length).toBeGreaterThan(0)
    const detail = await svc.detail(slug)
    expect(detail.build?.ok).toBe(true)
    expect(detail.build?.placeholders).toEqual([])
    expect(detail.lint?.skipped).toBe(true)
    expect(detail.resolvedTheme).toBeTruthy()
    // invalid stage answers are dropped: a slot twice, a character that is not in the cast beat
    const events = env.events.filter((e) => e.type === 'build.result')
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  it('drops stage answers that do not fit the book', async () => {
    const { mergeChapterCues } = await import('../src/engine/vn/agents/stage-director')
    const { defaultCues } = await import('../src/engine/renpy/stage')
    const { loadBook } = await import('./fixtures/vn/load')
    const vn = loadBook('linear')
    const cues = defaultCues(vn)
    const ch = vn.chapters[0]!
    const castBeat = ch.scenes.flatMap((s) => s.beats).find((b) => b.type === 'cast')!
    const m = mergeChapterCues(cues, ch, { music: 'music_99', scenes: [{ id: 'nope', transition: 'fade', pause: 9 }], casts: [{ beatId: castBeat.id, slots: [{ charKey: 'ghost', slot: 'left' }] }], sfx: [], ambience: [] }, ['music_01'])
    expect(m.cues.casts[castBeat.id]).toEqual(cues.casts[castBeat.id])
    expect(m.notes.join(' ')).toMatch(/unknown music/)
    expect(m.notes.join(' ')).toMatch(/unknown scene/)
    expect(m.notes.join(' ')).toMatch(/do not fit/)
  })
})

describe.skipIf(!sdkExists(process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH))('real Ren\'Py', () => {
  it('builds the soother with placeholders and lint is clean', { timeout: 300_000 }, async () => {
    env = await makeVnEnv({ sdk: process.env.VNO_RENPY_SDK ?? DEFAULT_SDK_PATH })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('soother'))
    await svc.runPipeline(slug, 'build')
    const { failed } = await waitIdle(env, slug, 280_000)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const detail = await svc.detail(slug)
    expect(detail.build?.placeholders?.length).toBeGreaterThan(5)
    expect(detail.lint?.skipped).toBeFalsy()
    expect(detail.lint?.messages).toEqual([])
    expect(detail.lint?.ok).toBe(true)
  })
})

describe('art review', () => {
  const makeVision = async (e: VnEnv) => {
    await writeMd(
      path.join(e.dir, 'config', 'providers.md'),
      { kind: 'providers', providers: [{ id: 'loc', kind: 'mock', local: true, concurrency: 4, models: [{ id: 'm1', family: 'loc', vision: true }] }] },
      'test\n'
    )
    await e.engine.registry.load()
  }

  it('retries a rejected image twice with the revised prompt, keeps the best version and says why', async () => {
    env = await makeVnEnv({ sdk: false })
    await makeVision(env)
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug)
    await svc.updateSettings(slug, { art: { review: true } })
    const bg = (await svc.store.loadAssets(slug)).assets.find((a) => a.kind === 'background')!
    const problems = [['wrong place', 'text in the image', 'a frame'], ['a frame'], ['wrong place', 'blurry']]
    let call = 0
    let sawImage = false
    env.mock.on({ task: 'vn.assets.review' }, (req) => {
      const last = req.messages[req.messages.length - 1]!
      sawImage = typeof last.content !== 'string' && last.content.some((p) => p.type === 'image')
      const p = problems[Math.min(call++, problems.length - 1)]!
      return JSON.stringify({ approved: false, problems: p, revisedPrompt: `revised ${call}` })
    })
    const before = env.comfy.requests.length
    await svc.enqueue(slug, 'vn.assets.review', bg.id, 90, { vision: true })
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    expect(sawImage).toBe(true)
    expect(call).toBe(REVIEW_RETRIES + 1)
    expect(env.comfy.requests.length - before).toBe(REVIEW_RETRIES)
    const entry = (await svc.store.loadAssets(slug)).assets.find((a) => a.id === bg.id)!
    expect(entry.versions).toHaveLength(REVIEW_RETRIES + 1)
    expect(entry.selected).toBe(2) // the attempt with the fewest problems
    expect(entry.review).toEqual({ status: 'rejected', note: 'a frame' })
    expect(entry.versions[1]!.prompt).toBe('revised 1')
  })

  it('approves an image at once, and a locked one is not reviewed', async () => {
    env = await makeVnEnv({ sdk: false })
    await makeVision(env)
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug)
    const assets = (await svc.store.loadAssets(slug)).assets
    const [a, b] = assets.filter((x) => x.kind === 'background')
    env.mock.on({ task: 'vn.assets.review' }, JSON.stringify({ approved: true, problems: [], revisedPrompt: null }))
    await svc.lockAsset(slug, b!.id, true)
    await svc.enqueue(slug, 'vn.assets.review', a!.id, 91, { vision: true })
    await svc.enqueue(slug, 'vn.assets.review', b!.id, 91, { vision: true })
    await waitIdle(env, slug)
    const now = (await svc.store.loadAssets(slug)).assets
    expect(now.find((x) => x.id === a!.id)!.review).toEqual({ status: 'approved' })
    expect(now.find((x) => x.id === b!.id)!.review).toBeUndefined()
  })

  it('reviews only run when a vision model is there', async () => {
    env = await makeVnEnv({ sdk: false }) // the mock model has no vision flag
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { art: { review: true } })
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug)
    expect((await jobIds(env, 'done')).some((id) => id.includes('--vn.assets.review--'))).toBe(false)
  })
})

describe('voice', () => {
  const clipFile = async (e: VnEnv) => {
    const f = path.join(e.dir, 'ref.wav')
    await writeFile(f, Buffer.from('RIFFxxxxWAVE'))
    return f
  }

  it('does nothing when voice is off', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    expect(await svc.generateVoice(slug)).toEqual([])
    expect(await jobIds(env, 'queued')).toEqual([])
    await svc.runPipeline(slug, 'art')
    await waitIdle(env, slug)
    const all = [...(await jobIds(env, 'done')), ...(await jobIds(env, 'failed'))]
    expect(all.some((id) => id.includes('--vn.voice.'))).toBe(false)
    expect(env.comfy.requests.some((r) => r.engine.startsWith('custom:'))).toBe(false)
    expect(existsSync(path.join(svc.store.dir(slug), 'voice'))).toBe(false)
    const ch1 = await readFile(path.join(svc.store.dir(slug), 'game', 'game', 'ch01.rpy'), 'utf8')
    expect(ch1).not.toMatch(/^\s*voice /m)
    expect((await svc.store.loadAssets(slug)).assets.some((a) => a.kind === 'voiceRef')).toBe(false)
  })

  it('says clearly that a language the workflow does not declare is skipped', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-hr'))
    expect((await svc.store.loadSettings(slug)).settings.primaryLang).toBe('hr')
    await svc.updateSettings(slug, { voice: { enabled: true, langs: ['hr'], provider: 'comfy', engines: { hr: 'custom:chatterbox-multilingual' } } })
    await svc.setVoiceRef(slug, 'narrator', await clipFile(env))
    const ids = await svc.generateVoice(slug)
    expect(ids).toHaveLength(1)
    await waitIdle(env, slug)
    const done = await env.engine.jobs.read('done', ids[0]!)
    expect(done?.body).toMatch(/voice for hr skipped: the TTS workflow "chatterbox-multilingual" has no hr voice \(it supports: en,/)
    expect(env.comfy.requests.some((r) => r.engine.startsWith('custom:'))).toBe(false)
    const st = await svc.pipelineStatus(slug)
    expect(st?.steps.voice?.status).toBe('skipped')
    expect(st?.steps.voice?.message).toContain('no hr voice')
  })

  it('makes a clip per beat with the voice reference, skips unchanged ones and uses the clips in the game', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.updateSettings(slug, { voice: { enabled: true, langs: ['en'], provider: 'comfy', engines: { en: 'custom:chatterbox-multilingual' } } })
    expect((await svc.store.loadAssets(slug)).assets.filter((a) => a.kind === 'voiceRef').length).toBeGreaterThan(1)
    await svc.setVoiceRef(slug, 'narrator', await clipFile(env))
    await svc.generateVoice(slug, { lang: 'en' })
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const dir = path.join(svc.store.dir(slug), 'voice', 'en')
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')) as Record<string, { hash: string; file: string }>
    const beats = Object.keys(index)
    expect(beats.length).toBeGreaterThan(3)
    expect(existsSync(path.join(dir, index[beats[0]!]!.file))).toBe(true)
    expect(index[beats[0]!]!.file).toBe(`${beats[0]}.flac`)
    const tts = env.comfy.requests.filter((r) => r.engine === 'custom:chatterbox-multilingual')
    expect(tts).toHaveLength(beats.length)
    expect(tts[0]!.language).toBe('en')
    expect(typeof tts[0]!.voiceRef).toBe('string') // the narrator's reference was used for every speaker

    await svc.generateVoice(slug, { lang: 'en' })
    await waitIdle(env, slug)
    expect(env.comfy.requests.filter((r) => r.engine.startsWith('custom:'))).toHaveLength(tts.length) // the hashes match: nothing new

    await svc.updateEditionBeat(slug, 'en', beats[1]!, 'A new sentence for this beat.')
    await svc.generateVoice(slug, { lang: 'en' })
    await waitIdle(env, slug)
    const again = env.comfy.requests.filter((r) => r.engine.startsWith('custom:'))
    expect(again).toHaveLength(tts.length + 1)
    expect(again.at(-1)!.text).toBe('A new sentence for this beat.')

    await svc.enqueueBuild(slug)
    await waitIdle(env, slug)
    const ch1 = await readFile(path.join(svc.store.dir(slug), 'game', 'game', 'ch01.rpy'), 'utf8')
    expect(ch1).toMatch(/voice "voice\/en\/ch01\.s01\.b\d+\.flac"/)
  })
})

describe('editions', () => {
  it('adds a translated edition that reuses every asset; a missing beat goes to the edition-aligner', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    const idsBefore = (await svc.store.loadAssets(slug)).assets.map((a) => a.id)

    await svc.addEdition(slug, book('linear-hr'), 'hr')
    await waitIdle(env, slug)
    const rep = await svc.alignReport(slug, 'hr')
    expect(rep?.missing).toEqual([])
    expect(rep?.matched).toBeGreaterThan(5)
    expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en', 'hr'])
    const ed = await svc.getEdition(slug, 'hr')
    expect(Object.keys(ed.beats).length).toBe(rep!.matched)
    expect((await svc.reconcileAssets(slug)).added).toEqual([])
    expect((await svc.store.loadAssets(slug)).assets.map((a) => a.id)).toEqual(idsBefore)

    // one beat missing: the edition-aligner is asked about the leftovers (here it has nothing to match)
    env.mock.on({ task: 'vn.edition.align' }, JSON.stringify({ fixes: [], names: [{ charKey: 'mara', name: 'Mara' }, { charKey: 'nobody', name: 'x' }] }))
    await svc.addEdition(slug, book('linear-hr-missing'), 'hr')
    await waitIdle(env, slug, 60_000)
    expect(env.mock.calls.some((c) => c.meta?.task === 'vn.edition.align')).toBe(true)
    const rep2 = await svc.alignReport(slug, 'hr')
    expect(rep2?.missing.length).toBe(1)
    expect((await svc.getEdition(slug, 'hr')).characterNames.mara).toBe('Mara')
    await expect(svc.addEdition(slug, book('linear-hr'), 'en')).rejects.toThrow(/primary language/)
  })

  it('applies the aligner fixes only for missing beats and only with the translator\'s own text', async () => {
    const { applyAlignmentFixes } = await import('../src/engine/vn/fixes')
    const { loadBook, loadEdition } = await import('./fixtures/vn/load')
    const vn = loadBook('linear')
    const full = loadEdition('linear', 'hr')
    const ids = Object.keys(full.beats)
    const missingId = ids[2]!
    const edition = { ...full, beats: Object.fromEntries(Object.entries(full.beats).filter(([id]) => id !== missingId)) }
    const report = { matched: ids.length - 1, missing: [missingId], extra: [{ chapter: 1, scene: 1, text: full.beats[missingId]! }, { chapter: 1, scene: 1, text: 'stray' }], nameMap: {}, placeMap: {}, warnings: [] }
    const r = applyAlignmentFixes(vn, edition, report, [{ beatId: missingId, extraIndex: 0 }, { beatId: ids[0]!, extraIndex: 1 }, { beatId: missingId, extraIndex: 7 }], [])
    expect(r.edition.beats[missingId]).toBe(full.beats[missingId])
    expect(r.edition.beats[ids[0]!]).toBe(full.beats[ids[0]!]) // untouched: it was not missing
    expect(r.fixed).toBe(1)
    expect(r.report.missing).toEqual([])
    expect(r.report.extra).toEqual([{ chapter: 1, scene: 1, text: 'stray' }])
    expect(r.notes.length).toBe(2)
  })
})

export { mkdir }
