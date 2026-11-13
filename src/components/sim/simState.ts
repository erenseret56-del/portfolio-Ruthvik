// Flight simulator state and flight model. Dependency-free, like hero/flightState.ts: the DOM layer writes
// inputs and reads instruments, the WebGL scene steps the model and reads the aircraft's attitude.
//
// World frame: +X is to the right of the starting heading, -Z is straight ahead, +Y is up (metres).
// Heading is measured clockwise from straight ahead, so the forward vector is (sin h, 0, -cos h).

const D2R = Math.PI / 180

export const SIM = {
  cruise: 72,
  boost: 150,
  maxBank: 40 * D2R,
  /** rad/s at full bank */
  turnRate: 0.5,
  climbRate: 16,
  altMin: -24,
  altMax: 240,
  /** how far out each destination sits from the start */
  range: 1250,
  /** height of the centre of each destination's ring */
  ringAlt: 14,
  ringRadius: 62,
  /** passing within this distance of a ring counts as arriving */
  arriveRadius: 150,
  orbitRadius: 250,
  /** a destination just left must be this far behind before it can trigger again */
  rearmRadius: 480,
}

export type DestinationId = 'projects' | 'skills' | 'hobbies'

export interface Waypoint {
  id: DestinationId
  x: number
  z: number
}

/** Ahead, right and left of where the flight begins. */
export const WAYPOINTS: Waypoint[] = [
  { id: 'hobbies', x: 0, z: -SIM.range },
  { id: 'projects', x: SIM.range, z: 0 },
  { id: 'skills', x: -SIM.range, z: 0 },
]

/** Where a destination's label belongs on screen (css px), or which edge it lies beyond. */
export interface Mark {
  x: number
  y: number
  side: -1 | 0 | 1
  distance: number
}

export const sim = {
  /** true while the scene is being flown as the simulator */
  active: false,
  /** true once the scene is really stepping the flight (stays false without WebGL or with reduced motion) */
  flying: false,
  /** bumped on every fresh start, so the scene can clear anything left from the last flight */
  epoch: 0,
  /** 1 as control is handed over, running down to 0: the camera settles in from a wide establishing shot */
  intro: 0,
  x: 0,
  z: 0,
  alt: 0,
  climb: 0,
  heading: 0,
  bank: 0,
  pitch: 0,
  speed: SIM.cruise,
  /** camera heading, written by the scene, read to place off-screen labels */
  viewYaw: 0,
  input: { turn: 0, climb: 0, boost: false },
  autopilot: null as null | { mode: 'goto' | 'orbit'; id: DestinationId },
  disarmed: null as DestinationId | null,
  marks: {} as Partial<Record<DestinationId, Mark>>,
  onArrive: null as null | ((id: DestinationId) => void),
  /** the full-circle sky is only fetched once somebody is about to need it */
  wantSky: false,
  onWantSky: null as null | (() => void),
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)
const waypoint = (id: DestinationId) => WAYPOINTS.find((w) => w.id === id)!

export function requestSimSky() {
  if (sim.wantSky) return
  sim.wantSky = true
  sim.onWantSky?.()
}

/** Put the aircraft back at the start, level, heading straight ahead. */
export function startSim(animated: boolean) {
  Object.assign(sim, {
    active: animated,
    flying: false,
    epoch: sim.epoch + 1,
    intro: 1,
    x: 0,
    z: 0,
    alt: 0,
    climb: 0,
    heading: 0,
    bank: 0,
    pitch: 0,
    speed: SIM.cruise,
    viewYaw: 0,
    autopilot: null,
    disarmed: null,
    marks: {},
  })
  sim.input.turn = sim.input.climb = 0
  sim.input.boost = false
  requestSimSky()
}

export function stopSim() {
  sim.active = sim.flying = false
  sim.autopilot = null
  sim.input.turn = sim.input.climb = 0
  sim.input.boost = false
}

/** Hand the aircraft to the autopilot and fly it to a destination. */
export function flyTo(id: DestinationId) {
  sim.autopilot = { mode: 'goto', id }
  sim.disarmed = null
}

/** Take the aircraft back from the autopilot. */
export function resumeFlight() {
  if (sim.autopilot?.mode === 'orbit') sim.disarmed = sim.autopilot.id
  sim.autopilot = null
}

export function stepSim(dt: number) {
  let { turn, climb, boost } = sim.input
  const ap = sim.autopilot

  if (ap) {
    const wp = waypoint(ap.id)
    const dx = wp.x - sim.x
    const dz = wp.z - sim.z
    const d = Math.hypot(dx, dz)
    let desired: number
    if (ap.mode === 'goto') {
      desired = Math.atan2(dx, -dz)
      // full throttle only on the straight: fast means a wide turn, and it must not swing round the ring
      boost = d > 700 && Math.abs(wrap(desired - sim.heading)) < 0.35
      climb = clamp((SIM.ringAlt - sim.alt) / 40, -1, 1)
    } else {
      // left-hand circle around the ring: fly the tangent, leaning in or out to hold the radius
      const outward = Math.atan2(-dx, dz)
      desired = outward - Math.PI / 2 - clamp((d - SIM.orbitRadius) / SIM.orbitRadius, -0.7, 0.7) * 1.1
      boost = false
      climb = clamp((SIM.ringAlt + 26 - sim.alt) / 40, -1, 1)
    }
    turn = clamp(wrap(desired - sim.heading) * 2.2, -1, 1)
  }

  sim.bank += (turn * SIM.maxBank - sim.bank) * ease(dt, 2.8)
  sim.heading = wrap(sim.heading + (sim.bank / SIM.maxBank) * SIM.turnRate * dt)

  // climb rate runs out smoothly at the floor (just above the cloud tops) and the ceiling
  let target = climb * SIM.climbRate
  if (target > 0) target *= clamp((SIM.altMax - sim.alt) / 45, 0, 1)
  else target *= clamp((sim.alt - SIM.altMin) / 30, 0, 1)
  sim.climb += (target - sim.climb) * ease(dt, 2.2)
  sim.alt += sim.climb * dt
  sim.pitch = Math.atan2(sim.climb, sim.speed) * 1.5

  sim.speed += ((boost ? SIM.boost : SIM.cruise) - sim.speed) * ease(dt, 1.1)
  sim.x += Math.sin(sim.heading) * sim.speed * dt
  sim.z -= Math.cos(sim.heading) * sim.speed * dt
  sim.intro = Math.max(0, sim.intro - dt / 3.2)

  if (sim.disarmed) {
    const w = waypoint(sim.disarmed)
    if (Math.hypot(w.x - sim.x, w.z - sim.z) > SIM.rearmRadius) sim.disarmed = null
  }
  if (ap?.mode !== 'orbit') {
    for (const w of WAYPOINTS) {
      if (w.id === sim.disarmed || (ap && ap.id !== w.id)) continue
      // the autopilot is allowed to call it a little earlier than a hand-flown pass
      if (Math.hypot(w.x - sim.x, w.z - sim.z) < (ap ? SIM.arriveRadius + 50 : SIM.arriveRadius)) {
        sim.autopilot = { mode: 'orbit', id: w.id }
        sim.onArrive?.(w.id)
        break
      }
    }
  }
}

// ---------- instruments (what the HUD prints) ----------

/** The flight starts toward the sunset, so straight ahead is west. */
export const compassHeading = () => (((270 + sim.heading / D2R) % 360) + 360) % 360
export const altitudeFeet = () => 35000 + sim.alt * 3.281
export const machNumber = () => 0.78 + ((sim.speed - SIM.cruise) / (SIM.boost - SIM.cruise)) * 0.07
