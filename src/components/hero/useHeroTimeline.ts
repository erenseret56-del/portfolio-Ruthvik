import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useEffect, type RefObject } from 'react'
import { approachDistance, CRUISE_TRAIL_FADE, flight, heroLayout } from './flightState'

gsap.registerPlugin(ScrollTrigger)

/** px the aircraft tail must be past a glyph before that glyph starts to condense */
const REVEAL_LEAD = 24

/**
 * One timeline tells the whole opening: flight begins -> the name condenses out of the trail ->
 * the name settles -> supporting copy arrives. Afterwards only the WebGL scene keeps moving.
 */
export function useHeroTimeline(root: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const el = root.current
    if (!ready || !el) return

    const ctx = gsap.context(() => {
      const curtain = el.querySelector('.hero__curtain')

      if (flight.reducedMotion) {
        // no flight-in: the scene is already in its settled state, so just lift the curtain
        gsap.to(curtain, { autoAlpha: 0, duration: 0.6 })
        return
      }

      const name = el.querySelector<HTMLElement>('.hero-name')!
      const chars = gsap.utils.toArray<HTMLElement>('.hero-name__char')
      const fades = gsap.utils.toArray<HTMLElement>('[data-hero-fade]')
      const scrollHint = el.querySelector('[data-hero-scroll]')
      const { width, height } = el.getBoundingClientRect()
      const aspect = width / height

      // measured before any transform is applied, so these are the glyphs' resting positions
      const centres = chars.map((c) => {
        const r = c.getBoundingClientRect()
        return r.left + r.width / 2
      })

      gsap.set(el, { '--streak': 1 })
      gsap.set(chars, { opacity: 0, xPercent: -55, scaleX: 1.4, filter: 'blur(18px)', transformOrigin: '0% 60%' })
      gsap.set(name, { x: width * 0.022, y: height * 0.014, scale: 1.05, transformOrigin: '0% 50%' })
      gsap.set(fades, { autoAlpha: 0, y: 20 })
      gsap.set(scrollHint, { autoAlpha: 0 })

      const pending = new Set(chars.keys())
      const reveal = (i: number, delay = 0) => {
        if (!pending.delete(i)) return
        gsap.to(chars[i], {
          opacity: 1,
          xPercent: 0,
          scaleX: 1,
          filter: 'blur(0px)',
          duration: 1.35,
          delay,
          ease: 'power3.out',
          onComplete: () => gsap.set(chars[i], { clearProps: 'filter' }),
        })
      }
      // the aircraft itself drives the reveal: a glyph appears once the tail has flown past it
      const followAircraft = () => {
        for (const i of pending) if (flight.tailScreenX - REVEAL_LEAD > centres[i]) reveal(i)
        if (!pending.size) gsap.ticker.remove(followAircraft)
      }
      gsap.ticker.add(followAircraft)
      // glyphs the aircraft never reaches (narrow screens) follow in order
      const revealRest = () => [...pending].forEach((i, n) => reveal(i, n * 0.07))

      const tl = gsap.timeline({ delay: 0.1 })
      tl.to(curtain, { autoAlpha: 0, duration: 1.9, ease: 'power2.inOut' }, 0)
        .fromTo(flight, { along: -approachDistance(heroLayout(aspect), aspect) }, { along: 0, duration: 6.6, ease: 'power2.out' }, 0.2)
        .fromTo(flight, { introBank: 1 }, { introBank: 0, duration: 5.4, ease: 'sine.inOut' }, 0.8)
        .fromTo(flight, { trailFade: 700 }, { trailFade: CRUISE_TRAIL_FADE, duration: 5, ease: 'power1.inOut' }, 5.2)
        .addLabel('settle', 4.2)
        .call(revealRest, undefined, 'settle-=0.4')
        .to(name, { x: 0, y: 0, scale: 1, duration: 2.4, ease: 'power3.inOut' }, 'settle')
        .to(el, { '--streak': 0.28, duration: 2.4, ease: 'power2.inOut' }, 'settle')
        .to(fades, { autoAlpha: 1, y: 0, duration: 1.4, ease: 'power3.out', stagger: 0.32 }, 'settle+=1.2')
        .to(scrollHint, { autoAlpha: 1, duration: 1.6, ease: 'power1.out' }, 'settle+=2.4')

      // leaving the hero: copy drifts up and the camera tilts with the scroll
      gsap.to('.hero__content', {
        yPercent: -14,
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          onUpdate: (self) => (flight.scroll = self.progress),
        },
      })

      return () => gsap.ticker.remove(followAircraft)
    }, el)

    return () => ctx.revert()
  }, [root, ready])
}
