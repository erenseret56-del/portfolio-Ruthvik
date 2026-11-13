import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, TorusGeometry, Vector3 } from 'three'
import { SIM, sim, WAYPOINTS } from '../../sim/simState'

const BEAM_BASE = -70
const BEAM_HEIGHT = 950
/** labels sit this far above the ring */
const LABEL_LIFT = 92

const beamVertex = /* glsl */ `
uniform vec3 uBase;
uniform float uHeight;
varying vec2 vUv;
void main() {
  vUv = uv;
  // upright sheet that always turns to face the camera, never thinner than a couple of pixels
  vec3 toCam = cameraPosition - uBase;
  toCam.y = 0.0;
  float dist = length(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float width = max(46.0, dist * 0.007);
  vec3 p = uBase + vec3(0.0, uv.y * uHeight, 0.0) + right * (uv.x - 0.5) * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`
const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float across = exp(-x * x * 26.0) + exp(-x * x * 4.0) * 0.22;
  float along = smoothstep(0.0, 0.07, vUv.y) * pow(1.0 - vUv.y, 1.7);
  gl_FragColor = vec4(uColor * across * along * uOpacity, 1.0);
}
`

/**
 * The three destinations: a thin ring to fly through and a shaft of light that marks it from far away.
 * Also reports where each one falls on screen, which is what the HTML labels follow.
 */
export function SimBeacons() {
  const { root, beacons, dispose } = useMemo(() => {
    const root = new Group()
    root.visible = false
    const sheet = new PlaneGeometry(1, 1)
    sheet.translate(0, 0.5, 0)
    const ring = new TorusGeometry(SIM.ringRadius, 1.15, 10, 120)
    const halo = new TorusGeometry(SIM.ringRadius, 5.5, 10, 120)
    const materials: { dispose: () => void }[] = []
    const beacons = WAYPOINTS.map((waypoint) => {
      const beam = new ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: {
          uBase: { value: new Vector3() },
          uHeight: { value: BEAM_HEIGHT },
          uColor: { value: new Color('#ffd9a8') },
          uOpacity: { value: 0 },
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      })
      const solid = new MeshBasicMaterial({ color: '#fff0dc', transparent: true, toneMapped: false, fog: false })
      const soft = new MeshBasicMaterial({
        color: '#ffc98a',
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      })
      materials.push(beam, solid, soft)

      const shaft = new Mesh(sheet, beam)
      shaft.frustumCulled = false
      shaft.renderOrder = 3
      // the ring stands across the line from the start, so the first approach flies straight through it
      const gate = new Group()
      gate.rotation.y = Math.atan2(waypoint.x, waypoint.z)
      gate.add(new Mesh(ring, solid), new Mesh(halo, soft))
      root.add(shaft, gate)
      return { waypoint, beam, solid, soft, gate }
    })
    const dispose = () => {
      sheet.dispose()
      ring.dispose()
      halo.dispose()
      materials.forEach((m) => m.dispose())
    }
    return { root, beacons, dispose }
  }, [])

  useEffect(() => dispose, [dispose])

  const point = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }) => {
    root.visible = sim.active
    if (!sim.active) return
    const t = performance.now() / 1000
    for (const { waypoint, beam, solid, soft, gate } of beacons) {
      const dx = waypoint.x - sim.x
      const dz = waypoint.z - sim.z
      const distance = Math.hypot(dx, dz)
      const here = sim.autopilot?.mode === 'orbit' && sim.autopilot.id === waypoint.id
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.6 + waypoint.x)

      beam.uniforms.uBase.value.set(dx, BEAM_BASE, dz)
      // brighter from far away, where it has to carry; gentler once you are beside it
      beam.uniforms.uOpacity.value = (0.5 + 0.5 * Math.min(1, distance / 900)) * pulse * (here ? 0.55 : 1)
      gate.position.set(dx, SIM.ringAlt, dz)
      // a wire this thin would shimmer at range, so the ring only resolves as you close in
      const near = 1 - Math.min(1, Math.max(0, (distance - 500) / 500))
      solid.opacity = near
      soft.opacity = near * 0.16 * pulse
      gate.visible = near > 0.01

      // screen position of the label, or the side it lies off toward
      const toward = Math.atan2(dx, -dz) - sim.viewYaw
      const bearing = Math.atan2(Math.sin(toward), Math.cos(toward))
      point.set(dx, SIM.ringAlt + SIM.ringRadius + LABEL_LIFT, dz).project(camera)
      // close in, the label would climb out of the top of the frame: hold it at the edge instead
      const onScreen = Math.abs(bearing) < Math.PI / 2 && Math.abs(point.x) < 0.9
      sim.marks[waypoint.id] = {
        x: (point.x * 0.5 + 0.5) * size.width,
        y: (0.5 - Math.min(0.74, Math.max(-0.6, point.y)) * 0.5) * size.height,
        side: onScreen ? 0 : bearing < 0 ? -1 : 1,
        distance,
      }
    }
  })

  return <primitive object={root} />
}
