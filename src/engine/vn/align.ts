import { hasText } from '../../shared/vn'
import type { Edition, Lang, TextBeat, VnBook, VnScene } from '../../shared/vn'
import { parseRawBook } from './import'
import type { ParsedFolder } from './import'
import { normText } from './ids'
import { readBookFolder } from './reader'

export interface AlignReport {
  /** Text beats (lines and narration) of the primary that got a translated text. */
  matched: number
  /** Primary text beats without a translated counterpart. */
  missing: string[]
  /** Translated text beats without a primary counterpart: chapter number, scene number (1-based) and the text. */
  extra: { chapter: number; scene: number; text: string }[]
  /** Character key -> the display name in the translated edition. */
  nameMap: Record<string, string>
  /** Place key -> the place name in the translated edition. */
  placeMap: Record<string, string>
  /** Other differences (cast counts, speaker mismatches, missing chapters or titles). */
  warnings: string[]
  /** A pack edition (VNO-46): the pack hash and version it was validated against, and how many catalogue keys it had. */
  packHash?: string
  packVersion?: number
  keyCount?: number
  /** The catalogue file or bundle folder it came from. */
  source?: string
}

export interface AlignResult {
  edition: Edition
  report: AlignReport
}

const isText = hasText

const sim = (a: string, b: string) => {
  const x = a.length
  const y = b.length
  return x === 0 && y === 0 ? 1 : Math.min(x, y) / Math.max(x, y, 1)
}

/** Pairs the text beats of one scene. Same counts per type: by position within the type. Otherwise a best-score alignment. */
function alignBeats(p: TextBeat[], t: TextBeat[], keyMap: Map<string, string>): { pairs: [TextBeat, TextBeat][]; missing: TextBeat[]; extra: TextBeat[] } {
  const count = (list: TextBeat[], type: string) => list.filter((b) => b.type === type).length
  if (count(p, 'line') === count(t, 'line') && count(p, 'narration') === count(t, 'narration')) {
    const pairs: [TextBeat, TextBeat][] = []
    for (const type of ['line', 'narration']) {
      const a = p.filter((b) => b.type === type)
      const b = t.filter((x) => x.type === type)
      a.forEach((beat, i) => pairs.push([beat, b[i]!]))
    }
    return { pairs, missing: [], extra: [] }
  }
  const score = (a: TextBeat, b: TextBeat): number => {
    if (a.type !== b.type) return -Infinity
    let s = 1 + sim(a.text, b.text)
    if (a.type === 'line' && b.type === 'line') {
      const mapped = b.speakerKey ? keyMap.get(b.speakerKey) : undefined
      if (mapped !== undefined && mapped === a.speakerKey) s += 2
      else if (a.speakerKey === null && b.speakerKey === null && normText(a.speakerLabel) === normText(b.speakerLabel)) s += 2
    }
    return s
  }
  const n = p.length
  const m = t.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = score(p[i - 1]!, t[j - 1]!)
      dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!, Number.isFinite(s) ? dp[i - 1]![j - 1]! + s : -Infinity)
    }
  }
  const pairs: [TextBeat, TextBeat][] = []
  const usedP = new Set<TextBeat>()
  const usedT = new Set<TextBeat>()
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = score(p[i - 1]!, t[j - 1]!)
    if (Number.isFinite(s) && dp[i]![j] === dp[i - 1]![j - 1]! + s) {
      pairs.unshift([p[i - 1]!, t[j - 1]!])
      usedP.add(p[i - 1]!)
      usedT.add(t[j - 1]!)
      i--
      j--
    } else if (dp[i]![j] === dp[i - 1]![j]!) i--
    else j--
  }
  return { pairs, missing: p.filter((b) => !usedP.has(b)), extra: t.filter((b) => !usedT.has(b)) }
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)

