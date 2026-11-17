import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { Euler, MathUtils, Matrix4, Vector3, type PerspectiveCamera } from 'three'
import { CAR, drive, handOver, LANDING, stepCar } from '../../drive/driveState'
import { CARGO_LIFT, stage, type Canopy } from './driveStage'

const D2R = MathUtils.DEG2RAD
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}
const mix = MathUtils.lerp

// ---------- the delivery, as a function of time ----------
//
// Everything in the opening is placed by the clock alone, so it can be cut short, and so the car is certain
// to come down exactly where the road is. Positions are worked out along the aircraft's track: s metres past
// the landing point, l metres to the right of it.

const PSI = LANDING.heading
const FWD = new Vector3(Math.sin(PSI), 0, -Math.cos(PSI))
const RIGHT = new Vector3(Math.cos(PSI), 0, Math.sin(PSI))
const UP = new Vector3(0, 1, 0)

/** the transport's speed over the ground (m/s) and the height of its run-in (m) */
const SPEED = 62
const RUN_IN = 64
const TRIM = 2 * D2R

// the hold, in the aircraft model's own frame: where the car is tied down, and the lip of the lowered ramp
const HOLD_X = 3
const LIP_X = -6.6
const FLOOR_Y = -4.67
const RAMP_TOP_X = -2.76
const RAMP_SLOPE = 0.154
const deck = (x: number) => (x > RAMP_TOP_X ? FLOOR_Y : FLOOR_Y - 0.05 - (RAMP_TOP_X - x) * RAMP_SLOPE)
/** the extraction parachute hauls the car backwards at this rate (m/s^2) */
const PULL = 9
const SLIDE = Math.sqrt((2 * (HOLD_X - LIP_X)) / PULL)

const T = {
  /** the aircraft has come down to its run-in height */
  level: 4.4,
  /** from a camera flying ahead of the nose to one flying behind the tail */
  cut: 4.7,
  ramp: 5.2,
  rampTime: 4.4,
  drogue: 9.9,
  extract: 10.6,
  exit: 10.6 + SLIDE,
}

// under the canopies: free fall for a moment, then the main parachute bites and it comes down steadily
const FREE = { time: 1.5, gravity: 9, sink: 6.8, settle: 0.75 }
const fallen = (s: number) => {
  if (s < FREE.time) return 0.5 * FREE.gravity * s * s
  const v = FREE.gravity * FREE.time - FREE.sink
  const u = s - FREE.time
  return 0.5 * FREE.gravity * FREE.time ** 2 + FREE.sink * u + v * FREE.settle * (1 - Math.exp(-u / FREE.settle))
}
const sinkRate = (s: number) =>
  s < FREE.time ? FREE.gravity * s : FREE.sink + (FREE.gravity * FREE.time - FREE.sink) * Math.exp(-(s - FREE.time) / FREE.settle)
/** it leaves the ramp still doing most of the aircraft's speed, and the air takes that off it */
const CARRY = { speed: SPEED - PULL * SLIDE, time: 1.5 }
const carried = (s: number) => CARRY.speed * CARRY.time * (1 - Math.exp(-s / CARRY.time))

// where the lip of the ramp is, relative to the middle of the aircraft in level flight
const LIP_FORWARD = LIP_X * Math.cos(TRIM) - (deck(LIP_X) + CARGO_LIFT) * Math.sin(TRIM)
const LIP_UP = LIP_X * Math.sin(TRIM) + (deck(LIP_X) + CARGO_LIFT) * Math.cos(TRIM)
const DROP_HEIGHT = RUN_IN + LIP_UP
const FALL_TIME = (() => {
  let lo = 0
  let hi = 40
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (fallen(mid) < DROP_HEIGHT) lo = mid
    else hi = mid
  }
  return hi
})()
const T_LAND = T.exit + FALL_TIME
const T_END = T_LAND + 2.8
/** the car leaves the ramp this far short of where it lands */
const EXIT_S = -carried(FALL_TIME)
const PLANE_EXIT_S = EXIT_S - LIP_FORWARD

const euler = new Euler()
const scratch = new Matrix4()
const LIFT = new Matrix4().makeTranslation(0, CARGO_LIFT, 0)

/** A body with +X forward, placed on the track and turned to a heading, pitch and bank. */
function pose(out: Matrix4, s: number, l: number, y: number, heading: number, pitch: number, bank: number) {
  euler.set(bank, Math.PI / 2 - heading, pitch, 'YZX')
  return out
    .makeRotationFromEuler(euler)
    .setPosition(LANDING.x + FWD.x * s + RIGHT.x * l, y, LANDING.z + FWD.z * s + RIGHT.z * l)
}

