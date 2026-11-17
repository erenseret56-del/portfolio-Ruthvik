import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  Vector3,
} from 'three'
import { drive } from '../../drive/driveState'
import { stage, type Canopy } from './driveStage'

const GORES = 24
const LINES = 12
/** where the four straps of the main parachute are made fast, in the car's own frame */
const HARD_POINTS: [number, number, number][] = [
  [1.45, 0.78, 0.72],
  [1.45, 0.78, -0.72],
  [-1.5, 0.85, 0.7],
  [-1.5, 0.85, -0.7],
]

/** A round canopy of unit radius, mouth on y = 0, sewn from gores that belly out between their seams. */
function canopyGeometry(colours: string[]) {
  const profile: Vector2[] = []
  for (let i = 0; i <= 12; i++) {
    const phi = 0.07 + (i / 12) * (Math.PI / 2 - 0.07)
    profile.push(new Vector2(Math.sin(phi), 0.72 * Math.cos(phi)))
  }
  const lathe = new LatheGeometry(profile, GORES * 2)
  const position = lathe.getAttribute('position') as BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const r = Math.hypot(x, z)
    const belly = 1 + 0.055 * Math.abs(Math.sin((GORES / 2) * Math.atan2(z, x))) * r * r
    position.setXYZ(i, x * belly, position.getY(i), z * belly)
  }
  lathe.computeVertexNormals()
  // unshared corners, so each gore can be a single flat colour
  const geometry = lathe.toNonIndexed()
  lathe.dispose()
  const p = geometry.getAttribute('position') as BufferAttribute
  const colour = new Float32Array(p.count * 3)
  const palette = colours.map((c) => new Color(c))
  for (let f = 0; f < p.count; f += 3) {
    const cx = p.getX(f) + p.getX(f + 1) + p.getX(f + 2)
    const cz = p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)
    const gore = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (2 * Math.PI)) * GORES) % GORES
    const c = palette[gore % palette.length]
    for (let k = 0; k < 3; k++) c.toArray(colour, (f + k) * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colour, 3))
  return geometry
}

function parachute(radius: number, colours: string[], straps: boolean) {
  const geometry = canopyGeometry(colours)
  const cloth = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.8, transparent: true, emissive: '#2a140a' })
  const dome = new Mesh(geometry, cloth)
  dome.frustumCulled = false
  const segments = LINES + (straps ? HARD_POINTS.length : 0)
  const rigging = new BufferGeometry()
  const points = new BufferAttribute(new Float32Array(segments * 6), 3)
  points.setUsage(DynamicDrawUsage)
  rigging.setAttribute('position', points)
  const cord = new LineBasicMaterial({ color: '#191715', transparent: true })
  const lines = new LineSegments(rigging, cord)
  lines.frustumCulled = false
  const group = new Group()
  group.add(dome, lines)
  return { group, dome, lines, points, cloth, cord, radius, straps, dispose: () => [geometry, cloth, rigging, cord].forEach((d) => d.dispose()) }
}

const UP = new Vector3(0, 1, 0)

/**
 * The two parachutes of the delivery: the small one that drags the car out of the hold, and the large one it
 * comes down under. Where they are and how full is decided by the director; this draws cloth and lines.
 */
export function Parachutes() {
  const { root, chutes, dispose } = useMemo(() => {
    const root = new Group()
    const chutes = [
      { state: stage.drogue, ...parachute(1.15, ['#efe6d4'], false) },
      { state: stage.main, ...parachute(7.8, ['#e2552b', '#f0e5d0'], true) },
    ]
    chutes.forEach((c) => root.add(c.group))
    return { root, chutes, dispose: () => chutes.forEach((c) => c.dispose()) }
  }, [])
  useEffect(() => dispose, [dispose])

  const scratch = useMemo(() => ({ u: new Vector3(), v: new Vector3(), rim: new Vector3(), hard: new Vector3() }), [])

  useFrame(() => {
    for (const { state, group, dome, lines, points, cloth, cord, radius, straps } of chutes) {
      const c: Canopy = state
      group.visible = drive.active && c.visible && c.opacity > 0.01
      if (!group.visible) continue
      const spread = radius * (0.1 + 0.9 * c.filled)
      dome.position.copy(c.mouth)
      dome.quaternion.setFromUnitVectors(UP, c.axis)
      dome.scale.set(spread, radius * (1.55 - 0.55 * c.filled), spread)
      cloth.opacity = c.opacity

      lines.visible = c.rigged
      cord.opacity = c.opacity * 0.85
      if (!c.rigged) continue
      // two directions across the mouth of the canopy
      const { u, v, rim, hard } = scratch
      u.crossVectors(c.axis, Math.abs(c.axis.y) > 0.9 ? v.set(1, 0, 0) : v.set(0, 1, 0)).normalize()
      v.crossVectors(c.axis, u)
      let n = 0
      for (let i = 0; i < LINES; i++) {
        const a = (i / LINES) * Math.PI * 2
        rim.copy(c.mouth).addScaledVector(u, Math.cos(a) * spread).addScaledVector(v, Math.sin(a) * spread)
        points.setXYZ(n++, rim.x, rim.y, rim.z)
        points.setXYZ(n++, c.confluence.x, c.confluence.y, c.confluence.z)
      }
      if (straps) {
        for (const at of HARD_POINTS) {
          hard.set(...at).applyMatrix4(stage.car)
          points.setXYZ(n++, c.confluence.x, c.confluence.y, c.confluence.z)
          points.setXYZ(n++, hard.x, hard.y, hard.z)
        }
      }
      points.needsUpdate = true
    }
  })

  return <primitive object={root} />
}
