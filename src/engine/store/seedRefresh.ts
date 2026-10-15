import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomic'

/**
 * Seed refresh. The data folder is made from `seed/` and never overwritten, so a prompt or config improved in a new release never reached
 * an existing data folder. This keeps the hash of each seed file as it was copied (`.seed-hashes.json`):
 *
 * - the file is not there: copy it;
 * - it is the same as the seed: nothing to do;
 * - it is still the seed version that was copied (its hash is the recorded one, or a known earlier seed version): untouched, so update it;
 * - otherwise you edited it (or the app did): keep it, and note that an update is available.
 *
 * Text is hashed with line endings normalised (Windows checkouts have CRLF).
 */

export const SEED_HASHES_FILE = '.seed-hashes.json'

export const seedHash = (content: string | Buffer): string => createHash('sha1').update(content.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')

/**
 * The hashes of the seed files as VNO-01 shipped them, for data folders made before the hashes were recorded.
 * A file whose hash is in here was never edited, so a newer seed version may replace it.
 */
export const SEED_HISTORY: Record<string, string[]> = {
  'config/budget.md': ['2fec03e66314e9171ada0b8a80a4fdf5c9ca4d47'],
  'config/comfy.md': ['f4c50af40202013df75b99cff084a62574c8a5bd'],
  'config/models.md': ['54ea1ce85b0ec431933ed8713255c077ca466077'],
  'config/providers.md': ['52f7f1fcea6bb96b93b518b170f3b67eda898e99'],
  'config/renpy.md': ['ee45c4fdd67af0303d9a17a22ce504e50a08b479'],
  'config/roles.md': ['81502202bbd57fd4ec3e341f189dff696b9a6b07'],
  'config/settings.md': ['14c8e4f0bd587cf3e070a41aabd66a4247d62f72'],
  'config/voice.md': ['e481b8e3e083fe86389b44fb665aa30d6c042919'],
  'palettes/cga.hex': ['c3d221752b2ab710b508dc1a0dc584d13c770f19'],
  'palettes/db16.hex': ['1fffb9a3e66bda452a7d50db327d1a121fe8a036'],
  'palettes/db32.hex': ['8c9b9aa779d7216463b44222c66b6377c57c33d5'],
  'palettes/endesga-32.hex': ['b5530491e97fb6079182c02450fd4c40bd9d3368'],
  'palettes/endesga-64.hex': ['576fff32c5a2819d110387c33fbd2bcbe77f2e5b'],
  'palettes/gameboy.hex': ['3ca802e9f64d8d1bc1a38779c90bd9ca934dece5'],
  'palettes/nes.hex': ['6a389c76f4ff4f21150db2b05e800beb84f003d8'],
  'palettes/pico-8.hex': ['485c0074b853f163b42c7b09670e3f555b8a0062'],
  'palettes/resurrect-64.hex': ['466f9be4b8c0e89b20310d6bb7cbcd9944246a13'],
  'palettes/sweetie-16.hex': ['64a6e951860647900a0b538b1230591cc67c1a7b'],
  'prompts/art-critic/review_image.md': ['affa0b3ed54b11bbe68f16b7d88939ece6488bad'],
  'prompts/art-director/plan_art.md': ['9318f9534f00ef15596ad386fc798ed2d3d3e0d6'],
  'prompts/composer/plan_music.md': ['cd4ba59979eb500333dc506714a018f064ce0788'],
  'prompts/director/summarize_run.md': ['7fae7be2ff56bd3a9f69d4f50055e11d4f286dbe'],
  'prompts/edition-aligner/resolve_alignment.md': ['95c08dc83848c96fcbe26f009ed846d30989ab47'],
  'prompts/script-analyst/resolve_uncertain.md': ['879a9d2c74565c3eb326d8611426ecccfa6db18d'],
  'prompts/stage-director/stage_chapter.md': ['54c873794e777ad561b3c9d6ddf0a9518e86f0f4'],
  'prompts/voice-director/plan_voices.md': ['0c58d203bc45b30858901d64328fe76662b2f489'],
  'workflows/chatterbox-multilingual.json': ['13cb798511a19d50d2eb3f6959aa6a4a7ce60449'],
  'workflows/chatterbox-multilingual.map.yaml': ['4d4e6a100d5f7f3e3925aac1f9df0877b52960b7']
}

export interface SeedState {
  version: 1
  /** Seed file (relative, `/`) -> hash of the seed version that was last copied or confirmed. */
  files: Record<string, string>
  /** Files you edited that have a newer seed version. */
  updateAvailable: string[]
}

export const emptySeedState = (): SeedState => ({ version: 1, files: {}, updateAvailable: [] })

export type SeedAction = 'copy' | 'same' | 'update' | 'keep'

/**
 * What to do with one seed file. `destHash` is null when the file is not in the data folder. Returns the action and the new state of that file
 * (`recorded`: the hash to remember, or undefined to forget; `pending`: an update is available for the edited file).
 */
export function planSeedFile(rel: string, seed: string, destHash: string | null, state: Pick<SeedState, 'files'>, history: Record<string, string[]> = SEED_HISTORY): { action: SeedAction; recorded: string | undefined; pending: boolean } {
  const recorded = state.files[rel]
  if (destHash === null) return { action: 'copy', recorded: seed, pending: false }
  if (destHash === seed) return { action: 'same', recorded: seed, pending: false }
  const past = history[rel] ?? []
  const untouched = destHash === recorded || past.includes(destHash)
  if (untouched) return { action: 'update', recorded: seed, pending: false }
  // edited by you. A seed that did not change since the version your file came from has no update; a changed one does.
  const seedChanged = recorded !== undefined ? recorded !== seed : !past.includes(seed)
  return { action: 'keep', recorded: recorded ?? (seedChanged ? undefined : seed), pending: seedChanged }
}

export async function loadSeedState(dataDir: string): Promise<SeedState> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(dataDir, SEED_HASHES_FILE), 'utf8')) as Partial<SeedState>
    return { version: 1, files: { ...(j.files ?? {}) }, updateAvailable: [...(j.updateAvailable ?? [])] }
  } catch {
    return emptySeedState()
  }
}

export async function saveSeedState(dataDir: string, state: SeedState): Promise<void> {
  const sorted: SeedState = { version: 1, files: Object.fromEntries(Object.entries(state.files).sort(([a], [b]) => a.localeCompare(b))), updateAvailable: [...state.updateAvailable].sort() }
  await atomicWrite(path.join(dataDir, SEED_HASHES_FILE), JSON.stringify(sorted, null, 2) + '\n')
}

/** The seeded files with a newer version that you edited (kept), from the last `initDataFolder`. */
export async function readSeedNotes(dataDir: string): Promise<{ updateAvailable: string[] }> {
  return { updateAvailable: (await loadSeedState(dataDir)).updateAvailable }
}

/** Applies `planSeedFile` to one file on disk and updates the state. Returns the action taken. */
export async function syncSeedFile(rel: string, from: string, to: string, state: SeedState): Promise<SeedAction> {
  const seedBytes = await fs.readFile(from)
  const seed = seedHash(seedBytes)
  let destHash: string | null = null
  try {
    destHash = seedHash(await fs.readFile(to))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const plan = planSeedFile(rel, seed, destHash, state)
  if (plan.action === 'copy' || plan.action === 'update') {
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.writeFile(to, seedBytes)
  }
  if (plan.recorded === undefined) delete state.files[rel]
  else state.files[rel] = plan.recorded
  state.updateAvailable = state.updateAvailable.filter((f) => f !== rel)
  if (plan.pending) state.updateAvailable.push(rel)
  return plan.action
}
