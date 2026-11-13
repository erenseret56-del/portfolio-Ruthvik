import { Canvas, useLoader } from '@react-three/fiber'
import { Suspense } from 'react'
import { TextureLoader } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { AIRCRAFT_URL } from './Aircraft'
import { ENV_URL, HeroScene } from './HeroScene'
import { SKY_URL } from './useSkyTexture'

useLoader.preload(TextureLoader, SKY_URL)
useLoader.preload(HDRLoader, ENV_URL)
useLoader.preload(GLTFLoader, AIRCRAFT_URL)

interface HeroCanvasProps {
  /** render one still frame instead of animating */
  still: boolean
  /** pause the render loop (nothing of the sky can be seen) */
  paused: boolean
  onReady: () => void
}

/** The WebGL layer. Loaded as its own chunk so three.js never blocks the page shell. */
export default function HeroCanvas({ still, paused, onReady }: HeroCanvasProps) {
  return (
    <Canvas
      className="hero__canvas"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 2, far: 6000, position: [0, 0, 0] }}
      frameloop={still ? 'demand' : paused ? 'never' : 'always'}
    >
      <Suspense fallback={null}>
        <HeroScene onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}
