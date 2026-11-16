import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { ClampToEdgeWrapping, LinearMipmapLinearFilter, MathUtils, NoColorSpace, RepeatWrapping, TextureLoader, type Texture } from 'three'
import { flight, SKY } from '../flightState'
import { sim } from '../../sim/simState'
import { skyUniforms } from './skyUniforms'
import { useSkyTexture } from './useSkyTexture'

/** Same sky as the hero, same grade and pixel density, but all the way round (land painted out). */
const PANORAMA_URL = '/sim/sky-360.jpg'

/**
 * Chooses which photograph the scene's sky comes from. The hero only ever looks one way, so it ships a
 * 110 degree crop; the simulator can turn right round, so it swaps in the full circle once that has loaded.
 */
export function SkySource() {
  const crop = useSkyTexture()
  const panorama = useRef<Texture | null>(null)

  useLayoutEffect(() => {
    skyUniforms.uSky.value = crop
  }, [crop])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (panorama.current || cancelled) return
      new TextureLoader().load(PANORAMA_URL, (texture) => {
        if (cancelled) return texture.dispose()
        texture.colorSpace = NoColorSpace
        texture.wrapS = RepeatWrapping
        texture.wrapT = ClampToEdgeWrapping
        texture.minFilter = LinearMipmapLinearFilter
        texture.generateMipmaps = true
        texture.anisotropy = 4
        panorama.current = texture
      })
    }
    sim.onWantSky = load
    if (sim.wantSky) load()
    return () => {
      cancelled = true
      sim.onWantSky = null
      panorama.current?.dispose()
      panorama.current = null
    }
  }, [])

  useFrame(() => {
    const full = sim.active && panorama.current
    skyUniforms.uSky.value = full ? panorama.current : crop
    skyUniforms.uCrop.value[0] = (full ? 360 : SKY.lonSpan) * MathUtils.DEG2RAD
    skyUniforms.uSim.value = sim.active ? 1 : 0
    skyUniforms.uTime.value = flight.time
  }, -28)

  return null
}
