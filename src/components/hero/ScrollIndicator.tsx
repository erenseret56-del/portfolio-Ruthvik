export function ScrollIndicator() {
  return (
    <div className="hero-scroll" data-hero-scroll aria-hidden="true">
      <div className="hero-scroll__float">
        <svg className="hero-scroll__mouse" viewBox="0 0 22 36" width="22" height="36" fill="none">
          <rect x="1" y="1" width="20" height="34" rx="10" stroke="currentColor" strokeWidth="1.4" />
          <line className="hero-scroll__wheel" x1="11" y1="7.5" x2="11" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="hero-scroll__label">Scroll to explore</span>
        <svg className="hero-scroll__chevron" viewBox="0 0 18 10" width="18" height="10" fill="none">
          <path d="M1 1l8 7.5L17 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
