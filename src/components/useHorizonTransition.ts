import gsap from 'gsap'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { airfieldStage } from './about/airfieldStage'
import { drive, startDrive, stopDrive } from './drive/driveState'
import { CRUISE_TRAIL_FADE, exitDistance, flight, heroLayout } from './hero/flightState'
import { descend, requestSimSky, sim, startSim, stopSim } from './sim/simState'

/** The four places a visitor can be, each with its own address. */
type Page = 'hero' | 'about' | 'sim' | 'drive'
/**
 * A page, or one of the moves between two of them: hero <-> about (leaving / returning),
 * about <-> sim (departing, then boarding / landing), and sim <-> drive (dropping / climbing, then boarding).
 */
export type View = Page | 'leaving' | 'returning' | 'departing' | 'boarding' | 'landing' | 'dropping' | 'climbing'

const HASH: Record<Page, string> = { hero: '', about: '#about', sim: '#sim', drive: '#drive' }
const pageFromUrl = (): Page => {
  const { hash } = window.location
  return hash === HASH.drive ? 'drive' : hash === HASH.sim ? 'sim' : hash === HASH.about ? 'about' : 'hero'
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
 * sim -> drive: the aircraft goes down into the cloud; under it is open country, where the same aircraft makes
 *   a low pass and delivers a car by parachute (the scene plays that itself), and the car is the visitor's.
 *   Going back, cloud closes over the road and the aircraft climbs out of the tops again.
 * Going back reverses each more simply: the About page rises over the simulator, or lowers off the hero.
 */
export function useHorizonTransition(
  hero: Ref<HTMLElement>,
  about: Ref<HTMLElement>,
  simulator: Ref<HTMLElement>,
  ground: Ref<HTMLElement>,
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
    const veilEl = veil.current
    const director = airfieldStage.current
    if (current.current !== 'about' || !aboutEl || !simEl) return
    const page = aboutEl.firstElementChild as HTMLElement | null

    const takeControl = () => {
      gsap.set(aboutEl, { autoAlpha: 0, y: 0 })
      focusTarget.current = () => simEl
      show('sim')
    }

    if (flight.reducedMotion || !veilEl || !director || !page) {
      // no flight to watch: one page simply gives way to the other
      show('boarding')
      startSim(!flight.reducedMotion)
      running.current = gsap
        .timeline({ onComplete: takeControl })
        .to(aboutEl, { autoAlpha: 0, duration: 0.4 }, 0)
        .fromTo(simEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, 0.1)
      return
    }

    show('departing')
    requestSimSky()
    const items = aboutEl.querySelectorAll('[data-about-item]')
    const width = aboutEl.clientWidth
    const height = aboutEl.clientHeight
    const scroll = aboutEl.scrollTop
    const zoom = gsap.utils.clamp(1.8, 3, (TAKEOFF_FRAMING * width) / (0.054 * director.sceneWidth()))

    // The camera is the page itself, scaled about a point that travels from wherever the visitor was looking
    // to the aircraft, and then stays on it. vx, vy: where on the screen that point is held.
    const cam = { scale: 1, follow: 0, vx: 0.36, vy: 0.6 }
    /** seconds since the brakes came off; the airfield places the aircraft by it */
    const run = { time: 0 }
    const from = { x: cam.vx * width, y: scroll + cam.vy * height }
    let aboard = false
    const frame = () => {
      if (aboard) return
      if (run.time > 0) director.departure(run.time)
      const aircraft = director.aircraft()
      const x = from.x + (aircraft.x - from.x) * cam.follow
      const y = from.y + (aircraft.y - from.y) * cam.follow
      // never far enough to show past the edge of the page
      const tx = gsap.utils.clamp(width - cam.scale * page.offsetWidth, 0, cam.vx * width - cam.scale * x)
      const ty = gsap.utils.clamp(scroll + height - cam.scale * page.offsetHeight, scroll, scroll + cam.vy * height - cam.scale * y)
      page.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${cam.scale.toFixed(4)})`
    }
    // under cover of cloud: the airfield is put back as it was, and the flight begins just below the cloud tops
    const board = () => {
      aboard = true
      gsap.set(aboutEl, { autoAlpha: 0, clearProps: 'overflow' })
      gsap.set(page, { clearProps: 'transform,transformOrigin,willChange' })
      gsap.set(items, { clearProps: 'opacity,visibility,transform' })
      director.set('loop')
      director.sharpen(1)
      startSim(true, true)
      show('boarding')
    }

    gsap.set(aboutEl, { overflow: 'hidden' })
    gsap.set(page, { transformOrigin: '0 0', willChange: 'transform' })
    director.sharpen(zoom)
    director.set('ready')

    const liftOff = TAKEOFF.roll + TAKEOFF.run
    const cloud = liftOff + TAKEOFF.climb
    running.current = gsap
      .timeline({ onUpdate: frame, onComplete: takeControl })
      .to(items, { autoAlpha: 0, duration: 0.6, ease: 'power1.out', stagger: 0.03 }, 0)
      .to(cam, { scale: zoom, follow: 1, duration: TAKEOFF.zoom, ease: 'power2.inOut' }, 0.2)
      .call(() => director.set('depart'), undefined, TAKEOFF.roll)
      .to(run, { time: TAKEOFF.flight, duration: TAKEOFF.flight, ease: 'none' }, TAKEOFF.roll)
      // as it rotates and climbs the camera eases back and lets it rise up the frame
      .to(cam, { scale: zoom * 0.76, vy: 0.42, duration: 3, ease: 'power1.inOut' }, liftOff - 0.4)
      // cloud comes down over the climb, holds while the scene changes behind it, and falls away below
      .set(veilEl, { autoAlpha: 1, yPercent: -100 }, cloud)
      .to(veilEl, { yPercent: -33.4, duration: 1.2, ease: 'power1.in' }, cloud)
      .call(board, undefined, cloud + 1.2)
      .to(veilEl, { yPercent: 33.4, duration: 1.8, ease: 'power1.out' }, cloud + 1.5)
      .set(veilEl, { autoAlpha: 0 })
      // the instruments come up as the aircraft levels off, and with them the controls
      .fromTo(simEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, cloud + 2.7)
  }, [about, simulator, veil, show])

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

  // ---------- simulator -> ground ----------

  const toDrive = useCallback(() => {
    const simEl = simulator.current
    const driveEl = ground.current
    const veilEl = veil.current
    if (current.current !== 'sim' || !simEl || !driveEl) return
    show('dropping')

    const takeTheWheel = () => {
      focusTarget.current = () => driveEl
      show('drive')
    }
    if (flight.reducedMotion || !veilEl || !sim.flying) {
      // no descent to watch: one page simply gives way to the other
      stopSim()
      startDrive(!flight.reducedMotion)
      running.current = gsap
        .timeline({ onComplete: takeTheWheel })
        .to(simEl, { autoAlpha: 0, duration: 0.4 }, 0)
        .fromTo(driveEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, 0.1)
      return
    }

    descend()
    // under cover of cloud the sky is swapped for the country below it, and the delivery begins
    const swap = () => {
      stopSim()
      startDrive(true, true)
      gsap.set(simEl, { autoAlpha: 0 })
      gsap.set(driveEl, { autoAlpha: 1 })
    }
    running.current = gsap
      .timeline({ onComplete: takeTheWheel })
      .to(simEl, { autoAlpha: 0, duration: 0.5, ease: 'power1.out' }, 0)
      // the cloud tops come up over the diving aircraft, and are left behind above
      .set(veilEl, { autoAlpha: 1, yPercent: 33.4 }, 0.4)
      .to(veilEl, { yPercent: -33.4, duration: 1.3, ease: 'power1.in' }, 0.4)
      .call(swap, undefined, 1.7)
      .to(veilEl, { yPercent: -100, duration: 1.7, ease: 'power1.out' }, 2)
      .set(veilEl, { autoAlpha: 0 })
  }, [simulator, ground, veil, show])

  // ---------- ground -> simulator ----------

  const toSimFromDrive = useCallback(() => {
    const simEl = simulator.current
    const driveEl = ground.current
    const veilEl = veil.current
    if (current.current !== 'drive' || !simEl || !driveEl) return
    show('climbing')

    const takeControl = () => {
      gsap.set(driveEl, { autoAlpha: 0 })
      focusTarget.current = () => simEl
      show('sim')
    }
    if (flight.reducedMotion || !veilEl || !drive.running) {
      stopDrive()
      startSim(!flight.reducedMotion)
      running.current = gsap
        .timeline({ onComplete: takeControl })
        .to(driveEl, { autoAlpha: 0, duration: 0.4 }, 0)
        .fromTo(simEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, 0.1)
      return
    }

    // cloud comes down over the road; above it the aircraft is already climbing out of the tops
    const board = () => {
      stopDrive()
      startSim(true, true)
      show('boarding')
    }
    running.current = gsap
      .timeline({ onComplete: takeControl })
      .to(driveEl, { autoAlpha: 0, duration: 0.45, ease: 'power1.out' }, 0)
      .set(veilEl, { autoAlpha: 1, yPercent: -100 }, 0.2)
      .to(veilEl, { yPercent: -33.4, duration: 1.1, ease: 'power1.in' }, 0.2)
      .call(board, undefined, 1.3)
      .to(veilEl, { yPercent: 33.4, duration: 1.8, ease: 'power1.out' }, 1.6)
      .set(veilEl, { autoAlpha: 0 })
      .fromTo(simEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power1.out' }, 2.8)
  }, [simulator, ground, veil, show])

  /** Be on a page at once, with no flight: for arriving by address, or a jump in the history that skips a page. */
  const cutTo = useCallback(
    (page: Page) => {
      const aboutEl = about.current
      const simEl = simulator.current
      const driveEl = ground.current
      if (!aboutEl || !simEl || !driveEl) return
      if (page === 'sim') startSim(!flight.reducedMotion)
      else stopSim()
      // arriving on the ground by address, the car is simply standing on the road
      if (page === 'drive') startDrive(!flight.reducedMotion)
      else stopDrive()
      if (page === 'hero') restoreHero()
      else requestSimSky()
      gsap.set(aboutEl, { autoAlpha: page === 'about' ? 1 : 0, y: 0 })
      gsap.set(simEl, { autoAlpha: page === 'sim' ? 1 : 0 })
      gsap.set(driveEl, { autoAlpha: page === 'drive' ? 1 : 0 })
      show(page)
    },
    [about, simulator, ground, show, restoreHero],
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
      else if (from === 'sim' && to === 'drive') toDrive()
      else if (from === 'drive' && to === 'sim') toSimFromDrive()
      else cutTo(to)
    },
    [toAbout, toHero, toSim, toAboutFromSim, toDrive, toSimFromDrive, cutTo],
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
    enterHorizon: useCallback(() => navigate('sim', 'drive'), [navigate]),
    leaveDrive: useCallback(() => navigate('drive', 'sim'), [navigate]),
  }
}
