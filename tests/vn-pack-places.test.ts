import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importPackBook, packHashOf, readPack } from '../src/engine/vn/pack'
import { backgroundId } from '../src/engine/vn/ids'
import { detectTime, matchPlace } from '../src/engine/vn/script'
import type { Lang } from '../src/shared/vn'

/**
 * The real soother book's SCENE place texts are not bible names; Scriptorium writes `placeKey: null` for them. VN Studio
 * owns the place matching: it must use the same `matchPlace` rule as the legacy importer so the existing background ids
 * (and therefore the 53 assets of the live project) are reused. The place names below are the live bible's.
 */
const PLACES = [
  { key: 'petra_s_house', name: "Petra's House", looks: 'A small cottage with a red door and a green garden.' },
  { key: 'bubble_gum_volcano', name: 'Bubble-gum Volcano', looks: 'A tall volcano that bubbles pink and blue gum.' },
  { key: 'lost_things_office', name: 'Lost Things Office', looks: 'A cozy office with wooden shelves of lost things.' },
  { key: 'singing_dragons_chorus', name: "Singing Dragons' Chorus", looks: "A grassy hill with a circle of standing stones." },
  { key: 'bouncing_mud_puddles', name: 'Bouncing Mud Puddles', looks: 'A field of brown mud puddles that bounce.' },
  { key: 'golden_cave', name: 'Golden Cave', looks: 'A large cave whose walls sparkle like gold.' },
  { key: 'sky_over_dragon_land', name: 'Sky over Dragon Land', looks: 'The green sky is full of fluffy clouds.' },
  { key: 'dragon_path', name: 'Path through Dragon Land', looks: 'A little winding stone road between candy-leaf trees.' }
]
const CASES: { placeText: string; time: string | null; placeKey: string; backgroundId: string }[] = [
  { placeText: "Petra's garden", time: 'morning', placeKey: 'petra_s_house', backgroundId: 'bg_petra_s_house_morning' },
  { placeText: "Petra's garden", time: 'evening', placeKey: 'petra_s_house', backgroundId: 'bg_petra_s_house_evening' },
  { placeText: 'Path through Dragon Land', time: 'morning', placeKey: 'dragon_path', backgroundId: 'bg_dragon_path_morning' },
  { placeText: 'Dragon Land, near a bubble-gum volcano', time: null, placeKey: 'bubble_gum_volcano', backgroundId: 'bg_bubble_gum_volcano_any' },
  { placeText: 'Inside the Lost Things Office', time: null, placeKey: 'lost_things_office', backgroundId: 'bg_lost_things_office_any' },
  { placeText: 'A stone path winding up to the Golden Cave, Dragon Land', time: 'afternoon', placeKey: 'golden_cave', backgroundId: 'bg_golden_cave_afternoon' },
  { placeText: 'The edge of the bouncing mud puddles, Dragon Land', time: 'afternoon', placeKey: 'bouncing_mud_puddles', backgroundId: 'bg_bouncing_mud_puddles_afternoon' },
  { placeText: 'The green sky over Dragon Land', time: 'afternoon', placeKey: 'sky_over_dragon_land', backgroundId: 'bg_sky_over_dragon_land_afternoon' }
]

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/** A minimal v2 pack whose scenes all have `placeKey: null` and a non-bible SCENE text. */
async function nullPlacePack(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vno-pack-places-'))
  dirs.push(root)
  const scenes = CASES.map((c, i) => ({
    id: `ch01.s${String(i + 1).padStart(2, '0')}`,
    placeKey: null,
    placeText: c.placeText,
    time: c.time,
    description: '',
    breakBefore: false,
    beats: [{ id: `ch01.s${String(i + 1).padStart(2, '0')}.b001`, type: 'narration' }]
  }))
  // an unmatched place keeps the text-based background id and warns
  scenes.push({
    id: 'ch01.s09',
    placeKey: null,
    placeText: 'Somewhere Else',
    time: null,
    description: '',
    breakBefore: false,
    beats: [{ id: 'ch01.s09.b001', type: 'narration' }]
  })
  const raw: Record<string, unknown> = {
    format: 'vn-pack',
    version: 2,
    book: { slug: 'places-test', format: 'visual-novel', kind: 'linear', primaryLang: 'en', style: 'warm' },
    characters: [],
    places: PLACES,
    chapters: [{ n: 1, isEnding: true, scenes }],
    puzzles: []
  }
  raw.packHash = packHashOf(raw)
  const packHash = raw.packHash as string
  const catalog = {
    format: 'vn-text',
    version: 2,
    lang: 'en' as Lang,
    packHash,
    title: 'Places Test',
    chapterTitles: { '1': 'Places' },
    sceneTitles: {},
    choiceTexts: {},
    endings: { '1': 'end' },
    characterNames: {},
    beats: Object.fromEntries(scenes.map((s) => [s.beats[0]!.id, 'A line.']))
  }
  await mkdir(path.join(root, 'vn', 'text'), { recursive: true })
  await writeFile(path.join(root, 'vn', 'pack.json'), JSON.stringify(raw, null, 2) + '\n')
  await writeFile(path.join(root, 'vn', 'text', 'en.json'), JSON.stringify(catalog, null, 2) + '\n')
  return root
}

