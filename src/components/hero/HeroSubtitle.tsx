const ROLES = ['Full Stack Developer', 'AI Enthusiast', 'Creative Technologist']

export function HeroSubtitle() {
  return (
    <div className="hero-subtitle">
      <p className="hero-subtitle__roles" data-hero-fade>
        {ROLES.map((role, i) => (
          <span className="hero-subtitle__role" key={role}>
            {i > 0 && (
              <span className="hero-subtitle__dot" aria-hidden="true">
                ·
              </span>
            )}
            {role}
          </span>
        ))}
      </p>
      <p className="hero-subtitle__tagline" data-hero-fade>
        <span className="hero-subtitle__rule" aria-hidden="true" />
        Building things that make an impact.
      </p>
    </div>
  )
}
