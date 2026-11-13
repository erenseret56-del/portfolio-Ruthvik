import { useRef } from 'react'
import { AboutSection } from './components/about/AboutSection'
import { HeroSection } from './components/hero/HeroSection'
import { useHorizonTransition } from './components/useHorizonTransition'

function App() {
  const hero = useRef<HTMLElement>(null)
  const glow = useRef<HTMLDivElement>(null)
  const about = useRef<HTMLElement>(null)
  const { view, goToAbout, goToHero } = useHorizonTransition(hero, glow, about)

  return (
    <main>
      <HeroSection ref={hero} active={view === 'hero'} covered={view === 'about'} onExplore={goToAbout} />
      <div className="horizon-glow" ref={glow} aria-hidden="true" />
      <AboutSection ref={about} active={view === 'about'} visible={view !== 'hero'} onHome={goToHero} />
    </main>
  )
}

export default App
