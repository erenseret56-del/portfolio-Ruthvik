import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { flight } from '../flightState'
import { drive, SITES, TREE_CELL, treesIn } from '../../drive/driveState'
import { beamFragment, beamVertex, groundFragment, groundVertex, hillsFragment, hillsVertex } from './driveShaders'
import { stage } from './driveStage'
import { skyUniforms } from './skyUniforms'
import { SUN_DIR } from './vectors'

/** trees are planted this far out from the camera's subject, and replanted once it has moved on this far */
const TREE_RANGE = 620
const REPLANT = 40
const MAX_TREES = 2200
const GATE_HALF = 6.4
const GATE_HEIGHT = 7.4
const BEAM_HEIGHT = 420

/** Paint a geometry one colour, darker toward the ground, and drop its index so pieces can be merged. */
function tinted(geometry: BufferGeometry, top: string, bottom: string, low: number, high: number) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (g !== geometry) geometry.dispose()
  const position = g.getAttribute('position')
  const colours = new Float32Array(position.count * 3)
  const a = new Color(bottom)
  const b = new Color(top)
  const c = new Color()
  for (let i = 0; i < position.count; i++) {
    c.copy(a).lerp(b, Math.min(1, Math.max(0, (position.getY(i) - low) / (high - low))))
    c.toArray(colours, i * 3)
  }
  g.setAttribute('color', new BufferAttribute(colours, 3))
  g.deleteAttribute('uv')
  return g
}

/** Both kinds of tree, one unit tall, standing on y = 0. */
function treeGeometries() {
  // dusk trees: dark, with only their tops and sunward sides picking up colour
  const cone = (radius: number, height: number, y: number) => tinted(new ConeGeometry(radius, height, 9).translate(0, y, 0), '#2c4a22', '#0e1c11', 0.15, 1)
  const conifer = mergeGeometries([
    tinted(new CylinderGeometry(0.025, 0.04, 0.2, 5).translate(0, 0.1, 0), '#33261a', '#1c140e', 0, 0.2),
    cone(0.23, 0.3, 0.29),
    cone(0.2, 0.28, 0.43),
    cone(0.165, 0.26, 0.57),
    cone(0.125, 0.24, 0.71),
    cone(0.08, 0.24, 0.86),
  ])
  const blob = (radius: number, x: number, y: number, z: number) => {
    const g = new IcosahedronGeometry(radius, 2)
    // lumpy, not a ball
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.16 * Math.sin(p.getX(i) * 23 + p.getY(i) * 17) * Math.cos(p.getZ(i) * 19 + p.getY(i) * 7)
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k)
    }
    g.computeVertexNormals()
    return tinted(g.translate(x, y, z), '#4f6a2a', '#1a2a12', 0.3, 1)
  }
  const broadleaf = mergeGeometries([
    tinted(new CylinderGeometry(0.035, 0.055, 0.45, 5).translate(0, 0.22, 0), '#4f3a26', '#2a1d14', 0, 0.45),
    blob(0.3, 0, 0.66, 0),
    blob(0.2, 0.2, 0.52, 0.06),
    blob(0.19, -0.17, 0.55, -0.1),
  ])
  return [conifer, broadleaf]
}

