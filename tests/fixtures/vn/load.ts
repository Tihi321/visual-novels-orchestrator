import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { editionSchema, projectSettingsSchema, vnBookSchema, type Edition, type ProjectSettings, type VnBook } from '../../../src/shared/vn'

const dir = path.dirname(fileURLToPath(import.meta.url))

export type FixtureName = 'linear' | 'choice'

export function loadBook(name: FixtureName): VnBook {
  return vnBookSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, `${name}.book.json`), 'utf8')))
}

export function loadEdition(name: FixtureName, lang: 'en' | 'hr'): Edition {
  return editionSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, `${name}.${lang}.json`), 'utf8')))
}

export function loadSettings(book: VnBook, over: Partial<ProjectSettings> = {}): ProjectSettings {
  return projectSettingsSchema.parse({ slug: book.slug, source: '', primaryLang: book.primaryLang, editions: ['en', 'hr'], ...over })
}

export const fixturesDir = dir
