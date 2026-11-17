import { useEffect, useState } from 'react'
import type { Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { whenBeyondHero } from '../../sim/simState'

/**
 * A model the hero itself never shows. It is not fetched until the visitor moves on from the hero, and the
 * scene does not wait for it: the result is null until it has arrived.
 */
export function useLateModel(url: string) {
  const [model, setModel] = useState<Group | null>(null)
  useEffect(() => {
    let cancelled = false
    const withdraw = whenBeyondHero(() => {
      new GLTFLoader().loadAsync(url).then(
        (gltf) => {
          if (!cancelled) setModel(gltf.scene)
        },
        () => {},
      )
    })
    return () => {
      cancelled = true
      withdraw()
    }
  }, [url])
  return model
}
