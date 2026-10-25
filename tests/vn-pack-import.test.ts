import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectSettingsSchema } from '../src/shared/vn'
import { deriveAssets } from '../src/engine/assets/derive'
import { importBook } from '../src/engine/vn/import'
import {
  canonicalJson,
  catalogValueProblems,
  compareCatalogKeys,
  editionFromCatalog,
  expectedCatalogKeys,
  importPackBook,
  packHashOf,
  primaryEditionProblems,
  readCatalog,
  readPack,
  sha256
} from '../src/engine/vn/pack'
import type { VnBook } from '../src/shared/vn'

const fixture = path.join(__dirname, 'fixtures', 'books', 'soother-pack')
const tmpDirs: string[] = []
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/** A copy of the fixture a test may break. */
async function brokenCopy(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vno-pack-'))
  tmpDirs.push(root)
  const copy = path.join(root, 'soother-pack')
  await cp(fixture, copy, { recursive: true })
  return copy
}

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
const writeJson = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n')
const enCatalog = (folder: string) => path.join(folder, 'vn', 'text', 'en.json')

/**
 * The legacy importer's VnBook with the two contract-inherent differences normalized (contract §4/§8.4): the pack has
 * no display label on a line, and its `scene.description` is the richer prompt material Scriptorium writes (legacy
 * builds it from the SCENE line and props). Everything else must be identical.
 */
function forParity(book: VnBook): VnBook {
  const b = JSON.parse(JSON.stringify(book)) as VnBook
  for (const ch of b.chapters) {
    for (const sc of ch.scenes) {
      delete (sc as { description?: string }).description
      for (const beat of sc.beats) if (beat.type === 'line') delete (beat as { speakerLabel?: string }).speakerLabel
    }
  }
  return b
}

describe('the pack hash helpers', () => {
  it('canonicalizes object keys recursively, keeps array order and ignores packHash', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}')
    expect(canonicalJson({ x: [2, 1] })).toBe('{"x":[2,1]}')
    expect(packHashOf({ b: 2, a: 1, packHash: 'sha256:whatever' })).toBe(sha256('{"a":1,"b":2}'))
    expect(packHashOf({ a: 1, b: 2 })).toBe(sha256('{"a":1,"b":2}'))
  })

  it('hashes the authored files in the contract order, as the fixture says', async () => {
    const loaded = await readPack(fixture)
    expect(loaded.packHash).toBe('sha256:2a16692893b8724dc482af3207092356bf7373b889b8a436203dcfc48cb1c870')
    expect(loaded.computedHash).toBe(loaded.packHash)
    expect(loaded.sourceHash).toBe(loaded.pack.book.sourceHash)
    expect(loaded.warnings).toEqual([])
  })

  it('reports a pack edited after it was written and a stale sourceHash', async () => {
    const copy = await brokenCopy()
    const packFile = path.join(copy, 'vn', 'pack.json')
    const pack = await readJson(packFile)
    ;(pack.book as Record<string, unknown>).genre = 'Mystery'
    await writeJson(packFile, pack)
    const edited = await readPack(copy)
    expect(edited.warnings.some((w) => /edited after it was written/.test(w))).toBe(true)

    // an authored file changed: the pack is stale (sourceHash covers it)
    await writeFile(path.join(copy, 'chapters', 'ch-01.md'), '---\nkind: chapter\nn: 1\ntitle: The Soother\n---\n\nSCENE: Petra\'s House, morning\nChanged.\n')
    const stale = await readPack(copy)
    expect(stale.warnings.some((w) => /the pack is stale/.test(w))).toBe(true)
  })
})

