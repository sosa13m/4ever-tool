/**
 * AQUA CARTOON world.
 *
 * Original cartoon deep-sea scene rendered behind the UI: surface waves, light
 * rays, rising bubbles, swaying kelp, fish, jellyfish, coral and a sandy
 * seabed. Scrolling the page "dives": the water darkens, the surface drifts
 * away and the seabed rises into view. Clicking anywhere releases bubbles.
 *
 * Pure decoration: aria-hidden, pointer-events none, honours reduced motion.
 */
import { CSSProperties, useEffect, useRef, useState } from 'react'
import './aqua.css'

type Bubble = { left: number; size: number; delay: number; duration: number; drift: number }

// Deterministic pseudo-random layout so the scene is stable between renders.
function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}

const random = seeded(2020)
const BUBBLES: Bubble[] = Array.from({ length: 26 }, () => ({
  left: Math.round(random() * 96 + 2),
  size: Math.round(8 + random() * 30),
  delay: -Math.round(random() * 18 * 10) / 10,
  duration: Math.round((9 + random() * 11) * 10) / 10,
  drift: Math.round((random() - 0.5) * 60),
}))

const KELP = [
  { left: 3, height: 46, hue: 0, delay: 0 },
  { left: 7, height: 34, hue: 1, delay: -1.2 },
  { left: 21, height: 28, hue: 0, delay: -2.1 },
  { left: 68, height: 30, hue: 1, delay: -0.6 },
  { left: 86, height: 50, hue: 0, delay: -1.7 },
  { left: 91, height: 38, hue: 1, delay: -2.6 },
  { left: 96, height: 26, hue: 0, delay: -0.3 },
]

const FISH = [
  { top: 24, size: 92, duration: 34, delay: -6, color: '#ffe735', reverse: false },
  { top: 47, size: 64, duration: 26, delay: -17, color: '#ff8a5c', reverse: true },
  { top: 63, size: 74, duration: 40, delay: -28, color: '#f47aaa', reverse: false },
  { top: 36, size: 48, duration: 22, delay: -3, color: '#7cf3ff', reverse: true },
]

const JELLY = [
  { left: 76, top: 18, size: 110, duration: 9, delay: 0 },
  { left: 12, top: 52, size: 78, duration: 11, delay: -4 },
]

const MAX_DEPTH_METERS = 404

