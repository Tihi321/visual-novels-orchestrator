import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import type { Decision } from '../src/engine/vn/agents/script-analyst'
import { describeItems } from '../src/engine/vn/agents/script-analyst'
import { applyDecisions } from '../src/engine/vn/fixes'
import { importBook } from '../src/engine/vn/import'
import type { Uncertain } from '../src/engine/vn/script'
import { projectSettingsSchema } from '../src/shared/vn'
import type { VnBook } from '../src/shared/vn'
import { waitFor } from './helpers'
import { book, jsonAfter, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'


// these tests run a pipeline or import a whole book: under the load of the full suite 15 s is not always enough
vi.setConfig({ testTimeout: 60_000 })

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const decision = (index: number, over: Partial<Decision>): Decision => ({ index, placeKey: null, newPlace: null, time: null, charKey: null, newCharacter: null, expression: null, isDirection: false, aliasOf: null, ...over })

/** One scene at the harbour with a line by Mara that the parser could not read the expression of. */
function harbour(time: string | null = null): VnBook {
  const bg = `bg_harbour_${time ?? 'any'}`
  return {
    slug: 'h',
    title: 'H',
    format: 'visual-novel',
    kind: 'linear',
    primaryLang: 'en',
    style: '',
    characters: [{ key: 'mara', name: 'Mara', looks: 'a girl in a red coat' }],
    places: [{ key: 'harbour', name: 'Harbour', looks: 'stone pier' }],
    chapters: [
      {
        n: 1,
        title: 'One',
        choices: [],
        ending: null,
        scenes: [
          {
            id: 'ch01.s01',
            placeKey: 'harbour',
            placeText: 'The harbour',
            time,
            backgroundId: bg,
            description: '',
            breakBefore: false,
            beats: [{ id: 'ch01.s01.b001', type: 'line', speakerKey: 'mara', speakerLabel: 'MARA', expression: 'neutral', rawExpression: 'startled', text: 'Oh!' }]
          }
        ]
      }
    ],
    warnings: []
  }
}
const timeItem: Uncertain = { kind: 'time', chapter: 1, sceneId: 'ch01.s01', text: 'The harbour', reason: 'no time of day recognised' }
const exprItem: Uncertain = { kind: 'expression', chapter: 1, sceneId: 'ch01.s01', beatId: 'ch01.s01.b001', text: 'startled', reason: 'unknown expression' }
const has = (...ids: string[]) => ({ hasFile: (id: string) => ids.includes(id) })
const scene = (b: VnBook) => b.chapters[0]!.scenes[0]!
const assetIds = (b: VnBook) => deriveAssets(b, projectSettingsSchema.parse({ slug: 'h', source: '', primaryLang: 'en' })).map((a) => a.id)

describe('the analysis keeps the art that exists (V17)', () => {
  it('a time with no art keeps the background that has art, and adds no asset', () => {
    const r = applyDecisions(harbour(), undefined, [timeItem], [decision(0, { time: 'dusk' })], has('bg_harbour_any'))
    expect(scene(r.book).time).toBeNull()
    expect(scene(r.book).backgroundId).toBe('bg_harbour_any')
    expect(r.notes).toContain('kept bg_harbour_any: no art for bg_harbour_dusk')
    expect(assetIds(r.book).filter((id) => id.startsWith('bg_'))).toEqual(['bg_harbour_any'])
    expect(r.applied).toBe(1)
  })
  it('a time that has art is used as decided', () => {
    const r = applyDecisions(harbour(), undefined, [timeItem], [decision(0, { time: 'dusk' })], has('bg_harbour_any', 'bg_harbour_dusk'))
    expect(scene(r.book)).toMatchObject({ time: 'dusk', backgroundId: 'bg_harbour_dusk' })
  })
  it('with no art for this scene, the nearest time that has art for the place is used: evening becomes night', () => {
    const r = applyDecisions(harbour(), undefined, [timeItem], [decision(0, { time: 'evening' })], has('bg_harbour_night'))
    expect(scene(r.book)).toMatchObject({ time: 'night', backgroundId: 'bg_harbour_night' })
    expect(r.notes.join(' ')).toContain('used bg_harbour_night for bg_harbour_evening')
    // morning is nearer to the day than to the night
    const m = applyDecisions(harbour(), undefined, [timeItem], [decision(0, { time: 'morning' })], has('bg_harbour_night', 'bg_harbour_day'))
    expect(scene(m.book).backgroundId).toBe('bg_harbour_day')
  })
  it('a place decision that would make an art-less background keeps the old one', () => {
    const place: Uncertain = { kind: 'place', chapter: 1, sceneId: 'ch01.s01', text: 'The harbour', reason: 'no bible place matches' }
    const b = harbour('night')
    scene(b).placeKey = null
    const r = applyDecisions(b, undefined, [place], [decision(0, { placeKey: 'harbour', time: 'dawn' })], has('bg_harbour_night'))
    expect(scene(r.book).backgroundId).toBe('bg_harbour_night')
    expect(scene(r.book).placeKey).toBe('harbour')
  })
  it('an expression with no art becomes the nearest one that has: surprised -> happy', () => {
    const r = applyDecisions(harbour(), undefined, [exprItem], [decision(0, { expression: 'surprised' })], has('sprite_mara_neutral', 'sprite_mara_happy'))
    const beat = scene(r.book).beats[0]!
    expect(beat).toMatchObject({ expression: 'happy', rawExpression: 'startled' })
    expect(r.notes.join(' ')).toContain('used sprite_mara_happy for surprised')
    const w = applyDecisions(harbour(), undefined, [exprItem], [decision(0, { expression: 'worried' })], has('sprite_mara_neutral', 'sprite_mara_sad'))
    expect(scene(w.book).beats[0]).toMatchObject({ expression: 'sad' })
    const kept = applyDecisions(harbour(), undefined, [exprItem], [decision(0, { expression: 'surprised' })], has('sprite_mara_neutral', 'sprite_mara_surprised'))
    expect(scene(kept.book).beats[0]).toMatchObject({ expression: 'surprised' })
  })
  it('without any art the decisions apply as before', () => {
    const none = applyDecisions(harbour(), undefined, [timeItem, exprItem], [decision(0, { time: 'dusk' }), decision(1, { expression: 'surprised' })], has())
    expect(scene(none.book)).toMatchObject({ time: 'dusk', backgroundId: 'bg_harbour_dusk' })
    expect(scene(none.book).beats[0]).toMatchObject({ expression: 'surprised' })
    const plain = applyDecisions(harbour(), undefined, [timeItem, exprItem], [decision(0, { time: 'dusk' }), decision(1, { expression: 'surprised' })])
    expect(scene(plain.book)).toMatchObject({ time: 'dusk', backgroundId: 'bg_harbour_dusk' })
    // a character with no sprite at all keeps the expression too
    const otherChar = applyDecisions(harbour(), undefined, [exprItem], [decision(0, { expression: 'surprised' })], has('sprite_tom_neutral'))
    expect(scene(otherChar.book).beats[0]).toMatchObject({ expression: 'surprised' })
  })

  it('the analyst is told which art exists, in the prompt', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('quirks-en'))
    await svc.reconcileAssets(slug)
    const assets = (await svc.store.loadAssets(slug)).assets
    const bg = assets.find((a) => a.kind === 'background')!
    const sheet = assets.find((a) => a.kind === 'sheet')!
    // one background and one sheet have art
    await svc.enqueue(slug, 'vn.art.plan', 'all', 1)
    await waitIdle(env, slug)
    await svc.enqueue(slug, 'vn.assets.generate', 'all', 2, { body: { dispatch: true, ids: [bg.id, sheet.id], tail: false } })
    await waitIdle(env, slug)
    let prompt = ''
    env.mock.on({ task: 'vn.analyse' }, (req) => {
      prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
      return JSON.stringify({ decisions: [] })
    })
    await svc.enqueue(slug, 'vn.analyse', 'all', 3)
    await waitFor(() => prompt !== '', 20_000, 'the analyst was asked')
    expect(prompt).toContain('Prefer a time or an expression from this list')
    const m = /\{"backgrounds":.*\}/.exec(prompt)
    expect(m).not.toBeNull()
    const placeAndTime = /^bg_(.+)_([a-z]+)$/.exec(bg.id)!
    expect(JSON.parse(m![0])).toMatchObject({ backgrounds: { [placeAndTime[1]!]: [placeAndTime[2]!] } })
  }, 90_000)
})

