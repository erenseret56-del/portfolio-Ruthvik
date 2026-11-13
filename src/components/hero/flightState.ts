// Shared, dependency-free flight state. Kept free of three.js so the page shell does not pull it in;
// the vector forms of these values live in scene/vectors.ts.

export const D2R = Math.PI / 180

/** How public/hero/sky.jpg was cut from the 360° panorama (degrees). */
export const SKY = { lonSpan: 110, latMin: -6, latMax: 46, sunLon: 16, sunLat: 2.6 }

/** The aircraft flies toward screen right (+X), angled slightly away from the camera (which looks down -Z). */
export const HEADING_YAW = 10 * D2R

/** Apparent speed (m/s) at which the air mass streams past the chase camera. */
export const AIR_SPEED = 64

/** Contrail fade distance (m) once the flight has settled into cruise. */
export const CRUISE_TRAIL_FADE = 250

/** Slow vertical float shared by the aircraft and its contrail (metres). */
export const bobAt = (t: number) => 1.5 * Math.sin(0.42 * t) + 0.6 * Math.sin(0.97 * t + 1.3)

/**
 * Mutable animation state shared between GSAP (writer), the WebGL scene and the DOM layers (readers).
 * Deliberately not React state: nothing here should ever trigger a re-render.
 */
export const flight = {
  time: 0,
  /** metres of air that have streamed past the camera */
  travel: 0,
  /** aircraft offset along its heading from the rest position (m); negative = still approaching */
  along: -600,
  /** 1 while the aircraft is banking into frame, 0 in level cruise */
  introBank: 1,
  /** distance (m) over which the contrail fades out */
  trailFade: 700,
  trailOpacity: 1,
  /** screen-space x (css px) of the aircraft tail, used to reveal the name */
  tailScreenX: -1e4,
  pointerX: 0,
  pointerY: 0,
  /** true while the aircraft makes the close climbing pass that carries the next page in */
  closeUp: false,
  /** 0..1 progress of that pass */
  flyby: 0,
  reducedMotion: false,
}

export interface HeroLayout {
  fov: number
  pitch: number
  planeNdcX: number
  planeNdcY: number
  planeDist: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (x: number, min: number, max: number) => {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)))
  return t * t * (3 - 2 * t)
}

/** Camera + aircraft framing as a function of viewport aspect ratio (portrait -> landscape). */
export function heroLayout(aspect: number): HeroLayout {
  const t = smoothstep(aspect, 0.7, 1.45)
  return {
    fov: lerp(50, 30, t),
    pitch: lerp(-6, -3, t) * D2R,
    planeNdcX: lerp(0.34, 0.58, t),
    planeNdcY: lerp(0.28, 0.12, t),
    planeDist: lerp(335, 258, t),
  }
}

/** World-space rest position [x, y, z] of the aircraft for a given layout (camera sits at the origin). */
export function restPosition(layout: HeroLayout, aspect: number): [number, number, number] {
  const tanY = Math.tan((layout.fov * D2R) / 2)
  // view-space ray through the target NDC point...
  let x = layout.planeNdcX * tanY * aspect
  let y = layout.planeNdcY * tanY
  let z = -1
  const k = layout.planeDist / Math.hypot(x, y, z)
  x *= k
  y *= k
  z *= k
  // ...rotated by the camera pitch into world space
  const c = Math.cos(layout.pitch)
  const s = Math.sin(layout.pitch)
  return [x, y * c - z * s, y * s + z * c]
}

/** How far back along its heading (m) the aircraft must start for its nose to be just off the left edge. */
export function approachDistance(layout: HeroLayout, aspect: number) {
  const [x, , z] = restPosition(layout, aspect)
  const edge = 1.12 * Math.tan((layout.fov * D2R) / 2) * aspect
  const noseLead = 32
  return (x + edge * (-z - 16)) / (Math.cos(HEADING_YAW) + edge * Math.sin(HEADING_YAW)) + noseLead
}

/** How far past its rest position (m) the aircraft must fly for its tail to clear the right edge. */
export function exitDistance(layout: HeroLayout, aspect: number) {
  const [x, , z] = restPosition(layout, aspect)
  const edge = 1.12 * Math.tan((layout.fov * D2R) / 2) * aspect
  const tailLag = 42
  return (edge * -z - x) / (Math.cos(HEADING_YAW) - edge * Math.sin(HEADING_YAW)) + tailLag
}

// ---------- close pass ----------
// Flown in camera space (+X right, +Y up, depth = distance in front of the lens): the aircraft comes up
// from under the frame, nose first, climbing away from the camera until it has left through the top.

const FLYBY_PITCH = 30 * D2R
const FLYBY_LEAN = 5 * D2R
const FLYBY_START_DEPTH = 55
/** generous half length used to keep the whole airframe out of frame at either end of the pass */
const HALF_LENGTH = 34
/** how far behind the model's origin the fuselage actually ends */
const TAIL_REACH = 26

/** Unit direction of the pass in camera space (also where the nose points). */
export const FLYBY_DIR: [number, number, number] = [
  Math.sin(FLYBY_LEAN) * Math.cos(FLYBY_PITCH),
  Math.cos(FLYBY_LEAN) * Math.cos(FLYBY_PITCH),
  -Math.sin(FLYBY_PITCH),
]

/** Tail height (NDC, +1 = top edge) at which the pass ends: far enough out of frame to take the wipe's soft edge with it. */
const FLYBY_EXIT_NDC = 1.2

export interface FlybyPath {
  /** camera-space start of the aircraft's centre: x, y, depth */
  x0: number
  y0: number
  depth0: number
  /** metres flown along FLYBY_DIR between progress 0 and 1 */
  length: number
  tan: number
}

export function flybyPath(layout: HeroLayout): FlybyPath {
  const tan = Math.tan((layout.fov * D2R) / 2)
  const [dx, dy, dz] = FLYBY_DIR
  const recede = -dz
  // start with the nose just under the bottom edge...
  const y0 = -1.1 * tan * (FLYBY_START_DEPTH + HALF_LENGTH * recede) - HALF_LENGTH * dy
  // ...and fly until the tail has cleared the top edge
  const tailY0 = y0 - HALF_LENGTH * dy
  const tailDepth0 = FLYBY_START_DEPTH - HALF_LENGTH * recede
  const length = (FLYBY_EXIT_NDC * tan * tailDepth0 - tailY0) / (dy - FLYBY_EXIT_NDC * tan * recede)
  return { x0: -0.5 * dx * length, y0, depth0: FLYBY_START_DEPTH, length, tan }
}

/** Screen height of the aircraft's tail (NDC) at pass progress p; the page wipe follows it. */
export function flybyTailNdcY(p: number, path: FlybyPath) {
  const s = p * path.length - TAIL_REACH
  return (path.y0 + s * FLYBY_DIR[1]) / ((path.depth0 - s * FLYBY_DIR[2]) * path.tan)
}