export function AquaWorld() {
  const [depth, setDepth] = useState(0)
  const [floor, setFloor] = useState(0)
  const burstLayer = useRef<HTMLDivElement | null>(null)

  // Keep the seabed above the fixed radio bar, whatever its height (it grows on mobile).
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector('.radio-bar')
      const rect = bar?.getBoundingClientRect()
      const covered = rect && rect.height > 0 && rect.top < window.innerHeight ? Math.round(window.innerHeight - rect.top) : 0
      setFloor(previous => (previous === covered ? previous : covered))
    }
    measure()
    const timer = window.setInterval(measure, 800)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Scroll position -> dive depth (0..1).
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      setDepth(Math.min(1, Math.max(0, window.scrollY / scrollable)))
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Click / tap anywhere -> a small burst of bubbles at the pointer.
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const onPointer = (event: PointerEvent) => {
      const layer = burstLayer.current
      if (!layer || layer.childElementCount > 40) return
      for (let i = 0; i < 6; i += 1) {
        const bubble = document.createElement('i')
        const size = 6 + Math.random() * 14
        bubble.style.left = `${event.clientX + (Math.random() - 0.5) * 34}px`
        bubble.style.top = `${event.clientY + (Math.random() - 0.5) * 16}px`
        bubble.style.width = `${size}px`
        bubble.style.height = `${size}px`
        bubble.style.setProperty('--drift', `${(Math.random() - 0.5) * 50}px`)
        bubble.style.animationDelay = `${i * 40}ms`
        bubble.addEventListener('animationend', () => bubble.remove(), { once: true })
        layer.appendChild(bubble)
      }
    }
    window.addEventListener('pointerdown', onPointer, { passive: true })
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [])

  const meters = String(Math.round(4 + depth * (MAX_DEPTH_METERS - 4))).padStart(3, '0')

  return (
    <>
      <div className="aqua-world" aria-hidden="true" style={{ '--depth': depth, '--aq-floor': `${floor}px` } as CSSProperties}>
        <div className="aq-deep-shade" />

        <div className="aq-surface">
          <svg className="aq-wave aq-wave-back" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d="M0 60 C 180 20 360 100 540 60 S 900 20 1080 60 S 1440 100 1440 60 V0 H0 Z" /></svg>
          <svg className="aq-wave aq-wave-front" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d="M0 50 C 160 90 320 10 480 50 S 800 90 960 50 S 1280 10 1440 50 V0 H0 Z" /></svg>
        </div>

        <div className="aq-rays">
          <i style={{ left: '8%' }} /><i style={{ left: '27%' }} /><i style={{ left: '49%' }} /><i style={{ left: '66%' }} /><i style={{ left: '84%' }} />
        </div>
        <div className="aq-caustics" />

        <div className="aq-bubbles">
          {BUBBLES.map((bubble, index) => (
            <i key={index} style={{ left: `${bubble.left}%`, width: bubble.size, height: bubble.size, animationDelay: `${bubble.delay}s`, animationDuration: `${bubble.duration}s`, '--drift': `${bubble.drift}px` } as CSSProperties} />
          ))}
        </div>

        {JELLY.map((jelly, index) => (
          <div key={index} className="aq-jelly" style={{ left: `${jelly.left}%`, top: `${jelly.top}%`, width: jelly.size, animationDuration: `${jelly.duration}s`, animationDelay: `${jelly.delay}s` }}>
            <svg viewBox="0 0 100 140">
              <path className="aq-jelly-tentacle" d="M30 58 C 24 80 38 96 30 120" />
              <path className="aq-jelly-tentacle t2" d="M44 60 C 52 84 38 102 46 132" />
              <path className="aq-jelly-tentacle" d="M58 60 C 50 82 64 98 56 126" />
              <path className="aq-jelly-tentacle t2" d="M71 58 C 78 78 66 94 74 116" />
              <path className="aq-jelly-bell" d="M10 60 C 10 22 32 6 50 6 C 68 6 90 22 90 60 C 82 54 76 64 68 58 C 60 66 54 56 50 62 C 44 56 38 66 31 58 C 24 64 17 54 10 60 Z" />
              <ellipse className="aq-jelly-shine" cx="34" cy="26" rx="10" ry="6" transform="rotate(-25 34 26)" />
            </svg>
          </div>
        ))}

        {FISH.map((fish, index) => (
          <div key={index} className={`aq-fish ${fish.reverse ? 'reverse' : ''}`} style={{ top: `${fish.top}%`, width: fish.size, animationDuration: `${fish.duration}s`, animationDelay: `${fish.delay}s` }}>
            <svg viewBox="0 0 120 70" style={{ '--fish': fish.color } as CSSProperties}>
              <path className="aq-fish-tail" d="M26 35 L4 14 Q10 35 4 56 Z" />
              <path className="aq-fish-body" d="M22 35 C 40 4 88 2 112 35 C 88 68 40 66 22 35 Z" />
              <path className="aq-fish-fin" d="M58 16 Q66 2 80 12 Q70 14 66 22 Z" />
              <path className="aq-fish-stripe" d="M62 12 Q54 35 62 58" />
              <circle className="aq-fish-eye" cx="92" cy="30" r="8" />
              <circle className="aq-fish-pupil" cx="94" cy="30" r="3.6" />
            </svg>
          </div>
        ))}

        <div className="aq-seabed">
          {KELP.map((kelp, index) => (
            <svg key={index} className={`aq-kelp hue-${kelp.hue}`} viewBox="0 0 40 200" preserveAspectRatio="none" style={{ left: `${kelp.left}%`, height: `${kelp.height}vh`, animationDelay: `${kelp.delay}s` }}>
              <path d="M20 200 C 6 170 34 150 18 120 C 4 92 34 74 20 46 C 10 26 24 10 20 0 C 30 12 32 30 28 48 C 42 76 14 94 28 122 C 42 150 16 172 26 200 Z" />
            </svg>
          ))}
          <svg className="aq-coral aq-coral-a" viewBox="0 0 160 140"><path d="M70 140 C 72 110 60 96 40 84 C 24 74 18 52 30 46 C 42 40 48 58 56 70 C 60 50 52 30 64 22 C 78 14 84 34 80 56 C 92 40 104 24 118 30 C 132 36 120 58 104 72 C 94 82 90 108 92 140 Z" /></svg>
          <svg className="aq-coral aq-coral-b" viewBox="0 0 120 110"><path d="M20 110 C 14 84 6 70 12 56 C 18 42 34 50 34 64 C 38 44 44 26 58 26 C 72 26 70 46 66 60 C 76 46 92 40 100 50 C 110 62 96 78 84 86 C 78 94 80 102 82 110 Z" /></svg>
          <div className="aq-crate"><b>4E</b><span>4EVER · FRAGILE · BASS</span></div>
          <div className="aq-shell" />
          <svg className="aq-sand" viewBox="0 0 1440 160" preserveAspectRatio="none">
            <path className="aq-sand-back" d="M0 70 C 200 30 380 90 600 60 S 1000 20 1200 56 S 1400 80 1440 64 V160 H0 Z" />
            <path className="aq-sand-front" d="M0 104 C 240 76 420 124 700 100 S 1120 74 1440 100 V160 H0 Z" />
            <circle className="aq-pebble" cx="180" cy="122" r="7" /><circle className="aq-pebble" cx="198" cy="128" r="4" />
            <circle className="aq-pebble" cx="980" cy="118" r="6" /><circle className="aq-pebble" cx="1310" cy="126" r="8" />
          </svg>
        </div>

        <div className="aq-buoy"><b>SGP</b><span>DIVE ZONE · KEEP BREATHING</span></div>
        <div className="aq-sonar"><i /><i /><i /><span>SONAR<br /><b>4EVER SIGNAL</b></span></div>
        <div className="aq-gauge">
          <span>DEPTH</span>
          <div className="aq-gauge-track"><i style={{ top: `${depth * 100}%` }} /></div>
          <b>{meters} M</b>
        </div>
      </div>
      <div className="aq-burst-layer" ref={burstLayer} aria-hidden="true" />
    </>
  )
}
