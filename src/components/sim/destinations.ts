import type { DestinationId } from './simState'

export interface DestinationEntry {
  title: string
  text?: string
  tags?: string[]
}

export interface Destination {
  id: DestinationId
  /** name on the beacon and in the heads-up display */
  label: string
  /** which way it lies from the start, for the opening hint */
  direction: string
  title: string
  intro?: string
  entries: DestinationEntry[]
}

/**
 * What waits at each beacon. Skills is taken from the About page's own wording.
 * Projects and Hobbies are PLACEHOLDERS until real entries are supplied: replace the entries below.
 */
export const DESTINATIONS: Destination[] = [
  {
    id: 'projects',
    label: 'Projects',
    direction: 'to your right',
    title: 'Things I have built.',
    intro: 'A selection of work, each one a chance to learn something new.',
    entries: [
      { title: 'Project one', text: 'What it is, the problem it solves and what you learned building it.', tags: ['Tech', 'Tech', 'Tech'] },
      { title: 'Project two', text: 'What it is, the problem it solves and what you learned building it.', tags: ['Tech', 'Tech'] },
      { title: 'Project three', text: 'What it is, the problem it solves and what you learned building it.', tags: ['Tech', 'Tech'] },
    ],
  },
  {
    id: 'skills',
    label: 'Skills',
    direction: 'to your left',
    title: 'What I work with.',
    intro: 'The areas I spend my time in, and what I do there.',
    entries: [
      {
        title: 'Full stack development',
        tags: ['Responsive interfaces', 'APIs', 'Databases', 'Complete web applications'],
      },
      {
        title: 'Artificial intelligence',
        tags: ['AI-powered applications', 'LLM integrations', 'Intelligent automation', 'Conversational agents'],
      },
      {
        title: 'Creative technology',
        tags: ['3D environments', 'Interactive web experiences', 'Motion design', 'Animation'],
      },
    ],
  },
  {
    id: 'hobbies',
    label: 'Hobbies',
    direction: 'straight ahead',
    title: 'Away from the keyboard.',
    intro: 'What I do when I am not building something.',
    entries: [
      { title: 'Hobby one', text: 'A line or two about it.' },
      { title: 'Hobby two', text: 'A line or two about it.' },
      { title: 'Hobby three', text: 'A line or two about it.' },
    ],
  },
]
