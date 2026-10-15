/**
 * Id conventions shared by the importer, the asset planner and the Ren'Py emitter.
 * Keys are Ren'Py-safe identifiers: lowercase ascii, digits and underscores, starting with a letter.
 */

const pad = (n: number, width: number) => String(n).padStart(width, '0')
export const pad2 = (n: number) => pad(n, 2)
export const pad3 = (n: number) => pad(n, 3)

/** Lowercases and strips diacritics (č ć đ š ž included). */
export function stripDiacritics(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Text for loose comparison: no diacritics, lowercase, words separated by single spaces. */
export function normText(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A Ren'Py-safe key from a name: `Petra's House` -> `petra_s_house`, `Šime` -> `sime`. */
export function slugKey(name: string): string {
  const s = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!s) return 'x'
  return /^[a-z]/.test(s) ? s : `x_${s}`
}

/** `bg_<placeKey>_<timeKey>`; with no matched place the slug of the place text (at most 40 characters). */
export function backgroundId(placeKey: string | null, placeText: string, time: string | null): string {
  let place = placeKey
  if (!place) {
    place = placeText.trim() ? slugKey(placeText).slice(0, 40).replace(/_+$/, '') : 'unknown'
  }
  return `bg_${place}_${time ? slugKey(time) : 'any'}`
}

export const sheetId = (charKey: string) => `sheet_${charKey}`
export const spriteId = (charKey: string, expr: string) => `sprite_${charKey}_${expr}`
export const coverId = 'cover'
export const musicId = (i: number) => `music_${pad2(i)}`
export const voiceRefId = (charKeyOrNarrator: string) => `voice_${charKeyOrNarrator}`

/** `ch01.s01` */
export const sceneId = (chapterN: number, sceneIndex: number) => `ch${pad2(chapterN)}.s${pad2(sceneIndex)}`
/** `ch01.s01.b001` */
export const beatId = (scene: string, beatIndex: number) => `${scene}.b${pad3(beatIndex)}`
