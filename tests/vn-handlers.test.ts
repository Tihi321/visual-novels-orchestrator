import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fallbackNegative, fallbackPrompt, resolveStylePrompt } from '../src/engine/assets/derive'
import { sanitizePrompt } from '../src/engine/vn/agents/art-director'
import type { Decision } from '../src/engine/vn/agents/script-analyst'
import { applyDecisions } from '../src/engine/vn/fixes'
import type { Uncertain } from '../src/engine/vn/script'
import type { AssetEntry, VnBook } from '../src/shared/vn'
import { book, failures, jsonAfter, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const nullDecision = (index: number): Decision => ({ index, placeKey: null, newPlace: null, time: null, charKey: null, newCharacter: null, expression: null, isDirection: false })

/** What a sensible script-analyst answers for the items of the prompt. */
function analystMock(env: VnEnv): void {
  env.mock.on({ task: 'vn.analyse' }, (req) => {
    const items = jsonAfter(req, /^Items to settle/) as { index: number; kind: string; text: string }[]
    const decisions = items.map((it): Decision => {
      const d = nullDecision(it.index)
      if (it.kind === 'place') return { ...d, newPlace: { name: it.text, looks: 'a place in Dragon Land' } }
      if (it.kind === 'time') return { ...d, time: 'day' }
      if (it.kind === 'speaker') return /splash|bang/i.test(it.text) ? { ...d, isDirection: true } : { ...d, newCharacter: { name: it.text.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()), looks: 'a dragon' } }
      if (it.kind === 'cast') return /sign/i.test(it.text) ? { ...d, isDirection: true } : { ...d, isDirection: true }
      return { ...d, expression: /sing|gentle|nodding/i.test(it.text) ? 'happy' : 'neutral' }
    })
    return JSON.stringify({ decisions })
  })
}

describe('import and analyse', () => {
  it('imports the soother, and the script-analyst settles what the parser could not', async () => {
    env = await makeVnEnv({ sdk: false })
    analystMock(env)
    const svc = env.engine.vn
    const { slug, preview } = await svc.importProject(book('soother'))
    expect(preview.detected.lang).toBe('en')
    expect(preview.chapters).toBe(7)
    expect(preview.uncertain).toBeGreaterThan(10)
    const before = await svc.store.loadBook(slug)
    expect(before.warnings.join(' ')).toContain('speakers not in the bible')
    expect(before.characters.map((c) => c.key)).not.toContain('mama')
    const unc = await svc.store.loadUncertain(slug)
    expect(unc.length).toBe(preview.uncertain)

    await svc.runPipeline(slug, 'analyse')
    // run only the analyse step: wait for it, the rest of the chain follows with the fake ComfyUI
    await waitIdle(env, slug, 120_000)
    const after = await svc.store.loadBook(slug)
    expect(after.characters.map((c) => c.key)).toEqual(expect.arrayContaining(['mama', 'pink_dragon', 'blue_dragon']))
    expect(after.warnings.join(' ')).not.toContain('speakers not in the bible')
    const left = await svc.store.loadUncertain(slug)
    expect(left.length).toBeLessThan(unc.length / 4)
    // every scene now has a time-aware background id; the asset list follows the book
    const manifest = await svc.store.loadAssets(slug)
    expect(manifest.assets.some((a) => a.id === 'sheet_mama')).toBe(true)
    const calls = env.mock.calls.filter((c) => c.meta?.task === 'vn.analyse')
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })

  it('turns a SMASH CUT TO speaker into narration when the analyst says it is a direction', () => {
    const book: VnBook = {
      slug: 'x',
      title: 'X',
      format: 'visual-novel',
      kind: 'linear',
      primaryLang: 'en',
      style: 's',
      characters: [{ key: 'mara', name: 'Mara', looks: '' }],
      places: [],
      chapters: [
        {
          n: 1,
          title: 'One',
          choices: [],
          ending: null,
          scenes: [
            {
              id: 'ch01.s01',
              placeKey: null,
              placeText: 'Dock',
              time: null,
              backgroundId: 'bg_dock_any',
              description: '',
              breakBefore: false,
              beats: [
                { id: 'ch01.s01.b001', type: 'line', speakerKey: null, speakerLabel: 'SMASH CUT TO', expression: 'neutral', text: 'Mara drops the rope.' },
                { id: 'ch01.s01.b002', type: 'line', speakerKey: null, speakerLabel: 'SMASH CUT TO', expression: 'neutral', text: 'Again.' }
              ]
            }
          ]
        }
      ],
      warnings: ['speakers not in the bible (no sprite): SMASH CUT TO']
    }
    const items: Uncertain[] = [
      { kind: 'speaker', chapter: 1, sceneId: 'ch01.s01', beatId: 'ch01.s01.b001', text: 'SMASH CUT TO', reason: 'not a bible character' },
      { kind: 'time', chapter: 1, sceneId: 'ch01.s01', text: 'Dock', reason: 'no time' }
    ]
    const r = applyDecisions(book, undefined, items, [{ ...nullDecision(0), isDirection: true }, { ...nullDecision(1), time: 'dusk' }])
    expect(r.book.chapters[0]!.scenes[0]!.beats.map((b) => b.type)).toEqual(['narration', 'narration'])
    expect(r.book.chapters[0]!.scenes[0]!.beats[0]).toMatchObject({ text: 'Mara drops the rope.' })
    expect(r.book.chapters[0]!.scenes[0]!.backgroundId).toBe('bg_dock_dusk')
    expect(r.unresolved).toEqual([])
    expect(r.book.warnings.join(' ')).not.toContain('speakers not in the bible')
    // the input is untouched
    expect(book.chapters[0]!.scenes[0]!.beats[0]!.type).toBe('line')
  })

  it('without a model the analyse step leaves the parser defaults and the pipeline goes on', async () => {
    env = await makeVnEnv({ sdk: false })
    // no mock rule: the reply is not JSON, so the agent fails and the deterministic path is used
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('quirks-en'))
    const unc = await svc.store.loadUncertain(slug)
    await svc.runPipeline(slug, 'analyse')
    const { failed } = await waitIdle(env, slug, 120_000)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    expect((await svc.store.loadUncertain(slug)).length).toBe(unc.length)
    const st = await svc.pipelineStatus(slug)
    expect(st?.steps.analyse?.status).toBe('done')
    expect(st?.steps.analyse?.message).toMatch(/keep the parser's defaults|no answer/)
    expect(st?.steps.build?.status).toBe('done')
  })
})

