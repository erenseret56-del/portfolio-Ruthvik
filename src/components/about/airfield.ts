// Canvas scene behind the About page: an airfield at dusk seen side-on from across the field.
// Skyline silhouettes, runway and taxiway lighting, and one airliner at a time departing to the right.
// Everything is positioned in "scene" units (0..1 across the scene width) so it frames the same on any screen.

export interface AirfieldMetrics {
  /** canvas size in css px */
  width: number
  height: number
  /** y of the horizon inside the canvas (css px) */
  horizon: number
  /** width of the whole scene in css px; wider than the canvas on narrow screens, which then show a crop */
  sceneWidth: number
  /** x of scene position 0 inside the canvas */
  offsetX: number
  /** x where the afterglow is centred (where the sun went down) */
  glowX: number
  /** free height (css px) above the horizon at canvas x, i.e. how tall a silhouette may stand without running into text */
  headroom: (x: number) => number
  dpr: number
}

/**
 * What the aircraft is doing. 'loop' is the page at rest: departures come and go on their own.
 * The flight to the simulator directs it instead: 'ready' lines one up at the start of the runway and holds
 * it there with its lights on, 'depart' sends it, briskly, and nothing follows it until the loop is restored.
 * A staged departure does not run on the airfield's own clock: whoever directs it says how far along it is
 * (see Airfield.departure), so the take-off stays in step with the camera move wrapped around it.
 */
export type AirfieldStage = 'loop' | 'ready' | 'depart'

export interface Airfield {
  resize: (metrics: AirfieldMetrics) => void
  /** advance by dt seconds and draw */
  frame: (dt: number) => void
  stage: (stage: AirfieldStage) => void
  /** in the 'depart' stage: put the aircraft where it is this many seconds after its brakes come off */
  departure: (seconds: number) => void
  /** draw at this many times the usual resolution, for when the page is about to be magnified */
  sharpen: (scale: number) => void
  /** where the aircraft is, in css px inside the canvas (roughly the middle of its fuselage) */
  aircraft: () => { x: number; y: number }
  dispose: () => void
}

// side-on render of the hero's own aircraft model, backlit (see public/hero/CREDITS.txt)
const SPRITE = { url: '/about/aircraft-dusk.webp', width: 781, height: 222, pxPerMetre: 12, originX: 404.6, originY: 146.7, length: 63 }
/** model-space height of the runway under the wheels, and where the main gear sits along the fuselage (m) */
const GROUND_Y = -5.1
const MAIN_GEAR_X = -3
const NOSE_GEAR_X = 24.5
/** on-screen length of the departing aircraft, in scene units */
const AIRCRAFT_LENGTH = 0.054

const INK = '#0c0a11'
const COLORS = {
  white: '#fff1d8',
  amber: '#ffb24a',
  red: '#ff4030',
  green: '#4dffa2',
  blue: '#4d8dff',
  flood: '#ffe3b4',
  strobe: '#ffffff',
  window: '#ffc98c',
} as const
type Color = keyof typeof COLORS

// vertical positions below the horizon, in scene units
const RUNWAY_FAR = 0.0095
const RUNWAY_NEAR = 0.018
const RUNWAY_MID = (RUNWAY_FAR + RUNWAY_NEAR) / 2
const TAXI_FAR = 0.028
const TAXI_NEAR = 0.0345
const RUNWAY_START = 0.05
const RUNWAY_END = 0.95

const D2R = Math.PI / 180
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step))

function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function glowSprite(color: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.1, color)
  g.addColorStop(0.28, `${color}66`)
  g.addColorStop(0.6, `${color}16`)
  g.addColorStop(1, `${color}00`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return c
}

interface Light {
  x: number
  y: number
  /** core radius in css px */
  r: number
  color: Color
  alpha: number
  /** scintillation depth 0..1 and its phase / rate */
  twinkle: number
  phase: number
  rate: number
  /** optional flash envelope */
  level?: (t: number) => number
}

type Phase = 'taxi' | 'hold' | 'roll' | 'climb' | 'gone'

const pulse = (t: number, period: number, start: number, length: number) => {
  const p = ((t % period) + period) % period
  return p > start && p < start + length ? 1 : 0
}
const strobe = (t: number) => Math.max(pulse(t, 1.3, 0, 0.06), pulse(t, 1.3, 0.15, 0.06))
const beacon = (t: number) => {
  const p = (t + 0.6) % 1.3
  return p < 0.24 ? Math.sin((p / 0.24) * Math.PI) : 0
}

