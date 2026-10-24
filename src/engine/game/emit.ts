import path from 'node:path'
import type { Edition, Lang, VnBeat, VnBook, VnChapter, VnScene } from '../../shared/vn'
import { hasText } from '../../shared/vn'
import { languageInfo } from '../../shared/languages'
import type { Theme } from '../themes/load'
import { aliasIndex } from '../vn/aliases'
import { expressionsOf } from '../vn/expressions'
import { ambId, sfxId } from '../vn/ids'
import { renderHtmlEmphasis, renpyPlainString, renpyString, renpyText, slugify } from './escape'
import { bgImageName, cgImageName, imageFile, pickColor, spriteImageName, type ImageFormat, type Resolution, type UsedImages } from './images'
import { emitPuzzleData, emitPuzzles, playedPuzzles, puzzlePics, puzzleStrings, type CompiledPuzzle } from './puzzles'
import { assignSlots, defaultCues, planScene, type BeatStagePlan, type SceneTransition, type Slot, type StageCues } from './stage'
import { compileEditions, type CompiledEdition } from './tl'
import { isRtlLang, rtlLanguages } from './rtl'

/**
 * Game script & GameData JSON emitter for the Visual Novel Web Player.
 */

export interface VoiceSource {
  has(lang: Lang, beatId: string): string | null
}

export interface LineMapEntry {
  file: string
  line: number
  beatId: string
  source: string
  stubLine?: number
}

export interface EmitInput {
  book: VnBook
  editions?: Edition[]
  cues: StageCues
  voice?: VoiceSource
  music?: Record<string, string>
  sounds?: Record<string, string>
  musicLoops?: Record<string, number | null | undefined>
  lightTheme?: boolean
  uniformNames?: boolean
}

export interface EmitResult {
  files: Record<string, string>
  lineMap: LineMapEntry[]
  used: UsedImages
  warnings: string[]
  labels: Record<number, string>
}

const RESERVED = new Set([
  'if', 'in', 'is', 'as', 'or', 'and', 'not', 'pass', 'def', 'class', 'from', 'with', 'at', 'show', 'hide', 'scene', 'play', 'stop',
  'menu', 'label', 'call', 'jump', 'return', 'image', 'define', 'default', 'init', 'python', 'pause', 'window', 'voice', 'nvl', 'queue',
  'transform', 'screen', 'style', 'translate', 'narrator', 'centered', 'extend', 'config', 'gui', 'store', 'persistent', 'layout',
  'theme', 'build', 'preferences', 'left', 'right', 'center', 'renpy', 'bg', 'black', 'dissolve', 'fade', 'e', 'on', 'onlayer', 'zorder',
  'behind', 'expression', 'while', 'for', 'else', 'elif', 'del', 'try', 'except', 'finally', 'raise', 'lambda', 'global', 'import'
])

export function musicFile(file: string, loopStartSec?: number | null): string {
  if (typeof loopStartSec !== 'number' || !Number.isFinite(loopStartSec) || loopStartSec < 0) return file
  return `<loop ${Number(loopStartSec.toFixed(4))}>${file}`
}

export const chapterLabel = (n: number): string => `ch_${String(n).padStart(2, '0')}`
export const chapterFile = (n: number): string => `ch${String(n).padStart(2, '0')}.rpy`
export const voicePath = (lang: Lang, beatId: string, file: string): string => `voice/${lang}/${beatId}${path.extname(file) || '.ogg'}`