describe('art plan', () => {
  const stubsOf = async (e: VnEnv, slug: string) => (await e.engine.vn.store.loadAssets(slug)).assets

  it('the art-director writes English prompts with one style prefix and no banned words', async () => {
    env = await makeVnEnv({ sdk: false })
    env.mock.on({ task: 'vn.art.plan' }, (req) => {
      const assets = jsonAfter(req, /^Assets \(id/) as { id: string; kind: string }[]
      return JSON.stringify({
        stylePrefix: 'soft watercolour storybook illustration, warm pastel palette',
        assets: assets.map((a) => ({ id: a.id, prompt: `A ${a.kind} in a book frame, ${a.id}`, negative: 'modern clothes, text' }))
      })
    })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-hr'))
    await svc.reconcileAssets(slug)
    await svc.enqueue(slug, 'vn.art.plan', 'all', 1)
    await waitIdle(env, slug)
    const assets = await stubsOf(env, slug)
    const vnBook = await svc.store.loadBook(slug)
    const bg = assets.find((a) => a.kind === 'background')!
    expect(bg.prompt.startsWith(resolveStylePrompt(vnBook, (await svc.store.loadSettings(slug)).settings))).toBe(true)
    expect(bg.prompt).toContain('no people')
    expect(bg.prompt).not.toMatch(/\b(book|storybook|frame)\b/i)
    expect(bg.negative).toContain('modern clothes')
    expect(bg.negative).toContain('watermark') // the standard negatives are kept
    const sprite = assets.find((a) => a.kind === 'sprite')
    if (sprite) expect(sprite.prompt).toBeTruthy()
    expect(assets.filter((a) => a.kind !== 'music' && a.kind !== 'voiceRef').every((a) => a.prompt !== '')).toBe(true)
    // Croatian book, English prompts: the request told the agent to write English
    const req = env.mock.calls.find((c) => c.meta?.task === 'vn.art.plan')
    expect(req).toBeTruthy()
  })

  it('falls back to the prompts built from the book when the agent fails', async () => {
    env = await makeVnEnv({ sdk: false })
    // no rule: the mock answers with text that is not JSON
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.reconcileAssets(slug)
    await svc.enqueue(slug, 'vn.art.plan', 'all', 1)
    await waitIdle(env, slug)
    const vn = await svc.store.loadBook(slug)
    const assets = await stubsOf(env, slug)
    for (const a of assets.filter((x) => x.kind !== 'music' && x.kind !== 'voiceRef')) {
      expect(a.prompt).toBe(fallbackPrompt(a, vn, { pixel: false }))
      expect(a.negative).toBe(fallbackNegative(a.kind))
    }
    const st = await svc.pipelineStatus(slug)
    expect(st?.steps.art?.message).toContain('built from the book')
  })

  it('sanitizePrompt removes the words image models misread', () => {
    expect(sanitizePrompt('storybook style, a book on a table, in a frame, soft light')).toBe('style, a on a table, in a, soft light')
  })
})

describe('data folder', () => {
  it('has the workflows, palettes, prompts and agents where the loaders look', async () => {
    env = await makeVnEnv()
    const { loadCustomWorkflow, workflowDirs } = await import('../src/engine/comfy/custom-workflow')
    const wf = await loadCustomWorkflow(workflowDirs(env.dir), 'chatterbox-multilingual')
    expect(Object.keys(wf.mapping.languages ?? {})).toContain('en')
    expect(existsSync(path.join(env.dir, 'palettes', 'pico-8.hex'))).toBe(true)
    for (const role of ['script-analyst', 'art-director', 'art-critic', 'composer', 'stage-director', 'edition-aligner', 'voice-director', 'director']) {
      const files = await readdir(path.join(env.dir, 'prompts', role))
      expect(files.some((f) => f.endsWith('.md')), role).toBe(true)
    }
    const prompt = await readFile(path.join(env.dir, 'prompts', 'art-director', 'plan_art.md'), 'utf8')
    expect(prompt).toContain('kind: prompt')
    expect(prompt).toContain('{{assets}}')
  })
})

export type { AssetEntry }
