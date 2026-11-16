import { Vector3, type Texture } from 'three'
import { skyCropUniform } from './fullscreen'

/**
 * The sky texture and its angular extent, as uniform objects shared by every material that samples the sky
 * (backdrop and cloud haze), so the whole scene switches between the hero's crop and the simulator's full
 * circle in one place: see SkySource.
 *
 * The simulator's extras ride along the same way: uSim turns on the stars, the breaks in the cloud deck and
 * the ground seen through them; uWorld is how far the air mass has slid under the camera (written by the
 * clouds, so the ground below moves with them); uTime makes lights twinkle.
 */
export const skyUniforms = {
  uSky: { value: null as Texture | null },
  uCrop: skyCropUniform(),
  uSim: { value: 0 },
  uWorld: { value: new Vector3() },
  uTime: { value: 0 },
}
