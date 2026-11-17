import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { MathUtils, Vector3, type PerspectiveCamera } from 'three'
import { SIM, sim, stepSim } from '../../sim/simState'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)

// chase position behind and above the aircraft, and the wider shot the flight opens on
const CHASE = { back: 112, up: 23, ahead: 210 }
const ESTABLISH = { back: 270, up: 86 }
/** the aircraft must stay comfortably inside the frame on tall screens too */
const MIN_HORIZONTAL_FOV = 46 * MathUtils.DEG2RAD

/**
 * Flies the simulator: steps the flight model, then puts a chase camera behind the aircraft.
 * The scene keeps the aircraft at the origin (only its height is real) and slides the world past it,
 * so the camera never travels far and everything else is drawn relative to the aircraft.
 */
export function SimFlight() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const rig = useMemo(() => ({ epoch: -1, yaw: 0, alt: 0, look: 0, rush: 0 }), [])
  const target = useMemo(() => new Vector3(), [])

  useFrame(({ size }, delta) => {
    if (!sim.active) return
    sim.flying = true
    const dt = Math.min(delta, 0.05)
    stepSim(dt)

    if (rig.epoch !== sim.epoch) Object.assign(rig, { epoch: sim.epoch, yaw: sim.heading, alt: sim.alt, look: 0, rush: 0 })
    // while circling a destination the camera swings inward, so the ring stays in the picture
    const circling = sim.autopilot?.mode === 'orbit'
    rig.look += ((circling ? -1.2 : 0) - rig.look) * ease(dt, 1.1)
    rig.yaw += wrap(sim.heading + rig.look - rig.yaw) * ease(dt, 2.6)
    rig.alt += (sim.alt - rig.alt) * ease(dt, 3)
    rig.rush += ((sim.speed - SIM.cruise) / (SIM.boost - SIM.cruise) - rig.rush) * ease(dt, 2)
    sim.viewYaw = rig.yaw

    const wide = sim.intro * sim.intro * (3 - 2 * sim.intro)
    const back = MathUtils.lerp(CHASE.back, ESTABLISH.back, wide) + 14 * rig.rush
    const up = MathUtils.lerp(CHASE.up, ESTABLISH.up, wide)
    const sin = Math.sin(rig.yaw)
    const cos = Math.cos(rig.yaw)
    camera.position.set(-sin * back, rig.alt + up, cos * back)
    camera.up.set(0, 1, 0)
    camera.lookAt(target.set(sin * CHASE.ahead, rig.alt + 4, -cos * CHASE.ahead))
    camera.rotateZ(-sim.bank * 0.2)

    const aspect = size.width / size.height
    const fov = Math.max(40, 2 * Math.atan(Math.tan(MIN_HORIZONTAL_FOV / 2) / aspect) * MathUtils.RAD2DEG) + 5 * rig.rush
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
  }, -25)

  return null
}
