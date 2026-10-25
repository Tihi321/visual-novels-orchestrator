import { describe, expect, it } from 'vitest'
import { studioFor } from '../src/engine/vn/roundtrip'
import { ASSET_KINDS } from '../src/shared/vn'
import type { AssetKind } from '../src/shared/vn'

/**
 * Which studio edits which kind of asset. Audio (music, sound effects, ambiences) is opened in Chiptune Studio; every
 * image in Pixel Studio; a voice reference is uploaded, never opened. `openAssetInStudio` uses this mapping.
 */
describe('studioFor', () => {
  it('sends music, sfx and ambience to Chiptune Studio', () => {
    for (const kind of ['music', 'sfx', 'ambience'] as const) expect(studioFor(kind)).toBe('chiptune')
  })

  it('sends every image kind to Pixel Studio', () => {
    for (const kind of ['background', 'sheet', 'sprite', 'cover', 'cg'] as const) expect(studioFor(kind)).toBe('pixel')
  })

  it('refuses a voice reference: those are uploaded, not opened in a studio', () => {
    expect(() => studioFor('voiceRef')).toThrow(/upload a clip/)
  })

  it('covers every asset kind (a new kind must choose a studio here)', () => {
    const expected: Record<AssetKind, 'chiptune' | 'pixel' | 'throws'> = {
      background: 'pixel',
      sheet: 'pixel',
      sprite: 'pixel',
      cover: 'pixel',
      cg: 'pixel',
      music: 'chiptune',
      sfx: 'chiptune',
      ambience: 'chiptune',
      voiceRef: 'throws'
    }
    expect(Object.keys(expected).sort()).toEqual([...ASSET_KINDS].sort())
    for (const kind of ASSET_KINDS) {
      if (expected[kind] === 'throws') expect(() => studioFor(kind)).toThrow()
      else expect(studioFor(kind)).toBe(expected[kind])
    }
  })
})
