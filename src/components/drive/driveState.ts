// The country under the clouds: its roads, the places along them, and the car that is driven there.
// Dependency-free, like sim/simState.ts: the DOM layer writes inputs and reads the speed, the WebGL scene
// steps the model and draws from it.
//
// World frame as the simulator's: +X right, -Z ahead, +Y up (metres). Heading is clockwise from straight
// ahead, so the forward vector is (sin h, 0, -cos h).

const D2R = Math.PI / 180
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

// ---------- roads ----------
//
// The road map is a square grid laid over ground that has been pulled out of shape, so it never ends and
// never repeats, and no road stays straight for long. The same few lines are written again in GLSL
// (hero/scene/driveShaders.ts) to paint it; the two must be kept in step.

export const ROAD = {
  /** distance between parallel roads, before the ground is bent */
  cell: 640,
  /** half the width of the tarmac */
  half: 4.4,
}

export interface RoadSample {
  /** metres to the nearest road running "north-south" and the nearest running "east-west" */
  dx: number
  dz: number
  /** bent-grid coordinates of the point */
  qx: number
  qz: number
  /** heading (radians) of each of those two roads here */
  hx: number
  hz: number
}

export function roadAt(x: number, z: number): RoadSample {
  const a = z * 0.0061 + 1.3
  const b = z * 0.0143 + x * 0.0037 + 4.1
  const c = x * 0.0057 + 2.2
  const e = x * 0.0131 - z * 0.0041 + 0.7
  const qx = x + 60 * Math.sin(a) + 30 * Math.sin(b)
  const qz = z + 60 * Math.sin(c) + 30 * Math.sin(e)
  // how fast each bent coordinate changes across the real ground: turns its offset back into metres
  const gxx = 1 + 30 * 0.0037 * Math.cos(b)
  const gxz = 60 * 0.0061 * Math.cos(a) + 30 * 0.0143 * Math.cos(b)
  const gzx = 60 * 0.0057 * Math.cos(c) + 30 * 0.0131 * Math.cos(e)
  const gzz = 1 - 30 * 0.0041 * Math.cos(e)
  return {
    dx: Math.abs(qx - ROAD.cell * Math.round(qx / ROAD.cell)) / Math.hypot(gxx, gxz),
    dz: Math.abs(qz - ROAD.cell * Math.round(qz / ROAD.cell)) / Math.hypot(gzx, gzz),
    qx,
    qz,
    hx: Math.atan2(gxz, gxx),
    hz: Math.atan2(gzz, gzx),
  }
}

/** The real point that lands on bent-grid coordinates (qx, qz). */
function unbend(qx: number, qz: number): [number, number] {
  let x = qx
  let z = qz
  for (let i = 0; i < 60; i++) {
    const s = roadAt(x, z)
    x += (qx - s.qx) * 0.7
    z += (qz - s.qz) * 0.7
  }
  return [x, z]
}

/** 0 on the tarmac, 1 well off it. */
export function offRoad(x: number, z: number) {
  const s = roadAt(x, z)
  return clamp((Math.min(s.dx, s.dz) - ROAD.half) / 2.5, 0, 1)
}

// ---------- places ----------

export type PlaceId = 'projects' | 'skills' | 'hobbies'

export interface Site {
  id: PlaceId
  x: number
  z: number
  /** heading of the road it stands across */
  heading: number
}

const site = (id: PlaceId, qx: number, qz: number, alongX: boolean): Site => {
  const [x, z] = unbend(qx, qz)
  const s = roadAt(x, z)
  return { id, x, z, heading: alongX ? s.hz : s.hx }
}

/** Where the car comes down: on a road, pointing along it, a short way before the first junction. */
export const LANDING = (() => {
  const [x, z] = unbend(0, 250)
  return { x, z, heading: roadAt(x, z).hx }
})()

/** Straight on, right and left from the first junction, as they were in the sky. */
export const SITES: Site[] = [
  site('hobbies', 0, -560, false),
  site('projects', 520, 0, true),
  site('skills', -520, 0, true),
]

export const PLACE = {
  /** driving inside this distance of a gate opens its panel */
  arrive: 30,
  /** and it must be this far behind before the panel closes again */
  leave: 58,
}

// ---------- trees ----------

export interface Tree {
  x: number
  z: number
  height: number
  /** 0 conifer, 1 broadleaf */
  kind: 0 | 1
}

export const TREE_CELL = 48

function hash(ix: number, iz: number, seed: number) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 362437) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth 0..1 field: where the woods are. */
function woods(x: number, z: number) {
  const fx = x / 330
  const fz = z / 330
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const u = fx - ix
  const v = fz - iz
  const su = u * u * (3 - 2 * u)
  const sv = v * v * (3 - 2 * v)
  return mix(mix(hash(ix, iz, 7), hash(ix + 1, iz, 7), su), mix(hash(ix, iz + 1, 7), hash(ix + 1, iz + 1, 7), su), sv)
}

