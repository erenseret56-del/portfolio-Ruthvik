import gsap from 'gsap'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  CRUISE_TRAIL_FADE,
  exitDistance,
  flight,
  flybyPath,
  flybyTailNdcY,
  heroLayout,
} from './hero/flightState'

/** hero / about = settled on that page; leaving / returning = the flight between them is under way */
export type View = 'hero' | 'leaving' | 'about' | 'returning'

const ABOUT_HASH = '#about'
const viewFromUrl = (): 'hero' | 'about' => (window.location.hash === ABOUT_HASH ? 'about' : 'hero')

type Ref<T extends HTMLElement> = RefObject<T | null>

/**
 * Page change as one piece of flight: the aircraft accelerates out of the hero and drags the name away
 * with it, then makes a close climbing pass up the screen with the About page rising in its wake.
 * Going back simply lowers the About page off the sky again.
 */
export function useHorizonTransition(hero: Ref<HTMLElement>, glow: Ref<HTMLElement>, about: Ref<HTMLElement>) {
  const [view, setView] = useState<View>(viewFromUrl)
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

  const toAbout = useCallback(() => {
    const heroEl = hero.current
    const glowEl = glow.current
    const aboutEl = about.current
    if (current.current !== 'hero' || !heroEl || !glowEl || !aboutEl) return
    show('leaving')

    const items = aboutEl.querySelectorAll('[data-about-item]')
    const arrive = () => {
      focusTarget.current = () => aboutEl
      show('about')
      aboutEl.scrollTop = 0
      running.current = gsap
        .timeline()
        .fromTo(
          items,
          { autoAlpha: 0, y: 26 },
          { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.11, clearProps: 'transform' },
        )
    }

    if (flight.reducedMotion) {
      gsap.set(items, { autoAlpha: 0 })
      running.current = gsap.timeline({ onComplete: arrive }).to(aboutEl, { autoAlpha: 1, duration: 0.4 })
      return
    }

    const { width, height } = heroEl.getBoundingClientRect()
    const aspect = width / height
    const layout = heroLayout(aspect)
    const pass = flybyPath(layout)
    const fades = gsap.utils.toArray<HTMLElement>('[data-hero-fade]', heroEl)
    const cta = heroEl.querySelector('[data-hero-cta]')
    // glyphs nearest the aircraft are caught by its wake first
    const chars = gsap.utils
      .toArray<HTMLElement>('.hero-name__char', heroEl)
      .map((el) => ({ el, x: el.getBoundingClientRect().left }))
      .sort((a, b) => b.x - a.x)
      .map((c) => c.el)

    // the About page is uncovered from the bottom up, its soft upper edge riding on the aircraft's tail
    const viewport = window.innerHeight
    const feather = Math.round(viewport * 0.18)
    const wipe = () => {
      const tail = (0.5 - 0.5 * flybyTailNdcY(flight.flyby, pass)) * viewport
      const edge = Math.min(viewport, tail - feather / 2)
      aboutEl.style.setProperty('--wipe-y', `${edge}px`)
      glowEl.style.transform = `translate3d(0, ${edge}px, 0)`
    }
    const beginPass = () => {
      flight.closeUp = true
      aboutEl.style.setProperty('--wipe-feather', `${feather}px`)
      glowEl.style.height = `${feather}px`
      wipe()
      aboutEl.dataset.wipe = ''
      gsap.set(items, { autoAlpha: 0 })
      gsap.set([aboutEl, glowEl], { autoAlpha: 1 })
    }
    const endPass = () => {
      delete aboutEl.dataset.wipe
      gsap.set(glowEl, { autoAlpha: 0 })
      arrive()
    }

    const tl = gsap.timeline({ onComplete: endPass })
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
      // 2. it comes back up from under the frame, close, and the next page rises behind it
      .call(beginPass, undefined, 1.85)
      .fromTo(flight, { flyby: 0 }, { flyby: 1, duration: 2.8, ease: 'none', onUpdate: wipe }, 1.85)
    departure.current = tl
    running.current = tl
  }, [hero, glow, about, show])

  const toHero = useCallback(() => {
    const aboutEl = about.current
    if (current.current !== 'about' || !aboutEl) return
    show('returning')

    // put the sky back into settled cruise before it is uncovered
    if (departure.current) {
      departure.current.progress(0, true).kill()
      departure.current = null
      Object.assign(flight, { closeUp: false, flyby: 0, along: 0, trailOpacity: 1, trailFade: CRUISE_TRAIL_FADE })
    }

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
  }, [hero, about, show])

  useEffect(() => {
    focusTarget.current?.()?.focus({ preventScroll: true })
    focusTarget.current = null
  }, [view])

  /** Follow the URL (back / forward buttons), finishing any flight still in the air first. */
  const sync = useCallback(() => {
    running.current?.progress(1)
    if (viewFromUrl() === 'about') toAbout()
    else toHero()
  }, [toAbout, toHero])

  useEffect(() => {
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [sync])

  // opened directly on #about: the page is simply there
  useLayoutEffect(() => {
    if (current.current === 'about') gsap.set(about.current, { autoAlpha: 1 })
  }, [about])

  const navigate = useCallback(
    (target: 'hero' | 'about') => {
      if (current.current !== (target === 'about' ? 'hero' : 'about')) return
      const { pathname, search } = window.location
      window.history.pushState(null, '', target === 'about' ? ABOUT_HASH : pathname + search)
      if (target === 'about') toAbout()
      else toHero()
    },
    [toAbout, toHero],
  )

  return {
    view,
    goToAbout: useCallback(() => navigate('about'), [navigate]),
    goToHero: useCallback(() => navigate('hero'), [navigate]),
  }
}
