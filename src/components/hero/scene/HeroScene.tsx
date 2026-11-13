import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { EquirectangularReflectionMapping, MathUtils, type PerspectiveCamera } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { AIR_SPEED, flight, heroLayout } from '../flightState'
import { sim } from '../../sim/simState'
import { Aircraft } from './Aircraft'
import { CloudLayers } from './CloudLayers'
import { Contrail } from './Contrail'
import { SimBeacons } from './SimBeacons'
import { SimFlight } from './SimFlight'
import { SimTrail } from './SimTrail'
import { SkyBackground } from './SkyBackground'
import { SkySource } from './SkySource'
import { SUN_DIR } from './vectors'

export const ENV_URL = '/hero/env.hdr'

const D2R = MathUtils.DEG2RAD

/** Advances the shared clock before anything else reads it. */
function FlightClock() {
  useFrame((_, delta) => {
    if (flight.reducedMotion) return
    const dt = Math.min(delta, 0.05)
    flight.time += dt
    // in the simulator the air goes by at whatever speed and heading the aircraft is actually flying
    if (!sim.active) flight.travel += AIR_SPEED * dt
  }, -30)
  return null
}

/** Chase camera: fixed formation with gyro-style drift and pointer parallax. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const aspect = useThree((s) => s.size.width / s.size.height)
  const layout = useMemo(() => heroLayout(aspect), [aspect])
  const eased = useMemo(() => ({ x: 0, y: 0 }), [])

  useLayoutEffect(() => {
    camera.fov = layout.fov
    camera.near = 2
    camera.far = 6000
    camera.updateProjectionMatrix()
  }, [camera, layout])

  useFrame((_, delta) => {
    // the simulator flies its own camera (SimFlight); take the lens back when it is done
    if (sim.active) return
    if (camera.fov !== layout.fov) {
      camera.fov = layout.fov
      camera.updateProjectionMatrix()
    }
    const t = flight.time
    const k = 1 - Math.exp(-delta * 2.2)
    eased.x += (flight.pointerX - eased.x) * k
    eased.y += (flight.pointerY - eased.y) * k
    // translating (not just rotating) the camera is what separates sky, cloud deck and aircraft
    camera.position.set(eased.x * 9 + 1.2 * Math.sin(0.17 * t), eased.y * 4 + 0.6 * Math.sin(0.23 * t + 1), 0)
    camera.rotation.set(
      layout.pitch + (0.18 * Math.sin(0.21 * t) - eased.y * 0.25) * D2R,
      (0.22 * Math.sin(0.15 * t + 0.7) - eased.x * 0.4) * D2R,
      0.12 * Math.sin(0.11 * t) * D2R,
      'YXZ',
    )
    camera.updateMatrixWorld()
  }, -20)
  return null
}

function Lighting() {
  const env = useLoader(HDRLoader, ENV_URL)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    env.mapping = EquirectangularReflectionMapping
    scene.environment = env
    scene.environmentIntensity = 1.05
    return () => {
      scene.environment = null
    }
  }, [env, scene])
  return (
    <>
      <directionalLight position={SUN_DIR.toArray()} intensity={3.4} color="#ffab6b" />
      {/* the low sun is almost behind the aircraft, so a warm kicker wraps its light onto the near side */}
      <directionalLight position={[0.5, 0.78, 0.42]} intensity={2.1} color="#ffc396" />
      <directionalLight position={[-0.6, 0.5, 1]} intensity={0.35} color="#9fa9cc" />
      <fog attach="fog" args={['#c9967a', 60, 3200]} />
    </>
  )
}

export function HeroScene({ onReady }: { onReady: () => void }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    onReady()
    invalidate()
  }, [onReady, invalidate])
  return (
    <>
      <FlightClock />
      <SkySource />
      <SimFlight />
      <CameraRig />
      <Lighting />
      <SkyBackground />
      <CloudLayers />
      <Aircraft />
      <Contrail />
      <SimBeacons />
      <SimTrail />
    </>
  )
}