describe('the analyst cannot put a stranger on screen (V7)', () => {
  const cast = async () => {
    const r = await importBook(book('quirks-cast-en'))
    const item = r.uncertain.findIndex((u) => u.kind === 'cast' && /silver-haired/.test(u.text))
    expect(item).toBeGreaterThanOrEqual(0)
    return { r, item }
  }
  it('a character who is not in the scene and does not look the part is refused, one who does is accepted', async () => {
    const { r, item } = await cast()
    const no = applyDecisions(r.book, r.edition, r.uncertain, [decision(item, { charKey: 'zoltan' })])
    expect(no.applied).toBe(0)
    expect(no.notes).toContain('rejected zoltan for "the silver-haired man (grey suit)": not in the scene and looks do not match')
    expect(no.unresolved).toContain(r.uncertain[item])
    const cast0 = no.book.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'cast')
    expect(JSON.stringify(cast0)).not.toContain('zoltan')

    const yes = applyDecisions(r.book, r.edition, r.uncertain, [decision(item, { charKey: 'vaulmont' })])
    expect(yes.applied).toBe(1)
    const first = yes.book.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'cast' && b.cast.length > 0)
    expect(first).toMatchObject({ cast: [{ charKey: 'dec' }, { charKey: 'ines' }, { charKey: 'vaulmont', look: 'grey suit' }] })
  })
  it('someone who speaks in the scene, or is named in it, is accepted even without matching looks', async () => {
    const { r, item } = await cast()
    // Dec speaks in the scene
    const speaks = applyDecisions(r.book, r.edition, r.uncertain, [decision(item, { charKey: 'dec' })])
    expect(speaks.applied).toBe(1)
  })
  it('the analyst sees who is in the scene and which characters the looks point to', async () => {
    const { r, item } = await cast()
    const described = describeItems(r.book, r.uncertain)[item]! as { present: { speakers: string[]; named: string[] }; candidates: { key: string }[] }
    expect(described.present.speakers.sort()).toEqual(['dec', 'ines'])
    const keys = described.candidates.map((c) => c.key)
    expect(keys).toContain('vaulmont') // silver hair, grey suit
    expect(keys).not.toContain('zoltan')
    expect(keys).not.toContain('ines')
  })
  it('a flagged "named only" entry is confirmed only when it fits; an answer that says direction takes someone off a crowded cast', () => {
    const b = harbour()
    b.characters.push({ key: 'tom', name: 'Tom', looks: 'a tall boy in a green coat' })
    scene(b).beats.unshift({ id: 'ch01.s01.b000', type: 'cast', cast: [{ charKey: 'mara' }] })
    const named: Uncertain = { kind: 'cast', chapter: 1, sceneId: 'ch01.s01', beatId: 'ch01.s01.b000', text: 'Tom the Younger (green coat)', reason: 'named only: on screen?', charKey: 'tom' }
    const ok = applyDecisions(b, undefined, [named], [decision(0, { charKey: 'tom' })])
    expect(ok.applied).toBe(1) // the green coat is in Tom's looks
    expect(scene(ok.book).beats[0]).toMatchObject({ cast: [{ charKey: 'mara' }, { charKey: 'tom' }] })
    const crowd: Uncertain = { kind: 'cast', chapter: 1, sceneId: 'ch01.s01', beatId: 'ch01.s01.b000', text: 'Mara', reason: 'more than 3 on screen', charKey: 'mara' }
    const off = applyDecisions(b, undefined, [crowd], [decision(0, { isDirection: true })])
    expect(scene(off.book).beats[0]).toMatchObject({ cast: [] })
    const stays = applyDecisions(b, undefined, [crowd], [decision(0, { charKey: 'mara' })])
    expect(scene(stays.book).beats[0]).toMatchObject({ cast: [{ charKey: 'mara' }] })
  })
})

