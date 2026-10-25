import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveAssets } from '../src/engine/assets/derive'
import { generateAsset } from '../src/engine/assets/generate'
import type { GenerateContext } from '../src/engine/assets/generate'
import { pickChipSound } from '../src/engine/studios/chip-sound'
import { engineFor } from '../src/engine/vn/service'
import type { AssetEntry, ProjectSettings } from '../src/shared/vn'
import { mediaBook, settings } from './assets-fixtures'
import { FakeChiptune } from './studio-fakes'
import { FakeComfy } from './vn-helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'vno-chip-sfx-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const chipSettings = (sound: Record<string, unknown> = { sfxEngine: 'chiptune', ambienceEngine: 'chiptune' }) => settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', ...sound } } as never)
const stub = (id: string, s = chipSettings()): AssetEntry => deriveAssets(mediaBook(), s).find((a) => a.id === id)!
const ctx = (chiptune: FakeChiptune, comfy = new FakeComfy(), over: Partial<GenerateContext> = {}): GenerateContext => ({ book: mediaBook(), settings: chipSettings(), projectDir: dir, comfy, chiptune, ...over })

describe('pickChipSound', () => {
  it('matches the key first, then the description, and says when it guessed', () => {
    expect(pickChipSound('sfx', 'bell', 'a ship bell')).toEqual({ sound: 'chime', guessed: false })
    expect(pickChipSound('sfx', 'knock', 'someone at the oak door')).toEqual({ sound: 'door', guessed: false })
    expect(pickChipSound('sfx', 'sting', 'a loud thunder clap')).toEqual({ sound: 'thunder', guessed: false })
    expect(pickChipSound('sfx', 'zzz', 'something odd')).toEqual({ sound: 'blip', guessed: true })
    expect(pickChipSound('ambience', 'waves', 'waves on the pier')).toEqual({ sound: 'waves', guessed: false })
    expect(pickChipSound('ambience', 'bg', 'a crackling fireplace')).toEqual({ sound: 'fire', guessed: false })
    expect(pickChipSound('ambience', 'x', 'silence')).toEqual({ sound: 'drone', guessed: true })
  })
})

const pixelSettings = (over: Partial<ProjectSettings> = {}) => settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' }, ...over })

describe('sound engines', () => {
  it('a default illustrated project makes an sfx with the ambience (ACE-Step) engine', () => {
    const s = settings()
    expect(engineFor('sfx', s)).toBe('ace-step-v1-instrumental')
    expect(engineFor('ambience', s)).toBe('ace-step-v1-instrumental')
    const assets = deriveAssets(mediaBook(), s)
    expect(assets.find((a) => a.id === 'sfx_bell')!.engine).toBe('ace-step-v1-instrumental')
    expect(assets.find((a) => a.id === 'amb_waves')!.engine).toBe('ace-step-v1-instrumental')
  })

  it('a pixel project with no music provider makes an sfx with Chiptune Studio, unless a music provider is set', () => {
    expect(engineFor('sfx', pixelSettings())).toBe('chiptune')
    expect(deriveAssets(mediaBook(), pixelSettings()).find((a) => a.id === 'sfx_bell')!.engine).toBe('chiptune')
    // the music provider decides, not the art style on its own
    expect(engineFor('sfx', pixelSettings({ music: { engine: 'ace-step-v1-instrumental', tracks: 3, provider: 'comfy' } }))).toBe('ace-step-v1-instrumental')
    expect(engineFor('sfx', settings({ music: { engine: 'ace-step-v1-instrumental', tracks: 3, provider: 'chiptune' } }))).toBe('chiptune')
  })

  it('an explicit sfx engine is respected: chiptune, a custom workflow and "none"', () => {
    expect(engineFor('sfx', chipSettings())).toBe('chiptune')
    expect(engineFor('sfx', settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'custom:foley' } }))).toBe('custom:foley')
    expect(engineFor('sfx', settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'none' } }))).toBe('none')
  })

  it('the settings of the ambience are independent of the sfx engine', () => {
    expect(stub('sfx_bell').engine).toBe('chiptune')
    expect(stub('amb_waves').engine).toBe('chiptune')
    expect(stub('amb_waves', chipSettings({ sfxEngine: 'chiptune' })).engine).toBe('ace-step-v1-instrumental')
    const importOnly = settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'none' } })
    expect(deriveAssets(mediaBook(), importOnly).find((a) => a.id === 'sfx_bell')!.engine).toBe('none')
    expect(deriveAssets(mediaBook(), importOnly).find((a) => a.id === 'amb_waves')!.engine).toBe('ace-step-v1-instrumental')
  })
})

