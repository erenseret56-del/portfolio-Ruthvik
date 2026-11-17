import type { PlaceId } from '../drive/driveState'
import type { DestinationId } from './simState'

export interface DestinationEntry {
  title: string
  text?: string
  tags?: string[]
}

interface Panel {
  /** name on the marker and in the heads-up display */
  label: string
  /** which way it lies from the start, for the plain menu */
  direction: string
  title: string
  intro?: string
  entries: DestinationEntry[]
}

export interface Destination extends Panel {
  id: DestinationId
}

export interface Place extends Panel {
  id: PlaceId
}

/**
 * The one beacon in the sky. Its panel says what is under the cloud and offers the way down;
 * the portfolio itself is on the ground (PLACES).
 */
export const DESTINATIONS: Destination[] = [
  {
    id: 'horizon',
    label: 'The Horizon',
    direction: 'straight ahead',
    title: 'The rest is on the ground.',
    intro:
      'Under this cloud there is open country and a road. The aircraft goes down low, the ramp opens, and a car is dropped by parachute. From there you drive.',
    entries: [
      { title: 'Projects', text: 'Things I have built. Right at the first junction.' },
      { title: 'Skills', text: 'What I work with. Left at the first junction.' },
      { title: 'Hobbies', text: 'Away from the keyboard. Straight on.' },
    ],
  },
]

/**
 * What waits at each gateway on the ground. Skills is taken from the About page's own wording.
 * Projects and Hobbies are PLACEHOLDERS until real entries are supplied: replace the entries below.
 */
export const PLACES: Place[] = [
  {
    id: 'projects',
    label: 'Projects',
    direction: 'right at the junction',
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
    direction: 'left at the junction',
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
    direction: 'straight on',
    title: 'Away from the keyboard.',
    intro: 'What I do when I am not building something.',
    entries: [
      { title: 'Hobby one', text: 'A line or two about it.' },
      { title: 'Hobby two', text: 'A line or two about it.' },
      { title: 'Hobby three', text: 'A line or two about it.' },
    ],
  },
]
