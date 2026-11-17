import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  PointLight,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  Mesh,
  type Object3D,
} from 'three'
import { bobAt, flight } from '../flightState'
import { drive } from '../../drive/driveState'
import { sim } from '../../sim/simState'
import { propFragment, propVertex } from './driveShaders'
import { CARGO_LIFT, stage } from './driveStage'
import { glowTexture } from './glow'
import { useLateModel } from './useLateModel'
import { trailOrigins } from './vectors'

const CARGO_URL = '/horizon/cargo.glb'
const D2R = MathUtils.DEG2RAD

// Model frame: +X forward, +Y up, +Z starboard (metres), as converted from the source model.
const ENGINES: [number, number, number][] = [
  [5.348, -1.429, 9.821],
  [5.348, -1.429, 4.926],
  [5.348, -1.429, -4.926],
  [5.348, -1.429, -9.821],
]
const OUTBOARD_EXHAUSTS = [new Vector3(0.9, -2.1, 9.9), new Vector3(0.9, -2.1, -9.9)]
/** how far the ramp swings down and the door above it swings up */
const RAMP_OPEN = 31.12 * D2R
const DOOR_OPEN = -22.52 * D2R

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

interface NavLight {
  sprite: Sprite
  size: number
  level: (t: number) => number
}

function build(source: Group) {
  const root = new Group()
  root.matrixAutoUpdate = false
  root.visible = false
  // a copy, so that building twice (as React does in development) cannot take the model away from the first
  const model = source.clone(true)
  root.add(model)
  const owned: { dispose: () => void }[] = []

  // the source materials are flat and fully rough: give the airframe a painted-metal response
  const glass = new MeshStandardMaterial({ color: '#0a1016', roughness: 0.08, metalness: 0.7 })
  owned.push(glass)
  model.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as MeshStandardMaterial
    if (material.name === 'glass') mesh.material = glass
    else {
      material.metalness = material.name === 'texture' ? 0.12 : 0
      material.roughness = material.name === 'texture' ? 0.5 : 0.85
      if (material.map) material.map.anisotropy = 8
    }
  })

  // one propeller comes with the model; the aircraft has four, and in flight each is a blur
  const hub = model.getObjectByName('prop_bol')
  const blades = ['prop_pal1', 'prop_pal2', 'prop_pal3', 'prop_pal4'].map((n) => model.getObjectByName(n))
  blades.forEach((b) => b?.removeFromParent())
  hub?.removeFromParent()
  const blur = new ShaderMaterial({
    vertexShader: propVertex,
    fragmentShader: propFragment,
    uniforms: { uTime: { value: 0 }, uPhase: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const disc = new CircleGeometry(2.06, 48)
  disc.rotateY(Math.PI / 2)
  owned.push(blur, disc)
  for (const [x, y, z] of ENGINES) {
    const prop = new Group()
    prop.position.set(x, y, z)
    if (hub) prop.add(hub.clone())
    const sweep = new Mesh(disc, blur)
    sweep.position.x = 0.12
    sweep.renderOrder = 4
    prop.add(sweep)
    model.add(prop)
  }

  const part = (name: string) => model.getObjectByName(name) as Object3D | undefined
  const ramp = [part('baieB'), part('int_baieB')]
  const door = [part('baieH'), part('int_baieH')]

  // the hold is lit from inside once it is open to the air
  const lamp = new PointLight('#ffc694', 0, 22, 1.6)
  lamp.position.set(2.5, -2.3, 0)
  model.add(lamp)

  const glow = glowTexture()
  owned.push(glow)
  const light = (color: string, at: [number, number, number], size: number, level: NavLight['level']): NavLight => {
    const material = new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })
    owned.push(material)
    const sprite = new Sprite(material)
    sprite.position.set(...at)
    model.add(sprite)
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
  const lights = [
    light('#49ff9a', [1.77, -0.86, 20.1], 0.8, () => 1),
    light('#ff4b3a', [1.77, -0.86, -20.1], 0.8, () => 1),
    light('#ffffff', [1.4, -0.86, 20.15], 3, strobe),
    light('#ffffff', [1.4, -0.86, -20.15], 3, strobe),
    light('#ff3b2e', [-11.2, 6.15, 0], 1.8, beacon),
  ]

  return { root, ramp, door, lamp, blur, lights, dispose: () => owned.forEach((o) => o.dispose()) }
}

const LIFT = new Matrix4().makeTranslation(0, CARGO_LIFT, 0)
const euler = new Euler()

/**
 * The transport: a four-engined military freighter with a ramp under its tail. It is the aircraft the
 * visitor flies in the simulator, and the one that makes the low pass and delivers the car on the ground.
 * Until its model has loaded the airliner stands in for it (see Aircraft).
 */
export function CargoPlane() {
  const model = useLateModel(CARGO_URL)
  const craft = useMemo(() => (model ? build(model) : null), [model])

  useEffect(() => {
    stage.cargoReady = craft !== null
    return () => {
      stage.cargoReady = false
      craft?.dispose()
    }
  }, [craft])

  useFrame(() => {
    if (!craft) return
    const { root, ramp, door, lamp, blur, lights } = craft
    const delivering = drive.active && stage.planeVisible
    root.visible = sim.active || delivering
    if (!root.visible) return
    const t = flight.time

    let open = 0
    if (sim.active) {
      // flown by the visitor: the scene keeps the aircraft over the origin and moves the world instead
      euler.set(sim.bank + 0.8 * D2R * Math.sin(0.83 * t), Math.PI / 2 - sim.heading, sim.pitch + 2 * D2R, 'YZX')
      root.matrix
        .makeRotationFromEuler(euler)
        .setPosition(0, sim.alt + 0.5 * bobAt(t), 0)
        .multiply(LIFT)
    } else {
      root.matrix.copy(stage.plane)
      open = stage.ramp
    }
    root.matrixWorldNeedsUpdate = true
    root.updateMatrixWorld(true)
    if (sim.active) OUTBOARD_EXHAUSTS.forEach((p, i) => trailOrigins[i].copy(p).applyMatrix4(root.matrixWorld))

    const doorUp = smooth(open * 1.7)
    const rampDown = smooth((open - 0.22) / 0.78)
    for (const o of door) if (o) o.rotation.z = DOOR_OPEN * doorUp
    for (const o of ramp) if (o) o.rotation.z = RAMP_OPEN * rampDown
    lamp.intensity = 140 * doorUp
    blur.uniforms.uTime.value = t

    for (const { sprite, size, level } of lights) {
      const l = level(t)
      sprite.scale.setScalar(size * (0.35 + 0.65 * l))
      sprite.material.opacity = l
    }
  }, -10)

  return craft ? <primitive object={craft.root} /> : null
}
