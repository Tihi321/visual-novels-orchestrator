import { describe, expect, it } from 'vitest'
import { emitScripts } from '../src/engine/renpy/emit'
import { defaultCues } from '../src/engine/renpy/stage'
import { deriveAssets } from '../src/engine/assets/derive'
import { applyStoryOps, validateBook } from '../src/engine/vn/story'
import { loadBook, loadEdition } from './fixtures/vn/load'
import { settings } from './assets-fixtures'

const MUSIC = { music_01: 'audio/music_01.ogg', music_02: 'audio/music_02.ogg' }

function withCues() {
  const book = loadBook('linear')
  const sceneId = book.chapters[0]!.scenes[0]!.id
  const beatId = book.chapters[0]!.scenes[0]!.beats[2]!.id
  const { book: b2 } = applyStoryOps(book, [
    { op: 'image.set', key: 'ledger', description: 'an open ledger', display: 'insert' },
    { op: 'sound.set', key: 'door', kind: 'sfx', description: 'a door creaks' },
    { op: 'sound.set', key: 'rain', kind: 'ambience', description: 'steady rain' },
    { op: 'beat.update', beatId, image: 'ledger', sfx: 'door' },
    { op: 'scene.update', sceneId, ambience: 'rain' }
  ])
  return { book: b2, beatId }
}

describe('media cues', () => {
  it('a book with catalogues and cues validates', () => {
    const { book } = withCues()
    expect(validateBook(book).errors).toEqual([])
  })

  it('an unknown cue key is an error', () => {
    const { book, beatId } = withCues()
    const bad = structuredClone(book)
    for (const s of bad.chapters.flatMap((c) => c.scenes)) for (const b of s.beats) if (b.id === beatId) b.image = 'nope'
    expect(validateBook(bad).errors.join('\n')).toMatch(/nope/)
  })

  it('derives cg and sound assets', () => {
    const { book } = withCues()
    const ids = deriveAssets(book, settings()).map((a) => a.id)
    expect(ids).toContain('cg_ledger')
    expect(ids).toContain('sfx_door')
    expect(ids).toContain('amb_rain')
  })

  it('emits the picture, the sound and the ambience', () => {
    const { book } = withCues()
    const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
    const r = emitScripts({
      book,
      editions: [loadEdition('linear', 'en')],
      cues,
      music: MUSIC,
      sounds: { sfx_door: 'audio/sfx_door.ogg', amb_rain: 'audio/amb_rain.ogg' }
    })
    const ch = r.files['ch01.rpy']!
    expect(ch).toContain('show cg ledger as vn_cg at vn_insert zorder 50')
    expect(ch).toContain('play sound "audio/sfx_door.ogg"')
    expect(ch).toContain('play ambience "audio/amb_rain.ogg" fadein 1.5')
    expect(r.used.cgs).toEqual([{ key: 'ledger', display: 'insert' }])
  })

  it('a sound with no file is skipped with a warning', () => {
    const { book } = withCues()
    const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
    const r = emitScripts({ book, editions: [loadEdition('linear', 'en')], cues, music: MUSIC })
    expect(r.files['ch01.rpy']).not.toContain('play sound')
    expect(r.warnings.join('\n')).toMatch(/door/)
  })
})
