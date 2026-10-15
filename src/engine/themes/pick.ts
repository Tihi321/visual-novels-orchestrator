import type { ProjectSettings, VnBook } from '../../shared/vn'

export const DEFAULT_THEME = 'classic-dark'

const DARK_GENRES = /\b(mystery|horror|thriller|crime|noir|detective|suspense)\b/i
const OLD_GENRES = /\b(fantasy|historical|history|medieval|fairy)/i

/**
 * Pick the game theme. `settings.theme` wins when it names an available theme; otherwise: kids formats ->
 * storybook, pixel art -> pixel-retro, mystery/horror/thriller -> noir, fantasy/historical -> parchment, else
 * classic-dark. `available` (theme names) is optional; the pick falls back to classic-dark when its choice is
 * not in the list.
 */
export function pickTheme(
  book: Pick<VnBook, 'format' | 'genre' | 'style'>,
  settings: Pick<ProjectSettings, 'theme' | 'art'> | { theme?: string | null; art?: { style?: string } },
  available?: string[]
): string {
  const ok = (name: string): boolean => !available || available.includes(name)
  if (settings.theme && ok(settings.theme)) return settings.theme

  let pick = DEFAULT_THEME
  const genre = book.genre ?? ''
  if (book.format.startsWith('kids-')) pick = 'storybook'
  else if (settings.art?.style === 'pixel' || /pixel/i.test(book.style)) pick = 'pixel-retro'
  else if (DARK_GENRES.test(genre)) pick = 'noir'
  else if (OLD_GENRES.test(genre)) pick = 'parchment'
  return ok(pick) ? pick : DEFAULT_THEME
}