/** The transport at time t: model space to world. Returns how far along the track it is. */
function planeAt(t: number, out: Matrix4) {
  const s = PLANE_EXIT_S + SPEED * (t - T.exit)
  // it comes down to its run-in height, drops its load, then climbs away to the left
  const u = Math.min(1, Math.max(0, t / T.level))
  const descent = (-42 * 6 * u * (1 - u)) / T.level
  const away = Math.max(0, t - T.exit - 0.9)
  const alt = RUN_IN + 42 * (1 - smooth(u)) + (4.5 * away * away) / (1 + 0.35 * away)
  const turn = (-0.03 * away * away) / (1 + 0.22 * away)
  pose(
    out,
    s,
    (-SPEED * 0.01 * away ** 3) / (1 + 0.2 * away),
    alt,
    PSI + turn,
    TRIM + Math.atan2(descent, SPEED) + 0.13 * smooth(away / 2.5),
    -0.4 * smooth(away / 3),
  )
  out.multiply(LIFT)
  return s
}

const carPlane = new Matrix4()
/** The car at time t of the delivery: wheels-on-the-ground frame to world. */
function carAt(t: number, out: Matrix4) {
  if (t < T.exit) {
    // tied down in the hold, then dragged back along the floor and down the ramp
    const slid = Math.max(0, t - T.extract)
    const x = HOLD_X - 0.5 * PULL * slid * slid
    planeAt(t, carPlane)
    euler.set(0, 0, RAMP_SLOPE * smooth((-1.5 - x) / 2.5), 'YZX')
    return out.copy(carPlane).multiply(scratch.makeRotationFromEuler(euler).setPosition(x, deck(x), 0))
  }
  const s = Math.min(t - T.exit, FALL_TIME)
  const u = Math.max(0, s - FREE.time)
  // it tips off the ramp tail first, then swings under the canopy until the swing dies away
  const calm = 1 - smooth((s - (FALL_TIME - 1.4)) / 1.4)
  const pitch = (0.19 * Math.exp(-s / 1.1) * Math.cos(1.8 * s) - 0.08 * Math.exp(-u / 3) * Math.sin(1.6 * u)) * calm
  const roll = 0.11 * Math.exp(-u / 3.2) * Math.sin(1.9 * u) * calm
  return pose(out, EXIT_S + carried(s), 0, Math.max(0, DROP_HEIGHT - fallen(s)), PSI, pitch, roll)
}

// ---------- cameras ----------

const planeNow = new Matrix4()
const position = new Vector3()
const target = new Vector3()
const carPos = new Vector3()
const offset = new Vector3()
const aim = new Vector3()

/** The camera that flies behind the tail and watches the ramp come down: fills position and target (world). */
function tailCamera(t: number, plane: Matrix4, eye: Vector3, look: Vector3) {
  const u = smooth((t - T.cut) / (T.extract - T.cut))
  eye
    .set(
      mix(-31, -21, u) + 0.12 * Math.sin(t * 5.3),
      mix(-1.9, -2.5, u) + 0.1 * Math.sin(t * 6.7 + 1),
      mix(7.5, 5.6, u) + 0.12 * Math.sin(t * 4.1 + 2),
    )
    .applyMatrix4(plane)
  look.set(-4.5, -4.1, 0).applyMatrix4(plane)
}

// what the tail camera was doing at the instant the car began to move: the falling camera starts from there
const HANDOFF = (() => {
  const plane = new Matrix4()
  const car = new Matrix4()
  const eye = new Vector3()
  const look = new Vector3()
  planeAt(T.extract, plane)
  carAt(T.extract, car)
  tailCamera(T.extract, plane, eye, look)
  const at = new Vector3().setFromMatrixPosition(car)
  return { eye: eye.sub(at), look: look.sub(at) }
})()

const CHASE = { back: 7.4, up: 2.5, ahead: 6, lift: 1.05 }
/** the car must stay comfortably inside the frame on tall screens too */
const MIN_HORIZONTAL_FOV = 62 * D2R

function setCanopy(c: Canopy, visible: boolean) {
  c.visible = visible
  c.rigged = true
  c.opacity = 1
}

/**
 * Runs the ground: first the delivery (the transport's low pass, the ramp, the car coming out and down
 * under its parachute), then the driving itself. It decides where everything is and where the camera
 * stands; the aircraft, the car and the parachutes only draw what it has left for them in driveStage.
 */
