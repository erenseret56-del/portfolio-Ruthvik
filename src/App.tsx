import { useRef } from 'react'
import { AboutSection } from './components/about/AboutSection'
import { HeroSection } from './components/hero/HeroSection'
import { SimSection } from './components/sim/SimSection'
import { useHorizonTransition } from './components/useHorizonTransition'
import './components/CloudVeil.css'

function App() {
  const hero = useRef<HTMLElement>(null)
  const about = useRef<HTMLElement>(null)
  const simulator = useRef<HTMLElement>(null)
  const veil = useRef<HTMLDivElement>(null)
  const { view, goToAbout, goToHero, goToSim, leaveSim } = useHorizonTransition(hero, about, simulator, veil)

  // the simulator has no page of its own behind it: it is the hero's sky, flown
  const flying = view === 'boarding' || view === 'sim' || view === 'landing'
  const aboutOnScreen = view !== 'hero' && view !== 'sim'
  // while the About page fills the screen (and through the take-off played on it) the sky behind can rest
  const skyHidden = view === 'about' || view === 'departing'

  return (
    <main>
      <HeroSection ref={hero} active={view === 'hero'} covered={skyHidden} bare={flying} onExplore={goToAbout} />
      <SimSection ref={simulator} active={view === 'sim'} live={flying} onLeave={leaveSim} />
      <AboutSection ref={about} active={view === 'about'} visible={aboutOnScreen} onHome={goToHero} onNext={goToSim} />
      {/* the cloud the departing aircraft climbs through, between the airfield and the sky above it */}
      <div className="cloud-veil" ref={veil} aria-hidden="true" />
    </main>
  )
}

export default App
