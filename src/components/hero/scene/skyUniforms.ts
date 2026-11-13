import type { Texture } from 'three'
import { skyCropUniform } from './fullscreen'

/**
 * The sky texture and its angular extent, as uniform objects shared by every material that samples the sky
 * (backdrop and cloud haze), so the whole scene switches between the hero's crop and the simulator's full
 * circle in one place: see SkySource.
 */
export const skyUniforms = {
  uSky: { value: null as Texture | null },
  uCrop: skyCropUniform(),
}