export function DriveDirector() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const rig = useMemo(() => ({ epoch: -1, yaw: 0, rush: 0, was: false }), [])

  useFrame(({ size }, delta) => {
    if (!drive.active) {
      if (rig.was) {
        // hand the lens back as it was found
        rig.was = false
        camera.near = 2
        camera.far = 6000
        camera.updateProjectionMatrix()
        stage.planeVisible = false
      }
      return
    }
    drive.running = true
    const dt = Math.min(delta, 0.05)
    const aspect = size.width / size.height
    const baseFov = Math.max(50, 2 * Math.atan(Math.tan(MIN_HORIZONTAL_FOV / 2) / aspect) * MathUtils.RAD2DEG)
    if (!rig.was || rig.epoch !== drive.epoch) {
      Object.assign(rig, { was: true, epoch: drive.epoch, yaw: drive.heading, rush: 0 })
      camera.near = 0.5
      camera.far = 12000
      camera.updateProjectionMatrix()
      stage.touchdown = -1
    }
    let fov = baseFov

    if (drive.phase === 'intro') {
      drive.introTime = drive.skip ? T_END : drive.introTime + dt
      const t = drive.introTime
      planeAt(t, planeNow)
      carAt(t, stage.car)
      carPos.setFromMatrixPosition(stage.car)
      stage.plane.copy(planeNow)
      stage.planeVisible = true
      // the door goes up first, the ramp follows it down
      stage.ramp = (t - T.ramp) / T.rampTime
      const landed = t - T_LAND
      stage.grounded = smooth(landed / 0.2)
      stage.touchdown = landed >= 0 ? landed : -1

      // --- parachutes ---
      const s = t - T.exit
      const out = t - T.drogue
      setCanopy(stage.drogue, out > 0 && s < 1.5)
      if (stage.drogue.visible) {
        const c = stage.drogue
        c.confluence.set(-2.2, 0.72, 0).applyMatrix4(stage.car)
        if (s < 0) c.axis.set(-1, -0.06, 0).transformDirection(planeNow)
        else c.axis.copy(FWD).multiplyScalar(-CARRY.speed * Math.exp(-s / CARRY.time)).addScaledVector(UP, sinkRate(s)).normalize()
        c.mouth.copy(c.confluence).addScaledVector(c.axis, 7 * smooth(out / 0.6))
        c.filled = smooth(out / 0.45) * (1 + 0.06 * Math.sin(t * 17))
        c.opacity = 1 - smooth((s - 1) / 0.5)
      }
      const open = s - 1
      setCanopy(stage.main, open > 0 && landed < 3.4)
      if (stage.main.visible) {
        const c = stage.main
        c.confluence.set(0, 2.5, 0).applyMatrix4(stage.car)
        // it streams out along the airflow, then swings up overhead as the car stops moving forward
        c.axis
          .copy(FWD)
          .multiplyScalar(-CARRY.speed * Math.exp(-s / CARRY.time))
          .addScaledVector(UP, sinkRate(s) + 14 * smooth(open / 3))
          .normalize()
        const fill = (open - 0.45) / 1.2
        c.filled = smooth(fill) + 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, fill))) + 0.025 * Math.sin(t * 3.1) * smooth(fill)
        c.mouth.copy(c.confluence).addScaledVector(c.axis, 13 * smooth(open / 0.5))
        if (landed > 0) {
          // cut loose at touchdown: it blows on down the road, folds and settles
          const fold = smooth(landed / 2.4)
          c.rigged = landed < 0.12
          c.axis.set(0, 1, 0).lerp(aim.copy(FWD).multiplyScalar(0.6).addScaledVector(RIGHT, 0.8), fold * 0.85).normalize()
          c.mouth
            .set(carPos.x, 15.5, carPos.z)
            .addScaledVector(FWD, 4 * landed)
            .addScaledVector(RIGHT, 3 * landed)
          c.mouth.y = Math.max(1.2, 15.5 - 2.6 * landed * landed)
          c.filled = 1 - 0.55 * fold
          c.opacity = 1 - smooth((landed - 1.3) / 1.4)
        }
      }

      // --- camera ---
      if (t < T.cut) {
        // air to air, off the nose: the transport comes down out of the dusk to its run-in height over the fields
        const u = smooth(t / T.cut)
        target.setFromMatrixPosition(planeNow)
        position
          .copy(target)
          .addScaledVector(FWD, mix(125, 46, u))
          .addScaledVector(RIGHT, mix(-80, -34, u))
        position.y += mix(17, 2, u)
        target.y -= 3.5
        fov = mix(30, 40, u)
      } else if (t < T.extract) {
        tailCamera(t, planeNow, position, target)
        fov = 46
      } else {
        // the camera lets go of the aircraft with the car, and circles it on the way down
        const w = smooth((t - T.extract) / 3.2)
        const fall = smooth((t - T.extract) / (T_LAND - T.extract))
        const angle = mix(0.35, 1.25, fall)
        // wide enough for the whole canopy, then in close for the touchdown
        const reach = mix(mix(30, 36, Math.sin(Math.PI * fall)), 17, smooth((fall - 0.62) / 0.38))
        offset
          .copy(FWD)
          .multiplyScalar(-Math.cos(angle) * reach)
          .addScaledVector(RIGHT, Math.sin(angle) * reach)
        offset.y = mix(-3, 5, fall)
        aim.set(0, mix(9, 2.5, smooth((fall - 0.3) / 0.7)), 0)
        // and once it is down, comes round behind it to where the driving is done from
        const settle = smooth(landed / 2.6)
        offset.lerp(position.copy(FWD).multiplyScalar(-CHASE.back).setY(CHASE.up), settle)
        aim.lerp(position.copy(FWD).multiplyScalar(CHASE.ahead).setY(CHASE.lift), settle)
        position.copy(HANDOFF.eye).lerp(offset, w).add(carPos)
        target.copy(HANDOFF.look).lerp(aim, w).add(carPos)
        position.y = Math.max(position.y, 0.9)
        fov = mix(mix(46, 52, w), baseFov, settle)
        // the springs take the landing
        drive.heave = landed > 0 ? -0.085 * Math.exp(-landed * 5) * Math.cos(landed * 13) : 0
        drive.pitch = landed > 0 ? 0.03 * Math.exp(-landed * 4) * Math.sin(landed * 11) : 0
      }
      drive.viewYaw = Math.atan2(target.x - position.x, -(target.z - position.z))

      // the scene rides with whatever the camera is watching
      const focus = t < T.extract ? target : carPos
      stage.origin.x = focus.x
      stage.origin.z = focus.z

      if (t >= T_END) {
        stage.planeVisible = false
        stage.main.visible = stage.drogue.visible = false
        stage.grounded = 1
        drive.heave = drive.pitch = 0
        rig.yaw = drive.heading
        handOver()
      }
    } else {
      stepCar(dt)
      stage.planeVisible = false
      stage.main.visible = stage.drogue.visible = false
      stage.grounded = 1
      if (stage.touchdown >= 0) stage.touchdown += dt

      euler.set(0, Math.PI / 2 - drive.heading, 0, 'YZX')
      stage.car.makeRotationFromEuler(euler).setPosition(drive.x, 0, drive.z)
      carPos.set(drive.x, 0, drive.z)
      stage.origin.x = drive.x
      stage.origin.z = drive.z

      // behind the car, looking a little way into the slide; further back and wider the faster it goes
      const slide = wrap(drive.heading - drive.course)
      rig.yaw += wrap(drive.heading - 0.45 * slide - rig.yaw) * ease(dt, 4.2)
      rig.rush += (smooth(Math.abs(drive.speed) / CAR.top) - rig.rush) * ease(dt, 2.2)
      drive.viewYaw = rig.yaw
      const sin = Math.sin(rig.yaw)
      const cos = Math.cos(rig.yaw)
      const back = CHASE.back + 1.6 * rig.rush
      const shake = rig.rush * (0.012 + 0.03 * drive.rough)
      position.set(drive.x - sin * back, CHASE.up + 0.25 * rig.rush + shake * Math.sin(drive.spin * 0.7), drive.z + cos * back)
      target.set(drive.x + sin * CHASE.ahead, CHASE.lift, drive.z - cos * CHASE.ahead)
      fov = baseFov + 13 * rig.rush
    }

    // world to scene
    const { x: ox, z: oz } = stage.origin
    for (const m of [stage.car, stage.plane]) {
      m.elements[12] -= ox
      m.elements[14] -= oz
    }
    for (const c of [stage.drogue, stage.main]) {
      c.mouth.x -= ox
      c.mouth.z -= oz
      c.confluence.x -= ox
      c.confluence.z -= oz
    }
    camera.position.set(position.x - ox, position.y, position.z - oz)
    camera.up.set(0, 1, 0)
    camera.lookAt(target.x - ox, target.y, target.z - oz)
    if (drive.phase === 'driving') camera.rotateZ(-drive.roll * 0.35)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
  }, -25)

  return null
}
