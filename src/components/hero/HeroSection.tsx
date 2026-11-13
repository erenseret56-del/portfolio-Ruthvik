import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CRUISE_TRAIL_FADE, flight, heroLayout } from './flightState'
import { HeroSubtitle } from './HeroSubtitle'
import './HeroSection.css'
import { NameReveal } from './NameReveal'
import { ScrollIndicator } from './ScrollIndicator'
import { useHeroTimeline } from './useHeroTimeline'

const HeroCanvas = lazy(() => import('./scene/HeroCanvas'))

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function HeroSection() {
  const root = useRef<HTMLElement>(null)
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
  }, [])

  // stop rendering entirely while the hero is scrolled out of view
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [])

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
    <section className="hero" ref={root} aria-label="Introduction">
      <Suspense fallback={null}>
        <HeroCanvas still={reduced} paused={!inView} onReady={onSceneReady} />
      </Suspense>
      <div className="hero__grade" aria-hidden="true" />
      <div className="hero__content">
        <div className="hero__copy">
          <NameReveal />
          <HeroSubtitle />
        </div>
        <ScrollIndicator />
      </div>
      <div className="hero__curtain" aria-hidden="true" />
    </section>
  )
}