describe('pack import', () => {
  it('produces the same VnBook and asset ids as the legacy folder import', async () => {
    const legacy = await importBook(fixture)
    const pack = await importPackBook(fixture)
    expect(forParity(pack.book)).toEqual(forParity(legacy.book))
    // the only difference: the contract's template carries no display text, so the label is the catalogue name
    const legacyLine = legacy.book.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'line')
    const packLine = pack.book.chapters[0]!.scenes[0]!.beats.find((b) => b.type === 'line')
    expect(legacyLine).toMatchObject({ speakerLabel: 'PETRA', speakerKey: 'petra' })
    expect(packLine).toMatchObject({ speakerLabel: 'Petra', speakerKey: 'petra' })

    const settings = projectSettingsSchema.parse({ slug: 'soother-pack', source: '', primaryLang: 'en' })
    expect(deriveAssets(pack.book, settings)).toEqual(deriveAssets(legacy.book, settings))
    // scene and beat ids are the pack's, unchanged
    expect(pack.book.chapters.flatMap((c) => c.scenes.map((s) => s.id))).toEqual(['ch01.s01', 'ch02.s01', 'ch03.s01'])
    expect(pack.book.chapters[0]!.scenes[0]!.beats.map((b) => b.id)).toEqual(['ch01.s01.b001', 'ch01.s01.b002', 'ch01.s01.b003', 'ch01.s01.b004', 'ch01.s01.b005'])
    // asset ids come from the template rules (cueKey / backgroundId)
    expect(pack.book.chapters.map((c) => c.scenes.map((s) => s.backgroundId))).toEqual([['bg_petra_s_house_morning'], ['bg_dragon_s_cave_night'], ['bg_petra_s_house_evening']])
    expect(pack.book.images?.map((i) => i.key)).toEqual(['soother_spinning_sky_above', 'tiny_dragon_curled_up', 'note_written_shaky_letters'])
    expect(pack.book.sounds?.map((s) => `${s.kind}:${s.key}`)).toEqual(['sfx:tiny_bell_chimes', 'ambience:wind_sunflowers'])
    const ch1b5 = pack.book.chapters[0]!.scenes[0]!.beats[4]!
    expect(ch1b5).toMatchObject({ sfx: 'tiny_bell_chimes', ambience: 'wind_sunflowers' })
    expect('image' in ch1b5).toBe(false)
    expect(pack.book.chapters[1]!.scenes[0]!.beats[5]).toMatchObject({ image: 'note_written_shaky_letters' })
  })

  it('writes the primary edition from the same catalogue and keeps a sceneTitles field', async () => {
    const pack = await importPackBook(fixture)
    expect(pack.edition.lang).toBe('en')
    expect(pack.edition.title).toBe(pack.book.title)
    expect(pack.edition.sceneTitles).toEqual({ 'ch01.s01': "Petra's House, morning", 'ch02.s01': "Dragon's Cave, night", 'ch03.s01': "Petra's House, evening" })
    expect(pack.edition.characterNames).toEqual({ petra: 'Petra', mango: 'Mango' })
    expect(pack.edition.endings[2]).toMatch(/^happy:/)
    expect(primaryEditionProblems(pack.book, pack.edition)).toEqual([])
    // a mismatch is reported with the file and the beat
    const broken = { ...pack.edition, beats: { ...pack.edition.beats, 'ch01.s01.b003': 'Something else.' } }
    expect(primaryEditionProblems(pack.book, broken)).toEqual([expect.stringMatching(/editions\/en\.json: beat ch01\.s01\.b003/)])
  })

  it('does not mutate the template: packHash and the raw object stay as written', async () => {
    const loaded = await readPack(fixture)
    const before = JSON.stringify(loaded.raw)
    const pack = await importPackBook(fixture)
    expect(JSON.stringify(loaded.raw)).toBe(before)
    expect(packHashOf(loaded.raw)).toBe(loaded.packHash)
    expect(pack.packHash).toBe(loaded.packHash)
    expect(pack.packVersion).toBe(2)
    expect(pack.sourceHash).toBe(loaded.pack.book.sourceHash)
    expect(pack.warnings).toEqual([])
  })

  it('rejects another language, a missing language and a catalogue for another pack', async () => {
    await expect(importPackBook(fixture, { lang: 'hr' })).rejects.toThrow(/the pack is en/)
    await expect(importPackBook(path.join(fixture, 'vn', 'text'), {})).rejects.toThrow(/no vn\/pack\.json/)
    const copy = await brokenCopy()
    const cat = await readJson(enCatalog(copy))
    cat.packHash = 'sha256:' + '0'.repeat(64)
    await writeJson(enCatalog(copy), cat)
    await expect(importPackBook(copy)).rejects.toThrow(/was made for pack/)
  })

  it('rejects a missing or extra key, and a bad value', async () => {
    const missing = await brokenCopy()
    const m = await readJson(enCatalog(missing))
    delete (m.beats as Record<string, string>)['ch01.s01.b003']
    await writeJson(enCatalog(missing), m)
    await expect(importPackBook(missing)).rejects.toThrow(/missing beat ch01\.s01\.b003/)

    const extra = await brokenCopy()
    const x = await readJson(enCatalog(extra))
    ;(x.beats as Record<string, string>)['ch01.s01.b999'] = 'A beat the pack does not have.'
    await writeJson(enCatalog(extra), x)
    await expect(importPackBook(extra)).rejects.toThrow(/unknown beat ch01\.s01\.b999/)

    const structural = await brokenCopy()
    const s = await readJson(enCatalog(structural))
    ;(s.beats as Record<string, string>)['ch01.s01.b003'] = 'SCENE: a label got translated'
    await writeJson(enCatalog(structural), s)
    await expect(importPackBook(structural)).rejects.toThrow(/starts with a structural label/)

    const multiline = await brokenCopy()
    const ml = await readJson(enCatalog(multiline))
    ;(ml.beats as Record<string, string>)['ch01.s01.b003'] = 'one line\nand another'
    await writeJson(enCatalog(multiline), ml)
    await expect(importPackBook(multiline)).rejects.toThrow(/is not a single line/)
  })

  it('rejects another pack version and checks unknown scene titles', async () => {
    const version = await brokenCopy()
    const p = await readJson(path.join(version, 'vn', 'pack.json'))
    p.version = 3
    await writeJson(path.join(version, 'vn', 'pack.json'), p)
    await expect(importPackBook(version)).rejects.toThrow(/version/)

    const scenes = await brokenCopy()
    const c = await readJson(enCatalog(scenes))
    ;(c.sceneTitles as Record<string, string>)['ch99.s99'] = 'A scene that is not in the pack'
    await writeJson(enCatalog(scenes), c)
    await expect(importPackBook(scenes)).rejects.toThrow(/unknown scene title ch99\.s99/)
  })

  it('accepts a catalogue without the optional fields (blurb, sceneTitles)', async () => {
    const copy = await brokenCopy()
    const c = await readJson(enCatalog(copy))
    delete c.blurb
    delete c.sceneTitles
    await writeJson(enCatalog(copy), c)
    const pack = await importPackBook(copy)
    expect(pack.edition.sceneTitles).toBeUndefined()
    expect(pack.book.title).toBe('The Soother Pack')
  })
})

