import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import { ClampToEdgeWrapping, LinearMipmapLinearFilter, NoColorSpace, TextureLoader, type Texture } from 'three'

export const SKY_URL = '/hero/sky.jpg'

/** The sky photo is already graded for display, so it is sampled raw (no colour-space conversion). */
export function useSkyTexture(): Texture {
  const sky = useLoader(TextureLoader, SKY_URL)
  return useMemo(() => {
    sky.colorSpace = NoColorSpace
    sky.wrapS = sky.wrapT = ClampToEdgeWrapping
    sky.minFilter = LinearMipmapLinearFilter
    sky.generateMipmaps = true
    sky.anisotropy = 4
    sky.needsUpdate = true
    return sky
  }, [sky])
}
