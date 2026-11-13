import { Vector3 } from 'three'
import { D2R, HEADING_YAW, SKY } from '../flightState'

/** Unit vector toward the sun; camera looks down -Z, +X is screen right. */
export const SUN_DIR = new Vector3(
  Math.sin(SKY.sunLon * D2R) * Math.cos(SKY.sunLat * D2R),
  Math.sin(SKY.sunLat * D2R),
  -Math.cos(SKY.sunLon * D2R) * Math.cos(SKY.sunLat * D2R),
)

/** Direction of flight. */
export const HEADING = new Vector3(Math.cos(HEADING_YAW), 0, -Math.sin(HEADING_YAW))

/** World positions of the two engine exhausts: written by the aircraft each frame, read by the contrail. */
export const trailOrigins = [new Vector3(), new Vector3()]
