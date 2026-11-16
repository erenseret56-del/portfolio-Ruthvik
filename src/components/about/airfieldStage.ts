import type { AirfieldStage } from './airfield'

/**
 * How the flight to the simulator reaches the airfield behind the About page: it stages the take-off and
 * follows the aircraft across the page. Registered by AirfieldBackdrop while it is mounted.
 */
export interface AirfieldDirector {
  set: (stage: AirfieldStage) => void
  /** during 'depart': seconds since the brakes came off */
  departure: (seconds: number) => void
  /** draw at this many times the usual resolution, for while the page is magnified */
  sharpen: (scale: number) => void
  /** where the aircraft is on the About page (px from the page's top-left corner, unscrolled and unscaled) */
  aircraft: () => { x: number; y: number }
  /** px across the whole airfield scene; the aircraft is 5.4% of this long */
  sceneWidth: () => number
}

export const airfieldStage = { current: null as AirfieldDirector | null }
