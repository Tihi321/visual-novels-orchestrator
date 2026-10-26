// Duplicate-chapter detector for Scriptorium books.
//   node scripts/dup-check.mjs [book ...]
// With no arguments: every book folder under ~/Scriptorium/books that has chapters.
// For each pair of adjacent chapters it reports the share of 8-word shingles of the shorter
// chapter that also appear in the other, and the longest repeated phrases, so a duplicated
// climax can be fixed before (or instead of) another review round.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ROOT = join(homedir(), 'Scriptorium', 'books')
const N = 8

function words(text) {
  return text
    .replace(/^---[\s\S]*?---/m, '') // frontmatter
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function shingles(ws) {
  const set = new Map()
  for (let i = 0; i + N <= ws.length; i++) {
    const s = ws.slice(i, i + N).join(' ')
    if (!set.has(s)) set.set(s, i)
  }
  return set
}

function chapterFiles(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => /^ch-\d+\.md$/.test(n))
    .sort()
    .map((n) => ({ name: n, path: join(dir, n) }))
}

function analyseBook(slug) {
  const dir = join(ROOT, slug, 'chapters')
  const files = chapterFiles(dir)
  if (files.length < 2) return null
  const chapters = files.map((f) => ({ name: f.name, ws: words(readFileSync(f.path, 'utf8')) }))
  const pairs = []
  for (let i = 0; i + 1 < chapters.length; i++) {
    const a = chapters[i]
    const b = chapters[i + 1]
    const sa = shingles(a.ws)
    const sb = shingles(b.ws)
    const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa]
    let shared = 0
    const examples = []
    for (const [s] of small) {
      if (large.has(s)) {
        shared++
        if (examples.length < 4) examples.push(s)
      }
    }
    const ratio = small.size ? shared / small.size : 0
    if (ratio > 0.01) pairs.push({ a: a.name, b: b.name, ratio, examples })
  }
  pairs.sort((x, y) => y.ratio - x.ratio)
  return { slug, chapters: chapters.length, pairs }
}

const args = process.argv.slice(2)
const slugs = args.length
  ? args
  : readdirSync(ROOT).filter((n) => {
      try {
        return statSync(join(ROOT, n)).isDirectory()
      } catch {
        return false
      }
    })

let flagged = 0
for (const slug of slugs) {
  const r = analyseBook(slug)
  if (!r) continue
  const worst = r.pairs[0]
  if (!worst || worst.ratio < 0.02) {
    console.log(`${r.slug.padEnd(40)} ${String(r.chapters).padStart(2)} ch  clean (max ${(100 * (worst?.ratio ?? 0)).toFixed(1)}%)`)
    continue
  }
  flagged++
  console.log(`${r.slug.padEnd(40)} ${String(r.chapters).padStart(2)} ch  OVERLAP`)
  for (const p of r.pairs.slice(0, 3)) {
    console.log(`  ${p.a} ~ ${p.b}: ${(100 * p.ratio).toFixed(1)}% of the shorter chapter repeats`)
    for (const e of p.examples) console.log(`    "${e}"`)
  }
}
console.log(`\n${flagged} book(s) with an adjacent-chapter overlap above 2%.`)
