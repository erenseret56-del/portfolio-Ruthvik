import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
  type Texture,
} from 'three'
import { CAR, drive } from '../../drive/driveState'
import { stage } from './driveStage'
import { glowTexture } from './glow'
import { useLateModel } from './useLateModel'

const COUPE_URL = '/horizon/coupe.glb'
const WHEEL_URL = '/horizon/wheel.webp'
const PAINT = '#2f6fe0'

/** A soft round patch, opaque in the middle: shadows, pools of light and dust are all cut from it. */
function softDisc(colour: string, hardness = 0.25) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, colour)
  g.addColorStop(hardness, colour)
  g.addColorStop(1, 'rgb(0 0 0 / 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Part of a loaded picture as a texture of its own. */
function cut(image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(image, x, y, w, h, 0, 0, w, h)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function build(source: Group) {
  const root = new Group()
  root.matrixAutoUpdate = false
  root.visible = false
  const body = new Group()
  // a copy, so that building twice (as React does in development) cannot take the model away from the first
  const model = source.clone(true)
  body.add(model)
  root.add(body)
  const owned: { dispose: () => void }[] = []
  const own = <T extends { dispose: () => void }>(o: T) => {
    owned.push(o)
    return o
  }

  // the model comes with one flat material per texture: give it paint, glass and lamps
  const made = new Map<string, MeshStandardMaterial>()
  model.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const source = mesh.material as MeshStandardMaterial
    const key = `${source.name}|${source.map?.uuid ?? ''}`
    let material = made.get(key)
    if (!material) {
      const map = source.map
      if (map) map.anisotropy = 8
      if (source.name === 'body')
        material = new MeshPhysicalMaterial({ map, color: PAINT, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.3 })
      else if (source.name === 'glass')
        material = new MeshPhysicalMaterial({ color: '#05080b', metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.8, depthWrite: false, envMapIntensity: 1.6 })
      else if (source.name === 'lamps')
        material = new MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.3 })
      else material = new MeshStandardMaterial({ map, color: '#9a9a9a', roughness: 0.9 })
      made.set(key, own(material))
    }
    mesh.material = material
    if (source.name === 'glass') mesh.renderOrder = 2
  })

  // ---- wheels: the model has none of its own (its simulator made them), so they are turned here ----
  const rubber = own(new MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.92 }))
  const face = own(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.35, transparent: true, alphaTest: 0.06 }))
  const drum = own(new MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.8 }))
  const wheels = CAR.axles.flatMap((x, axle) =>
    [1, -1].map((side) => {
      const r = CAR.radius[axle]
      const w = CAR.width[axle]
      const tyre = own(
        new LatheGeometry(
          [
            new Vector2(r * 0.6, -w / 2 + 0.02),
            new Vector2(r - 0.045, -w / 2),
            new Vector2(r, -w / 2 + 0.04),
            new Vector2(r, w / 2 - 0.04),
            new Vector2(r - 0.045, w / 2),
            new Vector2(r * 0.6, w / 2 - 0.02),
          ],
          36,
        ),
      )
      tyre.rotateX(Math.PI / 2)
      const disc = own(new CircleGeometry(r - 0.02, 36))
      const turning = new Group()
      const outer = new Mesh(disc, face)
      outer.position.z = w / 2 - 0.012
      const back = new Mesh(disc, drum)
      back.position.z = w / 2 - 0.06
      const inner = new Mesh(disc, drum)
      inner.position.z = -w / 2 + 0.02
      inner.rotation.y = Math.PI
      turning.add(new Mesh(tyre, rubber), back, outer, inner)
      // built with its outer face toward +Z: the wheels on the left are the same wheel turned round
      const steering = new Group()
      steering.position.set(x, r, side * CAR.track[axle])
      const facing = new Group()
      facing.rotation.y = side > 0 ? 0 : Math.PI
      facing.add(turning)
      steering.add(facing)
      root.add(steering)
      return { steering, turning, side, front: axle === 0, radius: r }
    }),
  )
  let rims: Texture | null = null
  /** Dress the wheels from their picture, once it has loaded. */
  const shoe = (image: HTMLImageElement) => {
    // left half: the rim four times over, sharp and at three speeds; right half: the tread
    rims = own(cut(image, 0, 0, image.width / 2, image.height))
    rims.repeat.set(0.5, 0.5)
    rims.offset.set(0, 0.5)
    face.map = rims
    face.needsUpdate = true
    const tread = own(cut(image, image.width / 2, 0, image.width / 2, image.height))
    tread.wrapS = tread.wrapT = RepeatWrapping
    tread.repeat.set(6, 1)
    rubber.map = tread
    rubber.color.set('#8a8a8a')
    rubber.needsUpdate = true
  }

  // ---- what the car does to the road under it ----
  const flat = own(new PlaneGeometry(1, 1))
  flat.rotateX(-Math.PI / 2)
  const shade = own(new MeshBasicMaterial({ map: own(softDisc('rgb(0 0 0)', 0.45)), transparent: true, depthWrite: false, fog: false, toneMapped: false }))
  const shadow = new Mesh(flat, shade)
  shadow.scale.set(5.6, 1, 2.9)
  shadow.position.y = 0.04
  shadow.renderOrder = 1
  const beamLight = own(
    new MeshBasicMaterial({ map: own(softDisc('rgb(255 232 190)', 0.05)), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
  )
  const pool = new Mesh(flat, beamLight)
  pool.scale.set(17, 1, 8)
  pool.position.set(10.5, 0.05, 0)
  pool.renderOrder = 1
  root.add(shadow, pool)

  const glow = own(glowTexture())
  const lamp = (colour: string, x: number, y: number, z: number) => {
    const material = own(new SpriteMaterial({ map: glow, color: colour, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }))
    const sprite = new Sprite(material)
    sprite.position.set(x, y, z)
    body.add(sprite)
    return sprite
  }
  const tail = [lamp('#ff2a1a', -2.1, 0.69, 0.56), lamp('#ff2a1a', -2.1, 0.69, -0.56)]
  const head = [lamp('#fff0d2', 1.93, 0.6, 0.62), lamp('#fff0d2', 1.93, 0.6, -0.62)]

  // dust thrown up where it lands
  const dustMap = own(softDisc('rgb(214 190 160)', 0.1))
  const dust = Array.from({ length: 10 }, (_, i) => {
    const material = own(new SpriteMaterial({ map: dustMap, transparent: true, depthWrite: false, opacity: 0 }))
    const sprite = new Sprite(material)
    const angle = (i / 10) * Math.PI * 2 + (i % 2) * 0.4
    sprite.visible = false
    root.add(sprite)
    return { sprite, x: Math.cos(angle) * (1.2 + (i % 3) * 0.5), z: Math.sin(angle) * (0.9 + (i % 2) * 0.5), rate: 0.8 + (i % 4) * 0.22 }
  })

  const dispose = () => owned.forEach((o) => o.dispose())
  return { root, body, wheels, shade, shadow, beamLight, tail, head, dust, shoe, rims: () => rims, dispose }
}

/**
 * The car: a two-seat coupe in metallic blue. It is placed by the director (tied down in the hold, hanging
 * under its parachute, or standing on the road); here it is given its paint, its wheels, its lamps and the
 * way its body moves on the springs.
 */
export function DriveCar() {
  const model = useLateModel(COUPE_URL)
  const car = useMemo(() => (model ? build(model) : null), [model])
  useEffect(() => () => car?.dispose(), [car])
  useEffect(() => {
    if (!car) return
    let cancelled = false
    new TextureLoader().load(WHEEL_URL, (loaded) => {
      if (!cancelled) car.shoe(loaded.image as HTMLImageElement)
      loaded.dispose()
    })
    return () => {
      cancelled = true
    }
  }, [car])

  useFrame(() => {
    if (!car) return
    const { root, body, wheels, shade, shadow, beamLight, tail, head, dust } = car
    root.visible = drive.active
    if (!root.visible) return
    root.matrix.copy(stage.car)
    root.matrixWorldNeedsUpdate = true

    body.rotation.set(drive.roll, 0, drive.pitch, 'YZX')
    body.position.y = drive.heave
    const hanging = 1 - stage.grounded
    const pace = Math.abs(drive.speed)
    // past a certain speed the spokes are a blur: the wheel picture has frames for that
    const rims = car.rims()
    const frame = pace < 7 ? 0 : pace < 18 ? 1 : pace < 32 ? 2 : 3
    if (rims) rims.offset.set(frame % 2 ? 0.5 : 0, frame < 2 ? 0.5 : 0)
    for (const { steering, turning, side, front, radius } of wheels) {
      // with no weight on them the wheels drop to the end of their travel
      steering.position.y = radius - 0.07 * hanging - drive.heave * 0.3
      steering.rotation.y = front ? -drive.steer * 0.5 * (1 / (1 + pace / 30)) : 0
      turning.rotation.z = -side * drive.spin
    }

    shade.opacity = 0.6 * stage.grounded
    shadow.visible = stage.grounded > 0.01
    beamLight.opacity = 0.2 * stage.grounded
    for (const sprite of tail) {
      sprite.scale.setScalar(drive.braking ? 1.15 : 0.55)
      sprite.material.opacity = drive.braking ? 1 : 0.6
    }
    for (const sprite of head) sprite.scale.setScalar(0.5)

    const since = stage.touchdown
    for (const { sprite, x, z, rate } of dust) {
      const age = since * rate
      sprite.visible = since >= 0 && age < 2.2
      if (!sprite.visible) continue
      const grow = 1 - Math.exp(-age * 2.2)
      sprite.position.set(x * (1 + 2.6 * grow), 0.5 + 1.3 * grow, z * (1 + 2.6 * grow))
      sprite.scale.setScalar(1.6 + 5.5 * grow)
      sprite.material.opacity = 0.42 * Math.min(1, age * 8) * Math.max(0, 1 - age / 2.2)
    }
  }, -5)

  return car ? <primitive object={car.root} /> : null
}
