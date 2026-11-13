/** The way out of the hero: starts the flight to the About page. */
export function HeroCta({ onExplore }: { onExplore: () => void }) {
  return (
    <button type="button" className="hero-cta" data-hero-cta onClick={onExplore} aria-label="Beyond the horizon: about me">
      <span className="hero-cta__label">Beyond the horizon</span>
      <svg className="hero-cta__arrow" viewBox="0 0 46 10" width="46" height="10" fill="none" aria-hidden="true">
        <path d="M0 5h44M39.5 1l4.5 4-4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
