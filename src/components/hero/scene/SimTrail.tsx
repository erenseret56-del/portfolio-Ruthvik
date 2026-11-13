import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector3 } from 'three'
import { sim } from '../../sim/simState'
import { trailOrigins } from './vectors'

const POINTS = 170
const SPACING = 13

const trailVertex = /* glsl */ `
attribute float aAge;
attribute float aSide;
attribute float aAir;
varying float vAge;
varying float vSide;
varying float vAir;
void main() {
  vAge = aAge;
  vSide = aSide;
  vAir = aAir;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`
const trailFragment = /* glsl */ `
varying float vAge;
varying float vSide;
varying float vAir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // noise rides with the air (vAir is distance along the path actually flown), so the vapour holds still
  float n = vnoise(vec2(vAir / 24.0, vSide * 1.4)) * 0.65 + vnoise(vec2(vAir / 8.0 + 31.0, vSide * 3.0)) * 0.35;
  float edge = abs(vSide) + (n - 0.5) * mix(0.35, 1.3, vAge);
  float body = 1.0 - smoothstep(0.25, 0.95, edge);
  float born = smoothstep(0.0, 0.035, vAge);
  float fade = 1.0 - smoothstep(0.3, 1.0, vAge);
  float breakup = mix(1.0, smoothstep(0.3, 0.7, n + (1.0 - vAge) * 0.25), smoothstep(0.3, 1.0, vAge));
  float alpha = body * born * fade * breakup * mix(0.95, 0.5, vAge) * (0.7 + 0.45 * n);
  if (alpha < 0.003) discard;
  vec3 col = mix(vec3(0.86, 0.74, 0.7), vec3(1.0, 0.93, 0.84), smoothstep(-0.7, 0.5, vSide) * 0.6 + body * 0.4);
  gl_FragColor = vec4(col, alpha);
}
`

interface Trail {
  /** path flown by this engine, newest first, in world metres */
  path: Float64Array
  count: number
  /** points laid so far, so the vapour pattern keeps its place in the air */
  laid: number
  geometry: BufferGeometry
  mesh: Mesh
}

/**
 * Contrails that remember where the aircraft has been: each engine lays a ribbon along its real path,
 * so a turn leaves a curve hanging in the sky. Rebuilt on the CPU every frame (a few hundred vertices).
 */
export function SimTrail() {
  const { trails, material } = useMemo(() => {
    const material = new ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    const index: number[] = []
    for (let i = 0; i < POINTS - 1; i++) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2)
    const trails: Trail[] = trailOrigins.map(() => {
      const geometry = new BufferGeometry()
      for (const [name, size] of [
        ['position', 3],
        ['aAge', 1],
        ['aSide', 1],
        ['aAir', 1],
      ] as const) {
        const attribute = new BufferAttribute(new Float32Array(POINTS * 2 * size), size)
        attribute.setUsage(DynamicDrawUsage)
        geometry.setAttribute(name, attribute)
      }
      geometry.setIndex(index)
      geometry.setDrawRange(0, 0)
      const mesh = new Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = 5
      mesh.visible = false
      return { path: new Float64Array(POINTS * 3), count: 0, laid: 0, geometry, mesh }
    })
    return { trails, material }
  }, [])

  useEffect(
    () => () => {
      material.dispose()
      trails.forEach((t) => t.geometry.dispose())
    },
    [trails, material],
  )

  const scratch = useMemo(
    () => ({ epoch: -1, a: new Vector3(), b: new Vector3(), tangent: new Vector3(), side: new Vector3(), view: new Vector3() }),
    [],
  )

  useFrame(({ camera }) => {
    for (const t of trails) t.mesh.visible = sim.active
    if (!sim.active) return
    if (scratch.epoch !== sim.epoch) {
      scratch.epoch = sim.epoch
      for (const t of trails) t.count = t.laid = 0
    }
    const { a, b, tangent, side, view } = scratch

    trails.forEach((t, e) => {
      const { path } = t
      // newest point follows the exhaust; once it has moved a full spacing on, it is laid and a new one starts
      const hx = trailOrigins[e].x + sim.x
      const hy = trailOrigins[e].y
      const hz = trailOrigins[e].z + sim.z
      if (t.count < 2 || Math.hypot(hx - path[3], hy - path[4], hz - path[5]) >= SPACING) {
        path.copyWithin(3, 0, (POINTS - 1) * 3)
        t.count = Math.min(POINTS, t.count + 1)
        t.laid++
      }
      path[0] = hx
      path[1] = hy
      path[2] = hz
      const lead = Math.hypot(hx - path[3], hy - path[4], hz - path[5]) / SPACING

      const position = t.geometry.getAttribute('position') as BufferAttribute
      const age = t.geometry.getAttribute('aAge') as BufferAttribute
      const sideAttr = t.geometry.getAttribute('aSide') as BufferAttribute
      const air = t.geometry.getAttribute('aAir') as BufferAttribute
      const at = (i: number, out: Vector3) => out.set(path[i * 3] - sim.x, path[i * 3 + 1], path[i * 3 + 2] - sim.z)
      for (let i = 0; i < t.count; i++) {
        at(i, a)
        at(Math.max(0, i - 1), tangent).sub(at(Math.min(t.count - 1, i + 1), b))
        view.copy(camera.position).sub(a)
        side.crossVectors(tangent, view)
        if (side.lengthSq() < 1e-8) side.set(0, 1, 0)
        side.normalize()
        const along = i === 0 ? 0 : (i - 1 + lead) / (POINTS - 2)
        // spreads as it ages, and sinks a little
        const half = 1.3 + 9.5 * Math.pow(along, 0.7)
        a.y -= 5 * along
        position.setXYZ(2 * i, a.x + side.x * half, a.y + side.y * half, a.z + side.z * half)
        position.setXYZ(2 * i + 1, a.x - side.x * half, a.y - side.y * half, a.z - side.z * half)
        age.setX(2 * i, along)
        age.setX(2 * i + 1, along)
        sideAttr.setX(2 * i, 1)
        sideAttr.setX(2 * i + 1, -1)
        const metres = (t.laid - i + (i === 0 ? lead : 0)) * SPACING + e * 57
        air.setX(2 * i, metres)
        air.setX(2 * i + 1, metres)
      }
      position.needsUpdate = age.needsUpdate = sideAttr.needsUpdate = air.needsUpdate = true
      t.geometry.setDrawRange(0, Math.max(0, t.count - 1) * 6)
    })
  })

  return (
    <>
      {trails.map((t, i) => (
        <primitive key={i} object={t.mesh} />
      ))}
    </>
  )
}
