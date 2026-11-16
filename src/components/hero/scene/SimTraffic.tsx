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
