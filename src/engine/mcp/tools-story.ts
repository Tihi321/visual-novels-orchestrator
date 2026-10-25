import { z } from 'zod'
import type { ProjectSettingsPatch } from '../../shared/protocol'
import { langSchema } from '../../shared/vn'
import { storyInputSchema, storyOpSchema } from '../vn/story'
import type { StoryOp } from '../vn/story'
import type { VnService } from '../vn/service'
import type { Tool, ToolDef } from './tools'

/**
 * The story tools: make a visual novel from JSON (no book folder) and edit its chapters, scenes, beats, characters and places.
 * Every edit goes through `VnService.editStory`, so one tool and the batch tool behave the same.
 */

const slug = z.string().describe('The project slug (see vno_list_projects)')
const BUILD_HINT = 'Run vno_build to see the change in the game.'

const IDS = 'Ids: chapters are numbers (1, 2 ...), scenes look like ch01.s02, beats like ch01.s02.b003. They never change when something is inserted or removed.'

/** The schema of one operation, for the one-operation tools. */
const opSchema = (name: StoryOp['op']) => storyOpSchema.options.find((o) => o.shape.op.value === name)!

export function storyTools(svc: VnService, def: ToolDef): Tool[] {
  const edit = async (slugName: string, ops: StoryOp[]) => {
    const r = await svc.editStory(slugName, ops)
    const art = r.assets.cleared.length ? ` ${r.assets.cleared.length} asset(s) lost their prompt (they have no image yet): run vno_plan to write them again.` : ''
    const stale = r.assets.stale.length ? ` ${r.assets.stale.length} asset(s) already have an image of the old subject (stale): make a new one with vno_asset_regen.` : ''
    return { ...r, next: `${BUILD_HINT}${art}${stale}` }
  }

  /** A tool that runs one operation: the operation's fields plus the slug. */
  const one = (name: string, op: StoryOp['op'], description: string): Tool =>
    def(name, `${description} ${IDS} ${BUILD_HINT}`, (opSchema(op) as unknown as z.ZodObject).omit({ op: true }).extend({ slug }), async (a) => {
      const { slug: s, ...rest } = a as { slug: string } & Record<string, unknown>
      return edit(s, [{ op, ...rest } as StoryOp])
    })

  return [
    def(
      'vno_create_project',
      `Make a new visual novel project from a story written as JSON, with no book folder. Give the title, the characters (key, name, looks), the places (key, name, looks) and the chapters, each with scenes and beats. A beat is a cast beat ({ cast: ["mara", "tom"] }: who is on screen from here on), a line ({ speaker: "mara", expression: "happy", text }) or a narration ({ text }). A beat with text, a speaker or a cast may also carry cues: image (a key of images: a CG or an insert shown from this beat, null hides it), sfx (a key of sounds: an effect played when the beat starts) and ambience (a key of sounds: a looped ambience started here, null stops it). A scene may have music (a track id such as music_02, null for silence) and ambience. images (key, description, display full or insert, characters) and sounds (key, kind sfx or ambience, description) are the catalogues those keys point to; expressions is the expression set of the book (default neutral, happy, sad, angry, surprised, worried, scared, thinking; it must include neutral) and a character may add its own expressions. A chapter has choices ([{ text, to: <chapter number> }]) or, in a book with choices, an ending text; a book where no chapter has choices is linear. Beats may name a character or place by key or by name; an unknown speaker or place is allowed with a warning. The language is detected unless you pass lang. This makes the project and its asset list only: next run vno_plan (or vno_run_pipeline from art) to write the prompts, vno_asset_generate for the images (or vno_asset_replace with your own), then vno_build and vno_lint. ${IDS} Returns the slug, the warnings and the asset counts.`,
      z.object({
        book: storyInputSchema,
        lang: langSchema.optional().describe('The language of the text (also allowed inside book). Left out: detected'),
        settings: z
          .object({
            theme: z.string().nullable().optional(),
            art: z.record(z.string(), z.unknown()).optional(),
            music: z.record(z.string(), z.unknown()).optional(),
            voice: z.record(z.string(), z.unknown()).optional()
          })
          .optional()
          .describe('The same as vno_update_settings: theme, art, music, voice'),
        run: z.boolean().optional().describe('Start the pipeline from the analyse step after creating the project')
      }),
      async (a) => {
        const r = await svc.createProject(a.book, { lang: a.lang, settings: a.settings as ProjectSettingsPatch | undefined })
        const counts: Record<string, number> = {}
        for (const x of await svc.listAssets(r.slug)) if (!x.orphaned) counts[x.kind] = (counts[x.kind] ?? 0) + 1
        const run = a.run ? await svc.runPipeline(r.slug, 'analyse') : null
        return { slug: r.slug, lang: r.lang, warnings: r.warnings, assets: counts, run, next: a.run ? 'The pipeline runs: follow it with vno_status.' : 'Next: vno_plan, then vno_asset_generate (or vno_asset_replace), then vno_build.' }
      }
    ),
    def(
      'vno_get_story',
      `Read the story of a project: the whole book (characters, places, chapters, scenes, beats with their ids), or one chapter by number. Use it to find the ids before an edit. ${IDS}`,
      z.object({ slug, chapter: z.number().int().positive().optional().describe('A chapter number. Left out: the whole book') }),
      async (a) => svc.getStory(a.slug, a.chapter)
    ),
    def(
      'vno_story_edit',
      `Edit the story with a list of operations applied in order, all or nothing: if the result is invalid (a choice to a missing chapter, a cast member that is not a character ...) nothing is saved. Each operation has an op: book.update, character.set, character.remove, place.set, place.remove, image.set, image.remove, sound.set, sound.remove, chapter.add, chapter.update, chapter.remove, scene.add, scene.update, scene.remove, beat.add, beat.update, beat.remove. New scenes and beats get the next free id; existing ids never change. Assets whose subject changed lose their prompt (no image yet) or are reported stale (have an image); locked and custom ones are kept. ${IDS} ${BUILD_HINT}`,
      z.object({ slug, ops: z.array(storyOpSchema).min(1) }),
      async (a) => edit(a.slug, a.ops)
    ),
    one('vno_book_update', 'book.update', 'Change the title, author, genre, style, cover brief or format of the book.'),
    one('vno_character_set', 'character.set', 'Add a character or change one: key (an existing one to change, or the key of a new one), name, looks (what the sprites look like), voice (a note), aliases (other names the story calls the character by, such as "the bald man": a line spoken under one belongs to the character and shows that name in the game; replaces the list, null clears it). A new character without a key gets one made from the name. Renaming updates the speaker labels of its lines, except the ones under an alias.'),
    one('vno_character_remove', 'character.remove', 'Remove a character. Refused while it is in a cast or speaks a line, unless force: then its cast entries are removed and its lines lose the speaker.'),
    one('vno_image_set', 'image.set', 'Add a picture (a CG shown over the scene, or an insert: an object or a document shown small in the middle) or change one: key, description (what it shows: the prompt is made from it), display (full or insert), characters (keys: their sheets are its references, at most three). Beats show it with image: <key>; the asset is cg_<key>.'),
    one('vno_image_remove', 'image.remove', 'Remove a picture. Refused while a beat shows it, unless force: then those beats lose the cue.'),
    one('vno_sound_set', 'sound.set', 'Add a sound or change one: key, kind (sfx: played once, ambience: looped until stopped), description (what it sounds like: the prompt is made from it). Beats play it with sfx: <key> or ambience: <key>; the assets are sfx_<key> and amb_<key>. A sound effect is made by sound.sfxEngine when set (an audio engine or custom:<workflow> for ComfyUI; chiptune for Chiptune Studio; "none" to import files only), else by the music/ambience audio engine (Chiptune Studio for a pixel book).'),
    one('vno_sound_remove', 'sound.remove', 'Remove a sound. Refused while a beat or scene plays it, unless force: then those cues are cleared. kind says which when a sound effect and an ambience share the key.'),
    one('vno_place_set', 'place.set', 'Add a place or change one: key (an existing one to change, or the key of a new one), name, looks (what the background looks like). Scenes written with that place name are connected to it.'),
    one('vno_place_remove', 'place.remove', 'Remove a place. Refused while a scene uses it, unless force: then those scenes keep the place text without the place.'),
    one('vno_chapter_add', 'chapter.add', 'Add a chapter (title, summary, choices, ending, scenes with beats). n defaults to the highest number plus one; after puts it after a chapter number.'),
    one('vno_chapter_update', 'chapter.update', 'Change a chapter: title, summary, ending (the ending text of a chapter that ends the game) or choices (replaces the list; each is { text, to: chapter number }).'),
    one('vno_chapter_remove', 'chapter.remove', 'Remove a chapter with its scenes. Refused while a choice still leads to it.'),
    one('vno_scene_add', 'scene.add', 'Add a scene to a chapter: place (a key, a name or free text), time, description, breakBefore and its beats. at is its position in the chapter (from 0, default the end).'),
    one('vno_scene_update', 'scene.update', 'Change a scene: place, time (the background follows them), description, breakBefore.'),
    one('vno_scene_remove', 'scene.remove', 'Remove a scene with its beats.'),
    one('vno_beat_add', 'beat.add', 'Add beats to a scene: cast ({ cast: [keys] }), lines ({ speaker, expression, text }), narration ({ text }) or a puzzle the player solves here ({ puzzle: key }, see vno_puzzle_set). at is the position (from 0) or after is a beat id; default the end.'),
    one('vno_beat_update', 'beat.update', 'Change a beat: text (line or narration), speaker and expression (line), cast (cast beat: the new list of who is on screen).'),
    one('vno_beat_remove', 'beat.remove', 'Remove beats by id (beatIds).'),
    def(
      'vno_edition_set',
      `Write the text of another language yourself (no book folder needed): a new edition, or entries merged into the existing one (replace: start from an empty one). beats maps text beat ids to their text; chapterTitles and endings map chapter numbers; choiceTexts maps "<chapter>:<choice index from 0>"; characterNames maps character keys; puzzles maps a puzzle key to { names: item id -> name, text: clue id (and murder) -> clue in prose } in that language (check it with vno_puzzle_check_text {lang}). Every key must exist in the book (vno_get_story). Text you leave out stays in the primary language; the result lists what is missing. For the primary language use the story tools. ${BUILD_HINT}`,
      z.object({
        slug,
        lang: langSchema.describe('The language code of the edition (vno_languages)'),
        title: z.string().optional(),
        chapterTitles: z.record(z.string(), z.string()).optional(),
        choiceTexts: z.record(z.string(), z.string()).optional(),
        endings: z.record(z.string(), z.string()).optional(),
        characterNames: z.record(z.string(), z.string()).optional(),
        beats: z.record(z.string(), z.string()).optional(),
        puzzles: z.record(z.string(), z.object({ names: z.record(z.string(), z.string()).optional(), text: z.record(z.string(), z.string()).optional() })).optional(),
        replace: z.boolean().optional()
      }),
      async ({ slug: s, lang, ...patch }) => {
        const r = await svc.setEdition(s, lang, patch as Parameters<VnService['setEdition']>[2])
        const e = r.edition
        return { lang, title: e.title, beats: Object.keys(e.beats).length, missing: { beats: r.missing.beats.length, beatIds: r.missing.beats.slice(0, 20), other: r.missing.other }, next: BUILD_HINT }
      }
    )
  ]
}
