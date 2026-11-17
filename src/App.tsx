import { useRef } from 'react'
import { AboutSection } from './components/about/AboutSection'
import { DriveSection } from './components/drive/DriveSection'
import { HeroSection } from './components/hero/HeroSection'
import { SimSection } from './components/sim/SimSection'
import { useHorizonTransition } from './components/useHorizonTransition'
import './components/CloudVeil.css'

function App() {
  const hero = useRef<HTMLElement>(null)
  const about = useRef<HTMLElement>(null)
  const simulator = useRef<HTMLElement>(null)
  const ground = useRef<HTMLElement>(null)
  const veil = useRef<HTMLDivElement>(null)
  const { view, goToAbout, goToHero, goToSim, leaveSim, enterHorizon, leaveDrive } = useHorizonTransition(hero, about, simulator, ground, veil)

  // the simulator has no page of its own behind it: it is the hero's sky, flown
  const flying = view === 'boarding' || view === 'sim' || view === 'landing' || view === 'dropping'
  // and neither has the ground: it is the same scene, under the cloud
  const driving = view === 'dropping' || view === 'drive' || view === 'climbing'
  const aboutOnScreen = view !== 'hero' && view !== 'sim' && !driving
  // while the About page fills the screen (and through the take-off played on it) the sky behind can rest
  const skyHidden = view === 'about' || view === 'departing'

  return (
    <main>
      <HeroSection ref={hero} active={view === 'hero'} covered={skyHidden} bare={flying || driving} onExplore={goToAbout} />
      <SimSection ref={simulator} active={view === 'sim'} live={flying} onLeave={leaveSim} onEnter={enterHorizon} />
      <DriveSection ref={ground} active={view === 'drive'} live={driving} onLeave={leaveDrive} />
      <AboutSection ref={about} active={view === 'about'} visible={aboutOnScreen} onHome={goToHero} onNext={goToSim} />
      {/* the cloud between the airfield, the sky above it and the country below it: every move through it is covered by this */}
      <div className="cloud-veil" ref={veil} aria-hidden="true" />
    </main>
  )
}

export default App
