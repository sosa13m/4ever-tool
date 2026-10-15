/**
 * 4EVER AERO (secret) world: Frutiger Aero / glossy-glass optimism.
 *
 * Behind the UI: a bright sky with drifting clouds, a soft sun glare, flowing
 * light ribbons, glossy bubbles rising over green rolling hills. The UI becomes
 * liquid glass with aqua gel buttons. In the hero: two desktop-sidebar style
 * gadgets (a live analog clock and a weather card). All artwork is original.
 *
 * Decoration is aria-hidden, pointer-events none, and honours reduced motion.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import './aero.css'

function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}
const r = seeded(7007)
const BUBBLES = Array.from({ length: 16 }, () => ({
  left: Math.round(r() * 96 + 2),
  size: Math.round(18 + r() * 64),
  delay: -Math.round(r() * 300) / 10,
  duration: Math.round(180 + r() * 160) / 10,
}))
const CLOUDS = [
  { top: 8, left: 6, w: 34, d: -10 },
  { top: 15, left: 58, w: 28, d: -40 },
  { top: 32, left: 30, w: 22, d: -25 },
]

export function AeroWorld() {
  return (
    <div className="aero-glass-world" aria-hidden="true">
      <div className="ae-sky" />
      <div className="ae-sun" />
      {CLOUDS.map((cloud, i) => <i key={i} className="ae-cloud" style={{ top: `${cloud.top}%`, left: `${cloud.left}%`, width: `${cloud.w}vw`, animationDelay: `${cloud.d}s` }} />)}
      <svg className="ae-ribbons" viewBox="0 0 1600 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ae-rib-a" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#bff6ff" stopOpacity="0" /></linearGradient>
          <linearGradient id="ae-rib-b" x1="0" x2="1"><stop offset="0" stopColor="#c9ff9a" stopOpacity="0" /><stop offset=".55" stopColor="#c9ff9a" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        </defs>
        <path d="M-60 640 C 300 420 620 760 980 520 S 1500 360 1680 440" stroke="url(#ae-rib-a)" strokeWidth="46" fill="none" />
        <path d="M-60 700 C 360 520 700 820 1040 600 S 1520 460 1680 520" stroke="url(#ae-rib-b)" strokeWidth="18" fill="none" />
        <path d="M-60 600 C 280 380 640 700 960 470 S 1480 300 1680 380" stroke="url(#ae-rib-a)" strokeWidth="6" fill="none" />
      </svg>
      <svg className="ae-hills" viewBox="0 0 1600 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ae-hill-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9be86a" /><stop offset="1" stopColor="#3f9e2a" /></linearGradient>
          <linearGradient id="ae-hill-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fdc4f" /><stop offset="1" stopColor="#2c7f1d" /></linearGradient>
        </defs>
        <path d="M0 140 C 260 40 520 60 760 130 S 1240 80 1600 120 V300 H0 Z" fill="url(#ae-hill-a)" />
        <path d="M0 210 C 300 130 640 170 900 220 S 1360 170 1600 200 V300 H0 Z" fill="url(#ae-hill-b)" />
        <path d="M0 140 C 260 40 520 60 760 130 S 1240 80 1600 120" fill="none" stroke="#ffffffa6" strokeWidth="3" />
      </svg>
      <div className="ae-bubbles">
        {BUBBLES.map((b, i) => <i key={i} style={{ left: `${b.left}%`, width: b.size, height: b.size, animationDelay: `${b.delay}s`, animationDuration: `${b.duration}s` } as CSSProperties} />)}
      </div>
    </div>
  )
}

/** Desktop-sidebar gadgets: a live analog clock and a weather card. */
export function AeroGadget() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = now.getSeconds()
  const m = now.getMinutes() + s / 60
  const h = (now.getHours() % 12) + m / 60
  const label = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="ae-gadgets">
      <div className="ae-clock" role="img" aria-label={`Clock, ${label}`}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" className="ae-face" />
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1="50" y1="9" x2="50" y2={i % 3 ? 13 : 16} transform={`rotate(${i * 30} 50 50)`} className="ae-tick" />)}
          <line x1="50" y1="50" x2="50" y2="27" className="ae-hand-h" transform={`rotate(${h * 30} 50 50)`} />
          <line x1="50" y1="50" x2="50" y2="17" className="ae-hand-m" transform={`rotate(${m * 6} 50 50)`} />
          <line x1="50" y1="56" x2="50" y2="14" className="ae-hand-s" transform={`rotate(${s * 6} 50 50)`} />
          <circle cx="50" cy="50" r="3.4" className="ae-pin" />
        </svg>
      </div>
      <div className="ae-weather">
        <span className="ae-weather-icon" aria-hidden="true"><i /><b /></span>
        <strong>22°</strong>
        <span>Clear sky</span>
        <small>4EVER CITY · ONLINE</small>
      </div>
    </div>
  )
}
