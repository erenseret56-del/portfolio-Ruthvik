import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  CustomBlending,
  LinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGL3DRenderTarget,
} from 'three'
import { flight } from '../flightState'
import { sim } from '../../sim/simState'
import { bakeCloudNoise, fullscreenMesh, fullscreenTriangle } from './fullscreen'
import { cloudCompositeFragment, cloudCompositeVertex, cloudFragment, rayVertex } from './shaders'
import { skyUniforms } from './skyUniforms'
import { HEADING, SUN_DIR } from './vectors'

/** Target width (fraction of the CSS viewport, with a floor for phones) and ray-march steps, best first. */
const QUALITY = [
  { scale: 0.5, minWidth: 400, steps: 128 },
  { scale: 0.4, minWidth: 360, steps: 110 },
  { scale: 0.32, minWidth: 300, steps: 92 },
  { scale: 0.25, minWidth: 240, steps: 76 },
]
const FIELD_ORIGIN = new Vector3(2350, 0, 640)

/**
 * Volumetric cloud deck. The ray march runs into a small off-screen target every frame and is
 * composited behind the aircraft; near and far clouds drift at different apparent speeds because
 * the whole field is advected through real perspective.
 */
export function CloudLayers() {
  const gl = useThree((s) => s.gl)
  // baked on the first frame (and again after a remount), so it never outlives or predates its GL resources
  const noise = useRef<WebGL3DRenderTarget | null>(null)
  const target = useMemo(() => new WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }), [])

  const { cloudScene, cloudMaterial, composite } = useMemo(() => {
    const cloudMaterial = new ShaderMaterial({
      vertexShader: rayVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        ...skyUniforms,
        uNoise: { value: null },
        uSunDir: { value: SUN_DIR },
        uOffset: { value: new Vector3() },
        uSteps: { value: QUALITY[0].steps },
        uDepth: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const cloudScene = new Scene()
    cloudScene.add(fullscreenMesh(cloudMaterial))
    const composite = new ShaderMaterial({
      vertexShader: cloudCompositeVertex,
      fragmentShader: cloudCompositeFragment,
      uniforms: { uClouds: { value: target.texture }, uTexel: { value: new Vector2() } },
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    })
    return { cloudScene, cloudMaterial, composite }
  }, [target])

  useEffect(
    () => () => {
      target.dispose()
      noise.current?.dispose()
      noise.current = null
      cloudMaterial.dispose()
      composite.dispose()
    },
    [target, cloudMaterial, composite],
  )

  const quality = useRef({ level: window.matchMedia('(pointer: coarse)').matches ? 1 : 0, slow: 0, frames: 0 })

  useFrame(({ camera, size }, delta) => {
    const q = quality.current
    // drop a quality level after ~1.5s of sustained slow frames; never climb back (avoids oscillation)
    if (!flight.reducedMotion && ++q.frames > 90) {
      q.slow = delta > 1 / 45 ? q.slow + 1 : Math.max(0, q.slow - 2)
      if (q.slow > 80 && q.level < QUALITY.length - 1) {
        q.level++
        q.slow = 0
      }
    }
    const { scale, minWidth, steps } = QUALITY[q.level]
    const w = Math.min(1000, Math.max(minWidth, Math.round(size.width * scale)))
    const h = Math.round((w * size.height) / size.width)
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h)
      composite.uniforms.uTexel.value.set(1 / w, 1 / h)
    }
    noise.current ??= bakeCloudNoise(gl)
    cloudMaterial.uniforms.uNoise.value = noise.current.texture
    cloudMaterial.uniforms.uSteps.value = steps
    // the field slides under a camera that stays near the origin: by distance flown in the hero, and by
    // the aircraft's actual position in the simulator
    const offset = cloudMaterial.uniforms.uOffset.value.copy(HEADING).multiplyScalar(flight.travel).add(FIELD_ORIGIN)
    if (sim.active) {
      offset.x += sim.x
      offset.z += sim.z
    }
    skyUniforms.uWorld.value.copy(offset)

    gl.setRenderTarget(target)
    gl.render(cloudScene, camera)
    gl.setRenderTarget(null)
  })

  return <mesh geometry={fullscreenTriangle} material={composite} frustumCulled={false} renderOrder={-5} />
}
