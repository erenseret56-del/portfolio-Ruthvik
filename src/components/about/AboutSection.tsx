import type { MouseEvent, RefObject } from 'react'
import { FlightLink } from '../FlightLink'
import { AirfieldBackdrop } from './AirfieldBackdrop'
import './AboutSection.css'

const FOCUS = [
  {
    title: 'Full stack development',
    text: 'Working across the frontend and backend to build responsive interfaces, APIs, databases and complete web applications.',
  },
  {
    title: 'Artificial intelligence',
    text: 'Exploring AI-powered applications, LLM integrations, intelligent automation and conversational agents, and bringing AI capabilities into practical software.',
  },
  {
    title: 'Creative technology',
    text: 'Experimenting with 3D environments, interactive web experiences, motion design and animation that make digital interfaces feel alive.',
  },
]

interface AboutSectionProps {
  ref: RefObject<HTMLElement | null>
  /** false while the page is hidden or still on its way in */
  active: boolean
  /** true whenever any of the page can be seen, including while it is still arriving */
  visible: boolean
  onHome: () => void
  /** starts the move to the next page; not wired up until that page exists */
  onNext?: () => void
}

/**
 * The page beyond the hero. It sits over the sky as its own scrolling layer; the transition hook moves it.
 * data-sky-text and data-horizon tell the backdrop where the words are, so its horizon falls between them.
 */
export function AboutSection({ ref, active, visible, onHome, onNext }: AboutSectionProps) {
  const home = (e: MouseEvent) => {
    e.preventDefault()
    onHome()
  }
  return (
    <section className="about" id="about" ref={ref} aria-labelledby="about-title" tabIndex={-1} inert={!active}>
      <div className="about__page">
        <AirfieldBackdrop live={visible} />
        <div className="about__inner">
          <header className="about__bar" data-about-item>
            <a className="about__home" href="#" onClick={home} aria-label="Ruthvik Reddy, back to the start">
              <svg viewBox="0 0 26 10" width="26" height="10" fill="none" aria-hidden="true">
                <path d="M26 5H2M6.5 1 2 5l4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Ruthvik Reddy
            </a>
          </header>

          <div className="about__lead" data-sky-text>
            <p className="about__eyebrow" data-about-item>
              About me
            </p>
            <h2 className="about__title" id="about-title" data-about-item>
              I turn ideas into meaningful digital experiences.
            </h2>
          </div>

          <div className="about__text" data-about-item data-sky-text>
            <p>
              I&rsquo;m Ruthvik Reddy, a Computer Science engineering student and full stack developer with a strong
              interest in artificial intelligence and creative technology.
            </p>
            <p>
              I enjoy understanding how technology works beneath the surface, experimenting with emerging tools, and
              building digital experiences that combine functionality, intelligence and thoughtful design.
            </p>
            <p>
              I&rsquo;m particularly interested in the intersection of software engineering, AI, automation and
              interactive experiences.
            </p>
          </div>

          <ul className="about__focus" data-horizon>
            {FOCUS.map(({ title, text }, i) => (
              <li className="about__focus-item" key={title} data-about-item>
                <span className="about__focus-index">0{i + 1}</span>
                <h3 className="about__focus-title">{title}</h3>
                <p className="about__focus-text">{text}</p>
              </li>
            ))}
          </ul>

          <div className="about__next" data-about-item>
            <FlightLink label="Take the controls" onClick={onNext} />
          </div>
        </div>
      </div>
    </section>
  )
}
