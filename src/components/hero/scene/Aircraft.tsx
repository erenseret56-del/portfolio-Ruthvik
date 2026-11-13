import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  MathUtils,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bobAt, flight, HEADING_YAW, heroLayout, restPosition } from '../flightState'
import { HEADING, trailOrigins } from './vectors'

export const AIRCRAFT_URL = '/hero/aircraft.glb'

const D2R = MathUtils.DEG2RAD
// Body frame after the model is turned nose-first: +X forward, +Y up, +Z starboard (toward the camera).
const ENGINE_EXHAUSTS = [new Vector3(-1, -2.6, 9.4), new Vector3(-1, -2.6, -9.4)]
const TAIL = new Vector3(-34, 3, 0)
const TOWARD_CAMERA = new Vector3(Math.sin(HEADING_YAW), 0, Math.cos(HEADING_YAW))

/** The source model ships with flat, fully rough materials and stray blend flags; give it painted-metal response. */
function prepareModel(scene: Object3D) {
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]
    for (const m of materials) {
      const texture = m.map?.name ?? ''
      m.metalness = 0
      m.roughness = texture.includes('windshield') ? 0.1 : 0.32
      m.transparent = false
      m.depthWrite = true
      m.alphaTest = texture.includes('landing-gears') ? 0.5 : 0
      if (m.map) m.map.anisotropy = 8
    }
  })
  return scene
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

interface NavLight {
  sprite: Sprite
  size: number
  /** flash envelope 0..1 for time t */
  level: (t: number) => number
}

function createNavLights(): NavLight[] {
  const map = glowTexture()
  const make = (color: string, position: [number, number, number], size: number, level: NavLight['level']): NavLight => {
    const sprite = new Sprite(
      new SpriteMaterial({ map, color, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    )
    sprite.position.set(...position)
    return { sprite, size, level }
  }
  const pulse = (t: number, period: number, start: number, length: number) => {
    const p = ((t % period) + period) % period
    return p > start && p < start + length ? 1 : 0
  }
  const strobe = (t: number) => Math.max(pulse(t, 1.3, 0, 0.055), pulse(t, 1.3, 0.14, 0.055))
  const beacon = (t: number) => {
    const p = (t + 0.6) % 1.3
    return p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0
  }
  return [
    make('#49ff9a', [-9.8, 1.9, 30], 1.1, () => 1),
    make('#ff4b3a', [-9.8, 1.9, -30], 1.1, () => 1),
    make('#ffffff', [-10.4, 1.9, 30.1], 4.2, strobe),
    make('#ffffff', [-10.4, 1.9, -30.1], 4.2, strobe),
    make('#ff3b2e', [-2.5, 3.45, 0], 2.4, beacon),
    make('#ff3b2e', [10, -3.15, 0], 2.4, beacon),
  ]
}

/**
 * Real airliner geometry flown by a chase camera: it arrives banking out of a shallow turn, then
 * holds formation forever with a slow float, roll and yaw, while the world streams past it.
 */
export function Aircraft() {
  const gltf = useLoader(GLTFLoader, AIRCRAFT_URL)
  const model = useMemo(() => prepareModel(gltf.scene), [gltf])
  const lights = useMemo(() => createNavLights(), [])
  const root = useRef<Group>(null!)
  const aspect = useThree((s) => s.size.width / s.size.height)
  const rest = useMemo(() => new Vector3(...restPosition(heroLayout(aspect), aspect)), [aspect])
  const scratch = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }) => {
    const t = flight.time
    const bank = flight.introBank
    const group = root.current

    group.position
      .copy(rest)
      .addScaledVector(HEADING, flight.along + 5 * Math.sin(0.13 * t))
      .addScaledVector(TOWARD_CAMERA, 16 * bank * bank + 2.5 * Math.sin(0.19 * t + 2))
    group.position.y += bobAt(t)

    const roll = (2 * Math.sin(0.31 * t + 0.5) + 0.7 * Math.sin(0.83 * t)) * D2R * (1 - 0.5 * bank) + 13 * D2R * bank
    const pitch = (2.2 + 0.5 * Math.cos(0.42 * t) + 1.2 * bank) * D2R
    const yaw = HEADING_YAW + (0.5 * Math.sin(0.23 * t) + 7 * bank) * D2R
    group.rotation.set(roll, yaw, pitch, 'YZX')
    group.updateMatrixWorld()

    ENGINE_EXHAUSTS.forEach((p, i) => trailOrigins[i].copy(p).applyMatrix4(group.matrixWorld))
    scratch.copy(TAIL).applyMatrix4(group.matrixWorld).project(camera)
    flight.tailScreenX = (scratch.x * 0.5 + 0.5) * size.width

    for (const { sprite, size: s, level } of lights) {
      const l = level(t)
      sprite.scale.setScalar(s * (0.35 + 0.65 * l))
      sprite.material.opacity = l
    }
  }, -10)

  return (
    <group ref={root}>
      <primitive object={model} rotation-y={-Math.PI / 2} />
      {lights.map(({ sprite }, i) => (
        <primitive key={i} object={sprite} />
      ))}
    </group>
  )
}
