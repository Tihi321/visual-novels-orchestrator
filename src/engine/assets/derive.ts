import { FLOW_ENGINE, FLOW_MUSIC_ENGINE } from '../../shared/vn'
import type { AssetEntry, AssetKind, ImageEntry, ProjectSettings, SoundEntry, VnBook, VnScene } from '../../shared/vn'
import { ambId, cgId, coverId, musicId, normText, sfxId, sheetId, spriteId, voiceRefId } from '../vn/ids'

/** Asset ids: one place formats them (`vn/ids.ts`); this object keeps the names the asset code uses. */
export const assetIds = {
  sheet: sheetId,
  sprite: spriteId,
  cover: () => coverId,
  cg: cgId,
  sfx: sfxId,
  amb: ambId,
  music: musicId,
  voiceRef: voiceRefId
}
export const NARRATOR_KEY = 'narrator'

/** Generation sizes: landscape for backgrounds, CGs and the cover (the menu picture), portrait for sheets and sprites, square for an insert. */
export const LANDSCAPE = { w: 1664, h: 928 }
export const PORTRAIT = { w: 928, h: 1664 }
export const SQUARE = { w: 1024, h: 1024 }

/** The picture of the book that an asset id `cg_<key>` names. */
export const imageOfAsset = (book: Pick<VnBook, 'images'>, id: string): ImageEntry | undefined => book.images?.find((i) => cgId(i.key) === id)
/** The sound of the book that an asset id `sfx_<key>` or `amb_<key>` names. */
export const soundOfAsset = (book: Pick<VnBook, 'sounds'>, id: string): SoundEntry | undefined => book.sounds?.find((s) => (s.kind === 'sfx' ? sfxId(s.key) : ambId(s.key)) === id)

/** The framing words of a cover: the main menu shows it full screen with the buttons on the left. */
export const COVER_FRAMING = 'wide 16:9 key art, landscape composition, keep the left third calm for the menu, full-bleed artwork, no border, no frame, no text, no lettering'

/** The framing words of an insert (an object or a document shown small in the middle). */
export const INSERT_FRAMING = 'object or document close-up, centered, plain background'

export const DEFAULT_NEGATIVE = 'text, letters, words, watermark, signature, logo, blurry, low quality, deformed, extra limbs, extra fingers, border, frame, open book'

function stub(partial: Pick<AssetEntry, 'id' | 'kind' | 'engine' | 'size'> & { refs?: string[] }): AssetEntry {
  return {
    id: partial.id,
    kind: partial.kind,
    prompt: '',
    engine: partial.engine,
    seed: null,
    size: partial.size,
    ...(partial.refs ? { refs: partial.refs } : {}),
    versions: [],
    selected: null,
    source: 'generated',
    locked: false
  }
}

/**
 * The asset list a book needs, as stubs with empty prompts (the art-director fills them):
 * one background per distinct `scene.backgroundId`, one sheet per character that appears in a cast or a line,
 * one sprite per (character, expression) used in lines (plus `neutral` for every character shown in a cast beat),
 * a cover, `settings.music.tracks` music tracks, a CG or insert per `images` entry a beat shows, a sound effect or ambience per `sounds`
 * entry a beat or scene plays, and, only when voice is enabled, a voice reference per speaking character and the narrator.
 * Order is by first appearance, so the output is deterministic.
 */
