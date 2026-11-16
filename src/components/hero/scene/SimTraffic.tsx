import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { flight } from '../flightState'
import { sim } from '../../sim/simState'
import { AIRCRAFT_URL } from './Aircraft'
import { glowTexture } from './glow'
import { SUN_DIR } from './vectors'

const COUNT = 5
/** other aircraft come into being and leave at this distance, already faded out */
const RANGE = 3700
const FADE = 800
/** nobody is allowed close: seen from here these are shapes and lights, not models */
const KEEP_OUT = 900
const TRAIL_LENGTH = 1500
/**
 * Each airframe is drawn this far from the lens, shrunk to match, on the line of sight to where it really is.
 * It looks the same, but the depth buffer can tell wing from flap again, which it cannot at three kilometres.
 */
const STAND_IN = 700

const COOL_AIR = new Vector3(0.5, 0.47, 0.55)
const WARM_AIR = new Vector3(0.93, 0.64, 0.45)


const bodyVertex = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const bodyFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeAmount;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  // white paint under a low orange sun, cool sky on the shaded side, then the air in between
  vec3 lit = vec3(1.0, 0.63, 0.37) * max(dot(n, uSunDir), 0.0) * 1.2;
  vec3 sky = mix(vec3(0.15, 0.16, 0.23), vec3(0.42, 0.4, 0.5), 0.5 + 0.5 * n.y);
  vec3 col = mix(vec3(0.93, 0.94, 0.96) * (lit + sky), uHaze, uHazeAmount);
  gl_FragColor = vec4(col, uOpacity);
}
`
const trailVertex = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uDir;
uniform float uLength;
uniform float uPixel;
varying vec2 vUv;
void main() {
  vUv = uv;
  // a ribbon laid out behind the aircraft, turned edge-on to nobody and never thinner than a pixel or two
  vec3 p = uHead - uDir * uv.x * uLength;
  p.y -= uv.x * uv.x * 16.0;
  vec3 toCam = cameraPosition - p;
  vec3 side = normalize(cross(uDir, toCam));
  float width = max(3.0 + 9.0 * smoothstep(0.0, 0.3, uv.x), length(toCam) * uPixel * 1.7);
  p += side * (uv.y - 0.5) * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`
