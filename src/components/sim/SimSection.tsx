import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { FlightLink } from '../FlightLink'
import { DESTINATIONS } from './destinations'
import { altitudeFeet, compassHeading, flyTo, machNumber, resumeFlight, sim, type DestinationId } from './simState'
import './SimSection.css'

const STEER_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'])
const BOOST_KEYS = new Set(['ShiftLeft', 'ShiftRight'])
/** drag distance (px) for full deflection on touch screens */
const STICK_TRAVEL = 64

const formatDistance = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)

interface SimSectionProps {
  ref: RefObject<HTMLElement | null>
  /** the simulator is the page in front and takes input */
  active: boolean
  /** some of it can be seen (also while arriving or leaving), so its read-outs should keep up */
  live: boolean
  onLeave: () => void
  /** go down to the ground: the button in the beacon's panel */
  onEnter: () => void
}

/**
 * Everything the simulator shows that is not the sky: destination labels that follow their beacons,
 * instruments, key hints, a touch stick, and the panel that opens on arrival.
 * The flying itself happens in the WebGL scene (hero/scene/Sim*.tsx) from the shared state in simState.ts.
 * Without that scene (reduced motion, or no WebGL) the labels become a plain menu that opens the same panels.
 */
export function SimSection({ ref, active, live, onLeave, onEnter }: SimSectionProps) {
  const [arrived, setArrived] = useState<DestinationId | null>(null)
  /** what the panel last showed, so its text stays put while it slides away */
  const [shown, setShown] = useState<DestinationId | null>(null)
  const hud = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const stick = useRef<HTMLDivElement>(null)
  const reading = useRef(false)

  const open = useCallback((id: DestinationId) => {
    setArrived(id)
    setShown(id)
  }, [])
  const close = useCallback(() => {
    resumeFlight()
    setArrived(null)
  }, [])

  useEffect(() => {
    reading.current = arrived !== null
    if (arrived) panel.current?.focus({ preventScroll: true })
  }, [arrived])

  useEffect(() => {
    sim.onArrive = open
    return () => {
      sim.onArrive = null
    }
  }, [open])

  // keyboard: WASD or arrows steer, Shift is the throttle, Escape closes the panel
  useEffect(() => {
    if (!active) return
    const held = new Set<string>()
    const keycaps = hud.current!.querySelectorAll<HTMLElement>('[data-key]')
    const apply = () => {
      const any = (...codes: string[]) => (codes.some((c) => held.has(c)) ? 1 : 0)
      sim.input.turn = any('KeyD', 'ArrowRight') - any('KeyA', 'ArrowLeft')
      sim.input.climb = any('KeyW', 'ArrowUp') - any('KeyS', 'ArrowDown')
      sim.input.boost = any('ShiftLeft', 'ShiftRight') === 1
      for (const cap of keycaps) cap.toggleAttribute('data-held', any(...cap.dataset.key!.split(' ')) === 1)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && reading.current) return close()
      const steer = STEER_KEYS.has(e.code)
      if ((!steer && !BOOST_KEYS.has(e.code)) || e.ctrlKey || e.metaKey || e.altKey || reading.current) return
      if (steer) {
        e.preventDefault()
        // touching the controls takes the aircraft back from "fly me there"
        if (sim.autopilot?.mode === 'goto') sim.autopilot = null
      }
      held.add(e.code)
      apply()
    }
    const up = (e: KeyboardEvent) => {
      held.delete(e.code)
      apply()
    }
    const release = () => {
      held.clear()
      apply()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      release()
    }
  }, [active, close])

  // labels and instruments follow the flight every frame, straight to the DOM
  useEffect(() => {
    if (!live) return
    const root = hud.current!
    const text = (selector: string) => root.querySelector<HTMLElement>(selector)!
    const marks = DESTINATIONS.map(({ id }) => ({ id, el: text(`[data-mark="${id}"]`), distance: text(`[data-mark="${id}"] [data-distance]`) }))
    const heading = text('[data-readout="heading"]')
    const altitude = text('[data-readout="altitude"]')
    const mach = text('[data-readout="mach"]')
    const write = (el: HTMLElement, value: string) => {
      if (el.textContent !== value) el.textContent = value
    }
    let raf = requestAnimationFrame(function tick() {
      root.dataset.mode = sim.flying ? 'flight' : 'menu'
      const slots = { left: 0, right: 0 }
      for (const { id, el, distance } of marks) {
        const mark = sim.flying ? sim.marks[id] : undefined
        if (!mark) {
          el.dataset.side = 'none'
          el.style.transform = ''
          continue
        }
        const side = mark.side === 0 ? 'on' : mark.side < 0 ? 'left' : 'right'
        el.dataset.side = side
        el.style.transform = side === 'on' ? `translate3d(${mark.x.toFixed(1)}px, ${mark.y.toFixed(1)}px, 0)` : ''
        if (side !== 'on') el.style.setProperty('--slot', String(slots[side]++))
        el.toggleAttribute('data-target', sim.autopilot?.id === id)
        write(distance, formatDistance(mark.distance))
      }
      write(heading, `${String(Math.round(compassHeading()) % 360).padStart(3, '0')}°`)
      write(altitude, `${(Math.round(altitudeFeet() / 10) * 10).toLocaleString('en-US')} ft`)
      write(mach, machNumber().toFixed(2))
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [live])

  const choose = (id: DestinationId) => {
    // with the scene flying, the autopilot takes you there; without it, the panel simply opens
    if (sim.flying) flyTo(id)
    else open(id)
  }

  const leave = (e: MouseEvent) => {
    e.preventDefault()
    setArrived(null)
    onLeave()
  }
  const enter = () => {
    setArrived(null)
    onEnter()
  }

  // touch: drag anywhere to steer, like a stick that appears under the thumb
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const stickTo = (dx: number, dy: number, visible: boolean) => {
    const el = stick.current!
    el.toggleAttribute('data-on', visible)
    el.style.setProperty('--dx', `${dx}px`)
    el.style.setProperty('--dy', `${dy}px`)
  }
  const touchStart = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || drag.current) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    stick.current!.style.setProperty('--x', `${e.clientX}px`)
    stick.current!.style.setProperty('--y', `${e.clientY}px`)
    stickTo(0, 0, true)
    if (sim.autopilot?.mode === 'goto') sim.autopilot = null
  }
  const touchMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = Math.max(-STICK_TRAVEL, Math.min(STICK_TRAVEL, e.clientX - d.x))
    const dy = Math.max(-STICK_TRAVEL, Math.min(STICK_TRAVEL, e.clientY - d.y))
    sim.input.turn = dx / STICK_TRAVEL
    sim.input.climb = -dy / STICK_TRAVEL
    stickTo(dx, dy, true)
  }
  const touchEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    sim.input.turn = sim.input.climb = 0
    stickTo(0, 0, false)
  }

  const content = DESTINATIONS.find((d) => d.id === shown)
  const isOpen = active && arrived !== null

  return (
    <section className="sim" ref={ref} aria-label="Flight simulator" tabIndex={-1} inert={!active}>
      <div className="sim__hud" ref={hud} data-mode="menu" data-reading={isOpen ? '' : undefined} data-live={live ? '' : undefined}>
        <div className="sim__touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}>
          <div className="sim__stick" ref={stick} aria-hidden="true" />
        </div>

        <header className="sim__bar">
          <a className="sim__back" href="#about" onClick={leave}>
            <svg viewBox="0 0 26 10" width="26" height="10" fill="none" aria-hidden="true">
              <path d="M26 5H2M6.5 1 2 5l4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            About
          </a>
        </header>

        <p className="sim__handover" aria-hidden="true">
          <span className="sim__handover-title">You have control.</span>
          <span className="sim__handover-text">Fly to the beacon ahead, or select it and the autopilot will take you there.</span>
        </p>

        <nav className="sim__marks" aria-label="Destinations">
          {DESTINATIONS.map(({ id, label, direction }) => (
            <button type="button" className="sim-mark" key={id} data-mark={id} data-side="none" onClick={() => choose(id)}>
              <span className="sim-mark__name">{label}</span>
              <span className="sim-mark__distance" data-distance />
              <span className="sim-mark__direction">{direction}</span>
            </button>
          ))}
        </nav>

        <dl className="sim__instruments" aria-hidden="true">
          <div>
            <dt>Hdg</dt>
            <dd data-readout="heading">270°</dd>
          </div>
          <div>
            <dt>Alt</dt>
            <dd data-readout="altitude">35,000 ft</dd>
          </div>
          <div>
            <dt>Mach</dt>
            <dd data-readout="mach">0.78</dd>
          </div>
        </dl>

        <div className="sim__keys" aria-hidden="true">
          <div className="sim__keypad">
            <kbd data-key="KeyW ArrowUp">W</kbd>
            <kbd data-key="KeyA ArrowLeft">A</kbd>
            <kbd data-key="KeyS ArrowDown">S</kbd>
            <kbd data-key="KeyD ArrowRight">D</kbd>
          </div>
          <p className="sim__legend">
            <span>A · D turn</span>
            <span>W · S climb and descend</span>
            <span>
              <kbd data-key="ShiftLeft ShiftRight">Shift</kbd> full throttle
            </span>
          </p>
          <p className="sim__legend sim__legend--touch">Drag to steer · tap the beacon to fly there</p>
        </div>
      </div>

      <aside className="sim-panel" ref={panel} data-open={isOpen ? '' : undefined} aria-label={content?.label} tabIndex={-1} inert={!isOpen}>
        {content && (
          <div className="sim-panel__inner">
            <p className="sim-panel__eyebrow">{content.label}</p>
            <h2 className="sim-panel__title">{content.title}</h2>
            {content.intro && <p className="sim-panel__intro">{content.intro}</p>}
            <ul className="sim-panel__list">
              {content.entries.map((entry, i) => (
                <li className="sim-panel__entry" key={i}>
                  <span className="sim-panel__index">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="sim-panel__entry-title">{entry.title}</h3>
                  {entry.text && <p className="sim-panel__entry-text">{entry.text}</p>}
                  {entry.tags && (
                    <ul className="sim-panel__tags">
                      {entry.tags.map((tag, j) => (
                        <li key={j}>{tag}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <div className="sim-panel__actions">
              <FlightLink className="sim-panel__enter" label="Enter the Horizon" onClick={enter} />
              <button type="button" className="sim-panel__stay" onClick={close}>
                Keep flying
              </button>
            </div>
          </div>
        )}
      </aside>
    </section>
  )
}
