import { asciiSlug } from '../vn/ids'

/**
 * Text escaping and formatting for both Ren'Py backward compatibility and
 * HTML5 Visual Novel web runtime typography.
 */

export interface Segment {
  text: string
  bold: boolean
  italic: boolean
}

/** Escape plain text for use inside a Ren'Py double-quoted string. */
export function escapeRenpy(s: string): string {
  let out = ''
  for (const ch of s) {
    switch (ch) {
      case '\\':
        out += '\\\\'
        break
      case '"':
        out += '\\"'
        break
      case '[':
        out += '[['
        break
      case '{':
        out += '{{'
        break
      case '\r':
        break
      case '\n':
        out += '\\n'
        break
      case '\t':
        out += ' '
        break
      default:
        out += ch
    }
  }
  return out
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Split text into runs with their markdown emphasis state (**bold**, *italic*, _italic_). */
export function parseEmphasis(s: string): Segment[] {
  const segs: Segment[] = []
  let buf = ''
  let bold = false
  let italic = false

  const flush = (): void => {
    if (buf) segs.push({ text: buf, bold, italic })
    buf = ''
  }

  const closes = (from: number, marker: string): boolean => s.indexOf(marker, from) > from
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === '\\' && i + 1 < s.length && '*_'.includes(s[i + 1]!)) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '*' && s[i + 1] === '*') {
      if (bold) {
        flush()
        bold = false
        i += 2
        continue
      }
      if (closes(i + 2, '**')) {
        flush()
        bold = true
        i += 2
        continue
      }
    } else if (c === '*') {
      if (italic) {
        flush()
        italic = false
        i += 1
        continue
      }
      if (closes(i + 1, '*') && s[i + 1] !== ' ') {
        flush()
        italic = true
        i += 1
        continue
      }
    } else if (c === '_') {
      if (italic && !isWordChar(s[i + 1]) && isWordChar(s[i - 1])) {
        flush()
        italic = false
        i += 1
        continue
      }
      if (!italic && !isWordChar(s[i - 1]) && isWordChar(s[i + 1]) && closes(i + 1, '_')) {
        flush()
        italic = true
        i += 1
        continue
      }
    }
    buf += c
    i += 1
  }

  if (bold || italic) return [{ text: s, bold: false, italic: false }]
  flush()
  return segs
}

/** Escape text and turn markdown emphasis into Ren'Py text tags. */
export function renpyText(s: string): string {
  return parseEmphasis(s.trim())
    .map((seg) => {
      let t = escapeRenpy(seg.text)
      if (seg.italic) t = `{i}${t}{/i}`
      if (seg.bold) t = `{b}${t}{/b}`
      return t
    })
    .join('')
}

/** A full quoted literal, emphasis included: `"Hello {i}you{/i}"`. */
export function renpyString(s: string): string {
  return `"${renpyText(s)}"`
}

/** A quoted literal without emphasis handling (names, UI strings). */
export function renpyPlainString(s: string): string {
  return `"${escapeRenpy(s)}"`
}

/** Make an ASCII identifier fragment from any text. */
export function slugify(s: string): string {
  return asciiSlug(s, { sep: '_', fallback: 'x' })
}

/** Safely escape special HTML characters. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Safely HTML-escapes text and converts:
 * `**bold**` -> `<strong>...</strong>`
 * `*italic*` / `_italic_` -> `<em>...</em>`
 * `\n` -> `<br/>`
 */
export function renderHtmlEmphasis(s: string): string {
  return parseEmphasis(s.trim())
    .map((seg) => {
      let html = escapeHtml(seg.text).replace(/\r\n/g, '<br/>').replace(/[\r\n]/g, '<br/>')
      if (seg.italic) html = `<em>${html}</em>`
      if (seg.bold) html = `<strong>${html}</strong>`
      return html
    })
    .join('')
}
