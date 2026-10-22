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
import type { AssetEntry } from '../src/shared/vn'
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

describe('sound engines', () => {
  it('the default is unchanged: no sfx engine, ambience on the music engine, also for a pixel book', () => {
    for (const s of [settings(), settings({ art: { style: 'pixel', generator: 'z-image-turbo', editor: 'qwen-image-2.1-edit', review: false, bgRemoval: 'birefnet' } } as never)]) {
      expect(engineFor('sfx', s)).toBeNull()
      expect(engineFor('ambience', s)).toBe('ace-step-v1-instrumental')
      const assets = deriveAssets(mediaBook(), s)
      expect(assets.find((a) => a.id === 'sfx_bell')!.engine).toBe('')
      expect(assets.find((a) => a.id === 'amb_waves')!.engine).toBe('ace-step-v1-instrumental')
    }
  })

  it('"chiptune" is the engine of the sfx and ambience assets', () => {
    expect(engineFor('sfx', chipSettings())).toBe('chiptune')
    expect(stub('sfx_bell').engine).toBe('chiptune')
    expect(stub('amb_waves').engine).toBe('chiptune')
    expect(stub('amb_waves', chipSettings({ sfxEngine: 'chiptune' })).engine).toBe('ace-step-v1-instrumental')
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

  it('the default engines are unchanged: no engine skips the sfx, the ComfyUI engine makes the ambience', async () => {
    const chip = new FakeChiptune()
    const comfy = new FakeComfy()
    const plain = settings()
    expect(await generateAsset(ctx(chip, comfy, { settings: plain }), stub('sfx_bell', plain))).toMatchObject({ ok: true, skipped: true })
    const amb = await generateAsset(ctx(chip, comfy, { settings: plain }), stub('amb_waves', plain))
    expect(amb).toMatchObject({ ok: true, version: { engine: 'ace-step-v1-instrumental' } })
    expect(comfy.requests).toHaveLength(1)
    expect(chip.calls).toHaveLength(0)
  })
})
