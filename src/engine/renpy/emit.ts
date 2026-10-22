import path from 'node:path'
import type { Edition, Lang, VnBeat, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { aliasIndex } from '../vn/aliases'
import { ambId, sfxId } from '../vn/ids'
import { renpyPlainString, renpyString, renpyText, slugify } from './escape'
import { bgImageName, cgImageName, pickColor, spriteImageName, type UsedImages } from './images'
import { emitPuzzleData, puzzleStrings } from './puzzles'
import { assignSlots, type Slot, type StageCues } from './stage'

/**
 * The script emitter: `characters.rpy`, `script.rpy` and one `chNN.rpy` per chapter, in the PRIMARY language.
 *
 * - Every say statement has a `# beat:<id>` comment line above it, and `lineMap` records the line of each say
 *   statement, so the translation stubs (`# game/chNN.rpy:LINE`) map back to beat ids exactly.
 * - A line whose speaker is not in the bible (`speakerKey` null) gets an ad hoc `Character` named after the label
 *   (`extra_<slug>`, defined in characters.rpy); it never has a sprite. The narrator is the default `narrator`.
 * - Voice is emitted only when `voice` is given and has a clip for the beat (otherwise nothing voice-related).
 */

export interface VoiceSource {
  /** The clip file for (lang, beat), or null when the beat has none. */
  has(lang: Lang, beatId: string): string | null
}

export interface EmitInput {
  book: VnBook
  /** Primary first. Only used for the primary character names. */
  editions?: Edition[]
  cues: StageCues
  voice?: VoiceSource
  /** Music asset id -> path inside `game/` (`audio/music_01.ogg`). Ids missing here are skipped. */
  music?: Record<string, string>
  /** Sound asset id (`sfx_<key>`, `amb_<key>`) -> path inside `game/` (`audio/sfx_door.ogg`). A sound with no file here is skipped with a warning. */
  sounds?: Record<string, string>
  /** Music asset id -> where the loop starts, in seconds (Chiptune Studio tracks). Those play as `"<loop S>audio/music_01.ogg"`: an intro, then a seamless loop to the end of the file. */
  musicLoops?: Record<string, number | null | undefined>
  /** A light theme needs darker character-name colours. */
  lightTheme?: boolean
  /** The theme colours every name itself: characters get no colour of their own. */
  uniformNames?: boolean
}

export interface LineMapEntry {
  /** File name inside `game/`, for example `ch01.rpy`. */
  file: string
  /** 1-based line of the say statement. */
  line: number
  beatId: string
  /** The say statement as emitted (without indentation): `mara "Hello"`. */
  source: string
  /**
   * The line Ren'Py's translation stub points at when it differs from `line`: with a `voice` statement above the say,
   * the stub block starts at the voice line.
   */
  stubLine?: number
}

export interface EmitResult {
  /** File name -> content, for `game/`. */
  files: Record<string, string>
  lineMap: LineMapEntry[]
  used: UsedImages
  warnings: string[]
  /** The chapter label for each chapter number. */
  labels: Record<number, string>
}

const RESERVED = new Set([
  'if', 'in', 'is', 'as', 'or', 'and', 'not', 'pass', 'def', 'class', 'from', 'with', 'at', 'show', 'hide', 'scene', 'play', 'stop',
  'menu', 'label', 'call', 'jump', 'return', 'image', 'define', 'default', 'init', 'python', 'pause', 'window', 'voice', 'nvl', 'queue',
  'transform', 'screen', 'style', 'translate', 'narrator', 'centered', 'extend', 'config', 'gui', 'store', 'persistent', 'layout',
  'theme', 'build', 'preferences', 'left', 'right', 'center', 'renpy', 'bg', 'black', 'dissolve', 'fade', 'e', 'on', 'onlayer', 'zorder',
  'behind', 'expression', 'while', 'for', 'else', 'elif', 'del', 'try', 'except', 'finally', 'raise', 'lambda', 'global', 'import'
])

/** The Ren'Py audio filename for a track: `<loop S>` in front of the path when the loop starts at S seconds (Ren'Py then loops from S to the end of the file). */
export function musicFile(file: string, loopStartSec?: number | null): string {
  if (typeof loopStartSec !== 'number' || !Number.isFinite(loopStartSec) || loopStartSec < 0) return file
  return `<loop ${Number(loopStartSec.toFixed(4))}>${file}`
}

export const chapterLabel = (n: number): string => `ch_${String(n).padStart(2, '0')}`
export const chapterFile = (n: number): string => `ch${String(n).padStart(2, '0')}.rpy`
export const voicePath = (lang: Lang, beatId: string, file: string): string => `voice/${lang}/${beatId}${path.extname(file) || '.ogg'}`

/** Hex colour for a character name: stable per key, dark enough for light themes and light enough for dark ones. */
export function characterColor(key: string, light: boolean): string {
  const base = pickColor(key)
  const n = parseInt(base.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  // The base colours are mid-dark; lighten them for dark themes.
  const mix = light ? 0 : 0.55
  const f = (c: number): number => Math.round(c + (255 - c) * mix)
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function charVar(key: string): string {
  return RESERVED.has(key) ? `c_${key}` : key
}

interface CharacterTable {
  /** Ad hoc speakers: label -> variable. */
  extra: Map<string, string>
  known: Set<string>
  /** Character key -> the aliases (1-based, as in `aliases`) that a line is spoken under. Each gets a `Character` of its own. */
  aliasUsed: Map<string, Set<number>>
}

/** The used alias of a character as a variable: `mara__a1`. */
const aliasVar = (key: string, n: number): string => `${charVar(key)}__a${n}`

function collectCharacters(book: VnBook): CharacterTable {
  const known = new Set(book.characters.map((c) => c.key))
  const extra = new Map<string, string>()
  const aliasUsed = new Map<string, Set<number>>()
  const taken = new Set<string>()
  for (const ch of book.chapters)
    for (const sc of ch.scenes)
      for (const b of sc.beats) {
        if (b.type !== 'line') continue
        if (b.speakerKey && known.has(b.speakerKey)) {
          const n = aliasIndex(book.characters.find((c) => c.key === b.speakerKey)!, b.speakerLabel)
          if (n > 0) aliasUsed.set(b.speakerKey, (aliasUsed.get(b.speakerKey) ?? new Set()).add(n))
          continue
        }
        const label = b.speakerLabel.trim() || 'Unknown'
        if (extra.has(label)) continue
        let name = `extra_${slugify(label)}`
        let i = 2
        while (taken.has(name)) name = `extra_${slugify(label)}_${i++}`
        taken.add(name)
        extra.set(label, name)
      }
  return { extra, known, aliasUsed }
}

/** The `characters.rpy` file. */
export function emitCharacters(book: VnBook, editions: Edition[], voiceOn: boolean, light: boolean, uniform = false): string {
  const names = editions[0]?.characterNames ?? {}
  const out: string[] = ['# Generated by VN Studio. Do not edit: the next build overwrites this file.', '']
  const table = collectCharacters(book)
  for (const c of book.characters) {
    const name = names[c.key]?.trim() || c.name
    const tag = voiceOn ? `, voice_tag=${renpyPlainString(c.key)}` : ''
    const col = uniform ? '' : `, color="${characterColor(c.key, light)}"`
    out.push(`define ${charVar(c.key)} = Character(_(${renpyString(name)})${col}${tag})`)
    // a line spoken under an alias shows the alias, not the name (the reader may not know it yet); same colour, voice and sprite
    for (const n of [...(table.aliasUsed.get(c.key) ?? [])].sort((a, b) => a - b)) {
      const alias = names[`${c.key}#${n}`]?.trim() || c.aliases![n - 1]!
      out.push(`define ${aliasVar(c.key, n)} = Character(_(${renpyString(alias)}), kind=${charVar(c.key)})`)
    }
  }
  for (const [label, v] of table.extra) {
    out.push(`define ${v} = Character(_(${renpyString(label)})${uniform ? '' : `, color="${characterColor(v, light)}"`})`)
  }
  out.push('')
  return out.join('\n')
}

class Writer {
  lines: string[] = []
  push(s: string): number {
    this.lines.push(s)
    return this.lines.length
  }
  get next(): number {
    return this.lines.length + 1
  }
}

interface ChapterCtx {
  book: VnBook
  cues: StageCues
  voice?: VoiceSource
  music?: Record<string, string>
  musicLoops?: Record<string, number | null | undefined>
  table: CharacterTable
  used: { bg: Set<string>; sprites: Map<string, { charKey: string; expression: string }>; cgs: Map<string, 'full' | 'insert'> }
  /** The chapter's own track (a cue or the plan), set when the chapter starts. */
  chapterTrack?: string | null
  lineMap: LineMapEntry[]
  warnings: string[]
  file: string
  labels: Record<number, string>
  sounds?: Record<string, string>
  /** What plays and shows now, so a cue is only emitted when it changes something. Per chapter. */
  media: { track: string | null | undefined; ambience: string | null | undefined; cg: boolean }
}

/** Emits `play ambience` (or `stop ambience` for null) when it differs from what plays; a sound with no file is skipped with a warning. */
function emitAmbience(w: Writer, ctx: ChapterCtx, where: string, key: string | null): void {
  if (key === ctx.media.ambience) return
  if (key === null) w.push('    stop ambience fadeout 1.5')
  else {
    const file = ctx.sounds?.[ambId(key)]
    if (!file) {
      ctx.warnings.push(`${where}: ambience ${key} has no file yet: skipped`)
      return
    }
    w.push(`    play ambience ${renpyPlainString(file)} fadein 1.5`)
  }
  ctx.media.ambience = key
}

function emitScene(w: Writer, ctx: ChapterCtx, scene: VnScene): void {
  const { cues, voice } = ctx
  const cue = cues.scenes[scene.id] ?? { transition: 'dissolve' as const }
  w.push('')
  w.push(`    # scene ${scene.id}${scene.placeText ? `: ${scene.placeText.replace(/[\r\n]+/g, ' ')}` : ''}`)

  if (scene.backgroundId) {
    ctx.used.bg.add(scene.backgroundId)
    if (cue.transition === 'fade') {
      w.push('    scene black')
      w.push('    with vn_fade')
      w.push(`    scene ${bgImageName(scene.backgroundId)}`)
      w.push('    with vn_dissolve')
    } else if (cue.transition === 'none') {
      w.push(`    scene ${bgImageName(scene.backgroundId)}`)
    } else {
      w.push(`    scene ${bgImageName(scene.backgroundId)}`)
      w.push('    with vn_dissolve')
    }
  } else {
    w.push('    scene black')
    if (cue.transition !== 'none') w.push('    with vn_fade')
  }
  if (cue.pause && cue.pause > 0) w.push(`    pause ${cue.pause}`)
  ctx.media.cg = false // a `scene` statement clears a picture shown over the old one

  // The music of the scene: a cue, else the story's `music`, else the chapter's goes on (back, after a scene that changed it).
  const sceneMusic = 'music' in cue ? cue.music : scene.music
  const wantTrack = sceneMusic !== undefined ? sceneMusic : (ctx.chapterTrack ?? undefined)
  if (wantTrack !== undefined && wantTrack !== ctx.media.track) {
    if (wantTrack === null) {
      w.push('    stop music fadeout 2.0')
      ctx.media.track = null
    } else if (ctx.music?.[wantTrack]) {
      w.push(`    play music ${renpyPlainString(musicFile(ctx.music[wantTrack]!, ctx.musicLoops?.[wantTrack]))} fadein 2.0 loop if_changed`)
      ctx.media.track = wantTrack
    } else ctx.warnings.push(`${scene.id}: music ${wantTrack} has no file yet: the music stays as it is`)
  }
  const sceneAmbience = 'ambience' in cue ? cue.ambience : scene.ambience
  if (sceneAmbience !== undefined) emitAmbience(w, ctx, scene.id, sceneAmbience)

  // What is on screen: char key -> {expression, slot}.
  const shown = new Map<string, { expression: string; slot: Slot }>()

  const nextExpression = (idx: number, key: string): string => {
    for (let j = idx + 1; j < scene.beats.length; j++) {
      const b = scene.beats[j]!
      if (b.type === 'cast') break
      if (b.type === 'line' && b.speakerKey === key) return b.expression
    }
    return 'neutral'
  }

  const emitOne = (beat: VnBeat, idx: number): void => {
    // the cues of this beat (the cues you set win over the story's): a picture, a sound effect, an ambience
    const bc = cues.beats?.[beat.id]
    const image = bc?.image !== undefined ? bc.image : beat.image
    const sfx = bc?.sfx ?? beat.sfx
    const ambience = bc?.ambience !== undefined ? bc.ambience : beat.ambience
    if (image === null && ctx.media.cg) {
      w.push('    hide vn_cg')
      w.push('    with vn_dissolve')
      ctx.media.cg = false
    } else if (image) {
      const display = ctx.book.images?.find((i) => i.key === image)?.display ?? 'full'
      ctx.used.cgs.set(image, display)
      w.push(`    show ${cgImageName(image)} as vn_cg${display === 'insert' ? ' at vn_insert' : ''} zorder 50`)
      w.push('    with vn_dissolve')
      ctx.media.cg = true
    }
    if (sfx) {
      const file = ctx.sounds?.[sfxId(sfx)]
      if (file) w.push(`    play sound ${renpyPlainString(file)}`)
      else ctx.warnings.push(`${beat.id}: sound effect ${sfx} has no file yet: skipped`)
    }
    if (ambience !== undefined) emitAmbience(w, ctx, beat.id, ambience)
    if (beat.type === 'puzzle') {
      const pz = ctx.book.puzzles?.find((p) => p.key === beat.puzzle)
      if (!pz) {
        ctx.warnings.push(`${beat.id}: puzzle ${beat.puzzle} is not in the book: skipped`)
        return
      }
      w.push(`    # beat:${beat.id} puzzle:${pz.key}`)
      w.push(`    call vno_puzzle_play(${renpyPlainString(pz.key)}, vno_puzzle_data[${renpyPlainString(pz.key)}])`)
      if (pz.onFail?.mode === 'chapter' && pz.onFail.to) {
        if (ctx.book.chapters.some((c) => c.n === pz.onFail!.to)) {
          w.push('    if not _return:')
          w.push(`        jump ${chapterLabel(pz.onFail.to)}`)
        } else ctx.warnings.push(`${beat.id}: puzzle ${pz.key} sends a failed player to chapter ${pz.onFail.to}, which does not exist: the story goes on`)
      }
      return
    }
    if (beat.type === 'cast') {
      const keys = [...new Set(beat.cast.map((c) => c.charKey))].filter((k) => {
        if (ctx.table.known.has(k)) return true
        ctx.warnings.push(`${beat.id}: cast member "${k}" is not in the bible; not shown`)
        return false
      })
      const slots = cues.casts[beat.id] ?? assignSlots(keys).slots
      let changed = false
      for (const [k] of shown) {
        if (!(k in slots)) {
          w.push(`    hide ${k}`)
          shown.delete(k)
          changed = true
        }
      }
      for (const k of keys) {
        const slot = slots[k]
        if (!slot) continue
        const cur = shown.get(k)
        if (cur && cur.slot === slot) continue
        const expression = cur?.expression ?? nextExpression(idx, k)
        w.push(`    show ${spriteImageName(k, expression)} at ${slot}`)
        ctx.used.sprites.set(`${k}/${expression}`, { charKey: k, expression })
        shown.set(k, { expression, slot })
        changed = true
      }
      if (changed) w.push('    with vn_show')
      return
    }

    if (beat.type === 'line') {
      const key = beat.speakerKey
      if (key && ctx.table.known.has(key)) {
        const cur = shown.get(key)
        if (cur && cur.expression !== beat.expression) {
          w.push(`    show ${spriteImageName(key, beat.expression)}`)
          ctx.used.sprites.set(`${key}/${beat.expression}`, { charKey: key, expression: beat.expression })
          cur.expression = beat.expression
          w.push('    with vn_show')
        }
      }
      const alias = key && ctx.table.known.has(key) ? aliasIndex(ctx.book.characters.find((c) => c.key === key)!, beat.speakerLabel) : 0
      const who = key && ctx.table.known.has(key) ? (alias > 0 ? aliasVar(key, alias) : charVar(key)) : (ctx.table.extra.get(beat.speakerLabel.trim() || 'Unknown') ?? 'narrator')
      emitSay(w, ctx, beat.id, `${who} `, beat.text, voice)
      return
    }

    emitSay(w, ctx, beat.id, '', beat.text, voice)
  }
  // a clue of a puzzle is found at its beat (`clueAt`): the puzzle screen lists the clues found by then
  const found = new Map<string, string[]>()
  for (const p of ctx.book.puzzles ?? []) for (const [clue, at] of Object.entries(p.clueAt ?? {})) found.set(at, [...(found.get(at) ?? []), `    $ vno_clue_found(${renpyPlainString(p.key)}, ${renpyPlainString(clue)})`])
  scene.beats.forEach((beat, idx) => {
    emitOne(beat, idx)
    for (const line of found.get(beat.id) ?? []) w.push(line)
  })
}

function emitSay(w: Writer, ctx: ChapterCtx, beatId: string, prefix: string, text: string, voice?: VoiceSource): void {
  w.push(`    # beat:${beatId}`)
  let voiceLine: number | undefined
  if (voice) {
    const clip = voice.has(ctx.book.primaryLang, beatId)
    if (clip) voiceLine = w.push(`    voice ${renpyPlainString(voicePath(ctx.book.primaryLang, beatId, clip))}`)
  }
  const source = `${prefix}${renpyString(text)}`
  const line = w.push(`    ${source}`)
  ctx.lineMap.push({ file: ctx.file, line, beatId, source, ...(voiceLine ? { stubLine: voiceLine } : {}) })
}

function emitChapter(ctx: ChapterCtx, ch: VnChapter, index: number): string {
  const { book, cues } = ctx
  const w = new Writer()
  const label = chapterLabel(ch.n)
  ctx.labels[ch.n] = label
  w.push(`# Chapter ${ch.n}${ch.title ? `: ${ch.title.replace(/[\r\n]+/g, ' ')}` : ''}`)
  w.push(`label ${label}:`)
  w.push('')

  const trackId = cues.chapters[ch.n]?.music ?? null
  const track = trackId && ctx.music?.[trackId] ? musicFile(ctx.music[trackId]!, ctx.musicLoops?.[trackId]) : undefined
  if (track) w.push(`    play music ${renpyPlainString(track)} fadein 2.0 loop if_changed`)
  ctx.chapterTrack = trackId
  ctx.media = { track: track ? trackId : undefined, ambience: undefined, cg: false }
  if (ch.title.trim()) {
    w.push('    scene black')
    w.push('    with vn_fade')
    w.push(`    call screen chapter_card(_(${renpyString(ch.title)}))`)
  }

  ch.scenes.forEach((scene) => emitScene(w, ctx, scene))

  w.push('')
  w.push(`    # end of chapter ${ch.n}`)
  const next = book.chapters[index + 1]
  if (book.kind === 'choice' && ch.choices.length > 0) {
    w.push('    menu:')
    ch.choices.forEach((c) => {
      const target = book.chapters.find((x) => x.n === c.to)
      if (!target) {
        ctx.warnings.push(`chapter ${ch.n}: choice "${c.text}" leads to chapter ${c.to}, which does not exist; skipped`)
        return
      }
      w.push(`        ${renpyString(c.text)}:`)
      w.push(`            jump ${chapterLabel(c.to)}`)
    })
  } else if (book.kind === 'linear' && next) {
    w.push(`    jump ${chapterLabel(next.n)}`)
  } else {
    w.push(ch.ending && ch.ending.trim() ? `    call screen the_end(_(${renpyString(ch.ending)}))` : '    call screen the_end()')
    w.push('    return')
  }
  w.push('')
  return w.lines.join('\n')
}

export function emitScripts(inp: EmitInput): EmitResult {
  const { book, cues } = inp
  const warnings: string[] = []
  const lineMap: LineMapEntry[] = []
  const files: Record<string, string> = {}
  const labels: Record<number, string> = {}
  const used = { bg: new Set<string>(), sprites: new Map<string, { charKey: string; expression: string }>(), cgs: new Map<string, 'full' | 'insert'>() }
  const table = collectCharacters(book)
  const voiceOn = !!inp.voice

  for (const [label, v] of table.extra) warnings.push(`speaker "${label}" is not in the bible; uses the ad hoc character ${v}`)

  const puzzleData = emitPuzzleData(book)
  if (puzzleData) files['vno_puzzles_data.rpy'] = puzzleData
  files['characters.rpy'] = emitCharacters(book, inp.editions ?? [], voiceOn, !!inp.lightTheme, !!inp.uniformNames)

  const chapters = [...book.chapters].sort((a, b) => a.n - b.n)
  chapters.forEach((ch, i) => {
    const file = chapterFile(ch.n)
    const ctx: ChapterCtx = { book: { ...book, chapters }, cues, voice: inp.voice, music: inp.music, musicLoops: inp.musicLoops, sounds: inp.sounds, table, used, lineMap, warnings, file, labels, media: { track: undefined, ambience: undefined, cg: false } }
    files[file] = emitChapter(ctx, ch, i)
  })

  const first = chapters[0]
  const menuTrack = cues.menuMusic && inp.music?.[cues.menuMusic] ? musicFile(inp.music[cues.menuMusic]!, inp.musicLoops?.[cues.menuMusic]) : undefined
  files['script.rpy'] = [
    '# Generated by VN Studio. Do not edit: the next build overwrites this file.',
    ...(menuTrack ? [`define config.main_menu_music = ${renpyPlainString(menuTrack)}`, ''] : ['']),
    'label start:',
    first ? `    jump ${chapterLabel(first.n)}` : '    return',
    ''
  ].join('\n')

  return {
    files,
    lineMap,
    used: { backgrounds: [...used.bg], sprites: [...used.sprites.values()], cgs: [...used.cgs].map(([key, display]) => ({ key, display })) },
    warnings,
    labels
  }
}

/** One string the edition can translate: the primary source text (as written in the script) and how to read it from an edition. */
export interface TranslatableString {
  /** The text as it appears between the quotes in the source script (escaped, emphasis tags in). */
  old: string
  /** The edition's text for it (raw, not escaped), if any. */
  pick: (ed: Edition) => string | undefined
  /** For reports: `chapter 2 title`. */
  what: string
  /** Names and other text where markdown emphasis is not interpreted. */
  plain?: boolean
}

/** Chapter titles, choices, endings, character names and the book title, for the `translate <lang> strings:` blocks. */
export function translatableStrings(book: VnBook, primaryNames: Record<string, string> = {}): TranslatableString[] {
  const out: TranslatableString[] = []
  out.push({ old: renpyText(book.title), pick: (e) => e.title, what: 'title' })
  for (const ch of book.chapters) {
    if (ch.title.trim()) out.push({ old: renpyText(ch.title), pick: (e) => e.chapterTitles[ch.n], what: `chapter ${ch.n} title` })
    ch.choices.forEach((c, i) => {
      out.push({ old: renpyText(c.text), pick: (e) => e.choiceTexts[`${ch.n}:${i}`], what: `chapter ${ch.n} choice ${i}` })
    })
    if (ch.ending && ch.ending.trim()) out.push({ old: renpyText(ch.ending), pick: (e) => e.endings[ch.n], what: `chapter ${ch.n} ending` })
  }
  out.push(...puzzleStrings(book).map((s) => ({ ...s, pick: (e: Edition) => s.pick(e) })))
  const used = collectCharacters(book).aliasUsed
  for (const c of book.characters) {
    out.push({ old: renpyText(primaryNames[c.key]?.trim() || c.name), pick: (e) => e.characterNames[c.key], what: `name of ${c.key}` })
    // the alias a line is spoken under is shown too: an edition translates it under `<key>#<n>`
    for (const n of [...(used.get(c.key) ?? [])].sort((a, b) => a - b)) {
      out.push({ old: renpyText(primaryNames[`${c.key}#${n}`]?.trim() || c.aliases![n - 1]!), pick: (e) => e.characterNames[`${c.key}#${n}`], what: `alias ${n} of ${c.key}` })
    }
  }
  return out
}
