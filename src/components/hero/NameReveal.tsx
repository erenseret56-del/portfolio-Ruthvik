const LINES = ['RUTHVIK', 'REDDY']

/**
 * The name as real heading text (read once by assistive tech via aria-label). Each glyph is its own
 * element so the timeline can condense it out of the contrail as the aircraft's tail passes over it.
 */
export function NameReveal() {
  return (
    <h1 className="hero-name" aria-label="Ruthvik Reddy">
      {LINES.map((line) => (
        <span className="hero-name__line" key={line} aria-hidden="true">
          {[...line].map((char, i) => (
            <span className="hero-name__char" data-char={char} key={i}>
              {char}
            </span>
          ))}
        </span>
      ))}
    </h1>
  )
}
