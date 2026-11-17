import { Matrix4, Vector3 } from 'three'

/** One parachute: where its mouth is, which way it is being pulled, and how far it has filled. */
export interface Canopy {
  visible: boolean
  /** centre of the canopy's open mouth, in the scene */
  mouth: Vector3
  /** unit vector from the load toward the canopy */
  axis: Vector3
  /** 0 a streamer, 1 full */
  filled: number
  /** 1 while it is flying, down to 0 as it settles on the ground */
  opacity: number
  /** the lines are cut at touchdown */
  rigged: boolean
  /** where the lines meet above the load, in the scene */
  confluence: Vector3
}

const canopy = (): Canopy => ({
  visible: false,
  mouth: new Vector3(),
  axis: new Vector3(0, 1, 0),
  filled: 0,
  opacity: 1,
  rigged: true,
  confluence: new Vector3(),
})

/**
 * What the director (DriveDirector) has decided for this frame, for the parts that only draw it.
 * Everything here is in scene space: the scene's origin rides along with whatever the camera is following.
 */
export const stage = {
  /** world position of the scene's origin */
  origin: { x: 0, z: 0 },
  /** the transport aircraft: model space (+X forward, +Y up, +Z starboard) to scene */
  plane: new Matrix4(),
  planeVisible: false,
  /** 0 shut, 1 ramp down and door up */
  ramp: 0,
  /** the car: wheels on y = 0, +X forward, to scene */
  car: new Matrix4(),
  /** 0 hanging in the air or tied down in the hold, 1 standing on the ground: shadow, lamps on the road */
  grounded: 1,
  /** seconds since the wheels touched down, or -1 */
  touchdown: -1,
  /** the small parachute that drags the car out, and the big one it comes down under */
  drogue: canopy(),
  main: canopy(),
  /** true once the transport's model has arrived and can stand in for the airliner */
  cargoReady: false,
}

/** How far above its own origin the transport's model is drawn, so that poses refer to the middle of the fuselage. */
export const CARGO_LIFT = 3