describe('place matching when a pack leaves placeKey null', () => {
  it('resolves the live soother place texts to the same places and background ids as the legacy importer', async () => {
    const folder = await nullPlacePack()
    const loaded = await readPack(folder)
    expect(loaded.warnings).toEqual([])
    // the pure rule on its own, against the same bible places
    for (const c of CASES) expect(matchPlace(c.placeText, PLACES), c.placeText).toBe(c.placeKey)

    const pack = await importPackBook(folder)
    const scenes = pack.book.chapters[0]!.scenes
    expect(scenes.slice(0, CASES.length).map((s) => s.placeKey)).toEqual(CASES.map((c) => c.placeKey))
    expect(scenes.slice(0, CASES.length).map((s) => s.backgroundId)).toEqual(CASES.map((c) => c.backgroundId))
    // at least the two the lead called out explicitly
    expect(scenes[0]!.backgroundId).toBe('bg_petra_s_house_morning')
    expect(scenes[2]!.backgroundId).toBe('bg_dragon_path_morning')
    expect(backgroundId(scenes[0]!.placeKey, scenes[0]!.placeText, scenes[0]!.time)).toBe('bg_petra_s_house_morning')

    // no match: null placeKey, the legacy text-based background id, and a warning
    const unmatched = scenes[CASES.length]!
    expect(unmatched.placeKey).toBeNull()
    expect(unmatched.backgroundId).toBe('bg_somewhere_else_any')
    expect(pack.warnings.some((w) => /matches no place in vn\/pack\.json/.test(w) && /Somewhere Else/.test(w))).toBe(true)
  })

  it('keeps the time based background id for a matched place, and never changes the pack file', async () => {
    const folder = await nullPlacePack()
    const before = await readFile(path.join(folder, 'vn', 'pack.json'), 'utf8')
    const pack = await importPackBook(folder)
    expect(pack.book.chapters[0]!.scenes.map((s) => s.backgroundId)).toContain('bg_golden_cave_afternoon')
    expect(await readFile(path.join(folder, 'vn', 'pack.json'), 'utf8')).toBe(before)
  })

  // The live project was imported from the authored folder before packs existed. With placeKey null in its pack the
  // same matching must reproduce every background id it already has. Skipped where the project is not on this machine.
  const liveProject = path.join(process.env.USERPROFILE ?? '', 'VisualNovels', 'projects', 'the-soother-that-fell-into-dragon-land', 'vn.json')
  it.skipIf(!existsSync(liveProject))('reproduces every background id of the live soother project', async () => {
    const vn = JSON.parse(await readFile(liveProject, 'utf8')) as { places: typeof PLACES; chapters: { scenes: { id: string; placeKey: string | null; placeText: string; time: string | null; backgroundId: string }[] }[] }
    const rows = vn.chapters.flatMap((ch) => ch.scenes).map((sc) => {
      const key = sc.placeKey ?? matchPlace(sc.placeText, vn.places)
      return { id: sc.id, key, backgroundId: backgroundId(key, sc.placeText, detectTime(sc.time ?? '')) }
    })
    expect(rows.length).toBeGreaterThan(10)
    for (const [i, sc] of vn.chapters.flatMap((ch) => ch.scenes).entries()) {
      expect(rows[i]!.key, sc.id).toBe(sc.placeKey)
      expect(rows[i]!.backgroundId, sc.id).toBe(sc.backgroundId)
    }
  })
})