export function deriveAssets(book: VnBook, settings: ProjectSettings): AssetEntry[] {
  const out: AssetEntry[] = []
  const backgrounds = new Set<string>()
  const castChars: string[] = []
  const speakers: string[] = []
  const appearing: string[] = []
  const spriteKeys = new Map<string, Set<string>>()
  const pictures: string[] = []
  const effects: string[] = []
  const ambiences: string[] = []
  const note = (list: string[], key: string) => {
    if (!list.includes(key)) list.push(key)
  }
  const useExpression = (charKey: string, expression: string) => {
    let set = spriteKeys.get(charKey)
    if (!set) spriteKeys.set(charKey, (set = new Set()))
    set.add(expression)
  }

  for (const chapter of book.chapters) {
    for (const scene of chapter.scenes) {
      if (scene.backgroundId) backgrounds.add(scene.backgroundId)
      if (scene.ambience) note(ambiences, scene.ambience)
      for (const beat of scene.beats) {
        if (beat.image) note(pictures, beat.image)
        if (beat.sfx) note(effects, beat.sfx)
        if (beat.ambience) note(ambiences, beat.ambience)
        if (beat.type === 'cast') {
          for (const c of beat.cast) {
            note(appearing, c.charKey)
            note(castChars, c.charKey)
            useExpression(c.charKey, 'neutral')
          }
        } else if (beat.type === 'line' && beat.speakerKey) {
          note(appearing, beat.speakerKey)
          note(speakers, beat.speakerKey)
          useExpression(beat.speakerKey, beat.expression)
        }
      }
    }
  }

  // an item of a puzzle that is a picture of the story (an insert: a weapon, a letter) is made too, even when no beat shows it
  for (const p of book.puzzles ?? []) for (const l of Object.values(p.links ?? {})) if (l.type === 'image' && book.images?.some((i) => i.key === l.key)) note(pictures, l.key)

  // the characters of a picture have sheets (they are its references)
  const imageEntries = pictures.flatMap((k) => book.images?.find((i) => i.key === k) ?? [])
  for (const img of imageEntries) for (const c of (img.characters ?? []).slice(0, 3)) if (book.characters.some((x) => x.key === c)) note(appearing, c)

  const art = settings.art
  // a Flow project makes every image with Flow, whatever the ComfyUI engines are
  const gen = art.provider === 'flow' ? FLOW_ENGINE : art.generator
  const edit = art.provider === 'flow' ? FLOW_ENGINE : art.editor
  for (const id of backgrounds) out.push(stub({ id, kind: 'background', engine: gen, size: { ...LANDSCAPE } }))
  for (const key of appearing) out.push(stub({ id: assetIds.sheet(key), kind: 'sheet', engine: gen, size: { ...PORTRAIT } }))
  for (const key of appearing) {
    for (const expression of spriteKeys.get(key) ?? []) {
      out.push(stub({ id: assetIds.sprite(key, expression), kind: 'sprite', engine: edit, size: { ...PORTRAIT }, refs: [assetIds.sheet(key)] }))
    }
  }
  for (const img of imageEntries) {
    const refs = (img.characters ?? []).filter((c) => book.characters.some((x) => x.key === c)).slice(0, 3).map((c) => assetIds.sheet(c))
    // a picture with characters is made by the edit engine from their sheets, one without by the generator
    out.push(stub({ id: assetIds.cg(img.key), kind: 'cg', engine: refs.length ? edit : gen, size: { ...(img.display === 'insert' ? SQUARE : LANDSCAPE) }, ...(refs.length ? { refs } : {}) }))
  }
  out.push(stub({ id: assetIds.cover(), kind: 'cover', engine: gen, size: { ...LANDSCAPE } }))
  for (let n = 1; n <= settings.music.tracks; n++) out.push(stub({ id: assetIds.music(n), kind: 'music', engine: settings.music.provider === 'flow' ? FLOW_MUSIC_ENGINE : settings.music.engine, size: null }))
  for (const k of effects) if (book.sounds?.some((s) => s.key === k && s.kind === 'sfx')) out.push(stub({ id: assetIds.sfx(k), kind: 'sfx', engine: settings.sound.sfxEngine ?? '', size: null }))
  for (const k of ambiences) if (book.sounds?.some((s) => s.key === k && s.kind === 'ambience')) out.push(stub({ id: assetIds.amb(k), kind: 'ambience', engine: settings.sound.ambienceEngine, size: null }))
  if (settings.voice.enabled) {
    const engine = settings.voice.engines[settings.primaryLang] ?? settings.voice.engines[book.primaryLang] ?? ''
    for (const key of speakers) out.push(stub({ id: assetIds.voiceRef(key), kind: 'voiceRef', engine, size: null }))
    out.push(stub({ id: assetIds.voiceRef(NARRATOR_KEY), kind: 'voiceRef', engine, size: null }))
  }
  return out
}

// ---- fallback prompts ----

const GENRE_MUSIC: Array<[RegExp, string]> = [
  [/fantasy|dragon|magic|fairy/i, 'whimsical harp and flute, storybook'],
  [/myster|detective|noir|crime/i, 'mysterious, muted strings, soft celesta'],
  [/roman|love/i, 'warm, tender, soft strings'],
  [/sci-?fi|space|cyber/i, 'soft synth pads, dreamy'],
  [/horror|gothic|ghost/i, 'quiet, eerie, low drones'],
  [/kids|children|bedtime|lullaby/i, 'lullaby-like, music box, gentle']
]

/**
 * The art style words every image prompt starts with, from the format, genre and art mode. The bible's `## Style` section is
 * NOT used: in a Scriptorium book it is a note on the writing style ("simple words, use SCENE and ON SCREEN ..."), not on the art.
 */
