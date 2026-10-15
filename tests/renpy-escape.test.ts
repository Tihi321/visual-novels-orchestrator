import { describe, expect, it } from 'vitest'
import { escapeRenpy, renpyPlainString, renpyString, renpyText, slugify } from '../src/engine/renpy/escape'

describe('escapeRenpy', () => {
  it('escapes backslash, quote, bracket and brace', () => {
    expect(escapeRenpy('a\\b')).toBe('a\\\\b')
    expect(escapeRenpy('say "hi"')).toBe('say \\"hi\\"')
    expect(escapeRenpy('[name] and {b}')).toBe('[[name] and {{b}')
  })

  it('leaves % alone (old substitutions are off in the template)', () => {
    expect(escapeRenpy('100% sure, 50%s')).toBe('100% sure, 50%s')
  })

  it('turns a newline into \\n and drops carriage returns and tabs', () => {
    expect(escapeRenpy('a\r\nb\tc')).toBe('a\\nb c')
  })

  it('keeps Croatian letters and typographic quotes', () => {
    expect(escapeRenpy('Čuvar svjetionika, đak “šuti” žuto ćud')).toBe('Čuvar svjetionika, đak “šuti” žuto ćud')
  })
})

describe('renpyText (emphasis after escaping)', () => {
  it('turns **bold** and *italic* into tags', () => {
    expect(renpyText('a **b** and *c*')).toBe('a {b}b{/b} and {i}c{/i}')
  })

  it('turns _italic_ into a tag only at word edges', () => {
    expect(renpyText('so _very_ much')).toBe('so {i}very{/i} much')
    expect(renpyText('snake_case_name stays')).toBe('snake_case_name stays')
  })

  it('escapes the author text but not the tags we add', () => {
    expect(renpyText('*[x]* and {y}')).toBe('{i}[[x]{/i} and {{y}')
    expect(renpyText('**say "no"**')).toBe('{b}say \\"no\\"{/b}')
  })

  it('does not let author braces make a tag', () => {
    expect(renpyText('{i}not italic{/i}')).toBe('{{i}not italic{{/i}')
  })

  it('nests bold inside italic text without crossing', () => {
    expect(renpyText('*a* **b**')).toBe('{i}a{/i} {b}b{/b}')
  })

  it('leaves a lone or unbalanced marker as text', () => {
    expect(renpyText('2 * 3 = 6')).toBe('2 * 3 = 6')
    expect(renpyText('an *open emphasis')).toBe('an *open emphasis')
    expect(renpyText('a ** b')).toBe('a ** b')
  })

  it('lets a backslash protect a marker', () => {
    expect(renpyText('\\*not italic\\*')).toBe('*not italic*')
  })

  it('trims the text', () => {
    expect(renpyText('  hi  ')).toBe('hi')
  })
})

describe('renpyString / renpyPlainString / slugify', () => {
  it('quotes the literal', () => {
    expect(renpyString('He said "*stop*"')).toBe('"He said \\"{i}stop{/i}\\""')
    expect(renpyPlainString('Mr. *X*')).toBe('"Mr. *X*"')
  })

  it('makes ASCII slugs', () => {
    expect(slugify('Mr. Šarić')).toBe('mr_saric')
    expect(slugify('Đuro')).toBe('duro')
    expect(slugify('???')).toBe('x')
  })
})
