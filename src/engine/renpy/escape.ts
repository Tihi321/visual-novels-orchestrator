/**
 * Ren'Py string escaping for text that goes between double quotes (say statements, menu choices, `_("...")`).
 *
 * Rules (the template sets `config.old_substitutions = False`, so `%` is literal and needs no escaping):
 *  - `\` -> `\\`, `"` -> `\"`, a newline -> `\n`, a tab -> a space.
 *  - `[` -> `[[` (otherwise it starts a substitution), `{` -> `{{` (otherwise it starts a text tag).
 *  - Markdown emphasis becomes Ren'Py tags: `**bold**` -> `{b}..{/b}`, `*italic*` / `_italic_` -> `{i}..{/i}`.
 *
 * Order matters: the emphasis markers are found on the RAW text first and the segments between them are escaped
 * afterwards, so the `{i}` tags we add are never escaped and the `{` of the author's own text always is.
 */

interface Segment {
  text: string
  bold: boolean
  italic: boolean
}

/** Escape plain text (no emphasis handling) for use inside a Ren'Py double-quoted string. */
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

/** Split text into runs with their emphasis state. Unbalanced markers stay literal. */
function parseEmphasis(s: string): Segment[] {
  const segs: Segment[] = []
  let buf = ''
  let bold = false
  let italic = false
  const flush = (): void => {
    if (buf) segs.push({ text: buf, bold, italic })
    buf = ''
  }
  // A marker opens only if the same marker appears later, so a lone `*` is plain text.
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
      // `_x_` only at word edges, so snake_case stays literal.
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
  // An emphasis that never closed: fall back to the literal text.
  if (bold || italic) return [{ text: s, bold: false, italic: false }]
  flush()
  return segs
}

/** Escape text and turn markdown emphasis into Ren'Py text tags. This is what goes between the quotes. */
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

/** Make an ASCII identifier fragment from any text (`Mr. Šarić` -> `mr_saric`). */
export function slugify(s: string): string {
  const out = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return out || 'x'
}
