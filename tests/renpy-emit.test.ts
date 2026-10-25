import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chapterLabel, characterColor, emitScripts, translatableStrings, voicePath, type VoiceSource } from '../src/engine/game/emit'
import { defaultCues } from '../src/engine/game/stage'
import { applyStoryOps } from '../src/engine/vn/story'
import { bookLanguages, languageTable, languageWarnings } from '../src/engine/game/build'
import { registerLanguages, resetLanguages } from '../src/shared/languages'
import { fixturesDir, loadBook, loadEdition } from './fixtures/vn/load'

const snap = (name: string): string => path.join(fixturesDir, '__snapshots__', name)
const MUSIC = { music_01: 'audio/music_01.ogg', music_02: 'audio/music_02.ogg' }

function emitLinear(extra: Partial<Parameters<typeof emitScripts>[0]> = {}) {
  const book = loadBook('linear')
  const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
  return emitScripts({ book, editions: [loadEdition('linear', 'en')], cues, music: MUSIC, ...extra })
}

function emitChoice(extra: Partial<Parameters<typeof emitScripts>[0]> = {}) {
  const book = loadBook('choice')
  const cues = defaultCues(book, { musicIds: ['music_01', 'music_02'] })
  return emitScripts({ book, editions: [loadEdition('choice', 'en')], cues, music: MUSIC, ...extra })
}

describe('emitter snapshots: linear book', () => {
  const r = emitLinear()
  it('characters.rpy', async () => {
    await expect(r.files['characters.rpy']).toMatchFileSnapshot(snap('linear-characters.rpy'))
  })
  it('script.rpy', async () => {
    await expect(r.files['script.rpy']).toMatchFileSnapshot(snap('linear-script.rpy'))
  })
  it('ch01.rpy', async () => {
    await expect(r.files['ch01.rpy']).toMatchFileSnapshot(snap('linear-ch01.rpy'))
  })
  it('ch02.rpy', async () => {
    await expect(r.files['ch02.rpy']).toMatchFileSnapshot(snap('linear-ch02.rpy'))
  })
})

describe('emitter snapshots: choice book', () => {
  const r = emitChoice()
  it('ch01.rpy (menu)', async () => {
    await expect(r.files['ch01.rpy']).toMatchFileSnapshot(snap('choice-ch01.rpy'))
  })
  it('ch02.rpy (ending)', async () => {
    await expect(r.files['ch02.rpy']).toMatchFileSnapshot(snap('choice-ch02.rpy'))
  })
  it('script.rpy', async () => {
    await expect(r.files['script.rpy']).toMatchFileSnapshot(snap('choice-script.rpy'))
  })
})

/** The linear book with a CG, an insert, a sound effect, an ambience and scene music (the chapters play music_02). */
function mediaBook() {
  return applyStoryOps(loadBook('linear'), [
    { op: 'image.set', key: 'ledger', description: 'an open ledger', display: 'insert' },
    { op: 'image.set', key: 'farewell', description: 'Mara waves from the wall' },
    { op: 'sound.set', key: 'door', kind: 'sfx', description: 'a door creaks' },
    { op: 'sound.set', key: 'rain', kind: 'ambience', description: 'steady rain' },
    { op: 'scene.update', sceneId: 'ch01.s01', ambience: 'rain' },
    { op: 'beat.update', beatId: 'ch01.s01.b002', image: 'ledger', sfx: 'door' },
    { op: 'beat.update', beatId: 'ch01.s01.b005', image: 'farewell' },
    { op: 'beat.update', beatId: 'ch01.s01.b006', image: 'none' },
    { op: 'beat.update', beatId: 'ch01.s01.b007', image: 'farewell' },
    { op: 'scene.update', sceneId: 'ch01.s02', music: 'music_01', ambience: 'none' },
    { op: 'beat.update', beatId: 'ch01.s02.b002', image: 'none' },
    { op: 'scene.update', sceneId: 'ch02.s01', music: 'none' }
  ]).book
}
const SOUNDS = { sfx_door: 'audio/sfx_door.ogg', amb_rain: 'audio/amb_rain.ogg' }
function emitMedia(cues = defaultCues(mediaBook(), { musicIds: ['music_01', 'music_02'] })) {
  return emitScripts({ book: mediaBook(), editions: [loadEdition('linear', 'en')], cues, music: MUSIC, sounds: SOUNDS })
}