export function characterColor(key: string, light: boolean): string {
  const base = pickColor(key)
  const n = parseInt(base.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const mix = light ? 0 : 0.55
  const f = (c: number): number => Math.round(c + (255 - c) * mix)
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function charVar(key: string): string {
  return RESERVED.has(key) ? `c_${key}` : key
}

export function characterVarMap(characters: { key: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of characters) {
    out[c.key] = charVar(c.key)
  }
  return out
}

export function insertImageName(key: string): string {
  return cgImageName(key)
}

interface CharacterTable {
  extra: Map<string, string>
  known: Set<string>
  aliasUsed: Map<string, Set<number>>
}

const aliasVar = (key: string, n: number): string => `${charVar(key)}__a${n}`

function collectCharacters(book: VnBook): CharacterTable {
  const known = new Set(book.characters.map((c) => c.key))
  const extra = new Map<string, string>()
  const aliasUsed = new Map<string, Set<number>>()
  const taken = new Set<string>()
  for (const ch of book.chapters) {
    for (const sc of ch.scenes) {
      for (const b of sc.beats) {
        if (b.type !== 'line') continue
        if (b.speakerKey && known.has(b.speakerKey)) {
          const char = book.characters.find((c) => c.key === b.speakerKey)!
          const n = aliasIndex(char, b.speakerLabel)
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
    }
  }
  return { extra, known, aliasUsed }
}

export function emitCharacters(book: VnBook, editions: Edition[], voiceOn: boolean, light: boolean, uniform = false): string {
  const names = editions[0]?.characterNames ?? {}
  const out: string[] = ['# Generated by VN Studio. Do not edit: the next build overwrites this file.', '']
  const table = collectCharacters(book)
  for (const c of book.characters) {
    const name = names[c.key]?.trim() || c.name
    const tag = voiceOn ? `, voice_tag=${renpyPlainString(c.key)}` : ''
    const col = uniform ? '' : `, color="${characterColor(c.key, light)}"`
    out.push(`define ${charVar(c.key)} = Character(_(${renpyString(name)})${col}${tag})`)
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
  chapterTrack?: string | null
  lineMap: LineMapEntry[]
  warnings: string[]
  file: string
  labels: Record<number, string>
  sounds?: Record<string, string>
  media: { track: string | null | undefined; ambience: string | null | undefined; cg: boolean }
}

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
  ctx.media.cg = false

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
        } else {
          ctx.warnings.push(`${beat.id}: puzzle ${pz.key} sends a failed player to chapter ${pz.onFail.to}, which does not exist: the story goes on`)
        }
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
  for (const pz of playedPuzzles(book)) {
    for (const [item, l] of Object.entries(pz.links ?? {})) {
      if (!puzzlePics(book, pz)[item]) continue
      if (l.type === 'character') used.sprites.set(`${l.key}/neutral`, { charKey: l.key, expression: 'neutral' })
      else if (l.type === 'image') used.cgs.set(l.key, book.images?.find((i) => i.key === l.key)?.display ?? 'insert')
    }
  }
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

export interface TranslatableString {
  old: string
  pick: (ed: Edition) => string | undefined
  what: string
  plain?: boolean
}

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
    for (const n of [...(used.get(c.key) ?? [])].sort((a, b) => a - b)) {
      out.push({ old: renpyText(primaryNames[`${c.key}#${n}`]?.trim() || c.aliases![n - 1]!), pick: (e) => e.characterNames[`${c.key}#${n}`], what: `alias ${n} of ${c.key}` })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// GameData JSON Contract for Web Player Runtime
// ---------------------------------------------------------------------------------------------------------------------

export interface GameDataCharacter {
  id: string
  varName: string
  displayName: string
  color: string
  aliases?: string[]
  expressions: string[]
  sprites: Record<string, string>
}

export interface GameDataSceneBeat {
  id: string
  type: 'line' | 'narration' | 'cast' | 'puzzle'
  speaker?: string | null
  speakerAliasKey?: string
  speakerLabel?: string
  text?: string
  html?: string
  stage?: BeatStagePlan
  puzzleKey?: string
  onFail?: { mode: 'retry' | 'continue' | 'chapter'; to?: number; maxTries?: number }
  failTargetLabel?: string
}

export interface GameDataScene {
  id: string
  label: string
  title: string
  locationKey: string | null
  bgPath: string | null
  transition: SceneTransition
  pause?: number
  music: string | null
  musicLoopStartSec?: number | null
  musicExplicitNull?: boolean
  ambience: string | null
  beats: GameDataSceneBeat[]
}

export interface GameDataChoice {
  text: string
  targetChapterId: number
  targetLabel: string
}

export interface GameDataChapter {
  id: string
  label: string
  number: number
  title: string
  music?: string | null
  musicLoopStartSec?: number | null
  scenes: GameDataScene[]
  choices: GameDataChoice[]
  ending?: { type: string; message: string } | null
  nextChapterLabel?: string | null
}

export interface GameDataLanguage {
  code: string
  name: string
  nativeName: string
  rtl: boolean
  fontFamily: string
}

export interface GameData {
  slug: string
  title: string
  primaryLang: string
  saveDir: string
  resolution: Resolution
  theme: Theme & { pixel?: boolean }
  rtlLangs: string[]
  characters: Record<string, GameDataCharacter>
  backgrounds: Record<string, string>
  cgs: Record<string, { path: string; display: 'full' | 'insert' }>
  audio: {
    music: Record<string, { path: string; loopStartSec?: number }>
    sfx: Record<string, string>
    ambience: Record<string, string>
  }
  chapters: GameDataChapter[]
  puzzles: Record<string, CompiledPuzzle>
  editions: Record<string, CompiledEdition>
  languages: GameDataLanguage[]
}

export interface BuildGameDataInput {
  book: VnBook
  theme: Theme
  editions?: Edition[]
  primaryEdition?: Edition
  cues?: StageCues
  voice?: VoiceSource
  music?: Record<string, string>
  musicLoops?: Record<string, number | null | undefined>
  sounds?: Record<string, string>
  resolution?: Resolution
  imageFormat?: ImageFormat
  pixel?: boolean
  warnings?: string[]
  used?: UsedImages
}

/**
 * Builds the complete structured GameData payload for the web player runtime.
 */
export function buildGameData(inp: BuildGameDataInput): GameData {
  const { book, theme } = inp
  const resolution = inp.resolution ?? { w: 1920, h: 1080 }
  const format: ImageFormat = inp.imageFormat ?? 'webp'
  const warnings = inp.warnings ?? []
  const musicIds = Object.keys(inp.music ?? {})
  const cues = inp.cues ?? defaultCues(book, { musicIds, warn: (m) => warnings.push(m) })
  const knownChars = new Set(book.characters.map((c) => c.key))

  // 1. Languages
  const editionLangs = (inp.editions ?? []).map((e) => e.lang)
  const allLangs = [book.primaryLang, ...editionLangs.filter((l, i) => l !== book.primaryLang && editionLangs.indexOf(l) === i)]
  const rtl = rtlLanguages(book.primaryLang, allLangs)

  const languages: GameDataLanguage[] = allLangs.map((code) => {
    const info = languageInfo(code)
    return {
      code,
      name: info?.name ?? code,
      nativeName: info?.native ?? code,
      rtl: isRtlLang(code),
      fontFamily: code === book.primaryLang ? 'var(--vno-font-text)' : `Font_${code}, var(--vno-font-text)`
    }
  })

  // 2. Characters
  const characters: Record<string, GameDataCharacter> = {}
  const primaryNames = inp.primaryEdition?.characterNames ?? {}
  const usedSpriteKeys = inp.used ? new Set(inp.used.sprites.map((s) => `${s.charKey}/${s.expression}`)) : null
  for (const c of book.characters) {
    const usedExprs = inp.used ? inp.used.sprites.filter((s) => s.charKey === c.key).map((s) => s.expression) : []
    const expressions = [...new Set(['neutral', ...expressionsOf(book, c), ...usedExprs])]


    const sprites: Record<string, string> = {}
    for (const expr of expressions) {
      if (!usedSpriteKeys || usedSpriteKeys.has(`${c.key}/${expr}`)) {
        sprites[expr] = imageFile(spriteImageName(c.key, expr), format)
      }
    }

    characters[c.key] = {
      id: c.key,
      varName: charVar(c.key),
      displayName: primaryNames[c.key]?.trim() || c.name,
      color: characterColor(c.key, !!theme.light),
      aliases: c.aliases,
      expressions: Object.keys(sprites),
      sprites
    }
  }

  // 3. Backgrounds & CGs
  const backgrounds: Record<string, string> = {}
  for (const ch of book.chapters) {
    for (const sc of ch.scenes) {
      if (sc.backgroundId) {
        backgrounds[sc.backgroundId] = imageFile(bgImageName(sc.backgroundId), format)
      }
    }
  }

  const cgs: Record<string, { path: string; display: 'full' | 'insert' }> = {}
  for (const img of book.images ?? []) {
    cgs[img.key] = {
      path: imageFile(cgImageName(img.key), format),
      display: img.display
    }
  }

  // 4. Audio
  const music: Record<string, { path: string; loopStartSec?: number }> = {}
  for (const [id, rel] of Object.entries(inp.music ?? {})) {
    const loop = inp.musicLoops?.[id]
    music[id] = {
      path: rel,
      ...(typeof loop === 'number' && loop > 0 ? { loopStartSec: loop } : {})
    }
  }

  const sfx: Record<string, string> = {}
  const ambience: Record<string, string> = {}
  for (const [id, rel] of Object.entries(inp.sounds ?? {})) {
    if (id.startsWith('sfx_')) sfx[id.replace(/^sfx_/, '')] = rel
    else if (id.startsWith('amb_')) ambience[id.replace(/^amb_/, '')] = rel
    else sfx[id] = rel
  }

  // 5. Puzzles
  const puzzlesResult = emitPuzzles(book, format)

  // 6. Chapters & Scenes
  const chapters: GameDataChapter[] = book.chapters.map((ch, chIdx) => {
    const scenes: GameDataScene[] = ch.scenes.map((sc, scIdx) => {
      const stagePlan = planScene(sc, cues, knownChars)
      const beats: GameDataSceneBeat[] = sc.beats.map((b) => {
        const beatPlan = stagePlan.beats[b.id]
        const pz = b.type === 'puzzle' ? book.puzzles?.find((p) => p.key === b.puzzle) : undefined
        const failTarget = pz?.onFail?.mode === 'chapter' && pz.onFail.to ? chapterLabel(pz.onFail.to) : undefined
        let speakerAliasKey: string | undefined
        if (b.type === 'line' && b.speakerKey && knownChars.has(b.speakerKey)) {
          const char = book.characters.find((c) => c.key === b.speakerKey)!
          const aliasIdx = aliasIndex(char, b.speakerLabel)
          if (aliasIdx > 0) speakerAliasKey = `${b.speakerKey}#${aliasIdx}`
        }

        return {
          id: b.id,
          type: b.type,
          speaker: b.type === 'line' ? b.speakerKey : undefined,
          speakerAliasKey,
          speakerLabel: b.type === 'line' ? b.speakerLabel : undefined,
          text: hasText(b) ? b.text : undefined,
          html: hasText(b) ? renderHtmlEmphasis(b.text) : undefined,
          stage: beatPlan,
          puzzleKey: b.type === 'puzzle' ? b.puzzle : undefined,
          onFail: pz?.onFail,
          failTargetLabel: failTarget
        }
      })

      const sceneMusic = stagePlan.music !== undefined ? stagePlan.music : (cues.chapters[ch.n]?.music ?? null)
      const loop = sceneMusic ? inp.musicLoops?.[sceneMusic] : undefined

      return {
        id: sc.id,
        label: `${chapterLabel(ch.n)}_s${String(scIdx + 1).padStart(2, '0')}`,
        title: sc.placeText || `Scene ${scIdx + 1}`,
        locationKey: sc.placeKey,
        bgPath: sc.backgroundId ? backgrounds[sc.backgroundId] ?? null : null,
        transition: stagePlan.transition,
        pause: stagePlan.pause,
        music: sceneMusic,
        musicLoopStartSec: typeof loop === 'number' ? loop : null,
        musicExplicitNull: stagePlan.music === null,
        ambience: stagePlan.ambience ?? null,
        beats
      }
    })

    const choices: GameDataChoice[] = ch.choices.map((c) => ({
      text: c.text,
      targetChapterId: c.to,
      targetLabel: chapterLabel(c.to)
    }))

    const nextCh = book.chapters[chIdx + 1]
    const nextChapterLabel = book.kind === 'linear' && nextCh ? chapterLabel(nextCh.n) : null

    const chMusic = cues.chapters[ch.n]?.music ?? null
    const chLoop = chMusic ? inp.musicLoops?.[chMusic] : undefined

    return {
      id: `chapter_${ch.n}`,
      label: chapterLabel(ch.n),
      number: ch.n,
      title: ch.title,
      music: chMusic,
      musicLoopStartSec: typeof chLoop === 'number' ? chLoop : null,
      scenes,
      choices,
      ending: ch.ending ? { type: 'the_end', message: ch.ending } : null,
      nextChapterLabel
    }
  })

  // 7. Editions compilation
  const editions = compileEditions(book, inp.primaryEdition, inp.editions ?? [], inp.voice, warnings)

  const buildName = book.slug.replace(/[^A-Za-z0-9_-]/g, '_') || 'game'

  return {
    slug: book.slug,
    title: book.title,
    primaryLang: book.primaryLang,
    saveDir: `vno-${buildName}`,
    resolution,
    theme: {
      ...theme,
      pixel: !!inp.pixel || !!theme.pixel
    },
    rtlLangs: rtl,
    characters,
    backgrounds,
    cgs,
    audio: {
      music,
      sfx,
      ambience
    },
    chapters,
    puzzles: puzzlesResult.puzzles,
    editions,
    languages
  }
}

/** Emit both scripts and game data for full compatibility. */
export function emitProject(inp: BuildGameDataInput): { gameData: GameData; files: Record<string, string>; lineMap: LineMapEntry[]; used: UsedImages } {
  const musicIds = Object.keys(inp.music ?? {})
  const cues = inp.cues ?? defaultCues(inp.book, { musicIds, warn: (m) => inp.warnings?.push(m) })
  const scriptResult = emitScripts({
    book: inp.book,
    editions: inp.editions,
    cues,
    voice: inp.voice,
    music: inp.music,
    sounds: inp.sounds,
    musicLoops: inp.musicLoops,
    lightTheme: !!inp.theme.light,
    uniformNames: !!inp.theme.namebox.textColor
  })
  const gameData = buildGameData({ ...inp, used: scriptResult.used })
  return {
    gameData,
    files: scriptResult.files,
    lineMap: scriptResult.lineMap,
    used: scriptResult.used
  }
}
