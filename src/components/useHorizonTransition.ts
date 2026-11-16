import gsap from 'gsap'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { airfieldStage } from './about/airfieldStage'
import { CRUISE_TRAIL_FADE, exitDistance, flight, heroLayout } from './hero/flightState'
import { requestSimSky, startSim, stopSim } from './sim/simState'

/** The three places a visitor can be, each with its own address. */
type Page = 'hero' | 'about' | 'sim'
/**
 * A page, or one of the moves between two of them: hero <-> about (leaving / returning), and
 * about <-> sim (departing, then boarding / landing).
 */
export type View = Page | 'leaving' | 'returning' | 'departing' | 'boarding' | 'landing'

const HASH: Record<Page, string> = { hero: '', about: '#about', sim: '#sim' }
const pageFromUrl = (): Page => {
  const { hash } = window.location
  return hash === HASH.sim ? 'sim' : hash === HASH.about ? 'about' : 'hero'
}

type Ref<T extends HTMLElement> = RefObject<T | null>

/** seconds the smoke needs, after the aircraft leaves the top of the frame, to finish covering it */
const SMOKE_FILL_TIME = 0.1

// The take-off that leads into the simulator, in seconds from the click.
const TAKEOFF = {
  /** the slow push in on the runway */
  zoom: 3.2,
  /** brakes off */
  roll: 3,
  /** the wheels leave the ground this long into the run (the airfield's departure profile) */
  run: 3.57,
  /** how long the departure is played for: until well after cloud has closed over it */
  flight: 7.5,
  /** after lift-off, how long the climb is watched before cloud closes over it */
  climb: 2.2,
}
/** share of the screen's width the aircraft is brought up to fill */
const TAKEOFF_FRAMING = 0.24

/**
 * Moves between the pages, each as a piece of flight.
 *
 * hero -> about: the aircraft accelerates out of the hero and drags the name away with it, then makes a
 *   close climbing pass up the screen that buries the sky in engine smoke; the About page clears out of it.
 * about -> sim: the words clear and the view pushes slowly in on the airfield behind them, where an aircraft
 *   is lined up on the runway. Nobody is flying it: it rolls, lifts off and climbs into cloud by itself, comes
 *   out above the cloud deck in the hero's sky, and only there is it handed to the visitor.
 * Going back reverses each more simply: the About page rises over the simulator, or lowers off the hero.
 */
