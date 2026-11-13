import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { CRUISE_TRAIL_FADE, flight, heroLayout } from './flightState'
import { HeroCta } from './HeroCta'
import { HeroSubtitle } from './HeroSubtitle'
import './HeroSection.css'
import { NameReveal } from './NameReveal'
import { useHeroTimeline } from './useHeroTimeline'

const HeroCanvas = lazy(() => import('./scene/HeroCanvas'))

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface HeroSectionProps {
  ref: RefObject<HTMLElement | null>
  /** false while another page is in front, or on its way in */
  active: boolean
  /** fully hidden behind another page: nothing here needs to render */
  covered: boolean
  /** only the sky is wanted (the simulator flies in it): the name and link stay out of the picture */
  bare: boolean
  onExplore: () => void
}

export function HeroSection({ ref: root, active, covered, bare, onExplore }: HeroSectionProps) {
  const [sceneReady, setSceneReady] = useState(false)
  const [ready, setReady] = useState(false)
  const [inView, setInView] = useState(true)
  const [reduced] = useState(prefersReducedMotion)

  // reduced motion renders a single still frame, so the flight must be in its settled state before that frame
  useLayoutEffect(() => {
    if (reduced) Object.assign(flight, { reducedMotion: true, along: 0, introBank: 0, trailFade: CRUISE_TRAIL_FADE })
  }, [reduced])

  // the copy is laid out against the aircraft's resting point, which depends on the viewport shape
  useLayoutEffect(() => {
    const el = root.current!
    const apply = () => {
      const { width, height } = el.getBoundingClientRect()
      const layout = heroLayout(width / height)
      el.style.setProperty('--plane-x', `${(layout.planeNdcX * 0.5 + 0.5) * 100}%`)
      el.style.setProperty('--plane-y', `${(0.5 - layout.planeNdcY * 0.5) * 100}%`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])

  // stop rendering entirely if the hero is ever out of view
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return
    const onMove = (e: PointerEvent) => {
      flight.pointerX = (e.clientX / window.innerWidth) * 2 - 1
      flight.pointerY = 1 - (e.clientY / window.innerHeight) * 2
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduced])

  // begin once the scene and fonts are in; if WebGL never arrives, begin anyway over the still sky
  useEffect(() => {
    let cancelled = false
    const begin = () => !cancelled && setReady(true)
    const timeout = window.setTimeout(begin, 8000)
    if (sceneReady) document.fonts.ready.then(begin)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [sceneReady])

  useHeroTimeline(root, ready)

  const onSceneReady = useCallback(() => setSceneReady(true), [])

  return (
    <section className={bare ? 'hero hero--bare' : 'hero'} ref={root} aria-label="Introduction" inert={!active}>
      <Suspense fallback={null}>
        <HeroCanvas still={reduced} paused={!inView || covered} onReady={onSceneReady} />
      </Suspense>
      <div className="hero__grade" aria-hidden="true" />
      <div className="hero__content">
        <div className="hero__copy">
          <NameReveal />
          <HeroSubtitle />
        </div>
        <HeroCta onExplore={onExplore} />
      </div>
      <div className="hero__curtain" aria-hidden="true" />
    </section>
  )
}