const treeCache = new Map<string, Tree[]>()

/** The trees standing in one square of ground: always the same ones for the same square. */
export function treesIn(cx: number, cz: number): Tree[] {
  const key = `${cx},${cz}`
  const known = treeCache.get(key)
  if (known) return known
  if (treeCache.size > 6000) treeCache.clear()
  const trees: Tree[] = []
  const wooded = woods((cx + 0.5) * TREE_CELL, (cz + 0.5) * TREE_CELL)
  const count = wooded > 0.62 ? 7 : wooded > 0.45 ? 3 : hash(cx, cz, 3) < 0.3 ? 1 : 0
  for (let i = 0; i < count; i++) {
    const x = (cx + hash(cx, cz, 11 + i * 3)) * TREE_CELL
    const z = (cz + hash(cx, cz, 12 + i * 3)) * TREE_CELL
    const road = roadAt(x, z)
    if (Math.min(road.dx, road.dz) < 15) continue
    if (Math.hypot(x - LANDING.x, z - LANDING.z) < 55) continue
    const r = hash(cx, cz, 13 + i * 3)
    trees.push({ x, z, height: 7 + 9 * r * r + (wooded > 0.62 ? 3 : 0), kind: hash(cx, cz, 40 + i) < 0.62 ? 0 : 1 })
  }
  treeCache.set(key, trees)
  return trees
}

// ---------- the car ----------

export const CAR = {
  wheelbase: 2.64,
  /** m/s flat out on the road, and in the rough */
  top: 70,
  roughTop: 27,
  accel: 11.5,
  brake: 24,
  reverse: 13,
  /** sideways g the tyres will give before the car pushes wide, on tarmac and on grass (m/s^2) */
  cornering: 15,
  roughCornering: 8,
  /** front axle, rear axle; half track; tyre radius and width (from the model's own data sheet) */
  axles: [1.35, -1.29] as const,
  track: [0.785, 0.76] as const,
  radius: [0.329, 0.324] as const,
  width: [0.245, 0.285] as const,
}

/** Where a place's label belongs on screen (css px), or which edge it lies beyond. */
export interface Mark {
  x: number
  y: number
  side: -1 | 0 | 1
  distance: number
}

export type DrivePhase = 'intro' | 'driving'

export const drive = {
  /** true while the scene is the ground and not the sky */
  active: false,
  /** true once the scene is really running it (stays false without WebGL or with reduced motion) */
  running: false,
  /** bumped on every fresh start */
  epoch: 0,
  /** the delivery is played first, then the car is handed over */
  phase: 'driving' as DrivePhase,
  /** seconds into the delivery */
  introTime: 0,
  /** set by the page to cut the delivery short */
  skip: false,
  /** 1 as the car is handed over, running down to 0 */
  handover: 0,
  x: LANDING.x,
  z: LANDING.z,
  heading: LANDING.heading,
  /** the way the car is actually travelling, which lags its heading when it slides */
  course: LANDING.heading,
  /** m/s, negative in reverse */
  speed: 0,
  /** -1..1, eased from the input */
  steer: 0,
  /** what the body does on its springs (radians, metres) */
  roll: 0,
  pitch: 0,
  heave: 0,
  /** how far the wheels have turned (radians) */
  spin: 0,
  braking: false,
  /** 0 on tarmac, 1 on grass */
  rough: 0,
  input: { throttle: 0, steer: 0, handbrake: false },
  /** camera heading, written by the scene, read to place off-screen labels */
  viewYaw: 0,
  marks: {} as Partial<Record<PlaceId, Mark>>,
  /** the place whose panel is open */
  near: null as PlaceId | null,
  onNear: null as null | ((id: PlaceId | null) => void),
  onPhase: null as null | ((phase: DrivePhase) => void),
}

/** Put the car on the road where it lands. With intro, it starts in the aircraft's hold instead. */
export function startDrive(animated: boolean, intro = false) {
  Object.assign(drive, {
    active: animated,
    running: false,
    epoch: drive.epoch + 1,
    phase: animated && intro ? 'intro' : 'driving',
    introTime: 0,
    skip: false,
    handover: animated && intro ? 0 : 1,
    x: LANDING.x,
    z: LANDING.z,
    heading: LANDING.heading,
    course: LANDING.heading,
    speed: 0,
    steer: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    spin: 0,
    braking: false,
    rough: 0,
    viewYaw: LANDING.heading,
    marks: {},
    near: null,
  })
  drive.input.throttle = drive.input.steer = 0
  drive.input.handbrake = false
}

export function stopDrive() {
  drive.active = drive.running = false
  drive.near = null
  drive.input.throttle = drive.input.steer = 0
  drive.input.handbrake = false
}