export function defaultStylePrompt(book: Pick<VnBook, 'format' | 'genre'>, pixel = false): string {
  if (pixel) return 'pixel art, 16-bit, limited palette, clean readable sprites'
  const genre = book.genre ?? ''
  if (book.format.startsWith('kids-')) return 'soft watercolor illustration, gentle warm colors, clean simple shapes, cute friendly characters'
  if (/myster|crime|noir|detective|horror|thriller|gothic/i.test(genre)) return 'moody digital illustration, visual novel art, muted palette, dramatic lighting, detailed'
  if (/fantasy|fairy|medieval|histor/i.test(genre)) return 'fantasy visual novel illustration, painterly, rich colors, detailed'
  if (/roman|love|slice/i.test(genre)) return 'soft anime visual novel illustration, pastel colors, gentle light'
  if (/sci-?fi|space|cyber/i.test(genre)) return 'clean sci-fi visual novel illustration, cool palette, crisp lines'
  return 'anime visual novel illustration, clean lines, soft colors'
}

/** The style prefix for a project: the user's `art.stylePrompt`, else the default for the format, genre and art mode. */
export function resolveStylePrompt(book: Pick<VnBook, 'format' | 'genre'>, settings: Pick<ProjectSettings, 'art'>): string {
  return settings.art.stylePrompt?.trim() || defaultStylePrompt(book, settings.art.style === 'pixel')
}

const VISUAL_WORDS =
  /\b(hair|braid|eyes?|wears?|wearing|dress|coat|raincoat|jacket|hat|cap|boots?|shoes?|jeans|shirt|onesie|skirt|cloak|robe|scarf|tall|small|tiny|big|chubby|wiry|round|skin|scales?|wings?|tail|horns?|claws?|beard|glasses|bow tie|freckles?|face|smile|fur|satchel|belt|years old|red|orange|green|blue|yellow|purple|brown|grey|gray|black|white|pink|golden|blonde|amber|silver)\b/i
/** The words of a text that name something visible (hair, colours, clothes ...): lower case, without repeats. */
export function visualWords(text: string | undefined): Set<string> {
  return new Set([...(text ?? '').matchAll(new RegExp(VISUAL_WORDS.source, 'gi'))].map((m) => m[0].toLowerCase()))
}

const PERSONALITY_WORDS =
  /\b(brave|quick to|loves?|likes?|hates?|fears?|afraid|favou?rite|friendly|curious|grumpy|kind|helpful|precise|shy|clever|noisy|giggly|funny|collector|guards|runs the|always|never|story|voice|says)\b/i

const sentences = (text: string): string[] => text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean)

/**
 * Keeps only what can be drawn: the sentences of a bible entry that name a visual feature (hair, clothes, colours, size, species
 * parts) and say nothing about character or habits ("She is brave, quick to fix mistakes ..." is dropped).
 */
export function visualLooks(text: string | undefined): string {
  if (!text) return ''
  return sentences(text)
    .filter((s) => VISUAL_WORDS.test(s) && !PERSONALITY_WORDS.test(s))
    .join(' ')
    .replace(/\.$/, '')
}

/** The sentences that do not mention a character of the book (an empty background must not describe who is in it). */
export function withoutCharacterSentences(text: string | undefined, book: Pick<VnBook, 'characters'>): string {
  if (!text) return ''
  const words = new Set<string>()
  for (const c of book.characters) {
    for (const w of normText(c.name).split(' ')) if (w.length > 2) words.add(w)
    words.add(c.key)
  }
  return sentences(text)
    .filter((s) => !normText(s).split(' ').some((w) => words.has(w)))
    .join(' ')
}

/** The framing words that keep an image model to one figure, or to an empty place. */
export const SHEET_FRAMING = 'single character, one full-body figure only, front view, standing, centered, plain white background'
export const BACKGROUND_FRAMING = 'empty environment, no people, no characters, no creatures, no animals'
export const spriteFraming = (expression: string): string =>
  `Show only this one character as a single full-body figure, centered, facing the viewer, ${expression} facial expression, plain pure white background, nothing else`

/** The style words for a kind of asset: an empty background must not be told about characters ("cute friendly characters" draws one). */
export function styleForKind(style: string, kind: AssetKind): string {
  return kind === 'background' ? style.split(',').filter((part) => !/characters?|people|figures?/i.test(part)).map((p) => p.trim()).join(', ') : style
}

function styleLine(book: VnBook, opts: { pixel?: boolean; stylePrompt?: string }): string {
  const style = opts.stylePrompt?.trim() || defaultStylePrompt(book, opts.pixel === true)
  return [style, book.genre?.trim()].filter(Boolean).join(', ')
}

/** The first scene with a beat that shows the picture `key`. */
function sceneShowing(book: VnBook, key: string): VnScene | undefined {
  for (const ch of book.chapters) for (const s of ch.scenes) if (s.beats.some((b) => b.image === key)) return s
  return undefined
}

function sceneOf(book: VnBook, backgroundId: string): VnScene | undefined {
  for (const ch of book.chapters) for (const s of ch.scenes) if (s.backgroundId === backgroundId) return s
  return undefined
}