export function createAirfield(canvas: HTMLCanvasElement): Airfield {
  const ctx = canvas.getContext('2d')!
  const backdrop = document.createElement('canvas')
  const glows = Object.fromEntries(Object.entries(COLORS).map(([name, hex]) => [name, glowSprite(hex)])) as Record<Color, HTMLCanvasElement>

  let m: AirfieldMetrics | null = null
  /** the metrics as measured, before sharpen() raises their resolution */
  let measured: AirfieldMetrics | null = null
  let detail = 1
  let stage: AirfieldStage = 'loop'
  /** the aircraft's opacity: it is faded out and back when it has to be somewhere else at once */
  let shown = 1
  let recall = false
  let lights: Light[] = []
  let time = 0
  let disposed = false

  // departure geometry, set per layout so the take-off always happens inside the visible part of the scene
  let holdX = 0.085
  let rollDistance = 0.46
  const plane = { phase: 'hold' as Phase, clock: 1.2, x: 0.085, alt: 0, speed: 0, pitch: 0, climb: 0, gear: 1 }

  const sprite = new Image()
  let spriteReady = false
  sprite.onload = () => {
    spriteReady = true
    if (!disposed && m) {
      rebuild()
      draw()
    }
  }
  sprite.src = SPRITE.url

  const X = (s: number) => m!.offsetX + s * m!.sceneWidth
  const Y = (below: number) => m!.horizon + below * m!.sceneWidth

  function resize(measuredMetrics: AirfieldMetrics) {
    measured = measuredMetrics
    const metrics = { ...measuredMetrics, dpr: Math.min(3, measuredMetrics.dpr * detail) }
    m = metrics
    for (const c of [canvas, backdrop]) {
      c.width = Math.round(metrics.width * metrics.dpr)
      c.height = Math.round(metrics.height * metrics.dpr)
    }
    const visibleLeft = -metrics.offsetX / metrics.sceneWidth
    const visibleRight = (metrics.width - metrics.offsetX) / metrics.sceneWidth
    holdX = Math.max(0.085, visibleLeft + 0.09)
    rollDistance = Math.min(0.46, (visibleRight - holdX) * 0.62)
    if (plane.phase === 'hold' || plane.phase === 'taxi') plane.x = Math.min(plane.x, holdX)
    if (plane.phase === 'hold') plane.x = holdX
    rebuild()
    draw()
  }

  /** Lights first, then the painted skyline, which adds the lamps that sit on its structures. */
  function rebuild() {
    buildLights()
    paintBackdrop()
  }

  // ---------- lights ----------

  function buildLights() {
    const { sceneWidth: V, width } = m!
    const rand = seeded(7)
    const k = clamp(V / 1920, 0.8, 1.5)
    lights = []
    const add = (s: number, below: number, r: number, color: Color, alpha = 1, twinkle = 0.2, level?: Light['level']) => {
      const x = X(s)
      if (x < -24 || x > width + 24) return
      lights.push({ x, y: Y(below), r: r * k, color, alpha, twinkle, phase: rand() * 6.28, rate: 1.5 + rand() * 3, level })
    }
    const row = (from: number, to: number, step: number, each: (s: number, i: number) => void) => {
      for (let s = from, i = 0; s <= to + 1e-6; s += step, i++) each(s, i)
    }

    // runway edges: white, turning amber over the last fifth, green at the threshold and red at the far end
    const amberFrom = RUNWAY_END - 0.18
    row(RUNWAY_START, RUNWAY_END, 0.0165, (s) => {
      const color: Color = s > amberFrom ? 'amber' : 'white'
      add(s, RUNWAY_FAR, 1.05, color, 0.85, 0.3)
      add(s, RUNWAY_NEAR, 1.5, color, 1, 0.22)
    })
    row(0, 3, 1, (_, i) => {
      const below = RUNWAY_FAR + ((RUNWAY_NEAR - RUNWAY_FAR) * i) / 3
      add(RUNWAY_START - 0.002, below, 1.3, 'green', 0.95, 0.15)
      add(RUNWAY_END + 0.002, below, 1.3, 'red', 0.95, 0.15)
    })
    // centreline: faint, alternating red and white near the end, then red
    row(RUNWAY_START + 0.008, RUNWAY_END - 0.008, 0.0085, (s, i) => {
      const left = RUNWAY_END - s
      const color: Color = left < 0.06 || (left < 0.18 && i % 2 === 0) ? 'red' : 'white'
      add(s, RUNWAY_MID, 0.75, color, 0.5, 0.25)
    })
    // glide-path indicator beside the threshold: two white, two red
    row(0, 3, 1, (_, i) => add(0.115 + i * 0.0032, RUNWAY_FAR - 0.0022, 1.7, i < 2 ? 'white' : 'red', 1, 0.05))
    // approach lighting running in from the left, with the sequenced flasher chasing toward the threshold
    row(0, 11, 1, (_, i) => {
      const s = RUNWAY_START - 0.012 - i * 0.011
      add(s, RUNWAY_MID - 0.002, 1.05, 'white', 0.8, 0.2)
      add(s, RUNWAY_MID + 0.002, 1.05, 'white', 0.8, 0.2)
      add(s, RUNWAY_MID, 2.6, 'strobe', 1, 0, (t) => pulse(t - (11 - i) * 0.045, 1.1, 0, 0.05))
    })

    // parallel taxiway: blue edges, green centreline, with three links up to the runway
    row(0, 1, 0.021, (s) => {
      add(s, TAXI_FAR, 1.25, 'blue', 0.85, 0.18)
      add(s, TAXI_NEAR, 1.55, 'blue', 0.95, 0.15)
    })
    row(0.004, 1, 0.0105, (s) => add(s, (TAXI_FAR + TAXI_NEAR) / 2, 0.8, 'green', 0.34, 0.2))
    for (const link of [0.22, 0.5, 0.78]) {
      row(1, 3, 1, (_, i) => {
        const f = i / 4
        const below = RUNWAY_NEAR + (TAXI_FAR - RUNWAY_NEAR) * f
        add(link - 0.012 + f * 0.01, below, 1.2, 'blue', 0.8, 0.15)
        add(link + 0.012 + f * 0.01, below, 1.2, 'blue', 0.8, 0.15)
      })
      // runway guard lights: an amber pair flashing alternately at the holding point
      const hold = RUNWAY_NEAR + (TAXI_FAR - RUNWAY_NEAR) * 0.35
      add(link - 0.016, hold, 1.6, 'amber', 1, 0, (t) => pulse(t, 1, 0, 0.5))
      add(link + 0.019, hold, 1.6, 'amber', 1, 0, (t) => pulse(t, 1, 0.5, 0.5))
    }
  }

  // ---------- skyline and ground (painted once per layout) ----------

  function paintBackdrop() {
    const { sceneWidth: V, width, height, horizon, glowX, dpr, headroom } = m!
    const b = backdrop.getContext('2d')!
    b.setTransform(dpr, 0, 0, dpr, 0, 0)
    b.clearRect(0, 0, width, height)
    const rand = seeded(21)
    /** a silhouette may be at most this tall at x: the layout decides, so nothing stands behind text */
    const fit = (x: number, nominal: number) => clamp(Math.min(nominal * V, headroom(x)), 0.006 * V, nominal * V)

    // afterglow on the sky side of the horizon
    b.save()
    b.beginPath()
    b.rect(0, 0, width, horizon)
    b.clip()
    b.translate(glowX, horizon)
    b.scale(1, 0.3)
    const sky = b.createRadialGradient(0, 0, 0, 0, 0, 0.36 * V)
    sky.addColorStop(0, 'rgba(255,170,98,0.46)')
    sky.addColorStop(0.3, 'rgba(255,132,76,0.22)')
    sky.addColorStop(1, 'rgba(255,110,70,0)')
    b.fillStyle = sky
    b.fillRect(-V, -V, 2 * V, 2 * V)
    b.restore()
    const haze = b.createLinearGradient(0, horizon - 0.014 * V, 0, horizon)
    haze.addColorStop(0, 'rgba(255,170,116,0)')
    haze.addColorStop(1, 'rgba(255,170,116,0.2)')
    b.fillStyle = haze
    b.fillRect(0, horizon - 0.014 * V, width, 0.014 * V)

    // its reflection in the tarmac, and the paler runway surface
    b.save()
    b.beginPath()
    b.rect(0, horizon, width, height - horizon)
    b.clip()
    b.translate(glowX, horizon)
    b.scale(1, 0.14)
    const sheen = b.createRadialGradient(0, 0, 0, 0, 0, 0.34 * V)
    sheen.addColorStop(0, 'rgba(255,150,92,0.26)')
    sheen.addColorStop(0.4, 'rgba(255,128,80,0.1)')
    sheen.addColorStop(1, 'rgba(255,120,80,0)')
    b.fillStyle = sheen
    b.fillRect(-V, 0, 2 * V, 2 * V)
    b.restore()
    b.fillStyle = 'rgba(255,236,214,0.035)'
    b.fillRect(X(RUNWAY_START), Y(RUNWAY_FAR), (RUNWAY_END - RUNWAY_START) * V, (RUNWAY_NEAR - RUNWAY_FAR) * V)

    b.fillStyle = INK
    // distant treeline
    b.beginPath()
    b.moveTo(0, horizon + 1)
    for (let x = 0; x <= width + 8; x += 8) {
      const s = (x - m!.offsetX) / V
      const bump = 0.0022 + 0.0016 * Math.sin(s * 41) + 0.0012 * Math.sin(s * 97 + 1.3) + 0.001 * Math.sin(s * 211 + 0.4)
      b.lineTo(x, horizon - bump * V)
    }
    b.lineTo(width, horizon + 1)
    b.fill()

    const block = (s: number, w: number, hNominal: number) => {
      const h = fit(X(s + w / 2), hNominal)
      b.fillRect(X(s), horizon - h, w * V, h + 1)
      return h
    }
    const windows = (s: number, w: number, up: number, step: number, lit: number) => {
      b.save()
      b.globalCompositeOperation = 'lighter'
      for (let q = s + step; q < s + w - step; q += step) {
        if (rand() > lit) continue
        b.globalAlpha = 0.3 + rand() * 0.45
        const size = Math.max(1.2, 0.0014 * V)
        b.drawImage(glows.window, X(q) - size * 2, horizon - up - size * 2, size * 4, size * 4)
      }
      b.restore()
    }
    const redTop = (x: number, y: number, r = 1.3, blink = true) =>
      lights.push({ x, y, r: r * clamp(V / 1920, 0.8, 1.5), color: 'red', alpha: 0.95, twinkle: 0, phase: 0, rate: 0, level: blink ? (t) => 0.25 + 0.75 * pulse(t + x, 2.2, 0, 1.1) : undefined })

    // terminal: long low concourse with a taller arched hall
    const concourse = block(0.1, 0.3, 0.0105)
    windows(0.1, 0.3, concourse * 0.5, 0.0034, 0.72)
    {
      const cx = X(0.2)
      const w = 0.085 * V
      const h = fit(cx, 0.019)
      b.beginPath()
      b.moveTo(cx - w / 2, horizon)
      b.lineTo(cx - w / 2, horizon - h * 0.55)
      b.quadraticCurveTo(cx, horizon - h * 1.25, cx + w / 2, horizon - h * 0.55)
      b.lineTo(cx + w / 2, horizon)
      b.fill()
      windows(0.165, 0.07, h * 0.42, 0.0026, 0.85)
    }
    // hangars, stores and a fuel farm further along
    for (const s of [0.565, 0.613]) {
      const cx = X(s + 0.021)
      const w = 0.042 * V
      const h = fit(cx, 0.0135)
      b.beginPath()
      b.moveTo(cx - w / 2, horizon)
      b.lineTo(cx - w / 2, horizon - h * 0.6)
      b.quadraticCurveTo(cx, horizon - h * 1.3, cx + w / 2, horizon - h * 0.6)
      b.lineTo(cx + w / 2, horizon)
      b.fill()
    }
    block(0.67, 0.035, 0.007)
    windows(0.67, 0.035, 0.0035 * V, 0.004, 0.5)
    for (const s of [0.81, 0.828, 0.846]) {
      const h = fit(X(s), 0.0075)
      b.beginPath()
      b.roundRect(X(s), horizon - h, 0.014 * V, h + 2, [h * 0.35, h * 0.35, 0, 0])
      b.fill()
    }
    block(0.875, 0.05, 0.005)

    // aircraft parked on the far apron
    if (spriteReady) {
      const scale = (0.6 * AIRCRAFT_LENGTH * V) / SPRITE.length / SPRITE.pxPerMetre
      for (const [s, flip] of [
        [0.135, 1],
        [0.33, -1],
      ] as const) {
        b.save()
        b.translate(X(s), horizon + 0.004 * V)
        b.scale(flip * scale, scale)
        b.drawImage(sprite, -SPRITE.originX, -(SPRITE.originY - GROUND_Y * SPRITE.pxPerMetre))
        b.restore()
      }
    }

    // apron floodlight masts
    for (const s of [0.085, 0.262, 0.4]) {
      const x = X(s)
      const h = fit(x, 0.031)
      b.fillRect(x - 0.0006 * V, horizon - h, Math.max(1, 0.0012 * V), h)
      b.fillRect(x - 0.0035 * V, horizon - h - 0.0012 * V, 0.007 * V, Math.max(1.5, 0.0022 * V))
      const pool = b.createLinearGradient(0, horizon - h, 0, horizon + 0.004 * V)
      pool.addColorStop(0, 'rgba(255,226,180,0.11)')
      pool.addColorStop(1, 'rgba(255,226,180,0)')
      b.save()
      b.fillStyle = pool
      b.beginPath()
      b.moveTo(x, horizon - h)
      b.lineTo(x - 0.022 * V, horizon + 0.004 * V)
      b.lineTo(x + 0.022 * V, horizon + 0.004 * V)
      b.fill()
      b.restore()
      for (const dx of [-0.0022, 0, 0.0022])
        lights.push({ x: x + dx * V, y: horizon - h - 0.0002 * V, r: 1.9 * clamp(V / 1920, 0.8, 1.5), color: 'flood', alpha: 1, twinkle: 0.06, phase: dx * 900, rate: 2 })
    }

    // control tower: tapered shaft, overhanging cab, rotating beacon
    {
      const x = X(0.52)
      const h = fit(x, 0.06)
      const shaft = 0.0046 * V * clamp(h / (0.06 * V), 0.6, 1)
      b.beginPath()
      b.moveTo(x - shaft * 0.62, horizon)
      b.lineTo(x - shaft * 0.42, horizon - h * 0.8)
      b.lineTo(x + shaft * 0.42, horizon - h * 0.8)
      b.lineTo(x + shaft * 0.62, horizon)
      b.fill()
      const cabW = Math.max(shaft * 2.6, h * 0.24)
      const cabTop = horizon - h
      const cabBottom = horizon - h * 0.8
      b.beginPath()
      b.moveTo(x - cabW * 0.36, cabBottom + h * 0.03)
      b.lineTo(x - cabW * 0.5, cabTop + h * 0.035)
      b.lineTo(x + cabW * 0.5, cabTop + h * 0.035)
      b.lineTo(x + cabW * 0.36, cabBottom + h * 0.03)
      b.fill()
      b.fillRect(x - cabW * 0.56, cabTop, cabW * 1.12, Math.max(1.5, h * 0.035))
      b.fillRect(x - 0.5, cabTop - h * 0.16, 1.2, h * 0.16)
      // lit cab glazing
      const glass = b.createLinearGradient(0, cabTop, 0, cabBottom)
      glass.addColorStop(0, 'rgba(255,214,160,0.75)')
      glass.addColorStop(1, 'rgba(255,190,130,0.35)')
      b.save()
      b.fillStyle = glass
      b.beginPath()
      b.moveTo(x - cabW * 0.385, cabBottom - h * 0.03)
      b.lineTo(x - cabW * 0.455, cabTop + h * 0.07)
      b.lineTo(x + cabW * 0.455, cabTop + h * 0.07)
      b.lineTo(x + cabW * 0.385, cabBottom - h * 0.03)
      b.fill()
      b.fillStyle = INK
      for (const q of [-0.22, 0, 0.22]) b.fillRect(x + q * cabW - 0.5, cabTop + h * 0.05, 1, h * 0.14)
      b.restore()
      b.fillStyle = INK
      redTop(x, cabTop - h * 0.16, 1.2, false)
      // airport beacon: alternating white and green sweeps
      const k = clamp(V / 1920, 0.8, 1.5)
      const sweep = (offset: number) => (t: number) => {
        const p = (t + offset) % 4.4
        return p < 0.5 ? Math.sin((p / 0.5) * Math.PI) : 0
      }
      lights.push({ x, y: cabTop - 2, r: 3.2 * k, color: 'strobe', alpha: 1, twinkle: 0, phase: 0, rate: 0, level: sweep(0) })
      lights.push({ x, y: cabTop - 2, r: 3.2 * k, color: 'green', alpha: 1, twinkle: 0, phase: 0, rate: 0, level: sweep(2.2) })
    }

    // radio mast
    {
      const x = X(0.742)
      const h = fit(x, 0.03)
      b.beginPath()
      b.moveTo(x - 0.0022 * V, horizon)
      b.lineTo(x - 0.4, horizon - h)
      b.lineTo(x + 0.4, horizon - h)
      b.lineTo(x + 0.0022 * V, horizon)
      b.fill()
      redTop(x, horizon - h)
      redTop(x, horizon - h * 0.5, 1, false)
    }
  }

  // ---------- the departure ----------

  /** Line the aircraft up at the start of the runway, lights on. */
  function lineUp() {
    Object.assign(plane, { phase: 'hold', clock: 2, x: holdX, alt: 0, speed: 0, pitch: 0, climb: 0, gear: 1 })
  }

  function fly(dt: number) {
    const p = plane
    p.clock += dt
    // called back to the runway from wherever it was: out of sight, into place, back into sight
    shown = approach(shown, recall ? 0 : 1, dt / 0.3)
    if (recall && shown === 0) {
      lineUp()
      recall = false
    }
    if (stage === 'depart') return
    if (stage === 'ready' && p.phase === 'hold') return
    if (p.phase === 'taxi') {
      p.speed = clamp((holdX - p.x) * 0.55, 0.0035, 0.024)
      p.x += p.speed * dt
      if (p.x >= holdX - 0.0006) Object.assign(p, { phase: 'hold', clock: 0, x: holdX, speed: 0 })
    } else if (p.phase === 'hold') {
      if (p.clock > 3) Object.assign(p, { phase: 'roll', clock: 0 })
    } else if (p.phase === 'roll') {
      p.speed += 0.0063 * dt
      p.x += p.speed * dt
      if (p.x > holdX + rollDistance * 0.8) p.pitch = approach(p.pitch, 9.5 * D2R, 4.2 * D2R * dt)
      if (p.x >= holdX + rollDistance) Object.assign(p, { phase: 'climb', clock: 0 })
    } else if (p.phase === 'climb') {
      p.speed += 0.002 * dt
      p.climb = approach(p.climb, 8 * D2R, 3.4 * D2R * dt)
      p.pitch = approach(p.pitch, p.climb + 3.5 * D2R, 2.5 * D2R * dt)
      p.x += p.speed * Math.cos(p.climb) * dt
      p.alt += p.speed * Math.sin(p.climb) * dt
      p.gear = Math.max(0, 1 - (p.clock - 1.2) / 2.2)
      if (X(p.x) - AIRCRAFT_LENGTH * m!.sceneWidth > m!.width + 60) Object.assign(p, { phase: 'gone', clock: 0 })
    } else if (p.clock > 7) {
      Object.assign(p, { phase: 'taxi', clock: 0, x: holdX - 0.16, alt: 0, speed: 0, pitch: 0, climb: 0, gear: 1 })
    }
  }

  /** The take-off the visitor rides along with: a short run, a firm rotation, a steep climb out. */
  function departure(dt: number) {
    const p = plane
    const span = m!.width / m!.sceneWidth
    const run = Math.min(0.14, span * 0.5)
    if (p.phase === 'hold') Object.assign(p, { phase: 'roll', clock: 0 })
    if (p.phase === 'roll') {
      p.speed += 0.022 * dt
      p.x += p.speed * dt
      if (p.x > holdX + run * 0.6) p.pitch = approach(p.pitch, 9.5 * D2R, 11 * D2R * dt)
      if (p.x >= holdX + run) Object.assign(p, { phase: 'climb', clock: 0 })
    } else if (p.phase === 'climb') {
      p.speed += 0.006 * dt
      p.climb = approach(p.climb, 17 * D2R, 10 * D2R * dt)
      p.pitch = approach(p.pitch, p.climb + 3.5 * D2R, 8 * D2R * dt)
      p.x += p.speed * Math.cos(p.climb) * dt
      p.alt += p.speed * Math.sin(p.climb) * dt
      p.gear = Math.max(0, 1 - (p.clock - 0.9) / 1.8)
      if (p.alt > 0.5) Object.assign(p, { phase: 'gone', clock: 0 })
    }
  }

  function drawAircraft() {
    const p = plane
    if (p.phase === 'gone' || !spriteReady || shown <= 0) return
    const V = m!.sceneWidth
    const ppm = (AIRCRAFT_LENGTH * V) / SPRITE.length
    const scale = ppm / SPRITE.pxPerMetre
    const k = clamp(V / 1920, 0.8, 1.5)
    /** model metres -> px in the aircraft's own frame, origin where the main gear meets the runway */
    const at = (mx: number, my: number): [number, number] => [(mx - MAIN_GEAR_X) * ppm, -(my - GROUND_Y) * ppm]
    const lamp = (mx: number, my: number, r: number, color: Color, alpha: number) => {
      if (alpha <= 0.01) return
      const [x, y] = at(mx, my)
      const size = r * k * 9
      ctx.globalAlpha = Math.min(1, alpha)
      ctx.drawImage(glows[color], x - size / 2, y - size / 2, size, size)
    }
    const lightsOn = p.phase !== 'taxi' && !(p.phase === 'hold' && p.clock < 1.6)

    ctx.save()
    ctx.translate(X(p.x), Y(RUNWAY_MID) - p.alt * V)
    ctx.rotate(-p.pitch)

    // landing lights throw a pool onto the runway ahead while the wheels are down
    if (lightsOn && p.gear > 0) {
      const [lx, ly] = at(8, -2)
      const reach = 0.085 * V
      const beam = ctx.createLinearGradient(lx, 0, lx + reach, 0)
      beam.addColorStop(0, `rgba(255,244,222,${0.2 * p.gear})`)
      beam.addColorStop(1, 'rgba(255,244,222,0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = beam
      ctx.beginPath()
      ctx.moveTo(lx, ly)
      ctx.lineTo(lx + reach, ly - 0.004 * V)
      ctx.lineTo(lx + reach, ly + 0.012 * V)
      ctx.fill()
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    if (p.gear > 0) {
      ctx.globalAlpha = p.gear
      ctx.fillStyle = INK
      const strut = Math.max(1, 0.5 * ppm)
      for (const [gx, top] of [
        [MAIN_GEAR_X, -2.6],
        [NOSE_GEAR_X, -2.4],
      ]) {
        const [x, y0] = at(gx, top)
        ctx.fillRect(x - strut / 2, y0, strut, -y0 - 0.5 * ppm)
        ctx.beginPath()
        ctx.arc(x, -0.6 * ppm, Math.max(1, 0.62 * ppm), 0, 6.3)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    ctx.drawImage(
      sprite,
      (-SPRITE.originX / SPRITE.pxPerMetre - MAIN_GEAR_X) * ppm,
      -(SPRITE.originY / SPRITE.pxPerMetre - GROUND_Y) * ppm,
      SPRITE.width * scale,
      SPRITE.height * scale,
    )

    ctx.globalCompositeOperation = 'lighter'
    lamp(-9.8, 1.9, 1.15, 'green', 0.95)
    lamp(-10.4, 1.9, 3.6, 'strobe', strobe(time))
    lamp(-32, 3.2, 2.6, 'strobe', strobe(time + 0.4))
    lamp(-2.5, 3.45, 2.2, 'red', beacon(time))
    lamp(10, -3.15, 2.2, 'red', beacon(time))
    if (lightsOn) {
      lamp(8, -1.9, 3.4, 'strobe', 0.95)
      lamp(NOSE_GEAR_X, -2.9, 2.6, 'strobe', 0.9 * p.gear)
    }
    ctx.restore()
  }

  function draw() {
    if (!m) return
    const { width, height, dpr } = m
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(backdrop, 0, 0, width, height)

    ctx.globalCompositeOperation = 'lighter'
    for (const l of lights) {
      const flicker = 1 - l.twinkle * (0.5 + 0.5 * Math.sin(time * l.rate + l.phase))
      const a = l.alpha * flicker * (l.level ? l.level(time) : 1)
      if (a <= 0.01) continue
      const size = l.r * 9
      ctx.globalAlpha = Math.min(1, a)
      ctx.drawImage(glows[l.color], l.x - size / 2, l.y - size / 2, size, size)
    }
    drawAircraft()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  return {
    resize,
    frame(dt) {
      if (!m) return
      const step = Math.min(dt, 0.05)
      time += step
      fly(step)
      draw()
    },
    dispose() {
      disposed = true
      sprite.onload = null
    },
  }
}
