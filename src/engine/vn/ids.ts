/**
 * Id conventions shared by the importer, the asset planner and the Ren'Py emitter.
 * Keys are Ren'Py-safe identifiers: lowercase ascii, digits and underscores, starting with a letter.
 */

import { createHash } from 'node:crypto'
import { transliterate } from '../../shared/translit'

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

/**
 * Text for loose comparison: no diacritics, lowercase, words separated by single spaces. Letters and digits of every script are kept (a
 * Cyrillic or Japanese name matches itself), so only punctuation and symbols separate words.
 */
export function normText(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * An ASCII slug of any text: transliterated (Cyrillic, Greek, kana, hangul ...), diacritics stripped, lower case, runs of other characters
 * turned into `sep`. When letters had no Latin form (Han, Thai ...) a short hash of the text is added (`red-1a2b3c`), so two different titles
 * never share a slug. `fallback` is the slug when nothing is left. `max` cuts the readable part.
 */
export function asciiSlug(text: string, o: { sep: '-' | '_'; fallback: string; max?: number }): string {
  const { latin, dropped } = transliterate(text.normalize('NFKC'))
  const trim = new RegExp(`^${o.sep}+|${o.sep}+$`, 'g')
  let base = stripDiacritics(latin)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, o.sep)
    .replace(trim, '')
  const cut = o.max ? (dropped ? o.max - 7 : o.max) : 0 // room for the hash
  if (cut) base = base.slice(0, cut).replace(trim, '')
  if (dropped === 0) return base || o.fallback
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 6)
  return `${base || o.fallback}${o.sep}${hash}`
}

/** A Ren'Py-safe key from a name: `Petra's House` -> `petra_s_house`, `Šime` -> `sime`, `Наташа` -> `natasha`. */
export function slugKey(name: string): string {
  const s = asciiSlug(name, { sep: '_', fallback: 'x' })
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
/** `cg_<key>`: a CG or an insert of the book's `images`. */
export const cgId = (key: string) => `cg_${key}`
/** `sfx_<key>` and `amb_<key>`: a sound effect and an ambience of the book's `sounds`. */
export const sfxId = (key: string) => `sfx_${key}`
export const ambId = (key: string) => `amb_${key}`
export const musicId = (i: number) => `music_${pad2(i)}`
export const voiceRefId = (charKeyOrNarrator: string) => `voice_${charKeyOrNarrator}`

/** `ch01.s01` */
export const sceneId = (chapterN: number, sceneIndex: number) => `ch${pad2(chapterN)}.s${pad2(sceneIndex)}`
/** `ch01.s01.b001` */
export const beatId = (scene: string, beatIndex: number) => `${scene}.b${pad3(beatIndex)}`
