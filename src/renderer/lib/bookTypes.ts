/**
 * The Scriptorium format ids grouped into the Library's type groups.
 *
 * Twin of `scriptorium/src/renderer/store/bookTypes.ts`: the table, the group ids and the labels must stay the same in both apps,
 * so change them together. The one difference: the label of `picture` is "Picture books" here (VN Studio never holds bedtime text formats).
 */

export type TypeGroup = 'stories' | 'nonfiction' | 'vn' | 'picture' | 'scripts' | 'puzzle' | 'other'

/** Display order of the type chips. */
export const TYPE_GROUPS: { id: TypeGroup; label: string }[] = [
  { id: 'stories', label: 'Novels & stories' },
  { id: 'vn', label: 'Visual novels' },
  { id: 'picture', label: 'Picture books' },
  { id: 'scripts', label: 'Scripts & film' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'nonfiction', label: 'Non-fiction' },
  { id: 'other', label: 'Other' }
]

interface FormatInfo {
  group: TypeGroup
  choices?: boolean
}

const FORMATS: Record<string, FormatInfo> = {
  'short-story': { group: 'stories' },
  'chapter-book': { group: 'stories' },
  'middle-grade': { group: 'stories' },
  novella: { group: 'stories' },
  novel: { group: 'stories' },
  gamebook: { group: 'stories', choices: true },
  'kids-choice-book': { group: 'stories', choices: true },
  'bedtime-toddler': { group: 'picture' },
  'bedtime-story': { group: 'picture' },
  'kids-picture-book': { group: 'picture' },
  'visual-novel': { group: 'vn' },
  'choice-visual-novel': { group: 'vn', choices: true },
  'kids-visual-story': { group: 'vn' },
  'kids-choice-visual-story': { group: 'vn', choices: true },
  'short-film': { group: 'scripts' },
  cartoon: { group: 'scripts' },
  'kids-cartoon': { group: 'scripts' },
  'mystery-puzzle-visual-novel': { group: 'puzzle' },
  'nonfiction-short': { group: 'nonfiction' },
  'nonfiction-kids': { group: 'nonfiction' },
  article: { group: 'nonfiction' },
  'feature-article': { group: 'nonfiction' }
}

function infoOf(format: string): FormatInfo {
  const known = FORMATS[format]
  if (known) return known
  const choices = /choice|gamebook/.test(format)
  if (/film|cartoon|screenplay/.test(format)) return { group: 'scripts', choices }
  if (/puzzle/.test(format)) return { group: 'puzzle', choices }
  if (/visual|vn/.test(format)) return { group: 'vn', choices }
  if (/picture|bedtime/.test(format)) return { group: 'picture', choices }
  if (/nonfiction|article/.test(format)) return { group: 'nonfiction', choices }
  return { group: 'other', choices }
}

export function typeGroupOf(format: string): TypeGroup {
  return infoOf(format).group
}

export function hasChoices(format: string): boolean {
  return infoOf(format).choices === true
}

/** The badge of a format: null for plain stories. */
export function typeBadge(format: string): { text: string; group: TypeGroup; choices: boolean } | null {
  const { group } = infoOf(format)
  const choices = hasChoices(format)
  switch (group) {
    case 'vn':
      return { text: choices ? 'Choice VN' : 'VN', group, choices }
    case 'stories':
      return choices ? { text: 'Choices', group, choices } : null
    case 'picture':
      return { text: format === 'kids-picture-book' ? 'Picture book' : 'Bedtime', group, choices }
    case 'scripts':
      return { text: format === 'short-film' ? 'Film' : 'Cartoon', group, choices }
    case 'puzzle':
      return { text: 'Puzzle', group, choices }
    case 'nonfiction':
      return { text: 'Non-fiction', group, choices }
    default:
      return { text: format, group, choices }
  }
}