describe('emitter snapshots: media cues', () => {
  const r = emitMedia()
  it('ch01.rpy', async () => {
    await expect(r.files['ch01.rpy']).toMatchFileSnapshot(snap('media-ch01.rpy'))
  })
  it('ch02.rpy', async () => {
    await expect(r.files['ch02.rpy']).toMatchFileSnapshot(snap('media-ch02.rpy'))
  })
  it('shows and hides the picture, plays the sounds and the scene music', () => {
    const ch1 = r.files['ch01.rpy']!
    expect(ch1).toContain('show cg ledger as vn_cg at vn_insert zorder 50')
    expect(ch1).toContain('show cg farewell as vn_cg zorder 50')
    expect(ch1.match(/hide vn_cg/g)).toHaveLength(1) // the second hide comes after a new scene, which cleared the picture already
    expect(ch1).toContain('play sound "audio/sfx_door.ogg"')
    expect(ch1).toContain('play ambience "audio/amb_rain.ogg" fadein 1.5')
    expect(ch1).toContain('stop ambience fadeout 1.5')
    expect(ch1).toContain('play music "audio/music_01.ogg" fadein 2.0 loop if_changed')
    expect(r.files['ch02.rpy']).toContain('stop music fadeout 2.0')
    expect(r.used.cgs).toEqual(expect.arrayContaining([{ key: 'ledger', display: 'insert' }, { key: 'farewell', display: 'full' }]))
    expect(r.warnings.filter((w) => /music|sound|ambience/.test(w))).toEqual([]) // every track and sound has a file
  })
  it('the cues win over the story: scene music, ambience, the picture and the sound of a beat', () => {
    const cues = defaultCues(mediaBook(), { musicIds: ['music_01', 'music_02'] })
    cues.scenes['ch01.s02'] = { ...cues.scenes['ch01.s02']!, music: null }
    cues.scenes['ch01.s01'] = { ...cues.scenes['ch01.s01']!, ambience: null }
    cues.beats = { 'ch01.s01.b002': { image: null, sfx: 'door' }, 'ch01.s01.b005': { image: 'ledger' } }
    const ch1 = emitMedia(cues).files['ch01.rpy']!
    expect(ch1).not.toContain('play music "audio/music_01.ogg"')
    expect(ch1).toContain('stop music fadeout 2.0')
    expect(ch1).not.toContain('play ambience')
    const b005 = ch1.slice(ch1.indexOf('# beat:ch01.s01.b003'), ch1.indexOf('# beat:ch01.s01.b005'))
    expect(b005).toContain('show cg ledger as vn_cg at vn_insert zorder 50')
    expect(b005).not.toContain('show cg farewell')
    const b002 = ch1.slice(0, ch1.indexOf('# beat:ch01.s01.b002'))
    expect(b002).not.toContain('show cg')
    expect(b002).toContain('play sound "audio/sfx_door.ogg"')
  })
})