function lookupChar(book: VnBook, key: string) {
  return book.characters.find((c) => c.key === key)
}

/** Splits a sprite id `sprite_<charKey>_<expression>` (the expression has no underscore). */
function splitSpriteId(id: string): { charKey: string; expression: string } {
  const rest = id.replace(/^sprite_/, '')
  const at = rest.lastIndexOf('_')
  return at < 0 ? { charKey: rest, expression: 'neutral' } : { charKey: rest.slice(0, at), expression: rest.slice(at + 1) }
}

/** The fixed negative prompt for a kind of asset. Audio has none. */
export function fallbackNegative(kind: AssetKind): string {
  if (kind === 'music' || kind === 'voiceRef' || kind === 'sfx' || kind === 'ambience') return ''
  if (kind === 'sheet' || kind === 'sprite') return `${DEFAULT_NEGATIVE}, character sheet, turnaround, model sheet, multiple views, collage, panels, labels, captions, multiple characters`
  if (kind === 'background') return `${DEFAULT_NEGATIVE}, person, people, character, creature, animal`
  return DEFAULT_NEGATIVE
}

/**
 * A deterministic English prompt built from the book (used when the art-director has not written one):
 * style prefix + bible looks / place looks + scene description. `opts.pixel` adds pixel-art wording.
 */
export function fallbackPrompt(asset: Pick<AssetEntry, 'id' | 'kind'>, book: VnBook, opts: { pixel?: boolean; stylePrompt?: string } = {}): string {
  const style = styleForKind(styleLine(book, opts), asset.kind)
  switch (asset.kind) {
    case 'background': {
      const scene = sceneOf(book, asset.id)
      const place = scene?.placeKey ? book.places.find((p) => p.key === scene.placeKey) : undefined
      const placeName = place?.name ?? scene?.placeText ?? asset.id.replace(/^bg_/, '').replace(/_/g, ' ')
      const time = scene?.time && scene.time !== 'any' ? `${scene.time} lighting` : ''
      return [style, BACKGROUND_FRAMING, placeName, withoutCharacterSentences(place?.looks, book), withoutCharacterSentences(scene?.description, book), time, 'wide landscape composition, full-bleed artwork filling the whole frame, no border, no frame, no text']
        .filter(Boolean)
        .join(', ')
    }
    case 'sheet': {
      const c = lookupChar(book, asset.id.replace(/^sheet_/, ''))
      return [style, SHEET_FRAMING, visualLooks(c?.looks) || c?.name].filter(Boolean).join(', ')
    }
    case 'sprite': {
      const { charKey, expression } = splitSpriteId(asset.id)
      const c = lookupChar(book, charKey)
      return ['Same character as the reference image', spriteFraming(expression), visualLooks(c?.looks)].filter(Boolean).join('. ')
    }
    case 'cover':
      return [style, 'single key-art illustration', book.title, book.coverBrief, COVER_FRAMING].filter(Boolean).join(', ')
    case 'cg': {
      const img = imageOfAsset(book, asset.id)
      if (!img) return [style, asset.id.replace(/^cg_/, '').replace(/_/g, ' ')].join(', ')
      if (img.display === 'insert') return [style, img.description, INSERT_FRAMING].filter(Boolean).join(', ')
      const scene = sceneShowing(book, img.key)
      const place = scene?.placeKey ? book.places.find((p) => p.key === scene.placeKey) : undefined
      const people = (img.characters ?? []).map((k) => visualLooks(lookupChar(book, k)?.looks)).filter(Boolean)
      return [style, img.description, ...people, withoutCharacterSentences(place?.looks, book), 'cinematic illustration, full-bleed artwork filling the whole frame, no border, no frame, no text'].filter(Boolean).join(', ')
    }
    case 'ambience': {
      const s = soundOfAsset(book, asset.id)
      return ['ambient soundscape', s?.description ?? asset.id.replace(/^amb_/, '').replace(/_/g, ' '), 'no melody, no drums, seamless loop'].join(', ')
    }
    case 'sfx':
      return soundOfAsset(book, asset.id)?.description ?? asset.id.replace(/^sfx_/, '').replace(/_/g, ' ')
    case 'music': {
      const tint = GENRE_MUSIC.find(([re]) => re.test(`${book.genre ?? ''} ${book.format} ${book.style}`))?.[1]
      const n = Number(asset.id.replace(/^music_/, '')) || 1
      return ['calm, gentle, soft piano and strings, ambient, slow, instrumental, no vocals', tint, n === 1 ? 'main menu theme' : `chapter theme ${n - 1}`]
        .filter(Boolean)
        .join(', ')
    }
    case 'voiceRef':
      return ''
  }
}