describe('the analyse job applies the cast guard (V7)', () => {
  const run = async (answer: string) => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('quirks-cast-en'))
    env.mock.on({ task: 'vn.analyse' }, (req) => {
      const items = jsonAfter(req, /^Items to settle/) as { index: number; kind: string; text: string }[]
      return JSON.stringify({ decisions: items.map((it) => decision(it.index, /silver-haired/.test(it.text) ? { charKey: answer } : { isDirection: true })) })
    })
    await svc.enqueue(slug, 'vn.analyse', 'all', 1)
    expect((await waitIdle(env, slug)).failed).toEqual([])
    await env.engine.logs.flush()
    const castBeat = (await svc.store.loadBook(slug)).chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'cast' && b.cast.length > 1)
    return { castBeat, left: await svc.store.loadUncertain(slug), log: await readFile(path.join(env.dir, 'logs', 'agents', 'script-analyst-test.md'), 'utf8') }
  }

  it('zoltan for "the silver-haired man" is rejected: he is not in the scene and his looks do not match', async () => {
    const r = await run('zoltan')
    expect(JSON.stringify(r.castBeat)).not.toContain('zoltan')
    expect(r.left.some((u) => /silver-haired/.test(u.text))).toBe(true)
    expect(r.log).toContain('rejected zoltan for "the silver-haired man (grey suit)": not in the scene and looks do not match')
  })
  it('vaulmont (silver hair) is accepted', async () => {
    const r = await run('vaulmont')
    expect(r.castBeat).toMatchObject({ cast: [{ charKey: 'dec' }, { charKey: 'ines' }, { charKey: 'vaulmont' }] })
    expect(r.left.some((u) => /silver-haired/.test(u.text))).toBe(false)
  })
})
