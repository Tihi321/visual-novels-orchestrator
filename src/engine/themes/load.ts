import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Game themes: a folder `themes/<name>/` with a `theme.yaml` (colours, fonts, textbox, namebox, choice buttons,
 * transitions), optional `fonts/` and optional frame PNGs. Custom themes are copies of a built-in folder.
 */

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'a #rrggbb or #rrggbbaa colour')

export const themeSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string(),
  description: z.string().default(''),
  /** A light theme: dark text on a light box. Used for the GUI generation and the name colours. */
  light: z.boolean().default(false),
  /** Pixel look: nearest-neighbour scaling and no smoothing. */
  pixel: z.boolean().default(false),
  colors: z.object({
    accent: color,
    /** The base colour of the menus (the `boring` colour of Ren'Py's GUI generator). */
    background: color.default('#101018'),
    text: color.default('#ffffff'),
    idle: color.default('#888888'),
    hover: color,
    selected: color.default('#ffffff'),
    insensitive: color.default('#8888887f'),
    muted: color
  }),
  textbox: z
    .object({
      color: color.default('#000000'),
      opacity: z.number().min(0).max(1).default(0.7),
      /** A line along the top edge of the textbox. */
      borderColor: color.nullable().default(null),
      radius: z.number().min(0).default(0)
    })
    .default({ color: '#000000', opacity: 0.7, borderColor: null, radius: 0 }),
  namebox: z
    .object({
      color: color.default('#222222'),
      opacity: z.number().min(0).max(1).default(0.9),
      radius: z.number().min(0).default(0),
      /** The colour of the name text. Null: the character's own colour. */
      textColor: color.nullable().default(null)
    })
    .default({ color: '#222222', opacity: 0.9, radius: 0, textColor: null }),
  /** Font file names: in the theme's `fonts/` folder, or a font that ships with Ren'Py (`DejaVuSans.ttf`). */
  fonts: z
    .object({
      text: z.string().default('DejaVuSans.ttf'),
      name: z.string().optional(),
      interface: z.string().optional(),
      bold: z.string().optional()
    })
    .default({ text: 'DejaVuSans.ttf' }),
  sizes: z
    .object({
      text: z.number().int().positive().default(33),
      name: z.number().int().positive().default(45),
      interface: z.number().int().positive().default(33),
      label: z.number().int().positive().default(36),
      title: z.number().int().positive().default(75),
      choice: z.number().int().positive().default(33)
    })
    .default({ text: 33, name: 45, interface: 33, label: 36, title: 75, choice: 33 }),
  choice: z
    .object({
      color: color.default('#00000099'),
      hoverColor: color.optional(),
      borderColor: color.nullable().default(null),
      radius: z.number().min(0).default(8),
      textColor: color.optional(),
      hoverTextColor: color.optional()
    })
    .default({ color: '#00000099', borderColor: null, radius: 8 }),
  /** Seconds. */
  transitions: z
    .object({
      dissolve: z.number().nonnegative().default(0.6),
      show: z.number().nonnegative().default(0.25),
      fade: z.number().nonnegative().default(0.6)
    })
    .default({ dissolve: 0.6, show: 0.25, fade: 0.6 }),
  /** Optional frame images (file names in the theme folder). They replace the generated ones. */
  frames: z
    .object({
      textbox: z.string().optional(),
      namebox: z.string().optional(),
      choiceIdle: z.string().optional(),
      choiceHover: z.string().optional()
    })
    .default({})
})
export type Theme = z.infer<typeof themeSchema>

export interface LoadedTheme {
  theme: Theme
  /** The theme folder. */
  dir: string
}

export function defaultThemesDir(): string {
  return process.env.VNO_THEMES ? path.resolve(process.env.VNO_THEMES) : path.resolve(process.cwd(), 'themes')
}

export function loadTheme(dir: string): LoadedTheme {
  const file = path.join(dir, 'theme.yaml')
  const raw = parseYaml(fs.readFileSync(file, 'utf8')) as unknown
  const theme = themeSchema.parse(raw)
  return { theme, dir }
}

/** Every theme folder under `root` that has a valid `theme.yaml`. Broken ones are returned in `errors`. */
export function listThemes(root: string = defaultThemesDir()): { themes: LoadedTheme[]; errors: string[] } {
  const themes: LoadedTheme[] = []
  const errors: string[] = []
  if (!fs.existsSync(root)) return { themes, errors }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    if (!fs.existsSync(path.join(dir, 'theme.yaml'))) continue
    try {
      themes.push(loadTheme(dir))
    } catch (e) {
      errors.push(`${entry.name}: ${(e as Error).message}`)
    }
  }
  themes.sort((a, b) => a.theme.name.localeCompare(b.theme.name))
  return { themes, errors }
}

/** Find a theme by name under `root` (the folder name or the `name` in the file). */
export function findTheme(name: string, root: string = defaultThemesDir()): LoadedTheme | null {
  return listThemes(root).themes.find((t) => t.theme.name === name || path.basename(t.dir) === name) ?? null
}
