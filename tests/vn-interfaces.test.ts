import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '../src/engine/mcp/server'
import { buildTools } from '../src/engine/mcp/tools'
import { COMMAND_TYPES, isCommand } from '../src/shared/protocol'
import type { EngineEvent } from '../src/shared/protocol'
import { parseCliArgs, runCliWith } from '../src/engine/vncli'
import { book, makeVnEnv, waitIdle } from './vn-helpers'
import type { VnEnv } from './vn-helpers'

let env: VnEnv | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await env?.cleanup()
  env = undefined
})

describe('CLI arguments', () => {
  it('splits the command, the words and the options', () => {
    expect(parseCliArgs(['import', './book', '--lang', 'hr', '--run'])).toEqual({ command: 'import', args: ['./book'], flags: { lang: 'hr', run: true } })
    expect(parseCliArgs(['--', 'run', 'my-book', '--from=build', '--force'])).toEqual({ command: 'run', args: ['my-book'], flags: { from: 'build', force: true } })
    expect(parseCliArgs(['edition', 'add', 'slug', 'C:/books/hr', '--lang', 'hr'])).toEqual({ command: 'edition', args: ['add', 'slug', 'C:/books/hr'], flags: { lang: 'hr' } })
    expect(parseCliArgs(['generate', 's', '--only', 'bg_a,bg_b', '--kind', 'background', '--data', 'D:/x'])).toMatchObject({ command: 'generate', args: ['s'], flags: { only: 'bg_a,bg_b', kind: 'background', data: 'D:/x' } })
    expect(parseCliArgs(['android', 's', '--preflight']).flags).toEqual({ preflight: true })
    expect(parseCliArgs(['asset', 'regen', 's', 'sprite_a_happy', '--prompt', 'new words', '--seed', '5']).flags).toEqual({ prompt: 'new words', seed: '5' })
    expect(parseCliArgs([])).toEqual({ command: '', args: [], flags: {} })
  })

  it('runs commands against an engine', async () => {
    env = await makeVnEnv({ sdk: false })
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      lines.push(String(s))
      return true
    })
    const run = (...argv: string[]) => runCliWith(env!.engine, parseCliArgs(argv))
    expect(await run('import', book('linear-en'))).toBe(0)
    expect(await run('projects')).toBe(0)
    expect(await run('themes')).toBe(0)
    expect(await run('voice', 'lighthouse-letters')).toBe(0) // voice is off: says so
    expect(await run('generate', 'lighthouse-letters', '--only', 'no_such_asset').catch((e: Error) => e.message)).toMatch(/no asset matches/)
    expect(await run('run', 'lighthouse-letters', '--from', 'art')).toBe(0)
    expect(await run('lint', 'lighthouse-letters')).toBe(3) // skipped: no Ren'Py SDK
    const text = lines.join('')
    expect(text).toContain('project lighthouse-letters')
    expect(text).toContain('classic-dark')
    expect(text).toContain('voice is off for this project')
    expect(text).toContain('pipeline run 1 from art')
    expect(text).toContain('lint skipped')
    expect(await run('asset', 'lock', 'lighthouse-letters', 'cover')).toBe(0)
    expect((await env.engine.vn.listAssets('lighthouse-letters')).find((a) => a.id === 'cover')?.locked).toBe(true)
    expect(await run('asset', 'replace', 'lighthouse-letters', 'cover', path.join(env.dir, 'nope.png')).catch((e: Error) => e.message)).toMatch(/no such file/)
  }, 60_000)
})