function softShadow() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgb(0 0 0 / 1)')
  g.addColorStop(0.35, 'rgb(0 0 0 / 0.75)')
  g.addColorStop(1, 'rgb(0 0 0 / 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

/**
 * The ground the car is delivered to and driven over: farmland and roads painted on one sheet, hills on the
 * skyline, trees that are planted around wherever the action is, and a lit gateway at each of the places.
 * It also reports where each gateway falls on screen, which is what their HTML labels follow.
 */
export function DriveWorld() {
  const world = useMemo(() => {
    const root = new Group()
    root.visible = false
    const owned: { dispose: () => void }[] = []
    const own = <T extends { dispose: () => void }>(o: T) => {
      owned.push(o)
      return o
    }
    const sky = { uSky: skyUniforms.uSky, uCrop: skyUniforms.uCrop, uSunDir: { value: SUN_DIR } }

    const ground = own(
      new ShaderMaterial({
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        uniforms: { ...sky, uOrigin: { value: [0, 0] }, uTime: { value: 0 } },
      }),
    )
    const sheet = new Mesh(own(new PlaneGeometry(22000, 22000).rotateX(-Math.PI / 2)), ground)
    sheet.frustumCulled = false
    root.add(sheet)

    const band = own(new CylinderGeometry(1, 1, 1, 220, 1, true))
    for (const [radius, height, seed, tint, haze] of [
      [7200, 760, 0.6, '#3a3550', 0.62],
      [5200, 330, 2.9, '#2b2a3a', 0.4],
    ] as const) {
      const material = own(
        new ShaderMaterial({
          vertexShader: hillsVertex,
          fragmentShader: hillsFragment,
          uniforms: { ...sky, uRadius: { value: radius }, uHeight: { value: height }, uSeed: { value: seed }, uTint: { value: new Color(tint) }, uHaze: { value: haze } },
          side: DoubleSide,
        }),
      )
      const hills = new Mesh(band, material)
      hills.frustumCulled = false
      root.add(hills)
    }

    // trees, and the long shadows they lay away from the low sun
    const wood = own(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
    const forest = new Group()
    const kinds = treeGeometries().map((geometry) => {
      const mesh = new InstancedMesh(own(geometry), wood, MAX_TREES)
      mesh.frustumCulled = false
      mesh.count = 0
      forest.add(mesh)
      return mesh
    })
    const shadowSheet = own(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.42))
    const shadowPaint = own(new MeshBasicMaterial({ map: own(softShadow()), transparent: true, opacity: 0.5, depthWrite: false, fog: false, toneMapped: false }))
    const shadows = new InstancedMesh(shadowSheet, shadowPaint, MAX_TREES * 2)
    shadows.frustumCulled = false
    shadows.count = 0
    shadows.renderOrder = 1
    forest.add(shadows)
    root.add(forest)

    // a gateway across the road at each place, and a shaft of light that marks it from far away
    const steel = own(new MeshStandardMaterial({ color: '#16181d', roughness: 0.45, metalness: 0.7 }))
    const lit = own(new MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false, fog: false }))
    const post = own(new BoxGeometry(0.6, GATE_HEIGHT, 0.6))
    const lintel = own(new BoxGeometry(0.6, 0.75, GATE_HALF * 2 + 0.6))
    const strip = own(new BoxGeometry(0.14, 0.14, GATE_HALF * 2 - 0.4))
    const stripe = own(new BoxGeometry(0.14, GATE_HEIGHT - 1, 0.14))
    const padGeometry = own(new CircleGeometry(GATE_HALF * 1.5, 48).rotateX(-Math.PI / 2))
    const beamSheet = own(new PlaneGeometry(1, 1).translate(0, 0.5, 0))
    const gates = SITES.map((site) => {
      const gate = new Group()
      gate.rotation.y = Math.PI / 2 - site.heading
      for (const side of [1, -1]) {
        const pillar = new Mesh(post, steel)
        pillar.position.set(0, GATE_HEIGHT / 2, side * GATE_HALF)
        const glow = new Mesh(stripe, lit)
        glow.position.set(-0.34, GATE_HEIGHT / 2, side * GATE_HALF)
        const glowBack = glow.clone()
        glowBack.position.x = 0.34
        gate.add(pillar, glow, glowBack)
      }
      const top = new Mesh(lintel, steel)
      top.position.y = GATE_HEIGHT + 0.37
      const under = new Mesh(strip, lit)
      under.position.y = GATE_HEIGHT - 0.08
      const pad = new Mesh(
        padGeometry,
        own(new MeshBasicMaterial({ map: shadowPaint.map, color: '#ffc98a', transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })),
      )
      pad.position.y = 0.06
      pad.renderOrder = 1
      gate.add(top, under, pad)
      const beam = own(
        new ShaderMaterial({
          vertexShader: beamVertex,
          fragmentShader: beamFragment,
          uniforms: { uBase: { value: new Vector3() }, uHeight: { value: BEAM_HEIGHT }, uColor: { value: new Color('#ffd9a8') }, uOpacity: { value: 0 } },
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        }),
      )
      const shaft = new Mesh(beamSheet, beam)
      shaft.frustumCulled = false
      shaft.renderOrder = 3
      root.add(gate, shaft)
      return { site, gate, beam }
    })

    return { root, ground, forest, kinds, shadows, gates, dispose: () => owned.forEach((o) => o.dispose()) }
  }, [])
  useEffect(() => world.dispose, [world])

  const planted = useMemo(() => ({ x: Infinity, z: Infinity }), [])
  const scratch = useMemo(
    () => ({ matrix: new Matrix4(), at: new Vector3(), turn: new Quaternion(), size: new Vector3(), up: new Vector3(0, 1, 0), point: new Vector3() }),
    [],
  )

  useFrame(({ camera, size }) => {
    const { root, ground, forest, kinds, shadows, gates } = world
    root.visible = drive.active
    if (!drive.active) {
      planted.x = Infinity
      return
    }
    const { x: ox, z: oz } = stage.origin
    const origin = ground.uniforms.uOrigin.value as number[]
    origin[0] = ox
    origin[1] = oz
    ground.uniforms.uTime.value = flight.time

    // ---- trees: plant the ground around the action, and again whenever it has moved on ----
    if (Math.hypot(ox - planted.x, oz - planted.z) > REPLANT) {
      planted.x = ox
      planted.z = oz
      const { matrix, at, turn, size: scale, up } = scratch
      const counts = [0, 0]
      let shade = 0
      const away = Math.atan2(-SUN_DIR.x, -SUN_DIR.z)
      const reach = Math.ceil(TREE_RANGE / TREE_CELL)
      const cx = Math.floor(ox / TREE_CELL)
      const cz = Math.floor(oz / TREE_CELL)
      for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
          for (const tree of treesIn(cx + i, cz + j)) {
            const distance = Math.hypot(tree.x - ox, tree.z - oz)
            // the furthest ones are still growing: nothing appears or vanishes at full size
            const grown = Math.min(1, (TREE_RANGE - distance) / 90)
            if (grown <= 0 || counts[tree.kind] >= MAX_TREES) continue
            const height = tree.height * grown * (tree.kind ? 0.72 : 1)
            at.set(tree.x - ox, 0, tree.z - oz)
            turn.setFromAxisAngle(up, tree.x * 12.9898 + tree.z * 4.1414)
            kinds[tree.kind].setMatrixAt(counts[tree.kind]++, matrix.compose(at, turn, scale.setScalar(height)))
            turn.setFromAxisAngle(up, away)
            at.y = 0.05
            shadows.setMatrixAt(shade++, matrix.compose(at, turn, scale.set(height * (tree.kind ? 0.75 : 0.5), 1, height * 2.6)))
          }
        }
      }
      kinds.forEach((mesh, k) => {
        mesh.count = counts[k]
        mesh.instanceMatrix.needsUpdate = true
      })
      shadows.count = shade
      shadows.instanceMatrix.needsUpdate = true
    }
    forest.position.set(planted.x - ox, 0, planted.z - oz)

    // ---- gateways, and where their labels go ----
    const t = flight.time
    for (const { site, gate, beam } of gates) {
      const dx = site.x - ox
      const dz = site.z - oz
      gate.position.set(dx, 0, dz)
      const carDistance = Math.hypot(site.x - drive.x, site.z - drive.z)
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.6 + site.x)
      beam.uniforms.uBase.value.set(dx, 0, dz)
      // brighter from far away, where it has to carry; gentler once you are beside it
      beam.uniforms.uOpacity.value = (0.3 + 0.55 * Math.min(1, carDistance / 500)) * pulse

      const toward = Math.atan2(dx - camera.position.x, -(dz - camera.position.z)) - drive.viewYaw
      const bearing = Math.atan2(Math.sin(toward), Math.cos(toward))
      const point = scratch.point.set(dx, GATE_HEIGHT + 4.5, dz).project(camera)
      const onScreen = Math.abs(bearing) < Math.PI / 2 && Math.abs(point.x) < 0.9
      drive.marks[site.id] = {
        x: (point.x * 0.5 + 0.5) * size.width,
        y: (0.5 - Math.min(0.74, Math.max(-0.6, point.y)) * 0.5) * size.height,
        side: onScreen ? 0 : bearing < 0 ? -1 : 1,
        distance: carDistance,
      }
    }
  })

  return <primitive object={world.root} />
}
