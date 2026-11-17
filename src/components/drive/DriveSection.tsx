import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { FlightLink } from '../FlightLink'
import { PLACES } from '../sim/destinations'
import { drive, speedKmh, type PlaceId } from './driveState'
import './DriveSection.css'

const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'])
/** drag distance (px) for full deflection on touch screens */
const STICK_TRAVEL = 64

const formatDistance = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)

interface DriveSectionProps {
  ref: RefObject<HTMLElement | null>
  /** the ground is the page in front and takes input */
  active: boolean
  /** some of it can be seen (also while arriving or leaving), so its read-outs should keep up */
  live: boolean
  onLeave: () => void
}

/**
 * Everything the ground shows that is not the country itself: the bars and the skip button while the car
 * is being delivered, then labels that follow the gateways, the speed, key hints, a touch stick, and the
 * panel that opens when the car reaches a place. The driving happens in the WebGL scene (hero/scene/Drive*.tsx)
 * from the shared state in driveState.ts. Without that scene (reduced motion, or no WebGL) the labels become
 * a plain menu that opens the same panels.
 */
export function DriveSection({ ref, active, live, onLeave }: DriveSectionProps) {
  const [open, setOpen] = useState<PlaceId | null>(null)
  /** what the panel last showed, so its text stays put while it slides away */
  const [shown, setShown] = useState<PlaceId | null>(null)
  const hud = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const stick = useRef<HTMLDivElement>(null)
  const reading = useRef(false)

  const show = useCallback((id: PlaceId | null) => {
    setOpen(id)
    if (id) setShown(id)
  }, [])
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    reading.current = open !== null
  }, [open])

  useEffect(() => {
    drive.onNear = show
    return () => {
      drive.onNear = null
    }
  }, [show])

  // keyboard: WASD or arrows drive, Space is the handbrake, Escape closes the panel or skips the delivery
  useEffect(() => {
    if (!active) return
    const held = new Set<string>()
    const keycaps = hud.current!.querySelectorAll<HTMLElement>('[data-key]')
    const apply = () => {
      const any = (...codes: string[]) => (codes.some((c) => held.has(c)) ? 1 : 0)
      drive.input.steer = any('KeyD', 'ArrowRight') - any('KeyA', 'ArrowLeft')
      drive.input.throttle = any('KeyW', 'ArrowUp') - any('KeyS', 'ArrowDown')
      drive.input.handbrake = any('Space') === 1
      for (const cap of keycaps) cap.toggleAttribute('data-held', any(...cap.dataset.key!.split(' ')) === 1)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (reading.current) close()
        else if (drive.phase === 'intro') drive.skip = true
        return
      }
      if (!DRIVE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return
      // a focused button keeps Space for itself
      if (e.code === 'Space' && e.target instanceof HTMLElement && e.target.closest('button, a')) return
      e.preventDefault()
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

  // labels and the speed follow the car every frame, straight to the DOM
  useEffect(() => {
    if (!live) return
    const root = hud.current!
    const text = (selector: string) => root.querySelector<HTMLElement>(selector)!
    const marks = PLACES.map(({ id }) => ({ id, el: text(`[data-mark="${id}"]`), distance: text(`[data-mark="${id}"] [data-distance]`) }))
    const speed = text('[data-readout="speed"]')
    const write = (el: HTMLElement, value: string) => {
      if (el.textContent !== value) el.textContent = value
    }
    let raf = requestAnimationFrame(function tick() {
      const mode = !drive.running ? 'menu' : drive.phase === 'intro' ? 'intro' : 'flight'
      if (root.dataset.mode !== mode) root.dataset.mode = mode
      const slots = { left: 0, right: 0 }
      for (const { id, el, distance } of marks) {
        const mark = mode === 'flight' ? drive.marks[id] : undefined
        if (!mark) {
          el.dataset.side = 'none'
          el.style.transform = ''
          continue
        }
        const side = mark.side === 0 ? 'on' : mark.side < 0 ? 'left' : 'right'
        el.dataset.side = side
        el.style.transform = side === 'on' ? `translate3d(${mark.x.toFixed(1)}px, ${mark.y.toFixed(1)}px, 0)` : ''
        if (side !== 'on') el.style.setProperty('--slot', String(slots[side]++))
        el.toggleAttribute('data-target', drive.near === id)
        write(distance, formatDistance(mark.distance))
      }
      write(speed, String(Math.round(speedKmh())))
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [live])

  // without the scene there is nowhere to drive to: the label simply opens its panel
  const choose = (id: PlaceId) => {
    if (!drive.running) show(id)
  }

  const leave = (e: MouseEvent) => {
    e.preventDefault()
    setOpen(null)
    onLeave()
  }

  // touch: drag anywhere, like a stick that appears under the thumb; sideways steers, up is the accelerator
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
  }
  const touchMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = Math.max(-STICK_TRAVEL, Math.min(STICK_TRAVEL, e.clientX - d.x))
    const dy = Math.max(-STICK_TRAVEL, Math.min(STICK_TRAVEL, e.clientY - d.y))
    drive.input.steer = dx / STICK_TRAVEL
    drive.input.throttle = -dy / STICK_TRAVEL
    stickTo(dx, dy, true)
  }
  const touchEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    drive.input.steer = drive.input.throttle = 0
    stickTo(0, 0, false)
  }

  const content = PLACES.find((p) => p.id === shown)
  const isOpen = active && open !== null

  return (
    <section className="sim drive" ref={ref} aria-label="The ground" tabIndex={-1} inert={!active}>
      <div className="sim__hud drive__hud" ref={hud} data-mode="menu" data-reading={isOpen ? '' : undefined} data-live={live ? '' : undefined}>
        <div className="sim__touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}>
          <div className="sim__stick" ref={stick} aria-hidden="true" />
        </div>

        {/* while the car is being delivered the frame is a film's, and the only control is the way out of it */}
        <div className="drive__bars" aria-hidden="true" />
        <button
          type="button"
          className="drive__skip"
          onClick={() => {
            drive.skip = true
          }}
        >
          Skip
        </button>

        <header className="sim__bar">
          <a className="sim__back" href="#sim" onClick={leave}>
            <svg viewBox="0 0 26 10" width="26" height="10" fill="none" aria-hidden="true">
              <path d="M26 5H2M6.5 1 2 5l4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to the sky
          </a>
        </header>

        <p className="sim__handover" aria-hidden="true">
          <span className="sim__handover-title">The car is yours.</span>
          <span className="sim__handover-text">Projects, Skills and Hobbies are down these roads. The markers show the way.</span>
        </p>

        <nav className="sim__marks" aria-label="Places">
          {PLACES.map(({ id, label, direction }) => (
            <button type="button" className="sim-mark" key={id} data-mark={id} data-side="none" onClick={() => choose(id)}>
              <span className="sim-mark__name">{label}</span>
              <span className="sim-mark__distance" data-distance />
              <span className="sim-mark__direction">{direction}</span>
            </button>
          ))}
        </nav>

        <p className="drive__speed" aria-hidden="true">
          <span className="drive__speed-value" data-readout="speed">
            0
          </span>
          <span className="drive__speed-unit">km/h</span>
        </p>

        <div className="sim__keys" aria-hidden="true">
          <div className="sim__keypad">
            <kbd data-key="KeyW ArrowUp">W</kbd>
            <kbd data-key="KeyA ArrowLeft">A</kbd>
            <kbd data-key="KeyS ArrowDown">S</kbd>
            <kbd data-key="KeyD ArrowRight">D</kbd>
          </div>
          <p className="sim__legend">
            <span>W · S accelerate and brake</span>
            <span>A · D steer</span>
            <span>
              <kbd data-key="Space">Space</kbd> handbrake
            </span>
          </p>
          <p className="sim__legend sim__legend--touch">Drag sideways to steer · push up to accelerate</p>
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
            <FlightLink className="sim-panel__resume" label="Keep driving" onClick={close} />
          </div>
        )}
      </aside>
    </section>
  )
}
