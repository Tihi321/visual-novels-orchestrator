import { describe, expect, it } from 'vitest'
import { chipFor, fallbackChipPlan, mergeChipPlan } from '../src/engine/studios/chip-plan'
import { CHIPS, projectSettingsSchema } from '../src/shared/vn'

const base = fallbackChipPlan('music_01', { genreText: 'kids bedtime' })

describe('ps1 and dreamcast chips', () => {
  it('are chips of the project settings', () => {
    expect(CHIPS.slice(0, 5)).toEqual(['nes', 'gb', 'genesis', 'snes', 'pce'])
    for (const chip of ['ps1', 'dreamcast']) expect(projectSettingsSchema.parse({ slug: 'x', source: 'x', primaryLang: 'en', music: { chip } }).music.chip).toBe(chip)
    expect(projectSettingsSchema.safeParse({ slug: 'x', source: 'x', primaryLang: 'en', music: { chip: 'amiga' } }).success).toBe(false)
  })

  it('mergeChipPlan keeps them and the synth moods, and clamps the tempo by mood', () => {
    expect(mergeChipPlan({ chip: 'ps1', mood: 'darkwave', bpm: 100 }, base)).toMatchObject({ chip: 'ps1', mood: 'darkwave', bpm: 100 })
    expect(mergeChipPlan({ chip: 'dreamcast', mood: 'outrun', bpm: 300 }, base)).toMatchObject({ chip: 'dreamcast', mood: 'outrun', bpm: 118 })
    expect(mergeChipPlan({ mood: 'synthwave', bpm: 112 }, base).bpm).toBe(112)
    expect(mergeChipPlan({ mood: 'calm', bpm: 300 }, base).bpm).toBe(100)
    expect(mergeChipPlan({ mood: 'heavy-metal', bpm: 300 }, base)).toMatchObject({ mood: base.mood, bpm: 100 })
  })

  it('a synth book gets dreamwave on the Dreamcast chip, a 90s book the PS1 chip, a user chip wins', () => {
    const synth = { genreText: 'neon 80s synthwave', seconds: 100 }
    expect(fallbackChipPlan('music_01', synth)).toMatchObject({ mood: 'dreamwave', chip: 'dreamcast', bpm: 80 })
    expect(['music_01', 'music_02', 'music_03', 'music_04', 'music_05', 'music_06'].map((id) => fallbackChipPlan(id, synth).mood)).toEqual(['dreamwave', 'synthwave', 'darkwave', 'dreamwave', 'ambient', 'dreamwave'])
    expect(fallbackChipPlan('music_02', synth).bpm).toBe(96)
    expect(fallbackChipPlan('music_01', { genreText: '90s coming of age' }).chip).toBe('ps1')
    expect(fallbackChipPlan('music_01', { genreText: '90s coming of age' }).mood).toBe('peaceful')
    expect(chipFor({ chip: 'nes', genreText: 'neon synthwave' })).toBe('nes')
    expect(chipFor({ palette: 'gameboy', genreText: 'neon synthwave' })).toBe('gb')
  })

  it('C9: a kids or picture-book work gets the gm chip unless the project sets a chip or the art is pixel', () => {
    expect(chipFor({ genreText: 'kids bedtime' })).toBe('gm')
    expect(chipFor({ genreText: 'cozy fantasy', presentation: 'picture-book' })).toBe('gm')
    expect(chipFor({ genreText: 'children picture book', chip: 'snes' })).toBe('snes')
    expect(chipFor({ genreText: 'kids bedtime', artStyle: 'pixel' })).toBe('snes')
    expect(chipFor({ presentation: 'picture-book', artStyle: 'pixel', palette: 'gameboy' })).toBe('gb')
    expect(chipFor({ genreText: 'a quiet novel', presentation: 'visual-novel' })).toBe('snes')
    // the gm plan gives each track its own mood, texture and tempo
    const plans = ['music_01', 'music_02', 'music_03', 'music_04'].map((id) => fallbackChipPlan(id, { genreText: 'kids bedtime', presentation: 'picture-book' }))
    expect(plans.every((p) => p.chip === 'gm')).toBe(true)
    expect(new Set(plans.map((p) => p.mood)).size).toBe(4)
    expect(new Set(plans.map((p) => p.texture)).size).toBe(4)
    expect(mergeChipPlan({ mood: 'playful', bpm: 300, texture: 'march', form: 'ABA', instruments: { M4: 'gm.lead.clarinet', M5: 'snes.flute.soft' } }, plans[1]!)).toMatchObject({ chip: 'gm', mood: 'playful', bpm: 128, texture: 'march', form: 'ABA', instruments: { M4: 'gm.lead.clarinet' } })
  })

  it('a book that is not synth or 90s keeps exactly the plan it had', () => {
    expect(fallbackChipPlan('music_01', { genreText: 'mystery detective', seconds: 100 })).toEqual({ mood: 'mysterious-calm', chip: 'snes', bpm: 72, key: 'C', bars: 32 })
    expect(fallbackChipPlan('music_02', { genreText: 'mystery detective', seconds: 100 })).toEqual({ mood: 'peaceful', chip: 'snes', bpm: 66, key: 'F', bars: 28 })
    expect(fallbackChipPlan('music_01', { genreText: 'kids bedtime', chip: 'snes', seconds: 100 })).toEqual({ mood: 'lullaby', chip: 'snes', bpm: 72, key: 'C', bars: 32 })
    expect(fallbackChipPlan('music_02', { genreText: 'a quiet novel', seconds: 100 })).toEqual({ mood: 'ambient', chip: 'snes', bpm: 66, key: 'F', bars: 28 })
    expect(fallbackChipPlan('music_01', { genreText: 'space sci-fi cyber', seconds: 100 })).toMatchObject({ mood: 'ambient', chip: 'snes' })
  })
})
