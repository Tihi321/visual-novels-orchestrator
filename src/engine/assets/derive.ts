import { FLOW_ENGINE, FLOW_MUSIC_ENGINE, isPictureBook, resolveSfxEngine, resolveVoiceEngine } from '../../shared/vn'
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
 *
 * A picture book (D4) is simpler: every scene is a page, so its background id is the page illustration (`bg_ch01_s01`); there are no sprites,
 * expression variants or CGs, but every character that appears keeps a `sheet_<char>` as an internal reference (never drawn in the book), and a
 * page whose scene has characters is made by the edit engine from their sheets, the same rule a CG with characters uses.
 */
export function deriveAssets(book: VnBook, settings: ProjectSettings): AssetEntry[] {
  const out: AssetEntry[] = []
  const pictureBook = isPictureBook(book)
  const backgrounds = new Set<string>()
  /** A picture book background id -> the characters drawn into its page. */
  const pagePeople = new Map<string, string[]>()
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
      if (scene.backgroundId) {
        backgrounds.add(scene.backgroundId)
        if (pictureBook) pagePeople.set(scene.backgroundId, charactersOnPage(book, scene))
      }
      if (scene.ambience) note(ambiences, scene.ambience)
      for (const beat of scene.beats) {
        if (!pictureBook && beat.image) note(pictures, beat.image)
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
  if (!pictureBook) for (const p of book.puzzles ?? []) for (const l of Object.values(p.links ?? {})) if (l.type === 'image' && book.images?.some((i) => i.key === l.key)) note(pictures, l.key)

  // the characters of a picture have sheets (they are its references)
  const imageEntries = pictures.flatMap((k) => book.images?.find((i) => i.key === k) ?? [])
  if (!pictureBook) for (const img of imageEntries) for (const c of (img.characters ?? []).slice(0, 3)) if (book.characters.some((x) => x.key === c)) note(appearing, c)

  // every listed sound has an asset, also one no beat plays (the stage director may cue it, and a person may add one with `vno_sound_set`)
  for (const snd of book.sounds ?? []) note(snd.kind === 'sfx' ? effects : ambiences, snd.key)

  const art = settings.art
  // a Flow project makes every image with Flow, whatever the ComfyUI engines are
  const gen = art.provider === 'flow' ? FLOW_ENGINE : art.generator
  const edit = art.provider === 'flow' ? FLOW_ENGINE : art.editor
  for (const id of backgrounds) {
    const people = pictureBook ? (pagePeople.get(id) ?? []) : []
    // a picture-book page with characters is made by the edit engine from their sheets; a page without them by the generator
    const refs = people.slice(0, 3).map((k) => assetIds.sheet(k))
    out.push(stub({ id, kind: 'background', engine: refs.length ? edit : gen, size: { ...LANDSCAPE }, ...(refs.length ? { refs } : {}) }))
  }
  for (const key of appearing) out.push(stub({ id: assetIds.sheet(key), kind: 'sheet', engine: gen, size: { ...PORTRAIT } }))
  if (!pictureBook) {
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
  }
  out.push(stub({ id: assetIds.cover(), kind: 'cover', engine: gen, size: { ...LANDSCAPE } }))
  for (let n = 1; n <= settings.music.tracks; n++) out.push(stub({ id: assetIds.music(n), kind: 'music', engine: settings.music.provider === 'flow' ? FLOW_MUSIC_ENGINE : settings.music.engine, size: null }))
  for (const k of effects) if (book.sounds?.some((s) => s.key === k && s.kind === 'sfx')) out.push(stub({ id: assetIds.sfx(k), kind: 'sfx', engine: resolveSfxEngine(settings), size: null }))
  for (const k of ambiences) if (book.sounds?.some((s) => s.key === k && s.kind === 'ambience')) out.push(stub({ id: assetIds.amb(k), kind: 'ambience', engine: settings.sound.ambienceEngine, size: null }))
  if (settings.voice.enabled) {
    const engine = resolveVoiceEngine(settings, settings.primaryLang)
    for (const key of speakers) out.push(stub({ id: assetIds.voiceRef(key), kind: 'voiceRef', engine, size: null }))
    out.push(stub({ id: assetIds.voiceRef(NARRATOR_KEY), kind: 'voiceRef', engine, size: null }))
  }
  return out
}

/** The characters a picture-book page shows, in the order they enter the scene: the cast beats; a scene without one shows its line speakers. */
export function charactersOnPage(book: Pick<VnBook, 'characters'>, scene: Pick<VnScene, 'beats'>): string[] {
  const known = new Set(book.characters.map((c) => c.key))
  const out: string[] = []
  const add = (key: string) => {
    if (known.has(key) && !out.includes(key)) out.push(key)
  }
  for (const b of scene.beats) if (b.type === 'cast') for (const c of b.cast) add(c.charKey)
  if (!out.length) for (const b of scene.beats) if (b.type === 'line' && b.speakerKey) add(b.speakerKey)
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

/**
 * What can be drawn in an empty place: the sentences that do not mention a character of the book (an empty background must not
 * describe who is in it). A sentence that names one is not thrown away whole when a colon or semicolon splits it: a place description is
 * often one long sentence, "a salon in the Moreau house: panelled walls, a chandelier; warm light", where the name is only in its head
 * ("Moreau house", "Ines's atelier") and the rest is the place. Only the clauses with a name go.
 */
export function withoutCharacterSentences(text: string | undefined, book: Pick<VnBook, 'characters'>): string {
  if (!text) return ''
  const words = new Set<string>()
  for (const c of book.characters) {
    for (const w of normText(c.name).split(' ')) if (w.length > 2) words.add(w)
    words.add(c.key)
  }
  const named = (s: string): boolean => normText(s).split(' ').some((w) => words.has(w))
  const out: string[] = []
  for (const sentence of sentences(text)) {
    if (!named(sentence)) {
      out.push(sentence)
      continue
    }
    const kept = sentence.split(/(?<=[:;])\s+/).filter((clause) => !named(clause))
    if (kept.length) out.push(kept.join(' ').replace(/[:;,]\s*$/, '').replace(/([^.!?])$/, '$1.'))
  }
  return out.join(' ')
}

/** The framing words that keep an image model to one figure, or to an empty place. */
export const SHEET_FRAMING = 'single character, one full-body figure only, front view, standing, centered, plain white background'
export const BACKGROUND_FRAMING = 'empty environment, no people, no characters, no creatures, no animals'
/** The framing words of a picture-book page: the whole illustration shows the scene, with its characters drawn into it. */
export const PAGE_FRAMING = "children's picture book illustration, full-bleed artwork filling the whole page, no border, no frame, no text, no lettering, no speech bubbles"
export const spriteFraming = (expression: string): string =>
  `Show only this one character as a single full-body figure, centered, facing the viewer, ${expression} facial expression, plain pure white background, nothing else`

/** The style words for a kind of asset: an empty background must not be told about characters ("cute friendly characters" draws one). */
export function styleForKind(style: string, kind: AssetKind): string {
  return kind === 'background' ? style.split(',').filter((part) => !/characters?|people|figures?/i.test(part)).map((p) => p.trim()).join(', ') : style
}

/** One person drawn into a picture-book page: their name and looks (a page may show one; `peopleClause` needs two or three). */
export function personLine(book: Pick<VnBook, 'characters'>, key: string): string {
  const c = book.characters.find((x) => x.key === key)
  if (!c) return ''
  const looks = visualLooks(c.looks) || c.looks
  return looks.trim() ? `${c.name} (${looks.slice(0, 160).replace(/[.\s]+$/, '')})` : c.name
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

const POSITIONS: string[][] = [[], [], ['on the left', 'on the right'], ['on the left', 'in the middle', 'on the right']]

/**
 * What keeps a picture of two or three people from merging them: the number of different people, each one named with their looks and a place
 * in the picture (left to right, in the order of their sheets, which are the reference images in the same order), and a ban on repeating a
 * face. Empty for fewer than two characters of the book. The model can still fail to keep them apart: this is a prompt, not a guarantee.
 */
export function peopleClause(book: Pick<VnBook, 'characters'>, keys: string[]): string {
  const people = keys.slice(0, 3).flatMap((k) => book.characters.find((c) => c.key === k) ?? [])
  if (people.length < 2) return ''
  const where = POSITIONS[people.length]!
  const named = people.map((c, i) => `${where[i]}: ${c.name}${visualLooks(c.looks) ? ` (${visualLooks(c.looks).slice(0, 160).replace(/[.\s]+$/, '')})` : ''}`).join('; ')
  const order = people.map((c, i) => `image ${i + 1} is ${c.name}`).join(', ')
  return `${people.length === 2 ? 'two' : 'three'} different people, each with their own face, hair and clothes, none repeated: ${named} (unless the picture says otherwise). Reference images: ${order}; keep each person as in their own reference image`
}

/** Splits a sprite id `sprite_<charKey>_<expression>` (the expression has no underscore). */
function splitSpriteId(id: string): { charKey: string; expression: string } {
  const rest = id.replace(/^sprite_/, '')
  const at = rest.lastIndexOf('_')
  return at < 0 ? { charKey: rest, expression: 'neutral' } : { charKey: rest.slice(0, at), expression: rest.slice(at + 1) }
}

/** The fixed negative prompt for a kind of asset. Audio has none. */
export function fallbackNegative(kind: AssetKind, opts: { pictureBook?: boolean } = {}): string {
  if (kind === 'music' || kind === 'voiceRef' || kind === 'sfx' || kind === 'ambience') return ''
  if (kind === 'sheet' || kind === 'sprite') return `${DEFAULT_NEGATIVE}, character sheet, turnaround, model sheet, multiple views, collage, panels, labels, captions, multiple characters`
  if (kind === 'background') {
    if (opts.pictureBook) return `${DEFAULT_NEGATIVE}, page border, cut-out figures, stickers`
    return `${DEFAULT_NEGATIVE}, person, people, character, creature, animal`
  }
  return DEFAULT_NEGATIVE
}

/**
 * A deterministic English prompt built from the book (used when the art-director has not written one):
 * style prefix + bible looks / place looks + scene description. `opts.pixel` adds pixel-art wording.
 *
 * A picture-book page is not an empty background: it is one illustration of the scene with its characters drawn into it, so the place and the
 * scene description keep the people they mention, and the scene's cast is named with their looks and a place from left to right (`peopleClause`).
 */
export function fallbackPrompt(asset: Pick<AssetEntry, 'id' | 'kind'>, book: VnBook, opts: { pixel?: boolean; stylePrompt?: string } = {}): string {
  const pictureBook = isPictureBook(book)
  // a page keeps the style's character words: the illustration is of people, not of an empty place
  const style = pictureBook ? styleLine(book, opts) : styleForKind(styleLine(book, opts), asset.kind)
  switch (asset.kind) {
    case 'background': {
      const scene = sceneOf(book, asset.id)
      const place = scene?.placeKey ? book.places.find((p) => p.key === scene.placeKey) : undefined
      const placeName = place?.name ?? scene?.placeText ?? asset.id.replace(/^bg_/, '').replace(/_/g, ' ')
      const time = scene?.time && scene.time !== 'any' ? `${scene.time} lighting` : ''
      if (pictureBook) {
        const people = scene ? charactersOnPage(book, scene) : []
        const clause = peopleClause(book, people) || (people.length === 1 ? personLine(book, people[0]!) : '')
        return [style, placeName, place?.looks, scene?.description, clause, time, PAGE_FRAMING].filter((part) => part && String(part).trim()).join(', ')
      }
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
      const clause = peopleClause(book, img.characters ?? [])
      const people = clause ? [clause] : (img.characters ?? []).map((k) => visualLooks(lookupChar(book, k)?.looks)).filter(Boolean)
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
