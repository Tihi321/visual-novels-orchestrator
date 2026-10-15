import { projectSettingsSchema, type ProjectSettings, type VnBook } from '../src/shared/vn'

export const book: VnBook = {
  slug: 'soother',
  title: 'The Soother',
  genre: 'fantasy',
  format: 'choice-visual-novel',
  kind: 'choice',
  primaryLang: 'en',
  style: 'soft watercolour storybook',
  characters: [
    { key: 'petra', name: 'Petra', looks: 'a small girl with red braids' },
    { key: 'mango', name: 'Mango', looks: 'a green dragon' },
    { key: 'wizard', name: 'Wizard', looks: 'tall, grey beard' }
  ],
  places: [{ key: 'harbour', name: 'Harbour', looks: 'wooden pier, gulls' }],
  coverBrief: 'a girl and a dragon on a pier',
  warnings: [],
  chapters: [
    {
      n: 1,
      title: 'One',
      choices: [],
      ending: null,
      scenes: [
        {
          id: 'ch01.s01',
          placeKey: 'harbour',
          placeText: 'Harbour',
          time: 'dusk',
          backgroundId: 'bg_harbour_dusk',
          description: 'The sun sinks behind the masts.',
          breakBefore: false,
          beats: [
            { id: 'ch01.s01.b001', type: 'cast', cast: [{ charKey: 'petra' }, { charKey: 'wizard' }] },
            { id: 'ch01.s01.b002', type: 'narration', text: 'Evening came.' },
            { id: 'ch01.s01.b003', type: 'line', speakerKey: 'petra', speakerLabel: 'Petra', expression: 'worried', text: 'Oh no.' },
            { id: 'ch01.s01.b004', type: 'line', speakerKey: 'petra', speakerLabel: 'Petra', expression: 'worried', text: 'Again.' },
            { id: 'ch01.s01.b005', type: 'line', speakerKey: 'mango', speakerLabel: 'Mango', expression: 'happy', text: 'Hi!' },
            { id: 'ch01.s01.b006', type: 'line', speakerKey: null, speakerLabel: 'Crowd', expression: 'neutral', text: 'Hooray' }
          ]
        },
        {
          id: 'ch01.s02',
          placeKey: 'harbour',
          placeText: 'Harbour',
          time: 'dusk',
          backgroundId: 'bg_harbour_dusk',
          description: 'Same place.',
          breakBefore: true,
          beats: []
        },
        { id: 'ch01.s03', placeKey: null, placeText: 'Attic', time: null, backgroundId: 'bg_attic_any', description: '', breakBefore: false, beats: [] }
      ]
    }
  ]
}

export const settings = (over: Partial<ProjectSettings> = {}): ProjectSettings =>
  projectSettingsSchema.parse({ slug: 'soother', source: 'x', primaryLang: 'en', ...over })