/** The delivery is over: the car is the visitor's. */
export function handOver() {
  if (drive.phase === 'driving') return
  drive.phase = 'driving'
  drive.handover = 1
  drive.onPhase?.('driving')
}

export function stepCar(dt: number) {
  const { throttle, handbrake } = drive.input
  const rough = (drive.rough = offRoad(drive.x, drive.z))
  const forward = drive.speed >= 0 ? 1 : -1
  const pace = Math.abs(drive.speed)

  // engine, brakes and everything that slows a car down by itself
  let accel = 0
  drive.braking = false
  if (throttle > 0) {
    if (drive.speed < -0.3) {
      accel = CAR.brake * throttle
      drive.braking = true
    } else accel = CAR.accel * throttle * Math.max(0, 1 - pace / mix(CAR.top, CAR.roughTop, rough)) * (pace < 12 ? 0.75 + pace / 48 : 1)
  } else if (throttle < 0) {
    if (drive.speed > 0.3) {
      accel = CAR.brake * throttle
      drive.braking = true
    } else accel = CAR.accel * 0.55 * throttle * Math.max(0, 1 - pace / CAR.reverse)
  }
  accel -= forward * (0.45 + 1.6 * rough + pace * (0.006 + 0.07 * rough) + (handbrake ? 10 : 0)) * Math.min(1, pace * 2)
  const before = drive.speed
  drive.speed += accel * dt
  // drag never turns the car round
  if (throttle === 0 && before * drive.speed < 0) drive.speed = 0
  if (throttle === 0 && Math.abs(drive.speed) < 0.12) drive.speed = 0

  // steering: full lock at a crawl, then only as much as the tyres can hold
  drive.steer += (drive.input.steer - drive.steer) * ease(dt, pace > 25 ? 4.5 : 7)
  const grip = handbrake ? CAR.cornering * 1.25 : mix(CAR.cornering, CAR.roughCornering, rough)
  const lock = (pace / CAR.wheelbase) * Math.tan(33 * D2R)
  const yawRate = drive.steer * Math.min(lock, grip / Math.max(pace, 1)) * forward
  drive.heading = wrap(drive.heading + yawRate * dt)
  // the car goes where it was going for a moment longer than it points: more so on grass or with the handbrake on
  const bite = handbrake ? 1.5 : mix(8.5, 3.4, rough)
  drive.course = wrap(drive.course + wrap(drive.heading - drive.course) * ease(dt, bite))
  const slide = wrap(drive.heading - drive.course)
  drive.speed -= drive.speed * Math.min(1, Math.abs(Math.sin(slide)) * 1.4 * dt)

  drive.x += Math.sin(drive.course) * drive.speed * dt
  drive.z -= Math.cos(drive.course) * drive.speed * dt
  drive.spin += (drive.speed / CAR.radius[0]) * dt

  // the body leans out of the turn, squats under power and dips under braking
  drive.roll += (-clamp((yawRate * drive.speed) / CAR.cornering, -1, 1) * 0.055 - drive.roll) * ease(dt, 6)
  drive.pitch += (clamp(accel / CAR.brake, -1, 1) * 0.04 - drive.pitch) * ease(dt, 5)
  // grass is not smooth
  const bump = rough * Math.min(1, pace / 12)
  drive.heave += (bump * 0.035 * Math.sin(drive.x * 0.9) * Math.sin(drive.z * 1.1 + drive.x * 0.37) - drive.heave) * ease(dt, 14)

  // trees do not move
  const cx = Math.floor(drive.x / TREE_CELL)
  const cz = Math.floor(drive.z / TREE_CELL)
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const tree of treesIn(cx + i, cz + j)) {
        const dx = drive.x - tree.x
        const dz = drive.z - tree.z
        const d = Math.hypot(dx, dz)
        if (d > 1.7 || d === 0) continue
        drive.x = tree.x + (dx / d) * 1.7
        drive.z = tree.z + (dz / d) * 1.7
        if (Math.abs(drive.speed) > 2) drive.speed *= -0.25
        drive.course = drive.heading
      }
    }
  }

  drive.handover = Math.max(0, drive.handover - dt / 2.4)

  // arriving at a place, and leaving it behind
  if (drive.near) {
    const s = SITES.find((p) => p.id === drive.near)!
    if (Math.hypot(s.x - drive.x, s.z - drive.z) > PLACE.leave) {
      drive.near = null
      drive.onNear?.(null)
    }
  } else {
    for (const s of SITES) {
      if (Math.hypot(s.x - drive.x, s.z - drive.z) < PLACE.arrive) {
        drive.near = s.id
        drive.onNear?.(s.id)
        break
      }
    }
  }
}

export const speedKmh = () => Math.abs(drive.speed) * 3.6