const trailFragment = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float v = (vUv.y - 0.5) * 2.0;
  float across = exp(-v * v * 3.2);
  float along = smoothstep(0.0, 0.025, vUv.x) * pow(1.0 - vUv.x, 1.5);
  gl_FragColor = vec4(vec3(1.0, 0.87, 0.77), across * along * uOpacity);
}
`

/** The airliner as one plain mesh in its body frame (+X forward): all that is needed at this distance. */
function silhouette(scene: Object3D) {
  scene.updateWorldMatrix(true, true)
  const toBody = new Matrix4().makeRotationY(-Math.PI / 2).multiply(new Matrix4().copy(scene.matrixWorld).invert())
  const positions: number[] = []
  const normals: number[] = []
  const matrix = new Matrix4()
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || !mesh.geometry.attributes.normal) return
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial
    if (material.map?.name.includes('landing-gears')) return
    const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    part.applyMatrix4(matrix.multiplyMatrices(toBody, mesh.matrixWorld))
    positions.push(...(part.attributes.position.array as Float32Array))
    normals.push(...(part.attributes.normal.array as Float32Array))
    part.dispose()
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.computeBoundingSphere()
  return geometry
}

interface Flight {
  x: number
  z: number
  y: number
  heading: number
  speed: number
  /** offsets its strobe from everybody else's */
  phase: number
}

/** Start a flight on the edge of sight, on a line that passes the visitor at a distance. */
function dispatch(f: Flight, underway: boolean) {
  const bearing = Math.random() * Math.PI * 2
  const fromX = sim.x + Math.sin(bearing) * RANGE
  const fromZ = sim.z - Math.cos(bearing) * RANGE
  const miss = (1300 + Math.random() * 1500) * (Math.random() < 0.5 ? -1 : 1)
  const aimX = sim.x + Math.cos(bearing) * miss
  const aimZ = sim.z + Math.sin(bearing) * miss
  f.heading = Math.atan2(aimX - fromX, -(aimZ - fromZ))
  f.speed = 120 + Math.random() * 55
  f.y = 70 + Math.random() * Math.random() * 520
  f.phase = Math.random() * 10
  // when the simulator opens the sky should already be in use, not waiting for its first arrival
  const along = underway ? (0.12 + 0.7 * Math.random()) * 2 * Math.sqrt(RANGE * RANGE - miss * miss) : 0
  f.x = fromX + Math.sin(f.heading) * along
  f.z = fromZ - Math.cos(f.heading) * along
}

const strobe = (t: number) => {
  const p = ((t % 1.4) + 1.4) % 1.4
  return p < 0.07 || (p > 0.16 && p < 0.23) ? 1 : 0
}

/**
 * Other traffic, far off: a handful of airliners crossing the simulator's sky on their own business,
 * each a small sunlit shape with a strobe and a contrail. They are kept at a distance and are only scenery.
 */
export function SimTraffic() {
  const gltf = useLoader(GLTFLoader, AIRCRAFT_URL)

  const { root, craft, dispose } = useMemo(() => {
    const root = new Group()
    root.visible = false
    const body = silhouette(gltf.scene)
    const ribbon = new PlaneGeometry(1, 1, 16, 1)
    ribbon.translate(0.5, 0, 0)
    const glow = glowTexture()
    const disposables: { dispose: () => void }[] = [body, ribbon, glow]

    const craft = Array.from({ length: COUNT }, () => {
      const paint = new ShaderMaterial({
        vertexShader: bodyVertex,
        fragmentShader: bodyFragment,
        uniforms: {
          uSunDir: { value: SUN_DIR },
          uHaze: { value: new Vector3() },
          uHazeAmount: { value: 0 },
          uOpacity: { value: 0 },
        },
        transparent: true,
      })
      const vapour = new ShaderMaterial({
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
        uniforms: {
          uHead: { value: new Vector3() },
          uDir: { value: new Vector3() },
          uLength: { value: TRAIL_LENGTH },
          uPixel: { value: 0.001 },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      })
      const flash = new SpriteMaterial({ map: glow, color: '#ffffff', blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })
      disposables.push(paint, vapour, flash)

      const airframe = new Mesh(body, paint)
      airframe.renderOrder = 2
      const trail = new Mesh(ribbon, vapour)
      trail.frustumCulled = false
      trail.renderOrder = 1
      const light = new Sprite(flash)
      light.renderOrder = 3
      root.add(trail, airframe, light)
      const state: Flight = { x: 0, z: 0, y: 0, heading: 0, speed: 0, phase: 0 }
      return { state, airframe, trail, light, paint, vapour, flash }
    })
    return { root, craft, dispose: () => disposables.forEach((d) => d.dispose()) }
  }, [gltf])

  useEffect(() => dispose, [dispose])

  const memory = useMemo(() => ({ epoch: -1 }), [])
  const forward = useMemo(() => new Vector3(), [])
  const place = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }, delta) => {
    root.visible = sim.active
    if (!sim.active) return
    const fresh = memory.epoch !== sim.epoch
    memory.epoch = sim.epoch
    const dt = Math.min(delta, 0.05)
    const t = flight.time
    const pixel = (2 * Math.tan(((camera as PerspectiveCamera).fov * MathUtils.DEG2RAD) / 2)) / size.height

    for (const { state: f, airframe, trail, light, paint, vapour, flash } of craft) {
      if (fresh) dispatch(f, true)
      f.x += Math.sin(f.heading) * f.speed * dt
      f.z -= Math.cos(f.heading) * f.speed * dt
      let dx = f.x - sim.x
      let dz = f.z - sim.z
      let distance = Math.hypot(dx, dz)
      if (distance > RANGE + 150) {
        dispatch(f, false)
        dx = f.x - sim.x
        dz = f.z - sim.z
        distance = Math.hypot(dx, dz)
      }
      const seen = (1 - MathUtils.smoothstep(distance, RANGE - FADE, RANGE)) * MathUtils.smoothstep(distance, KEEP_OUT - 300, KEEP_OUT)
      airframe.visible = trail.visible = light.visible = seen > 0.003
      if (!airframe.visible) continue

      forward.set(Math.sin(f.heading), 0, -Math.cos(f.heading))
      const shrink = STAND_IN / Math.max(STAND_IN, place.set(dx, f.y, dz).distanceTo(camera.position))
      place.sub(camera.position).multiplyScalar(shrink).add(camera.position)
      airframe.position.copy(place)
      airframe.scale.setScalar(shrink)
      airframe.rotation.set(0, Math.PI / 2 - f.heading, 2 * MathUtils.DEG2RAD, 'YZX')
      paint.uniforms.uOpacity.value = seen
      // further off, and it takes on the colour of the sky it is seen against: warm toward the sun, cool away from it
      const sunward = 0.5 + (0.5 * (dx * SUN_DIR.x + dz * SUN_DIR.z)) / Math.max(distance, 1)
      paint.uniforms.uHaze.value.copy(COOL_AIR).lerp(WARM_AIR, sunward * sunward)
      paint.uniforms.uHazeAmount.value = Math.min(0.62, distance / 5600)

      vapour.uniforms.uHead.value.set(dx, f.y, dz).addScaledVector(forward, -26)
      vapour.uniforms.uDir.value.copy(forward)
      vapour.uniforms.uPixel.value = pixel
      vapour.uniforms.uOpacity.value = seen * 0.62

      const level = strobe(t + f.phase)
      light.position.copy(place)
      // sized by the screen, not the scene, so the flash reads at any distance
      light.scale.setScalar(STAND_IN * pixel * (3 + 6 * level))
      flash.opacity = seen * (0.22 + 0.78 * level)
    }
  })

  return <primitive object={root} />
}
