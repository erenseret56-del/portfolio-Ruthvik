import { useMemo } from 'react'
import { ShaderMaterial } from 'three'
import { fullscreenTriangle } from './fullscreen'
import { rayVertex, skyFragment } from './shaders'
import { skyUniforms } from './skyUniforms'
import { SUN_DIR } from './vectors'

/** Photographic golden-hour sky, projected by view direction so it responds to real camera motion. */
export function SkyBackground() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: rayVertex,
        fragmentShader: skyFragment,
        uniforms: {
          ...skyUniforms,
          uSunDir: { value: SUN_DIR },
          uDepth: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  return <mesh geometry={fullscreenTriangle} material={material} frustumCulled={false} renderOrder={-10} />
}
