import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { DoubleSide, PlaneGeometry, ShaderMaterial } from 'three'
import { AIR_SPEED, flight } from '../flightState'
import { sim } from '../../sim/simState'
import { contrailFragment, contrailVertex } from './shaders'
import { HEADING, trailOrigins } from './vectors'

const TRAIL_LENGTH = 1900

/**
 * One vapour ribbon per engine. The geometry stays pinned to the exhausts while its noise is
 * anchored to the air mass, so the trail visibly streams backwards, spreads and breaks up.
 */
export function Contrail() {
  const geometry = useMemo(() => new PlaneGeometry(1, 1, 140, 1), [])
  const materials = useMemo(
    () =>
      trailOrigins.map(
        (origin, i) =>
          new ShaderMaterial({
            vertexShader: contrailVertex,
            fragmentShader: contrailFragment,
            uniforms: {
              uOrigin: { value: origin },
              uDir: { value: HEADING.clone().negate() },
              uLength: { value: TRAIL_LENGTH },
              uSpeed: { value: AIR_SPEED },
              // the far engine's trail is nudged up so the pair reads as two lines before merging
              uLift: { value: i === 0 ? 0 : 3.2 },
              uSeed: { value: i * 7.3 },
              uTime: { value: 0 },
              uTravel: { value: 0 },
              uFade: { value: 1 },
              uOpacity: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
          }),
      ),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      materials.forEach((m) => m.dispose())
    },
    [geometry, materials],
  )

  useFrame(() => {
    for (const { uniforms } of materials) {
      uniforms.uTime.value = flight.time
      uniforms.uTravel.value = flight.travel
      uniforms.uFade.value = flight.trailFade
      // the simulator draws its own trail, one that can curve
      uniforms.uOpacity.value = sim.active ? 0 : flight.trailOpacity
    }
  })

  return (
    <>
      {materials.map((material, i) => (
        <mesh key={i} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
      ))}
    </>
  )
}