/** Aligns an already parsed translated folder to the primary structure. */
export function alignParsed(primary: VnBook, translated: ParsedFolder, lang: Lang): AlignResult {
  const warnings: string[] = []
  const missing: string[] = []
  const extra: AlignReport['extra'] = []
  const beats: Record<string, string> = {}
  const chapterTitles: Edition['chapterTitles'] = {}
  const choiceTexts: Edition['choiceTexts'] = {}
  const endings: Edition['endings'] = {}
  let matched = 0

  // Translated character key -> primary key: same name, else the same bullet position.
  const keyMap = new Map<string, string>()
  const taken = new Set<string>()
  const tChars = translated.bible.characters
  tChars.forEach((tc) => {
    const same = primary.characters.find((pc) => normText(pc.name) === normText(tc.name) && !taken.has(pc.key))
    if (same) {
      keyMap.set(tc.key, same.key)
      taken.add(same.key)
    }
  })
  tChars.forEach((tc, i) => {
    if (keyMap.has(tc.key)) return
    const pc = primary.characters[i]
    if (pc && !taken.has(pc.key)) {
      keyMap.set(tc.key, pc.key)
      taken.add(pc.key)
    }
  })
  if (tChars.length !== primary.characters.length) warnings.push(`the translated bible has ${tChars.length} characters, the primary has ${primary.characters.length}`)

  const labelVotes = new Map<string, Map<string, number>>()
  const placeVotes = new Map<string, Map<string, number>>()
  const vote = (m: Map<string, Map<string, number>>, key: string, value: string) => {
    const inner = m.get(key) ?? new Map<string, number>()
    inner.set(value, (inner.get(value) ?? 0) + 1)
    m.set(key, inner)
  }

  for (const pc of primary.chapters) {
    const tc = translated.chapters.find((c) => c.n === pc.n)
    const textOf = (s: VnScene) => s.beats.filter(isText)
    if (!tc) {
      warnings.push(`the translation has no chapter ${pc.n}`)
      for (const s of pc.scenes) for (const b of textOf(s)) missing.push(b.id)
      continue
    }
    if (tc.title) chapterTitles[pc.n] = tc.title
    else warnings.push(`chapter ${pc.n} has no title in the translation`)
    if (pc.ending && tc.ending) endings[pc.n] = tc.ending
    pc.choices.forEach((ch, i) => {
      const byTo = tc.choices.find((x) => x.to === ch.to)
      const text = (byTo ?? tc.choices[i])?.text
      if (text) choiceTexts[`${pc.n}:${i}`] = text
      else warnings.push(`chapter ${pc.n}: choice ${i} has no translated text`)
    })
    if (tc.choices.length !== pc.choices.length) warnings.push(`chapter ${pc.n}: ${tc.choices.length} translated choices, ${pc.choices.length} in the primary`)

    const scenes = Math.max(pc.scenes.length, tc.scenes.length)
    for (let k = 0; k < scenes; k++) {
      const ps = pc.scenes[k]
      const ts = tc.scenes[k]
      if (!ps && ts) {
        for (const b of textOf(ts)) extra.push({ chapter: pc.n, scene: k + 1, text: b.text })
        continue
      }
      if (ps && !ts) {
        for (const b of textOf(ps)) missing.push(b.id)
        continue
      }
      if (!ps || !ts) continue
      if (ps.placeKey && ts.placeKey) vote(placeVotes, ps.placeKey, ts.placeKey)
      else if (ps.placeKey && ts.placeText) vote(placeVotes, ps.placeKey, `text:${ts.placeText}`)
      const pCast = ps.beats.filter((b) => b.type === 'cast').length
      const tCast = ts.beats.filter((b) => b.type === 'cast').length
      if (pCast !== tCast) warnings.push(`${ps.id}: ${tCast} cast line(s) in the translation, ${pCast} in the primary`)
      const aligned = alignBeats(textOf(ps), textOf(ts), keyMap)
      for (const [a, b] of aligned.pairs) {
        beats[a.id] = b.text
        matched++
        if (a.type === 'line' && b.type === 'line') {
          if (a.speakerKey) vote(labelVotes, a.speakerKey, b.speakerLabel)
          const mapped = b.speakerKey ? keyMap.get(b.speakerKey) : undefined
          if (mapped !== undefined && a.speakerKey && mapped !== a.speakerKey) warnings.push(`${a.id}: the speaker ${b.speakerLabel} does not match ${a.speakerLabel}`)
        }
      }
      for (const b of aligned.missing) missing.push(b.id)
      for (const b of aligned.extra) extra.push({ chapter: pc.n, scene: k + 1, text: b.text })
    }
  }
  for (const tc of translated.chapters) {
    if (!primary.chapters.some((c) => c.n === tc.n)) {
      warnings.push(`the translation has an extra chapter ${tc.n}`)
      tc.scenes.forEach((s, k) => s.beats.filter(isText).forEach((b) => extra.push({ chapter: tc.n, scene: k + 1, text: b.text })))
    }
  }

  const best = (m: Map<string, number> | undefined) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined)

  // Names: the translated bible by bullet order (or same name), else the speaker labels seen at aligned beats.
  const nameMap: Record<string, string> = {}
  const characterNames: Record<string, string> = {}
  for (const pc of primary.characters) {
    const tKey = [...keyMap.entries()].find(([, v]) => v === pc.key)?.[0]
    const fromBible = tKey ? tChars.find((c) => c.key === tKey)?.name : undefined
    const label = best(labelVotes.get(pc.key))
    const name = fromBible ?? (label ? capitalise(label) : undefined)
    if (name) {
      nameMap[pc.key] = name
      characterNames[pc.key] = name
    } else warnings.push(`no translated name for ${pc.name}`)
  }

  const placeMap: Record<string, string> = {}
  const tPlaces = translated.bible.places
  primary.places.forEach((pp, i) => {
    const winner = best(placeVotes.get(pp.key))
    let name: string | undefined
    if (winner?.startsWith('text:')) name = winner.slice(5)
    else if (winner) name = tPlaces.find((p) => p.key === winner)?.name
    name ??= tPlaces[i]?.name
    if (name) placeMap[pp.key] = name
  })

  const title = translated.raw.book.title
  // the puzzles: the clues and statements line up by id (`CLUE: dinner/c2:`), the names and the other sentences come from the translated bible/puzzles.md
  const puzzles: NonNullable<Edition['puzzles']> = {}
  for (const pp of primary.puzzles ?? []) {
    const tp = translated.puzzles.find((x) => x.key === pp.key)
    if (!tp) {
      warnings.push(`puzzle "${pp.key}": the translation has no such puzzle: the primary words are kept`)
      continue
    }
    const text = { ...pp.text, ...Object.fromEntries(Object.entries(tp.text).filter(([id, t]) => id in pp.text && t.trim())) }
    const names = { ...pp.names, ...Object.fromEntries(Object.entries(tp.names).filter(([id, n]) => id in pp.names && n.trim())) }
    for (const id of Object.keys(pp.text)) if (text[id] === pp.text[id]) warnings.push(`puzzle "${pp.key}": ${id} has no translated text: the primary words are kept`)
    puzzles[pp.key] = { names, text }
  }
  const edition: Edition = {
    lang,
    title: typeof title === 'string' && title.trim() ? title.trim() : primary.title,
    chapterTitles,
    choiceTexts,
    endings,
    characterNames,
    beats,
    ...(Object.keys(puzzles).length ? { puzzles } : {})
  }
  return { edition, report: { matched, missing, extra, nameMap, placeMap, warnings } }
}

/** Aligns a translated book folder (same layout) to the primary book beat by beat. */
export async function alignEdition(primary: VnBook, translatedFolder: string, lang: Lang): Promise<AlignResult> {
  const translated = parseRawBook(await readBookFolder(translatedFolder))
  return alignParsed(primary, translated, lang)
}
