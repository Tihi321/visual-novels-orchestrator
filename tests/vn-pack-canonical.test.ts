import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { aliasIndex } from '../src/engine/vn/aliases'
import { importBook } from '../src/engine/vn/import'
import { importPackBook, packHashOf, readPack } from '../src/engine/vn/pack'
import { projectSettingsSchema } from '../src/shared/vn'
import type { VnBook } from '../src/shared/vn'
import { failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

const canonical = (name: string): string => path.join(__dirname, 'fixtures', 'books', `canonical-${name}`)
const CANONICAL = ['soother', 'choice', 'mystery-puzzle'] as const
const settings = projectSettingsSchema.parse({ slug: 'x', source: '', primaryLang: 'en' })

let env: VnEnv | undefined
const tmpDirs: string[] = []
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/**
 * The canonical hub fixtures differ from the legacy importer in these documented ways (contract §4/§8.4 and the
 * Scriptorium compiler's choices), so parity compares ids, text, beat kinds, background/asset ids, cues, speakers,
 * characters and places, and ignores only:
 *  - `scene.description` (the pack has the richer prompt material),
 *  - the synthesized `speakerLabel` and the line `expression` (the pack carries the bracket word or neutral explicitly;
 *    the legacy parser inherits the previous expression when a line has no bracket),
 *  - `chapter.summary` (the pack template has no summary field),
 *  - puzzle policy/verification and place `links` (the pack carries richer puzzle metadata than the legacy parser),
 *  - images/sounds no beat plays (a cue with no beat after it has no home in the pack; legacy kept its catalogue entry).
 */
function forCanonicalParity(book: VnBook): VnBook {
  const b = JSON.parse(JSON.stringify(book)) as VnBook
  delete (b as { warnings?: string[] }).warnings
  const usedImages = new Set<string>()
  const usedSounds = new Set<string>()
  for (const ch of b.chapters) {
    for (const sc of ch.scenes) {
      for (const beat of sc.beats) {
        if (beat.image) usedImages.add(beat.image)
        if (beat.sfx) usedSounds.add(`sfx:${beat.sfx}`)
        if (beat.ambience) usedSounds.add(`ambience:${beat.ambience}`)
      }
    }
  }
  for (const p of b.puzzles ?? []) {
    delete (p as { verified?: unknown }).verified
    delete (p as { onFail?: unknown }).onFail
    delete (p as { hints?: unknown }).hints
    for (const [id, link] of Object.entries(p.links ?? {})) if (link.type === 'place') delete (p.links as Record<string, unknown>)[id]
  }
  if (b.images) b.images = b.images.filter((i) => usedImages.has(i.key))
  if (b.sounds) b.sounds = b.sounds.filter((s) => usedSounds.has(`${s.kind}:${s.key}`))
  for (const ch of b.chapters) {
    delete (ch as { summary?: string }).summary
    for (const sc of ch.scenes) {
      delete (sc as { description?: string }).description
      for (const beat of sc.beats) {
        if (beat.type !== 'line') continue
        const line = beat as { speakerLabel?: string; expression?: string; rawExpression?: string }
        delete line.speakerLabel
        delete line.expression
        delete line.rawExpression
      }
    }
  }
  return b
}

describe('the canonical HUB-16 fixtures', () => {
  it('have a matching packHash and sourceHash (book.md is not in the source hash)', async () => {
    for (const name of CANONICAL) {
      const loaded = await readPack(canonical(name))
      expect(loaded.computedHash, name).toBe(loaded.packHash)
      expect(loaded.warnings, name).toEqual([])
      expect(loaded.sourceHash, name).toBe(loaded.pack.book.sourceHash)
    }
  })

  it('import to the same structure, text and asset ids as the legacy folder import', async () => {
    for (const name of CANONICAL) {
      const legacy = await importBook(canonical(name))
      const pack = await importPackBook(canonical(name))
      expect(forCanonicalParity(pack.book), name).toEqual(forCanonicalParity(legacy.book))
      const legacyIds = deriveAssets(legacy.book, settings).map((a) => a.id)
      const packIds = deriveAssets(pack.book, settings).map((a) => a.id)
      expect(packIds, name).toEqual(legacyIds)
      expect((await importPackBook(canonical(name))).book.chapters.flatMap((c) => c.scenes.map((s) => s.backgroundId))).toEqual(legacy.book.chapters.flatMap((c) => c.scenes.map((s) => s.backgroundId)))
    }
  })

  it('uses the pack scene.description as given', async () => {
    const pack = await importPackBook(canonical('soother'))
    const first = pack.book.chapters[0]!.scenes[0]!
    const raw = JSON.parse(await readFile(path.join(canonical('soother'), 'vn', 'pack.json'), 'utf8')) as { chapters: { scenes: { description: string }[] }[] }
    expect(first.description).toBe(raw.chapters[0]!.scenes[0]!.description)
    expect(first.description.length).toBeGreaterThan(0)
  })

  it('does not go stale when only book.md changes, and does when an authored script file changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vno-canonical-'))
    tmpDirs.push(root)
    const copy = path.join(root, 'soother')
    await cp(canonical('soother'), copy, { recursive: true })
    const before = await readPack(copy)
    await writeFile(path.join(copy, 'book.md'), (await readFile(path.join(copy, 'book.md'), 'utf8')) + '\nA cover note.\n')
    const afterBook = await readPack(copy)
    expect(afterBook.sourceHash).toBe(before.sourceHash)
    expect(afterBook.warnings.filter((w) => /stale/.test(w))).toEqual([])
    await writeFile(path.join(copy, 'chapters', 'ch-01.md'), (await readFile(path.join(copy, 'chapters', 'ch-01.md'), 'utf8')) + '\nPETRA: One more line.\n')
    const afterChapter = await readPack(copy)
    expect(afterChapter.warnings.some((w) => /the pack is stale/.test(w))).toBe(true)
  })

  it('uses aliasKey for the name tag, and aliasIndex still finds the reveal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vno-alias-'))
    tmpDirs.push(root)
    const copy = path.join(root, 'soother')
    await cp(canonical('soother'), copy, { recursive: true })
    const packFile = path.join(copy, 'vn', 'pack.json')
    const raw = JSON.parse(await readFile(packFile, 'utf8')) as Record<string, unknown>
    const chapters = raw.chapters as { n: number; scenes: { id: string; beats: { id: string; aliasKey?: string }[] }[] }[]
    const beat = chapters[0]!.scenes[0]!.beats.find((b) => b.id === 'ch01.s01.b003')!
    beat.aliasKey = 'petra#1'
    // the pack hash covers the template: recompute it after the edit, and point the catalogue at it
    raw.packHash = packHashOf(raw)
    await writeFile(packFile, JSON.stringify(raw, null, 2) + '\n')
    const catalogFile = path.join(copy, 'vn', 'text', 'en.json')
    const catalog = JSON.parse(await readFile(catalogFile, 'utf8')) as Record<string, unknown>
    catalog.packHash = raw.packHash
    await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n')

    const pack = await importPackBook(copy)
    const line = pack.book.chapters[0]!.scenes[0]!.beats.find((b) => b.id === 'ch01.s01.b003')!
    expect(line).toMatchObject({ type: 'line', speakerKey: 'petra', speakerLabel: 'the girl' })
    const char = pack.book.characters.find((c) => c.key === 'petra')!
    expect(aliasIndex(char, 'the girl')).toBe(1)
  })

  it('adds the canonical hr catalogue with missing and extra empty and no asset change', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(canonical('soother'))
    await svc.reconcileAssets(slug)
    const assetsBefore = (await svc.store.loadAssets(slug)).assets
    const idsBefore = assetsBefore.map((a) => a.id)
    const versionsBefore = JSON.stringify(assetsBefore.map((a) => ({ id: a.id, versions: a.versions, selected: a.selected, customFile: a.customFile })))
    const filesBefore = JSON.stringify(assetsBefore.map((a) => ({ id: a.id, file: svc.store.resolveAsset(slug, a) })))
    const bundle = path.join(__dirname, 'fixtures', 'packs', 'canonical-soother-hr')
    expect(existsSync(bundle)).toBe(true)

    await svc.addEdition(slug, bundle, 'hr')
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const report = await svc.alignReport(slug, 'hr')
    expect(report?.missing).toEqual([])
    expect(report?.extra).toEqual([])
    expect(report?.keyCount).toBe(34)
    expect(report?.packHash).toBe((await readPack(canonical('soother'))).packHash)
    expect((await svc.getEdition(slug, 'hr')).beats['ch01.s01.b003']).toBe("HR Pip will not stop crying.")
    expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en', 'hr'])

    const assetsAfter = (await svc.store.loadAssets(slug)).assets
    expect(assetsAfter.map((a) => a.id)).toEqual(idsBefore)
    expect(JSON.stringify(assetsAfter.map((a) => ({ id: a.id, versions: a.versions, selected: a.selected, customFile: a.customFile })))).toBe(versionsBefore)
    expect(JSON.stringify(assetsAfter.map((a) => ({ id: a.id, file: svc.store.resolveAsset(slug, a) })))).toBe(filesBefore)
    // the prompt metadata did not change either (no generation and no plan ran)
    expect(assetsAfter.map((a) => a.prompt)).toEqual(assetsBefore.map((a) => a.prompt))
  })

  it('re-imports a pack keeping asset ids, versions and files', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(canonical('soother'))
    await svc.reconcileAssets(slug)
    const before = (await svc.store.loadAssets(slug)).assets.map((a) => ({ id: a.id, versions: a.versions, selected: a.selected, customFile: a.customFile }))
    const jobsBefore = new Set<string>()
    for (const state of ['queued', 'running', 'done', 'failed'] as const) for (const id of await env.engine.jobs.ids(state)) jobsBefore.add(id)
    await svc.importProject(canonical('soother'))
    const jobsAfter: string[] = []
    for (const state of ['queued', 'running', 'done', 'failed'] as const) jobsAfter.push(...(await env.engine.jobs.ids(state)))
    expect(jobsAfter.filter((id) => !jobsBefore.has(id))).toEqual([])
    const after = (await svc.store.loadAssets(slug)).assets.map((a) => ({ id: a.id, versions: a.versions, selected: a.selected, customFile: a.customFile }))
    expect(after).toEqual(before)
    expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en'])
  })
})