export function useHorizonTransition(
  hero: Ref<HTMLElement>,
  about: Ref<HTMLElement>,
  simulator: Ref<HTMLElement>,
  veil: Ref<HTMLElement>,
) {
  const [view, setView] = useState<View>(pageFromUrl)
  const current = useRef<View>(view)
  /** kept after it finishes so that going back can rewind everything it moved */
  const departure = useRef<gsap.core.Timeline | null>(null)
  const running = useRef<gsap.core.Timeline | null>(null)
  /** where keyboard focus should land once the page that just arrived is no longer inert */
  const focusTarget = useRef<(() => HTMLElement | null | undefined) | null>(null)

  const show = useCallback((next: View) => {
    current.current = next
    setView(next)
  }, [])

  /** Put the hero's sky back into settled cruise, as it was before the flight to the About page. */
  const restoreHero = useCallback(() => {
    if (!departure.current) return
    departure.current.progress(0, true).kill()
    departure.current = null
    Object.assign(flight, { closeUp: false, flyby: 0, along: 0, trailOpacity: 1, trailFade: CRUISE_TRAIL_FADE })
  }, [])

  const revealAboutText = useCallback((aboutEl: HTMLElement) => {
    running.current = gsap
      .timeline()
      .fromTo(
        aboutEl.querySelectorAll('[data-about-item]'),
        { autoAlpha: 0, y: 26 },
        { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.11, clearProps: 'transform' },
      )
  }, [])

  // ---------- hero -> about ----------

  const toAbout = useCallback(() => {
    const heroEl = hero.current
    const aboutEl = about.current
    if (current.current !== 'hero' || !heroEl || !aboutEl) return
    show('leaving')
    requestSimSky()

    const items = aboutEl.querySelectorAll('[data-about-item]')
    const arrive = () => {
      focusTarget.current = () => aboutEl
      show('about')
      aboutEl.scrollTop = 0
      revealAboutText(aboutEl)
    }

    if (flight.reducedMotion) {
      gsap.set(items, { autoAlpha: 0 })
      running.current = gsap.timeline({ onComplete: arrive }).to(aboutEl, { autoAlpha: 1, duration: 0.4 })
      return
    }

    const { width, height } = heroEl.getBoundingClientRect()
    const aspect = width / height
    const layout = heroLayout(aspect)
    const fades = gsap.utils.toArray<HTMLElement>('[data-hero-fade]', heroEl)
    const cta = heroEl.querySelector('[data-hero-cta]')
    // glyphs nearest the aircraft are caught by its wake first
    const chars = gsap.utils
      .toArray<HTMLElement>('.hero-name__char', heroEl)
      .map((el) => ({ el, x: el.getBoundingClientRect().left }))
      .sort((a, b) => b.x - a.x)
      .map((c) => c.el)

    const beginPass = () => {
      flight.closeUp = true
    }
    // by now the scene has filled the whole frame with smoke (EngineSmoke): the page clears out of it.
    // Kept out of the departure timeline, which is rewound on the way back and must not touch the page.
    const clearSmoke = () => {
      gsap.set(items, { autoAlpha: 0 })
      running.current = gsap
        .timeline({ onComplete: arrive })
        .fromTo(aboutEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.3, ease: 'power2.inOut' })
    }

    const tl = gsap.timeline({ onComplete: clearSmoke })
    tl.to(cta, { autoAlpha: 0, duration: 0.35, ease: 'power1.out' }, 0)
      // 1. the aircraft pulls away to the right, taking the name and its trail with it
      .to(flight, { along: exitDistance(layout, aspect), duration: 1.8, ease: 'power2.in', overwrite: 'auto' }, 0)
      .to(flight, { trailFade: 900, duration: 1.1, ease: 'power1.in', overwrite: 'auto' }, 0)
      .to(heroEl, { '--streak': 1, duration: 0.7, ease: 'power1.in', overwrite: 'auto' }, 0.1)
      .to(fades, { x: width * 0.3, autoAlpha: 0, duration: 1, ease: 'power2.in', stagger: 0.08 }, 0.1)
      .to(
        chars,
        { x: width * 0.55, scaleX: 1.6, opacity: 0, filter: 'blur(14px)', duration: 1.1, ease: 'power2.in', stagger: 0.035 },
        0.15,
      )
      .to(flight, { trailOpacity: 0, duration: 0.6, ease: 'power1.in' }, 1.2)
      // 2. it comes back up from under the frame, close, trailing smoke that goes on to fill the frame
      .call(beginPass, undefined, 1.85)
      .fromTo(flight, { flyby: 0 }, { flyby: 1, duration: 2.8, ease: 'none' }, 1.85)
      // 3. a beat for the smoke to close over the top of the frame after the aircraft has gone
      .to({}, { duration: SMOKE_FILL_TIME })
    departure.current = tl
    running.current = tl
  }, [hero, about, show, revealAboutText])

  // ---------- about -> hero ----------

  const toHero = useCallback(() => {
    const aboutEl = about.current
    if (current.current !== 'about' || !aboutEl) return
    show('returning')
    restoreHero()

    const land = () => {
      gsap.set(aboutEl, { autoAlpha: 0, y: 0 })
      focusTarget.current = () => hero.current?.querySelector<HTMLElement>('[data-hero-cta]')
      show('hero')
    }
    running.current = gsap
      .timeline({ onComplete: land })
      .to(
        aboutEl,
        flight.reducedMotion
          ? { autoAlpha: 0, duration: 0.4 }
          : { y: window.innerHeight, duration: 1.05, ease: 'power3.inOut' },
      )
  }, [hero, about, show, restoreHero])

  // ---------- about -> simulator ----------

  const toSim = useCallback(() => {
    const aboutEl = about.current
    const simEl = simulator.current
    if (current.current !== 'about' || !aboutEl || !simEl) return
    show('boarding')
    startSim(!flight.reducedMotion)

    const takeControl = () => {
      gsap.set(aboutEl, { autoAlpha: 0, y: 0 })
      focusTarget.current = () => simEl
      show('sim')
    }
    // the airfield falls away below; the instruments come up once there is sky to see them against
    running.current = gsap
      .timeline({ onComplete: takeControl })
      .to(
        aboutEl,
        flight.reducedMotion
          ? { autoAlpha: 0, duration: 0.4 }
          : { y: window.innerHeight, duration: 1.15, ease: 'power3.inOut' },
        0,
      )
      .fromTo(simEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, flight.reducedMotion ? 0.1 : 0.65)
  }, [about, simulator, show])

  // ---------- simulator -> about ----------

  const toAboutFromSim = useCallback(() => {
    const aboutEl = about.current
    const simEl = simulator.current
    if (current.current !== 'sim' || !aboutEl || !simEl) return
    show('landing')

    const land = () => {
      stopSim()
      gsap.set(simEl, { autoAlpha: 0 })
      focusTarget.current = () => aboutEl
      show('about')
    }
    const tl = gsap.timeline({ onComplete: land }).to(simEl, { autoAlpha: 0, duration: 0.45, ease: 'power1.out' }, 0)
    if (flight.reducedMotion) tl.fromTo(aboutEl, { autoAlpha: 0, y: 0 }, { autoAlpha: 1, duration: 0.4 }, 0)
    else
      tl.fromTo(
        aboutEl,
        { autoAlpha: 1, y: window.innerHeight },
        { y: 0, duration: 1.1, ease: 'power3.inOut', clearProps: 'transform' },
        0,
      )
    running.current = tl
  }, [about, simulator, show])

  /** Be on a page at once, with no flight: for arriving by address, or a jump in the history that skips a page. */
  const cutTo = useCallback(
    (page: Page) => {
      const aboutEl = about.current
      const simEl = simulator.current
      if (!aboutEl || !simEl) return
      if (page === 'sim') startSim(!flight.reducedMotion)
      else stopSim()
      if (page === 'hero') restoreHero()
      else requestSimSky()
      gsap.set(aboutEl, { autoAlpha: page === 'about' ? 1 : 0, y: 0 })
      gsap.set(simEl, { autoAlpha: page === 'sim' ? 1 : 0 })
      show(page)
    },
    [about, simulator, show, restoreHero],
  )

  useEffect(() => {
    focusTarget.current?.()?.focus({ preventScroll: true })
    focusTarget.current = null
  }, [view])

  /** Go to a page from wherever we have settled, by the flight between them if there is one. */
  const travel = useCallback(
    (to: Page) => {
      // finish whatever is in the air; one move can hand over to the next (flight, then the page clearing)
      for (let i = 0; i < 4 && running.current && running.current.progress() < 1; i++) running.current.progress(1)
      const from = current.current
      if (from === to) return
      if (from === 'hero' && to === 'about') toAbout()
      else if (from === 'about' && to === 'hero') toHero()
      else if (from === 'about' && to === 'sim') toSim()
      else if (from === 'sim' && to === 'about') toAboutFromSim()
      else cutTo(to)
    },
    [toAbout, toHero, toSim, toAboutFromSim, cutTo],
  )

  // back / forward buttons: follow the address
  useEffect(() => {
    const sync = () => travel(pageFromUrl())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [travel])

  // opened directly on a page other than the hero: it is simply there
  useLayoutEffect(() => {
    if (current.current !== 'hero') cutTo(current.current as Page)
  }, [cutTo])

  /** Follow a link: only from a page we are settled on, and it becomes a new entry in the history. */
  const navigate = useCallback(
    (from: Page, to: Page) => {
      if (current.current !== from) return
      const { pathname, search } = window.location
      window.history.pushState(null, '', HASH[to] || pathname + search)
      travel(to)
    },
    [travel],
  )

  return {
    view,
    goToAbout: useCallback(() => navigate('hero', 'about'), [navigate]),
    goToHero: useCallback(() => navigate('about', 'hero'), [navigate]),
    goToSim: useCallback(() => navigate('about', 'sim'), [navigate]),
    leaveSim: useCallback(() => navigate('sim', 'about'), [navigate]),
  }
}