describe('protocol commands', () => {
  it('lists every VN command as a known command type', () => {
    for (const t of ['listSourceBooks', 'importProject', 'runPipeline', 'regenerateAsset', 'replaceAsset', 'pickAssetVersion', 'buildGame', 'lintGame', 'androidBuild', 'listThemes', 'comfyStatus', 'setVoiceRef', 'generateVoice']) {
      expect(COMMAND_TYPES).toContain(t)
      expect(isCommand({ type: t })).toBe(true)
    }
    expect(isCommand({ type: 'rm -rf' })).toBe(false)
  })

  it('answers queries with events and reports errors as command.error', async () => {
    env = await makeVnEnv({ sdk: false })
    const e = env.engine
    const last = <T extends EngineEvent['type']>(type: T) => env!.events.filter((x): x is Extract<EngineEvent, { type: T }> => x.type === type).at(-1)
    await e.handleCommand({ type: 'previewImport', source: book('soother') })
    expect(last('import.preview')?.preview).toMatchObject({ slug: 'the-soother-that-fell-into-dragon-land', kind: 'choice', chapters: 7, detected: { lang: 'en' } })
    await e.handleCommand({ type: 'importProject', source: book('linear-hr'), lang: 'hr' })
    const done = last('import.done')!
    expect(done.preview.detected.lang).toBe('hr')
    expect(last('project.updated')?.slug).toBe(done.slug)
    await e.handleCommand({ type: 'listProjects' })
    expect(last('projects.listed')?.projects.map((p) => p.slug)).toEqual([done.slug])
    await e.handleCommand({ type: 'getProject', slug: done.slug })
    const detail = last('project.loaded')!.project
    expect(detail.book.primaryLang).toBe('hr')
    expect(detail.resolvedTheme).toBe('classic-dark')
    await e.handleCommand({ type: 'updateProjectSettings', slug: done.slug, patch: { theme: 'noir', art: { style: 'pixel', palette: 'pico-8' } } })
    await e.handleCommand({ type: 'getProject', slug: done.slug })
    expect(last('project.loaded')!.project.settings).toMatchObject({ theme: 'noir', art: { style: 'pixel', palette: 'pico-8' } })
    // null clears an optional art setting
    await e.handleCommand({ type: 'updateProjectSettings', slug: done.slug, patch: { art: { palette: null, stylePrompt: 'x' } } })
    await e.handleCommand({ type: 'getProject', slug: done.slug })
    const cleared = last('project.loaded')!.project.settings.art
    expect(cleared.palette).toBeUndefined()
    expect(cleared.stylePrompt).toBe('x')
    expect(cleared.style).toBe('pixel')
    // the Ren'Py config: read, write (a missing SDK is a warning), a bad resolution is an error
    await e.handleCommand({ type: 'getRenpyConfig' })
    expect(last('renpy.config')!.resolution).toBe('1920x1080')
    await e.handleCommand({ type: 'saveRenpyConfig', sdkPath: path.join(env!.dir, 'no-sdk-here'), imageFormat: 'png' })
    const saved = last('renpy.config')!
    expect(saved).toMatchObject({ imageFormat: 'png', sdkFound: false })
    expect(saved.sdkPath).toContain('no-sdk-here')
    expect(saved.warning).toMatch(/not found/)
    await e.handleCommand({ type: 'saveRenpyConfig', resolution: 'big' })
    expect(last('command.error')!.message).toMatch(/resolution/)
    await e.handleCommand({ type: 'listAssets', slug: done.slug })
    const assets = last('assets.listed')!.assets
    expect(assets.length).toBeGreaterThan(5)
    expect(assets.every((a) => a.fileRel === null)).toBe(true)
    await e.handleCommand({ type: 'listThemes' })
    const themes = last('themes.listed')!.themes
    expect(themes.map((t) => t.name)).toEqual(expect.arrayContaining(['classic-dark', 'storybook', 'parchment', 'noir', 'pixel-retro']))
    expect(themes[0]!.previewCss).toContain('.vnp-textbox')
    await e.handleCommand({ type: 'listEngines' })
    const engines = last('engines.listed')!
    expect(engines.image.map((x) => x.id)).toContain('qwen-image-2.1')
    expect(engines.audio.length).toBeGreaterThan(0)
    expect(engines.palettes).toContain('pico-8')
    await e.handleCommand({ type: 'listCustomWorkflows' })
    expect(last('workflows.listed')!.workflows).toEqual([expect.objectContaining({ name: 'chatterbox-multilingual', kind: 'audio', languages: expect.arrayContaining(['en']) })])
    // a lock and a replace announce the asset
    await e.handleCommand({ type: 'lockAsset', slug: done.slug, id: assets[0]!.id })
    expect(last('asset.updated')?.asset).toMatchObject({ id: assets[0]!.id, locked: true })
    const png = path.join(env.dir, 'x.png')
    await writeFile(png, Buffer.from('89504e470d0a1a0a', 'hex'))
    await e.handleCommand({ type: 'replaceAsset', slug: done.slug, id: assets[1]!.id, file: png })
    expect(last('asset.updated')?.asset).toMatchObject({ id: assets[1]!.id, source: 'custom', locked: true })
    expect(last('asset.updated')?.asset.fileRel).toBe(`assets/${assets[1]!.id}/custom.png`)

    await e.handleCommand({ type: 'getProject', slug: 'nope' })
    expect(last('command.error')).toMatchObject({ command: 'getProject', slug: 'nope' })
    await e.handleCommand({ type: 'getProject', slug: '../etc' })
    expect(last('command.error')?.message).toMatch(/invalid project slug/)

    // the pipeline reports its steps
    await e.handleCommand({ type: 'unlockAsset', slug: done.slug, id: assets[0]!.id })
    await e.handleCommand({ type: 'runPipeline', slug: done.slug, from: 'art' })
    await waitIdle(env, done.slug)
    const steps = env.events.filter((x): x is Extract<EngineEvent, { type: 'pipeline.progress' }> => x.type === 'pipeline.progress' && x.slug === done.slug)
    expect(new Set(steps.map((s) => s.step))).toEqual(new Set(['art', 'music', 'generate', 'stage', 'build', 'lint']))
    expect(steps.filter((s) => s.step === 'generate').some((s) => s.status.status === 'running' && s.status.total)).toBe(true)

    // only an explicit delete removes a project
    await e.handleCommand({ type: 'deleteProject', slug: done.slug })
    expect(last('project.deleted')?.slug).toBe(done.slug)
    await e.handleCommand({ type: 'listProjects' })
    expect(last('projects.listed')?.projects).toEqual([])
  }, 60_000)
})