describe('emitter rules', () => {
  it('writes a beat comment above every say statement and records its line', () => {
    const r = emitLinear()
    for (const name of ['ch01.rpy', 'ch02.rpy']) {
      const lines = r.files[name]!.split('\n')
      for (const e of r.lineMap.filter((m) => m.file === name)) {
        expect(lines[e.line - 1]!.trim()).toBe(e.source)
        expect(lines[e.line - 2]!.trim()).toBe(`# beat:${e.beatId}`)
      }
    }
    expect(r.lineMap).toHaveLength(9)
  })

  it('linear chapters jump to the next one and the last one ends', () => {
    const r = emitLinear()
    expect(r.files['ch01.rpy']).toContain('jump ch_02')
    expect(r.files['ch02.rpy']).toContain('call screen the_end(_("Mara kept the lamp burning."))')
    expect(r.files['ch02.rpy']!.trimEnd().endsWith('return')).toBe(true)
  })

  it('choice chapters get a menu, an ending chapter gets the end screen', () => {
    const r = emitChoice()
    expect(r.files['ch01.rpy']).toContain('menu:\n        "Go down Bakery Street":\n            jump ch_02\n        "Go down River Street":\n            jump ch_03')
    expect(r.files['ch02.rpy']).toContain('call screen the_end(')
    expect(r.files['ch03.rpy']).toContain('call screen the_end(')
    expect(r.files['ch02.rpy']).not.toContain('jump ch_')
  })

  it('a choice that leads nowhere is skipped with a warning', () => {
    const book = loadBook('choice')
    book.chapters[0]!.choices.push({ text: 'Nowhere', to: 9 })
    const r = emitScripts({ book, editions: [], cues: defaultCues(book) })
    expect(r.files['ch01.rpy']).not.toContain('Nowhere')
    expect(r.warnings.join('\n')).toContain('chapter 9')
  })

  it('escapes the text and keeps the emphasis tags', () => {
    const ch01 = emitLinear().files['ch01.rpy']!
    expect(ch01).toContain('"The sea was calm. {i}Too{/i} calm, thought Mara."')
    expect(ch01).toContain('mara "Is that light [[still] on? It is {{not} 100% safe."')
    expect(ch01).toContain('tomo "She said \\"come back\\", {b}and{/b} I did."')
  })

  it('a speaker that is not in the bible gets an ad hoc character', () => {
    const r = emitLinear()
    expect(r.files['characters.rpy']).toContain('define extra_gull = Character(_("Gull")')
    expect(r.files['ch01.rpy']).toContain('extra_gull "Screech!"')
    expect(r.warnings.some((w) => w.includes('Gull'))).toBe(true)
  })

  it('shows sprites by slot, changes expression, hides on leave', () => {
    const ch01 = emitLinear().files['ch01.rpy']!
    expect(ch01).toContain('show mara worried at center')
    expect(ch01).toContain('show mara worried at left')
    expect(ch01).toContain('show tomo neutral at right')
    expect(ch01).toContain('show mara happy\n')
    // a scene change clears the screen, the next cast beat shows again; 4th cast member is dropped
    expect(ch01).toContain('show dog neutral at right')
    expect(ch01).not.toContain('nina')
  })

  it('a character leaving the cast is hidden', () => {
    const book = loadBook('linear')
    const scene = book.chapters[0]!.scenes[0]!
    scene.beats.splice(4, 0, { id: 'ch01.s01.b004x', type: 'cast', cast: [{ charKey: 'tomo' }] })
    const r = emitScripts({ book, editions: [], cues: defaultCues(book) })
    expect(r.files['ch01.rpy']).toContain('hide mara')
  })

  it('a scene break fades through black', () => {
    const ch01 = emitLinear().files['ch01.rpy']!
    expect(ch01).toContain('scene black\n    with vn_fade\n    scene bg lighthouse_any\n    with vn_dissolve')
  })

  it('plays the chapter music and sets the menu music', () => {
    const r = emitLinear()
    expect(r.files['ch01.rpy']).toContain('play music "audio/music_02.ogg" fadein 2.0 loop if_changed')
    expect(r.files['script.rpy']).toContain('define config.main_menu_music = "audio/music_01.ogg"')
  })

  it('no music at all when no track exists', () => {
    const book = loadBook('linear')
    const r = emitScripts({ book, editions: [], cues: defaultCues(book) })
    expect(r.files['ch01.rpy']).not.toContain('play music')
    expect(r.files['script.rpy']).not.toContain('main_menu_music')
  })

  it('collects the images it needs', () => {
    const r = emitLinear()
    expect(r.used.backgrounds.sort()).toEqual(['bg_harbour_wall_dusk', 'bg_lighthouse_any'])
    expect(r.used.sprites.map((s) => `${s.charKey}/${s.expression}`).sort()).toEqual([
      'dog/neutral', 'mara/happy', 'mara/neutral', 'mara/thinking', 'mara/worried', 'tomo/neutral', 'tomo/surprised'
    ])
  })

  it('labels and character colours are stable', () => {
    expect(chapterLabel(1)).toBe('ch_01')
    expect(chapterLabel(12)).toBe('ch_12')
    expect(characterColor('mara', false)).toBe(characterColor('mara', false))
    expect(characterColor('mara', true)).not.toBe(characterColor('mara', false))
  })

  it('lists the translatable strings with the edition text', () => {
    const book = loadBook('choice')
    const hr = loadEdition('choice', 'hr')
    const strings = translatableStrings(book)
    const choice = strings.find((s) => s.what === 'chapter 1 choice 0')!
    expect(choice.old).toBe('Go down Bakery Street')
    expect(choice.pick(hr)).toBe('Idi Pekarskom ulicom')
    expect(strings.find((s) => s.what === 'chapter 2 ending')!.pick(hr)).toContain('Petra je jela')
  })
})