describe('catalogue validation units', () => {
  it('lists the keys a book expects, including alias keys and puzzle ids', async () => {
    const pack = await importPackBook(fixture)
    const expected = expectedCatalogKeys(pack.book)
    expect([...expected.chapterTitles]).toEqual(['1', '2', '3'])
    expect([...expected.choiceTexts]).toEqual(['1:0', '1:1'])
    expect([...expected.endings]).toEqual(['2', '3'])
    expect([...expected.characterNames]).toEqual(['petra', 'mango'])
    expect(expected.beats.size).toBe(12)
    expect([...expected.scenes]).toEqual(['ch01.s01', 'ch02.s01', 'ch03.s01'])
    const catalog = await readCatalog(enCatalog(fixture))
    const diff = compareCatalogKeys(pack.book, catalog)
    expect(diff).toEqual({ missing: [], extra: [], missingBeats: [] })
    expect(catalogValueProblems(catalog)).toEqual([])
    expect(editionFromCatalog(catalog).lang).toBe('en')
  })

  it('treats scene titles as optional but not unknown scene ids', async () => {
    const pack = await importPackBook(fixture)
    const catalog = await readCatalog(enCatalog(fixture))
    const { sceneTitles: _drop, ...without } = catalog
    expect(compareCatalogKeys(pack.book, without)).toEqual({ missing: [], extra: [], missingBeats: [] })
    const unknown = { ...catalog, sceneTitles: { 'ch42.s01': 'elsewhere' } }
    expect(compareCatalogKeys(pack.book, unknown).extra).toEqual(['scene title ch42.s01'])
  })

  it('checks values: empty, multi-line and structural labels', async () => {
    const catalog = await readCatalog(enCatalog(fixture))
    expect(catalogValueProblems({ ...catalog, beats: { ...catalog.beats, 'ch01.s01.b003': '  ' } })).toEqual(['beat ch01.s01.b003 is empty'])
    expect(catalogValueProblems({ ...catalog, beats: { ...catalog.beats, 'ch01.s01.b003': 'CG: no' } })).toEqual([expect.stringMatching(/starts with a structural label/)])
    expect(catalogValueProblems({ ...catalog, beats: { ...catalog.beats, 'ch01.s01.b003': 'see ch01.s01.b002' } })).toEqual([expect.stringMatching(/contains a beat or scene id/)])
  })
})
