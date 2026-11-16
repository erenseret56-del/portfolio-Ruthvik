import { useEffect, useRef } from 'react'
import { createAirfield, type Airfield } from './airfield'
import { airfieldStage } from './airfieldStage'
import './AirfieldBackdrop.css'

// how public/hero/sky.jpg is used here: mirrored, and cut off a little above its own horizon so the sun
// (which sits 2.6 degrees up in the photograph) has already gone down behind the airfield
const SKY_ASPECT = 2503 / 1183
const SKY_HORIZON_ROW = 0.798
const SKY_SUN_X = 0.355
/** how far above the marked element the horizon sits, as a share of scene width: room for runway and taxiway */
const GROUND_DEPTH = 0.04

/** Position of el's top-left corner inside ancestor, from layout alone (unaffected by transforms). */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement) {
  let left = 0
  let top = 0
  for (let node: HTMLElement | null = el; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft
    top += node.offsetTop
  }
  return { left, top }
}

/**
 * The world behind the About page: the hero's sky a little after sunset, over an airfield.
 * It is laid out against the page itself. The horizon is placed just above the element marked
 * data-horizon, and silhouettes never stand taller than the gap under elements marked data-sky-text,
 * so the statement sits in the sky, the cards sit on the tarmac and nothing runs behind the words.
 */
export function AirfieldBackdrop({ live }: { live: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const field = useRef<Airfield | null>(null)

  useEffect(() => {
    const el = root.current!
    const page = el.parentElement!
    const airfield = createAirfield(canvas.current!)
    field.current = airfield
    // the flight to the simulator directs the aircraft, and follows it across the page
    let canvasTop = 0
    let scene = 1000
    airfieldStage.current = {
      set: airfield.stage,
      departure: airfield.departure,
      sharpen: airfield.sharpen,
      aircraft: () => {
        const { x, y } = airfield.aircraft()
        return { x, y: y + canvasTop }
      },
      sceneWidth: () => scene,
    }

    const measure = () => {
      const width = page.clientWidth
      const pageHeight = page.clientHeight
      if (!width || !pageHeight) return
      const sceneWidth = Math.max(width, 1000)
      const anchor = page.querySelector<HTMLElement>('[data-horizon]')
      const anchorTop = anchor ? offsetWithin(anchor, page).top : pageHeight * 0.66
      const horizon = Math.round(anchorTop - GROUND_DEPTH * sceneWidth)

      const words = [...page.querySelectorAll<HTMLElement>('[data-sky-text]')].map((block) => {
        const { left, top } = offsetWithin(block, page)
        return { left, right: left + block.offsetWidth, bottom: top + block.offsetHeight }
      })
      const up = Math.round(0.15 * sceneWidth)
      const down = Math.min(Math.round(0.06 * sceneWidth), pageHeight - horizon)
      const headroom = (x: number) =>
        horizon - 14 - Math.max(0, ...words.filter((w) => x > w.left - 36 && x < w.right + 36).map((w) => w.bottom))

      // sky photograph: wide enough to drift, tall enough to reach the top of the page
      const skyHeight = Math.max((1.08 * width) / SKY_ASPECT, (horizon / SKY_HORIZON_ROW) * 1.02)
      const skyWidth = skyHeight * SKY_ASPECT
      const margin = 0.02 * skyWidth
      const glowTarget = width * (width > 860 ? 0.3 : 0.42)
      const skyLeft = Math.min(-margin, Math.max(width - skyWidth + margin, glowTarget - SKY_SUN_X * skyWidth))
      const glowX = skyLeft + SKY_SUN_X * skyWidth

      const set = (name: string, px: number) => el.style.setProperty(name, `${px}px`)
      canvasTop = horizon - up
      scene = sceneWidth
      set('--horizon', horizon)
      set('--canvas-top', horizon - up)
      set('--canvas-height', up + down)
      set('--sky-left', skyLeft)
      set('--sky-top', horizon - SKY_HORIZON_ROW * skyHeight)
      set('--sky-width', skyWidth)
      set('--sky-height', skyHeight)
      set('--glow-x', glowX)

      airfield.resize({
        width,
        height: up + down,
        horizon: up,
        sceneWidth,
        offsetX: width >= sceneWidth ? 0 : width / 2 - 0.4 * sceneWidth,
        glowX,
        headroom,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(page)
    let cancelled = false
    document.fonts.ready.then(() => !cancelled && measure())
    return () => {
      cancelled = true
      observer.disconnect()
      airfieldStage.current = null
      airfield.dispose()
      field.current = null
    }
  }, [])

  // animate only while the page is on screen; reduced motion keeps the still frame drawn on layout
  useEffect(() => {
    const airfield = field.current
    if (!live || !airfield || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      airfield.frame((now - last) / 1000)
      last = now
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div className="airfield" ref={root} aria-hidden="true">
      <div className="airfield__sky" />
      <div className="airfield__dusk" />
      <div className="airfield__ground" />
      <canvas className="airfield__canvas" ref={canvas} />
    </div>
  )
}
