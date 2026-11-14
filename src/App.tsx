import { useRef } from 'react'
import { AboutSection } from './components/about/AboutSection'
import { HeroSection } from './components/hero/HeroSection'
import { SimSection } from './components/sim/SimSection'
import { useHorizonTransition } from './components/useHorizonTransition'

function App() {
  const hero = useRef<HTMLElement>(null)
  const about = useRef<HTMLElement>(null)
  const simulator = useRef<HTMLElement>(null)
  const { view, goToAbout, goToHero, goToSim, leaveSim } = useHorizonTransition(hero, about, simulator)

  // the simulator has no page of its own behind it: it is the hero's sky, flown
  const flying = view === 'boarding' || view === 'sim' || view === 'landing'
  const aboutOnScreen = view !== 'hero' && view !== 'sim'

  return (
    <main>
      <HeroSection ref={hero} active={view === 'hero'} covered={view === 'about'} bare={flying} onExplore={goToAbout} />
      <SimSection ref={simulator} active={view === 'sim'} live={flying} onLeave={leaveSim} />
      <AboutSection ref={about} active={view === 'about'} visible={aboutOnScreen} onHome={goToHero} onNext={goToSim} />
    </main>
  )
}

export default App
