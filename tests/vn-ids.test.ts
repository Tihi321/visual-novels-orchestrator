import { describe, expect, it } from 'vitest'
import { backgroundId, beatId, coverId, musicId, sceneId, sheetId, slugKey, spriteId, voiceRefId } from '../src/engine/vn/ids'

describe('id helpers', () => {
  it('slugKey strips diacritics and is Ren\'Py safe', () => {
    expect(slugKey('Čaković Đuro')).toBe('cakovic_duro')
    expect(slugKey('Šime Žurić Ćosić')).toBe('sime_zuric_cosic')
    expect(slugKey("Petra's House")).toBe('petra_s_house')
    expect(slugKey('  Golden   Cave!! ')).toBe('golden_cave')
    expect(slugKey('7th Floor')).toBe('x_7th_floor')
    expect(slugKey('')).toBe('x')
    expect(slugKey('Crème brûlée')).toBe('creme_brulee')
  })

  it('builds asset ids', () => {
    expect(backgroundId('harbour_wall', 'The harbour wall', 'dusk')).toBe('bg_harbour_wall_dusk')
    expect(backgroundId('golden_cave', 'x', null)).toBe('bg_golden_cave_any')
    expect(backgroundId(null, 'Grassy hill with standing stones, Dragon Land', 'day')).toBe('bg_grassy_hill_with_standing_stones_dragon_day')
    expect(backgroundId(null, '', null)).toBe('bg_unknown_any')
    expect(sheetId('mara')).toBe('sheet_mara')
    expect(spriteId('mara', 'worried')).toBe('sprite_mara_worried')
    expect(coverId).toBe('cover')
    expect(musicId(3)).toBe('music_03')
    expect(voiceRefId('narrator')).toBe('voice_narrator')
  })

  it('pads scene and beat ids', () => {
    expect(sceneId(1, 2)).toBe('ch01.s02')
    expect(beatId(sceneId(12, 1), 7)).toBe('ch12.s01.b007')
  })
})
