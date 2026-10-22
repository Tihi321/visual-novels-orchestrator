import { extractAliases } from './aliases'
import { normText, slugKey } from './ids'

export interface BibleCharacter {
  key: string
  name: string
  looks: string
  voice?: string
  /** Other names the entry gives the character (`the bald man`), written in it or merged in from entries that were the same person (see `aliases.ts`). */
  aliases?: string[]
}
export interface BiblePlace {
  key: string
  name: string
  looks: string
}
export interface Bible {
  setting: string
  style: string
  characters: BibleCharacter[]
  places: BiblePlace[]
}

type Section = 'setting' | 'characters' | 'places' | 'style'

const HEADINGS: Record<string, Section> = {
  setting: 'setting',
  okruzenje: 'setting',
  svijet: 'setting',
  characters: 'characters',
  likovi: 'characters',
  places: 'places',
  locations: 'places',
  mjesta: 'places',
  style: 'style',
  stil: 'style'
}

const BULLET = /^\s*[-*+]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/
const VOICE = /\b(?:voice|glas)\s*:\s*/i

function uniqueKey(name: string, used: Set<string>): string {
  const base = slugKey(name)
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`
  used.add(key)
  return key
}

/** Parses the bible body (`## Setting/Characters/Places/Style`, English or Croatian headings). Never throws. */
export function parseBible(body: string): Bible {
  const text: Record<Section, string[]> = { setting: [], characters: [], places: [], style: [] }
  let section: Section | null = null
  for (const line of body.split(/\r?\n/)) {
    const h = /^#{2,3}\s+(.+?)\s*#*$/.exec(line)
    if (h) {
      section = HEADINGS[normText(h[1]!).replace(/ /g, '')] ?? null
      continue
    }
    if (/^#\s/.test(line)) {
      section = null
      continue
    }
    if (section) text[section].push(line)
  }

  const bullets = (lines: string[]): { name: string; text: string }[] => {
    const out: { name: string; text: string }[] = []
    for (const line of lines) {
      const m = BULLET.exec(line)
      if (m) out.push({ name: m[1]!.replace(/:\s*$/, '').trim(), text: m[2]!.trim() })
      else if (out.length && line.trim() && /^\s+\S/.test(line)) out[out.length - 1]!.text += ' ' + line.trim()
    }
    return out
  }

  const used = new Set<string>()
  const characters = bullets(text.characters).map((b): BibleCharacter => {
    const v = VOICE.exec(b.text)
    const looks = (v ? b.text.slice(0, v.index) : b.text).trim()
    const voice = v ? b.text.slice(v.index + v[0].length).trim() : ''
    const aliases = extractAliases(b.text, b.name)
    return { key: uniqueKey(b.name, used), name: b.name, looks, ...(voice ? { voice } : {}), ...(aliases.length ? { aliases } : {}) }
  })
  const usedPlaces = new Set<string>()
  const places = bullets(text.places).map((b): BiblePlace => ({ key: uniqueKey(b.name, usedPlaces), name: b.name, looks: b.text }))
  const para = (lines: string[]) => lines.join('\n').trim()
  return { setting: para(text.setting), style: para(text.style), characters, places }
}
