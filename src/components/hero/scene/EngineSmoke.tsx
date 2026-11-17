import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three'
import { flight, FLYBY_DIR, flybyPath, flybyTailNdcY, heroLayout } from '../flightState'
import { drive } from '../../drive/driveState'
import { sim } from '../../sim/simState'
import { fullscreenMesh } from './fullscreen'
import { SUN_DIR, trailOrigins } from './vectors'

const MAX_PUFFS = 260
/** metres flown between puffs */
const SPACING = 1.35
const LIFETIME = 2.4
/** how far behind the tail the front of the smoke bank sits (NDC: the frame is 2 high) */
const BANK_LAG = 0.14
/** once the aircraft is leaving, the bank climbs at least this fast (NDC per second) to close the frame */
const BANK_RISE = 3.4
/** front height at which the whole frame is certainly buried */
const BANK_FULL = 3.6

const noise = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

const puffVertex = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aState; // life 0..1, radius (m), seed
varying vec2 vUv;
varying float vLife;
varying float vSeed;
void main() {
  vUv = position.xy;
  vLife = aState.x;
  vSeed = aState.z;
  // puffs are kept in the camera's own space (like the aircraft during this pass), so they billboard for free
  gl_Position = projectionMatrix * vec4(aOffset + vec3(position.xy * aState.y, 0.0), 1.0);
}
`
const puffFragment = /* glsl */ `
uniform vec2 uSun;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
${noise}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // each puff gets its own turn of the same noise, so no two billow alike
  float a = vSeed * 6.2832;
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * vUv;
  float n = vnoise(q * 2.1 + vSeed * 19.0) * 0.6 + vnoise(q * 4.6 + vSeed * 7.0) * 0.4;
  // lumpy, cauliflower edge rather than a clean disc
  float body = 1.0 - smoothstep(0.3, 0.95, r + (n - 0.5) * 0.8);
  float alpha = body * smoothstep(0.0, 0.045, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife)) * mix(0.5, 0.28, vLife);
  if (alpha < 0.004) discard;
  // lit from the low sun's side, shaded like the cloud deck below on the other
  float lit = clamp(0.56 + 0.4 * dot(vUv, uSun) + (n - 0.5) * 0.55, 0.0, 1.0);
  vec3 col = mix(vec3(0.5, 0.47, 0.57), vec3(1.0, 0.91, 0.78), lit);
  gl_FragColor = vec4(col, alpha);
}
`

const bankVertex = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
const bankFragment = /* glsl */ `
uniform float uFront;
uniform float uTime;
uniform float uAspect;
uniform vec2 uSun;
varying vec2 vNdc;
${noise}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
void main() {
  vec2 p = vec2(vNdc.x * uAspect, vNdc.y);
  // billows that keep boiling slowly upward, as the wake goes on rolling after the aircraft has passed
  float big = fbm(p * 1.25 + vec2(0.0, -uTime * 0.22));
  float fine = fbm(p * 3.1 + vec2(17.0 + uTime * 0.07, -uTime * 0.36));
  // depth into the bank below its ragged front
  float d = uFront - vNdc.y + (big - 0.47) * 0.75 + (fine - 0.47) * 0.24;
  if (d <= 0.0) discard;
  // a wedge behind the engines that opens out to the full width of the frame
  float width = 0.3 + d * 2.4;
  float across = 1.0 - smoothstep(width, width + 0.75, abs(p.x) + (fine - 0.47) * 0.35);
  float alpha = clamp(smoothstep(0.0, 0.8, d) * across * 1.3, 0.0, 1.0);
  if (alpha < 0.004) discard;
  float lit = clamp(0.36 + 0.62 * big + 0.42 * (fine - 0.47) + 0.1 * vNdc.x * uSun.x, 0.0, 1.0);
  vec3 col = mix(vec3(0.47, 0.45, 0.55), vec3(1.0, 0.91, 0.79), lit);
  // light dies down a little deep inside
  col *= mix(1.0, 0.88, smoothstep(0.9, 2.4, d));
  gl_FragColor = vec4(col, alpha);
}
`

/**
 * The smoke of the close pass that carries the visitor from the hero to the About page.
 *
 * Two parts. Puffs: a pool of soft, noisy billboards left behind where each engine's exhaust was, swelling
 * and thinning. Bank: a full-frame layer of the same vapour whose ragged front follows the tail, opens out
 * to the full width, and after the aircraft has left keeps climbing until the whole frame is buried.
 * The page then fades in over that (see useHorizonTransition).
 */
export function EngineSmoke() {
  const aspect = useThree((s) => s.size.width / s.size.height)
  const path = useMemo(() => flybyPath(heroLayout(aspect)), [aspect])

  const { puffs, bank, offsets, states, dispose } = useMemo(() => {
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    const offsets = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3)
    const states = new InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 3), 3)
    offsets.setUsage(DynamicDrawUsage)
    states.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aOffset', offsets)
    geometry.setAttribute('aState', states)
    geometry.instanceCount = MAX_PUFFS
    const sun = { value: new Vector2(1, 0) }
    const puffMaterial = new ShaderMaterial({
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      uniforms: { uSun: sun },
      transparent: true,
      depthWrite: false,
    })
    const puffs = new Mesh(geometry, puffMaterial)
    puffs.frustumCulled = false
    puffs.renderOrder = 6

    const bankMaterial = new ShaderMaterial({
      vertexShader: bankVertex,
      fragmentShader: bankFragment,
      uniforms: { uFront: { value: -9 }, uTime: { value: 0 }, uAspect: { value: 1 }, uSun: sun },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const bank = fullscreenMesh(bankMaterial)
    bank.renderOrder = 7
    puffs.visible = bank.visible = false

    const dispose = () => {
      geometry.dispose()
      puffMaterial.dispose()
      bankMaterial.dispose()
    }
    return { puffs, bank, offsets, states, dispose }
  }, [])

  useEffect(() => dispose, [dispose])

  // simulation state per puff (camera space: x right, y up, -z ahead), and for the bank
  const pool = useMemo(
    () => ({
      velocity: new Float32Array(MAX_PUFFS * 3),
      age: new Float32Array(MAX_PUFFS).fill(LIFETIME),
      next: 0,
      running: false,
      front: -9,
      last: trailOrigins.map(() => new Vector3()),
      carry: trailOrigins.map(() => 0),
      now: new Vector3(),
      sun: new Vector3(),
    }),
    [],
  )

  useFrame(({ camera }, delta) => {
    // from the start of the pass until the hero is put back (the scene is paused once the page covers it)
    // only the hero's close pass smokes: not the simulator, and not the ground under it
    const smoking = flight.closeUp && !sim.active && !drive.active && flight.flyby > 0
    if (!smoking) {
      if (pool.running) {
        pool.running = false
        pool.front = -9
        pool.age.fill(LIFETIME)
        puffs.visible = bank.visible = false
      }
      return
    }
    const dt = Math.min(delta, 0.05)
    const position = offsets.array as Float32Array
    const state = states.array as Float32Array
    const { velocity, age, now } = pool
    const passing = flight.flyby < 1

    trailOrigins.forEach((origin, e) => {
      now.copy(origin).applyMatrix4(camera.matrixWorldInverse)
      const last = pool.last[e]
      if (!pool.running) last.copy(now)
      // lay puffs evenly along the stretch flown this frame, however long the frame took
      const flown = passing ? now.distanceTo(last) : 0
      let along = SPACING - pool.carry[e]
      for (; along <= flown; along += SPACING) {
        const i = pool.next
        pool.next = (pool.next + 1) % MAX_PUFFS
        const k = along / flown
        position[i * 3] = last.x + (now.x - last.x) * k
        position[i * 3 + 1] = last.y + (now.y - last.y) * k
        position[i * 3 + 2] = last.z + (now.z - last.z) * k
        // blown back along the flight path, spreading away from the fuselage, with some turbulence
        const outward = e === 0 ? 1 : -1
        const blast = 7 + Math.random() * 5
        velocity[i * 3] = -FLYBY_DIR[0] * blast + outward * (2 + Math.random() * 4) + (Math.random() - 0.5) * 5
        velocity[i * 3 + 1] = -FLYBY_DIR[1] * blast + (Math.random() - 0.5) * 5
        velocity[i * 3 + 2] = -FLYBY_DIR[2] * blast + (Math.random() - 0.5) * 3
        age[i] = (1 - k) * dt
        state[i * 3 + 2] = Math.random()
      }
      pool.carry[e] = flown - (along - SPACING)
      last.copy(now)
    })

    const drag = Math.exp(-dt * 1.3)
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (age[i] >= LIFETIME) {
        state[i * 3 + 1] = 0
        continue
      }
      age[i] += dt
      for (let c = 0; c < 3; c++) {
        position[i * 3 + c] += velocity[i * 3 + c] * dt
        velocity[i * 3 + c] *= drag
      }
      state[i * 3] = Math.min(1, age[i] / LIFETIME)
      // swells fast out of the nozzle, then keeps spreading slowly
      state[i * 3 + 1] = 2.1 + 15 * (1 - Math.exp(-age[i] * 2.1)) + 3.5 * age[i]
    }
    offsets.needsUpdate = states.needsUpdate = true

    // the bank's front rides behind the tail; as the aircraft goes out of the top it climbs on by itself
    const tail = flybyTailNdcY(flight.flyby, path)
    const leaving = tail > 0.55 || !passing
    pool.front = Math.min(BANK_FULL, Math.max(tail - BANK_LAG, pool.running && leaving ? pool.front + BANK_RISE * dt : -9))
    pool.running = true

    pool.sun.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse)
    const uniforms = bank.material.uniforms
    uniforms.uSun.value.set(pool.sun.x, pool.sun.y).normalize()
    uniforms.uFront.value = pool.front
    uniforms.uTime.value = flight.time
    uniforms.uAspect.value = aspect
    puffs.visible = bank.visible = true
  })

  return (
    <>
      <primitive object={puffs} />
      <primitive object={bank} />
    </>
  )
}