describe('MCP server', () => {
  /** An SDK client connected to the MCP server of the engine's service through in-memory streams (the transport the stdio mode uses). */
  async function connect(opts: Parameters<typeof buildTools>[1] = {}): Promise<Client> {
    const server = createMcpServer({ tools: buildTools(env!.engine.vn, opts) })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: 't', version: '1' })
    await client.connect(b)
    return client
  }
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text

  it('initialises, lists the tools and calls one', async () => {
    env = await makeVnEnv({ sdk: false })
    const client = await connect()
    expect(client.getServerVersion()).toMatchObject({ name: 'vn-studio' })
    expect(client.getInstructions()).toMatch(/Kokoro voices read English only/)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names.slice(0, 11)).toEqual(['vno_list_books', 'vno_import', 'vno_list_projects', 'vno_run_pipeline', 'vno_status', 'vno_asset_list', 'vno_asset_replace', 'vno_asset_regen', 'vno_build', 'vno_lint', 'vno_add_edition'])
    for (const n of ['vno_get_project', 'vno_update_settings', 'vno_wait', 'vno_asset_generate', 'vno_renpy_config_set', 'vno_stop_now']) expect(names).toContain(n)
    expect(new Set(names).size).toBe(names.length)
    expect(tools.find((t) => t.name === 'vno_import')!.inputSchema.properties).toHaveProperty('source')

    const imported = await client.callTool({ name: 'vno_import', arguments: { source: book('linear-en') } })
    expect(JSON.parse(text(imported))).toMatchObject({ slug: 'lighthouse-letters', preview: { chapters: 3 } })
    expect(imported.structuredContent).toMatchObject({ slug: 'lighthouse-letters' })
    const listed = await client.callTool({ name: 'vno_list_projects', arguments: {} })
    expect((listed.structuredContent as { projects: { slug: string }[] }).projects.map((p) => p.slug)).toEqual(['lighthouse-letters'])
    expect(await client.callTool({ name: 'vno_status', arguments: { slug: 'nope' } })).toMatchObject({ isError: true })
    expect(text(await client.callTool({ name: 'vno_run_pipeline', arguments: { slug: 'lighthouse-letters', from: 'bogus' } }))).toMatch(/from must be one of/)
    expect(await client.callTool({ name: 'vno_asset_list', arguments: {} })).toMatchObject({ isError: true })
    expect(await client.callTool({ name: 'vno_nothing', arguments: {} })).toMatchObject({ isError: true })
    expect(await client.callTool({ name: 'vno_delete_project', arguments: { slug: 'lighthouse-letters' } })).toMatchObject({ isError: true }) // needs confirm: true
    expect(await client.callTool({ name: 'vno_pause_all', arguments: {} })).toMatchObject({ isError: true }) // no queue switches given

    const guide = await client.readResource({ uri: 'vn-studio://guide' })
    expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' })
    expect((guide.contents[0] as { text: string }).text).toMatch(/supertonic:F1/)
    await client.close()
  })

  it('reads and changes a project through the new tools', async () => {
    env = await makeVnEnv({ sdk: false })
    const client = await connect({ control: env.engine.mcpControl() })
    await env.engine.vn.importProject(book('linear-en'))
    const slug = 'lighthouse-letters'
    const got = await client.callTool({ name: 'vno_get_project', arguments: { slug } })
    expect(got.structuredContent).toHaveProperty('project')
    const upd = await client.callTool({ name: 'vno_update_settings', arguments: { slug, theme: 'noir' } })
    expect((upd.structuredContent as { settings: { theme: string } }).settings.theme).toBe('noir')
    const themes = (await client.callTool({ name: 'vno_themes', arguments: {} })).structuredContent as { themes: { name: string }[] }
    expect(themes.themes.map((t) => t.name)).toContain('noir')
    expect(((await client.callTool({ name: 'vno_get_edition', arguments: { slug, lang: 'en' } })).structuredContent as { edition: unknown }).edition).toBeTruthy()
    expect((await client.callTool({ name: 'vno_pause_all', arguments: {} })).structuredContent).toEqual({ paused: true })
    expect(env.engine.factory.paused).toBe(true)
    expect((await client.callTool({ name: 'vno_resume_all', arguments: {} })).structuredContent).toEqual({ paused: false })
    expect(env.engine.factory.paused).toBe(false)
    await client.close()
  })

  it('builds a project through the tools', async () => {
    env = await makeVnEnv({ sdk: false })
    const client = await connect({ waitTimeoutMs: 30_000 })
    await env.engine.vn.importProject(book('linear-en'))
    const res = await client.callTool({ name: 'vno_build', arguments: { slug: 'lighthouse-letters' } })
    const out = JSON.parse(text(res)) as { waited: boolean; build: { ok: boolean; theme: string; placeholders: string[] } }
    expect(out.waited).toBe(true)
    expect(out.build).toMatchObject({ ok: true, theme: 'noir' })
    expect(out.build.placeholders.length).toBeGreaterThan(3)
    await client.close()
  }, 60_000)
})
