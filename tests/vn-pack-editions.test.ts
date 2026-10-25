import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GameData } from '../src/engine/game/emit'
import { ProjectStore } from '../src/engine/vn/project'
import { readPack } from '../src/engine/vn/pack'
import { voiceLangsOf } from '../src/engine/voice/catalog'
import type { Edition } from '../src/shared/vn'
import { book, failures, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const packBook = book('soother-pack')
const hrBundle = path.join(__dirname, 'fixtures', 'packs', 'soother-pack-hr')
const hrCatalog = path.join(hrBundle, 'vn', 'text', 'hr.json')

const allJobIds = async (e: VnEnv): Promise<string[]> => {
  const out: string[] = []
  for (const state of ['queued', 'running', 'done', 'failed'] as const) out.push(...(await e.engine.jobs.ids(state)))
  return out
}
const taskOf = (id: string): string => id.split('--')[1] ?? ''

const gameDataPath = (e: VnEnv, slug: string): string => path.join(e.engine.vn.gameDir(slug), 'game', 'game-data.json')

/** A temp copy of the pack book with extra catalogues in vn/text (for vno_sync_editions). */
async function syncFolder(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vno-pack-sync-'))
  const copy = path.join(root, 'soother-pack')
  await cp(packBook, copy, { recursive: true })
  await cp(hrCatalog, path.join(copy, 'vn', 'text', 'hr.json'))
  return copy
}

describe('pack import in a project', () => {
  it('stores the pack metadata and the primary edition, and adds a bundle edition with no asset change or generation', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    const loaded = await readPack(packBook)
    const { settings } = await svc.store.loadSettings(slug)
    expect(settings.packHash).toBe('sha256:2a16692893b8724dc482af3207092356bf7373b889b8a436203dcfc48cb1c870')
    expect(settings.packVersion).toBe(2)
    expect(settings.sourceHash).toBe(loaded.pack.book.sourceHash)
    expect(settings.packDir).toBe(packBook)
    expect(settings.editions).toEqual(['en'])
    const primary = await svc.getEdition(slug, 'en')
    expect(primary.title).toBe('The Soother Pack')
    expect(primary.sceneTitles?.['ch01.s01']).toBe("Petra's House, morning")

    await svc.reconcileAssets(slug)
    const assetsBefore = await readFile(svc.store.file(slug, 'assets.json'), 'utf8')
    const idsBefore = (await svc.store.loadAssets(slug)).assets.map((a) => a.id)
    const jobsBefore = new Set(await allJobIds(env))

    await svc.addEdition(slug, hrBundle, 'hr')
    const { failed } = await waitIdle(env, slug)
    expect(failed, (await failures(env)).join(' | ')).toEqual([])
    const report = await svc.alignReport(slug, 'hr')
    expect(report).toMatchObject({ missing: [], extra: [], packHash: settings.packHash, packVersion: 2 })
    expect(report?.keyCount).toBe(25)
    const hr = await svc.getEdition(slug, 'hr')
    expect(hr.title).toBe('Paket umirivača')
    expect(hr.beats['ch01.s01.b003']).toBe('Danas ću pronaći umirivač.')
    expect(hr.sceneTitles?.['ch02.s01']).toBe('Zmajeva pećina, noć')
    expect(hr.characterNames).toEqual({ petra: 'Petra', mango: 'Mango' })
    expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en', 'hr'])

    // not one byte of assets.json changed, no new asset ids, and only the edition job was queued
    expect(await readFile(svc.store.file(slug, 'assets.json'), 'utf8')).toBe(assetsBefore)
    expect((await svc.store.loadAssets(slug)).assets.map((a) => a.id)).toEqual(idsBefore)
    const addedJobs = (await allJobIds(env)).filter((id) => !jobsBefore.has(id))
    expect(addedJobs.map(taskOf)).toEqual(['vn.edition.add'])
    // no alignment and no model: no edition-aligner job waits or ran
    expect(addedJobs.some((id) => id.includes('edition.align'))).toBe(false)
    expect(env.mock.calls.some((c) => c.meta?.task === 'vn.edition.align')).toBe(false)
    // the catalogue text never reached an asset prompt
    expect((await svc.store.loadAssets(slug)).assets.every((a) => !/Danas|umirivač|Petra/.test(a.prompt))).toBe(true)
  })

  it('accepts a bare catalogue file (not only a bundle) and keeps the pack hash check', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    await svc.addEdition(slug, hrCatalog)
    const { failed } = await waitIdle(env, slug)
    expect(failed).toEqual([])
    expect((await svc.getEdition(slug, 'hr')).beats['ch03.s01.b003']).toBe('Možda sutra.')
  })

  it('refuses a catalogue for another pack, the primary language, and a legacy project', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    const root = await mkdtemp(path.join(tmpdir(), 'vno-pack-bad-'))
    try {
      const other = JSON.parse(await readFile(hrCatalog, 'utf8')) as Record<string, unknown>
      other.packHash = 'sha256:' + '1'.repeat(64)
      const file = path.join(root, 'hr.json')
      await writeFile(file, JSON.stringify(other, null, 2))
      await expect(svc.addEdition(slug, file)).rejects.toThrow(/made for pack/)
      await expect(svc.addEdition(slug, hrCatalog, 'en')).rejects.toThrow(/is hr, not en/)
      const enCatalog = path.join(packBook, 'vn', 'text', 'en.json')
      await expect(svc.addEdition(slug, enCatalog)).rejects.toThrow(/primary language/)

      const legacy = await svc.importProject(book('linear-en'))
      await expect(svc.addEdition(legacy.slug, hrCatalog)).rejects.toThrow(/not imported from a pack/)
      await expect(svc.syncEditions(legacy.slug)).rejects.toThrow(/not imported from a pack/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects missing keys by default, allows them with force, and always rejects an unknown key', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    const root = await mkdtemp(path.join(tmpdir(), 'vno-pack-keys-'))
    try {
      const missing = JSON.parse(await readFile(hrCatalog, 'utf8')) as { beats: Record<string, string> }
      delete missing.beats['ch01.s01.b003']
      const missingFile = path.join(root, 'hr-missing.json')
      await writeFile(missingFile, JSON.stringify(missing, null, 2))
      await svc.addEdition(slug, missingFile, 'hr')
      await waitIdle(env, slug)
      expect(existsSync(svc.store.file(slug, 'editions', 'hr.json'))).toBe(false)
      expect((await failures(env)).join(' ')).toMatch(/missing 1 key\(s\):[\s\S]*- beat ch01\.s01\.b003/)

      // force: the missing beat stays in the primary language and the report says so
      await svc.addEdition(slug, missingFile, 'hr', { force: true })
      await waitIdle(env, slug)
      const report = await svc.alignReport(slug, 'hr')
      expect(report?.missing).toEqual(['ch01.s01.b003'])
      expect((await svc.getEdition(slug, 'hr')).beats['ch01.s01.b003']).toBeUndefined()

      const extra = JSON.parse(await readFile(hrCatalog, 'utf8')) as { beats: Record<string, string> }
      extra.beats['ch09.s01.b001'] = 'A beat that is not in the book.'
      const extraFile = path.join(root, 'hr-extra.json')
      await writeFile(extraFile, JSON.stringify(extra, null, 2))
      await svc.addEdition(slug, extraFile, 'hr', { force: true })
      await waitIdle(env, slug)
      expect((await failures(env)).join(' ')).toMatch(/keys the book does not have.*ch09\.s01\.b001/s)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('syncs every non-primary catalogue in vn/text', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const folder = await syncFolder()
    try {
      const { slug } = await svc.importProject(folder)
      const jobsBefore = new Set(await allJobIds(env))
      const r = await svc.syncEditions(slug, folder)
      expect(r.skipped).toEqual(['en'])
      expect(r.failed).toEqual([])
      expect(r.added.map((a) => a.lang)).toEqual(['hr'])
      expect(r.added[0]!.missing).toEqual([])
      expect((await svc.getEdition(slug, 'hr')).beats['ch01.s01.b001']).toMatch(/^Mala plava/)
      expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en', 'hr'])
      // syncing is direct: no job appears in the queue
      expect((await allJobIds(env)).filter((id) => !jobsBefore.has(id))).toEqual([])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})

describe('pack editions in the built game', () => {
  it('builds en+hr with the same art/audio paths, localized scene titles and Croatian runtime UI', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    await svc.addEdition(slug, hrBundle, 'hr')
    expect((await waitIdle(env, slug)).failed).toEqual([])
    await svc.reconcileAssets(slug)
    await svc.enqueueBuild(slug)
    expect((await waitIdle(env, slug)).failed).toEqual([])

    const gd = JSON.parse(await readFile(gameDataPath(env, slug), 'utf8')) as GameData
    expect(gd.languages.map((l) => l.code)).toEqual(['en', 'hr'])
    expect(gd.editions.en!.title).toBe('The Soother Pack')
    expect(gd.editions.hr!.title).toBe('Paket umirivača')
    expect(gd.editions.en!.beats['ch01.s01.b003']).toBe('Today I will find the soother.')
    expect(gd.editions.hr!.beats['ch01.s01.b003']).toBe('Danas ću pronaći umirivač.')
    expect(gd.editions.hr!.characterNames.petra).toBe('Petra')
    expect(gd.editions.hr!.chapterTitles[1]).toBe('Umirivač')
    expect(gd.editions.en!.sceneTitles?.['ch01.s01']).toBe("Petra's House, morning")
    expect(gd.editions.hr!.sceneTitles?.['ch01.s01']).toBe('Petrina kuća, jutro')
    expect(gd.editions.en!.choices['1:0']).toBe('Follow the soother')
    expect(gd.editions.hr!.choices['1:0']).toBe('Slijedi umirivač')
    expect(gd.editions.hr!.endings[2]).toMatch(/^sretan:/)
    // Croatian menu/puzzle strings; English is the source and the fallback
    expect(gd.editions.hr!.ui.Clues).toBe('Tragovi')
    expect(gd.editions.hr!.ui.Accuse).toBe('Optuži')
    expect(gd.editions.en!.ui).toEqual({})
    // art and audio are language-free: the editions hold text only and the asset maps are unchanged by the language
    expect(Object.keys(gd.editions.en!)).not.toContain('backgrounds')
    expect(Object.keys(gd.backgrounds)).toEqual(['bg_petra_s_house_morning', 'bg_dragon_s_cave_night', 'bg_petra_s_house_evening'])
    expect(Object.keys(gd.cgs)).toEqual(['soother_spinning_sky_above', 'tiny_dragon_curled_up', 'note_written_shaky_letters'])
    // no asset file is generated in this test, so the audio map is empty for both editions (it is global, never per language)
    expect(gd.audio.sfx).toEqual({})
    expect(gd.audio.ambience).toEqual({})
    // the runtime localizes the scene title pill and falls back to English for the other languages
    const player = await readFile(path.join(svc.gameDir(slug), 'game', 'player.js'), 'utf8')
    expect(player).toContain('currentEdition.sceneTitles')
    expect(player).toContain("ui('Clues', 'Clues')")
    expect(player).toContain("ui('Accuse', 'Accuse')")
    expect(player).toContain("ui('Submit', 'Submit')")
    expect(player).toContain("ui('Hint', 'Hint')")
    expect(player).toContain("ui('Give Up', 'Give Up')")
    const index = await readFile(path.join(svc.gameDir(slug), 'game', 'index.html'), 'utf8')
    expect(index).toContain('id="vno-scene-title"')
  })

  it('lint passes on the pack project and fails when vn.json primary text and editions/<primary>.json disagree', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    await svc.reconcileAssets(slug)
    await svc.enqueueBuild(slug)
    await waitIdle(env, slug)
    await svc.enqueueLint(slug)
    await waitIdle(env, slug)
    expect((await svc.detail(slug)).lint).toMatchObject({ ok: true, messages: [] })

    const edition = await svc.store.loadEdition(slug, 'en')
    const broken: Edition = { ...edition, beats: { ...edition.beats, 'ch01.s01.b003': 'A different primary line.' } }
    await svc.store.saveEdition(slug, broken)
    await svc.enqueueLint(slug)
    await waitIdle(env, slug)
    const lint = (await svc.detail(slug)).lint!
    expect(lint.ok).toBe(false)
    expect(lint.messages.join('\n')).toMatch(/editions\/en\.json: beat ch01\.s01\.b003 .*vn\.json/)
  })

  it('reports a stale pack edition when the project pack hash changes', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    await svc.addEdition(slug, hrBundle, 'hr')
    await waitIdle(env, slug)
    const { settings } = await svc.store.loadSettings(slug)
    await svc.store.saveSettings({ ...settings, packHash: 'sha256:' + '2'.repeat(64) })
    expect((await svc.staleEditions(slug)).map((s) => s.lang)).toEqual(['hr'])
    await svc.reconcileAssets(slug)
    await svc.enqueueBuild(slug)
    await waitIdle(env, slug)
    const build = (await svc.detail(slug)).build!
    expect(build.messages.join('\n')).toMatch(/edition hr was made for pack/)
  })
})

describe('legacy editions and voice languages', () => {
  it('keeps the legacy folder alignment path and its report', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(book('linear-en'))
    await svc.addEdition(slug, book('linear-hr'), 'hr')
    const { failed } = await waitIdle(env, slug)
    expect(failed).toEqual([])
    const report = await svc.alignReport(slug, 'hr')
    expect(report?.matched).toBeGreaterThan(5)
    expect(report?.packHash).toBeUndefined()
    expect((await svc.store.loadSettings(slug)).settings.editions).toEqual(['en', 'hr'])
  })

  it('includes every edition language in voice generation and the build voice source, not only voice.langs', async () => {
    env = await makeVnEnv({ sdk: false })
    const svc = env.engine.vn
    const { slug } = await svc.importProject(packBook)
    await svc.addEdition(slug, hrBundle, 'hr')
    await waitIdle(env, slug)
    await svc.updateSettings(slug, { voice: { enabled: true, langs: [] } })
    const { settings } = await svc.store.loadSettings(slug)
    expect(voiceLangsOf(settings)).toEqual(['en', 'hr'])
    const ids = await svc.enqueueTail(slug, 1, 'voice', [])
    expect(ids.filter((id) => id.includes('--vn.voice.generate--')).map((id) => id.split('--')[2])).toEqual(['en', 'hr'])
  })
})

describe('project edition files', () => {
  it('reads 3-letter and hyphenated edition codes, and ignores report and other files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vno-edition-langs-'))
    try {
      const store = new ProjectStore(dir)
      const editions = path.join(dir, 'projects', 'p', 'editions')
      await mkdir(editions, { recursive: true })
      for (const name of ['en.json', 'pt-br.json', 'ja.json', 'en.report.json', 'align-en.json', 'notes.txt']) await writeFile(path.join(editions, name), '{}\n')
      expect(await store.editionLangs('p')).toEqual(['en', 'ja', 'pt-br'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
