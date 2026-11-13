import { FlightLink } from '../FlightLink'

/** The way out of the hero: starts the flight to the About page. */
export function HeroCta({ onExplore }: { onExplore: () => void }) {
  return (
    <FlightLink
      className="hero-cta"
      label="Beyond the horizon"
      aria-label="Beyond the horizon: about me"
      data-hero-cta
      onClick={onExplore}
    />
  )
}
