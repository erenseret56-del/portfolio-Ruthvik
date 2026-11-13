import { useMemo } from 'react'
import { ShaderMaterial } from 'three'
import { fullscreenTriangle, skyCropUniform } from './fullscreen'
import { rayVertex, skyFragment } from './shaders'
import { useSkyTexture } from './useSkyTexture'
import { SUN_DIR } from './vectors'

/** Photographic golden-hour sky, projected by view direction so it responds to real camera motion. */
export function SkyBackground() {
  const sky = useSkyTexture()
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: rayVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uSky: { value: sky },
          uCrop: skyCropUniform(),
          uSunDir: { value: SUN_DIR },
          uDepth: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    [sky],
  )
  return <mesh geometry={fullscreenTriangle} material={material} frustumCulled={false} renderOrder={-10} />
}