describe('voice on and off', () => {
  const voice: VoiceSource = { has: (lang, id) => (id === 'ch01.s01.b003' ? `C:/clips/${lang}/${id}.mp3` : null) }

  it('off: nothing voice-related is emitted anywhere', () => {
    for (const r of [emitLinear(), emitChoice()]) {
      for (const content of Object.values(r.files)) {
        expect(content).not.toMatch(/\bvoice\b/i)
      }
    }
  })

  it('on: a voice statement before the say of a beat that has a clip, and a voice_tag per character', () => {
    const r = emitLinear({ voice })
    const ch01 = r.files['ch01.rpy']!
    expect(ch01).toContain('# beat:ch01.s01.b003\n    voice "voice/en/ch01.s01.b003.mp3"\n    mara "Is that')
    expect(ch01.match(/^\s*voice /gm)).toHaveLength(1)
    expect(r.files['characters.rpy']).toContain('voice_tag="mara"')
    // the line map points at the say line, not the voice line
    const e = r.lineMap.find((m) => m.beatId === 'ch01.s01.b003')!
    expect(ch01.split('\n')[e.line - 1]).toContain('mara "Is that')
  })

  it('voice path keeps the extension', () => {
    expect(voicePath('hr', 'ch01.s01.b001', 'x/y.ogg')).toBe('voice/hr/ch01.s01.b001.ogg')
    expect(voicePath('en', 'a', 'x/y')).toBe('voice/en/a.ogg')
  })
})

describe('language table', () => {
  it('English primary: None is the primary, croatian the edition', () => {
    const t = languageTable('en', bookLanguages('en', ['en', 'hr']))
    expect(t.list).toBe('[(None, "English"), ("croatian", "Hrvatski")]')
    expect(t.defaultLanguage).toBe('None')
  })
  it('Croatian primary: croatian is the default language', () => {
    const t = languageTable('hr', bookLanguages('hr', ['hr', 'en']))
    expect(t.list).toBe('[("croatian", "Hrvatski"), ("english", "English")]')
    expect(t.defaultLanguage).toBe('"croatian"')
  })
  it('one language', () => {
    expect(bookLanguages('en', ['en', 'en'])).toEqual(['en'])
  })
})

describe('language table for other languages', () => {
  it('German primary: german is the default, English and Croatian are editions', () => {
    const t = languageTable('de', bookLanguages('de', ['de', 'en', 'hr']))
    expect(t.list).toBe('[("german", "Deutsch"), ("english", "English"), ("croatian", "Hrvatski")]')
    expect(t.defaultLanguage).toBe('"german"')
  })
  it('warns only about menus without a UI table: every built-in language has one, and fonts and the right-to-left layout have their own checks', () => {
    expect(languageWarnings(['en', 'hr'])).toEqual([])
    expect(languageWarnings(['de', 'ja', 'he', 'ar'])).toEqual([])
    registerLanguages([{ code: 'pt-br', name: 'Brazilian Portuguese' }])
    expect(languageWarnings(['de', 'pt-br'])).toEqual(['the interface has no Brazilian Portuguese strings (no UI strings for pt-br; add them in config/languages.md)'])
    resetLanguages()
  })
})
