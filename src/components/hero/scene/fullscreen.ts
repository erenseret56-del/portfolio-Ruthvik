import {
  BufferGeometry,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGL3DRenderTarget,
  type WebGLRenderer,
} from 'three'
import { MathUtils } from 'three'
import { SKY } from '../flightState'
import { noiseBakeFragment, noiseBakeVertex } from './shaders'

/** One oversized triangle covering the viewport. */
export const fullscreenTriangle = new BufferGeometry().setAttribute(
  'position',
  new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
)

/** The triangle is placed in clip space by its shader, so it must never be frustum-culled by its world position. */
export function fullscreenMesh(material: ShaderMaterial) {
  const mesh = new Mesh(fullscreenTriangle, material)
  mesh.frustumCulled = false
  return mesh
}

export const skyCropUniform = () => ({
  value: [SKY.lonSpan * MathUtils.DEG2RAD, SKY.latMin * MathUtils.DEG2RAD, SKY.latMax * MathUtils.DEG2RAD],
})

/** Renders the tileable cloud noise volume on the GPU, one slice per draw. */
export function bakeCloudNoise(gl: WebGLRenderer, size = 64): WebGL3DRenderTarget {
  const target = new WebGL3DRenderTarget(size, size, size, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  })
  target.texture.wrapS = target.texture.wrapT = target.texture.wrapR = RepeatWrapping

  const material = new ShaderMaterial({
    vertexShader: noiseBakeVertex,
    fragmentShader: noiseBakeFragment,
    uniforms: { uZ: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  })
  const scene = new Scene()
  scene.add(fullscreenMesh(material))
  const camera = new OrthographicCamera()

  const previous = gl.getRenderTarget()
  for (let z = 0; z < size; z++) {
    material.uniforms.uZ.value = (z + 0.5) / size
    gl.setRenderTarget(target, z)
    gl.render(scene, camera)
  }
  gl.setRenderTarget(previous)
  material.dispose()
  return target
}