describe('generating sounds with Chiptune Studio', () => {
  it('an sfx calls compose_sfx with a file path in the asset folder and stores a one-shot version', async () => {
    const chip = new FakeChiptune()
    const comfy = new FakeComfy()
    const r = await generateAsset(ctx(chip, comfy), stub('sfx_bell'))
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(chip.calls.map((c) => c.tool)).toEqual(['compose_sfx', 'save_song', 'delete_song'])
    const args = chip.calls[0]!.args as { kind: string; sound: string; path: string; seconds?: number }
    expect(args).toMatchObject({ kind: 'sfx', sound: 'chime' })
    expect(args.seconds).toBeUndefined()
    expect(path.isAbsolute(args.path)).toBe(true)
    expect(r.version).toMatchObject({ n: 1, file: 'v1.ogg', engine: 'chiptune', songFile: 'v1.song', loopStartSec: null, loopEndSec: null })
    expect(existsSync(path.join(dir, 'assets', 'sfx_bell', 'v1.ogg'))).toBe(true)
    expect(r.version.warnings).toBeUndefined()
    expect(comfy.requests).toHaveLength(0)
  })

  it('an ambience calls compose_sfx in ambience mode and keeps the loop points', async () => {
    const chip = new FakeChiptune()
    const comfy = new FakeComfy()
    const r = await generateAsset(ctx(chip, comfy), stub('amb_waves'))
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(chip.calls[0]).toMatchObject({ tool: 'compose_sfx', args: { kind: 'ambience', sound: 'waves', seconds: 60 } })
    expect(r.version).toMatchObject({ file: 'v1.ogg', engine: 'chiptune', loopStartSec: 0, loopEndSec: 60 })
    expect(comfy.requests).toHaveLength(0)
  })

  it('a new version never overwrites the earlier file', async () => {
    const chip = new FakeChiptune()
    const first = await generateAsset(ctx(chip), stub('sfx_bell'))
    if (!first.ok || first.skipped) throw new Error('expected a version')
    const second = await generateAsset(ctx(chip), first.entry, { force: true })
    if (!second.ok || second.skipped) throw new Error('expected a version')
    expect(second.version.file).toBe('v2.ogg')
    expect(existsSync(path.join(dir, 'assets', 'sfx_bell', 'v1.ogg'))).toBe(true)
  })

  it('an unmatched sound uses a fallback and says so', async () => {
    const b = mediaBook()
    b.sounds![0]!.description = 'something odd'
    b.sounds![0]!.key = 'zzz'
    b.chapters[0]!.scenes[0]!.beats[1]!.sfx = 'zzz'
    const entry = deriveAssets(b, chipSettings()).find((a) => a.id === 'sfx_zzz')
    if (!entry) throw new Error('no sfx_zzz asset: the cue key in the book must follow')
    const chip = new FakeChiptune()
    const r = await generateAsset(ctx(chip, new FakeComfy(), { book: b }), entry)
    if (!r.ok || r.skipped) throw new Error(JSON.stringify(r))
    expect(chip.calls[0]!.args).toMatchObject({ sound: 'blip' })
    expect(r.version.warnings?.join(' ')).toMatch(/no Chiptune Studio sound matches "zzz": used blip/)
  })

  it('an imported (custom) or locked file is never overwritten', async () => {
    const chip = new FakeChiptune()
    const custom: AssetEntry = { ...stub('sfx_bell'), source: 'custom', locked: true }
    expect(await generateAsset(ctx(chip), custom)).toMatchObject({ ok: true, skipped: true })
    expect(await generateAsset(ctx(chip), { ...stub('amb_waves'), locked: true })).toMatchObject({ ok: true, skipped: true, reason: 'locked' })
    expect(chip.calls).toHaveLength(0)
  })

  it('without the studio it fails with the start hint', async () => {
    const chip = new FakeChiptune()
    chip.down = true
    const r = await generateAsset(ctx(chip), stub('sfx_bell'))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toContain('yarn build && yarn mcp')
    expect(await generateAsset(ctx(chip), stub('amb_waves'))).toMatchObject({ ok: false })
  })

  it('a default project generates its sfx with ACE-Step; "none" keeps it import-only', async () => {
    const chip = new FakeChiptune()
    const comfy = new FakeComfy()
    const plain = settings()
    const made = await generateAsset(ctx(chip, comfy, { settings: plain }), stub('sfx_bell', plain))
    if (!made.ok || made.skipped) throw new Error(JSON.stringify(made))
    expect(made.version).toMatchObject({ file: 'v1.mp3', engine: 'ace-step-v1-instrumental' })
    expect(comfy.requests[0]).toMatchObject({ engine: 'ace-step-v1-instrumental', seconds: 5 })
    const amb = await generateAsset(ctx(chip, comfy, { settings: plain }), stub('amb_waves', plain))
    expect(amb).toMatchObject({ ok: true, version: { engine: 'ace-step-v1-instrumental' } })
    expect(comfy.requests).toHaveLength(2)
    expect(chip.calls).toHaveLength(0)

    // the old behaviour is now opt-in: sound.sfxEngine "none" means the file is imported by hand
    const importOnly = settings({ sound: { ambienceEngine: 'ace-step-v1-instrumental', sfxEngine: 'none' } })
    const skipped = await generateAsset(ctx(chip, comfy, { settings: importOnly }), stub('sfx_bell', importOnly))
    expect(skipped).toMatchObject({ ok: true, skipped: true })
    if (skipped.ok && skipped.skipped) expect(skipped.reason).toMatch(/import a file/)
    expect(comfy.requests).toHaveLength(2)
    expect(chip.calls).toHaveLength(0)
  })
})
