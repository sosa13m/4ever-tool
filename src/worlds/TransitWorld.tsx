/**
 * LINEA 4 EVER world: subway graffiti.
 *
 * Behind the UI: a night station with dark tiles bombed with tags (the crew's
 * own names), chrome throw-ups, and a train pulling in with a full 4EVER piece
 * painted below the windows. The platform edge stays. In the hero: the
 * split-flap departures board, whose rows are real shortcuts to the tools.
 * All lettering and artwork are original.
 *
 * Decoration is aria-hidden, pointer-events none, and honours reduced motion.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import './transit.css'

function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}

const TAG_WORDS = ['4EVER', 'cinho', 'rani', 'mella', '1000blunts', 'chupalito', 'mundane', 'maxoxo', 'hueviti', 'moneynlust', '2012', 'L4E', 'ALL CITY', 'anderrated', 'NO SLEEP', '4E']
const TAG_COLORS = ['#ffffff', '#c9b3ff', '#d4ff3a', '#ff5fb8', '#ffffff', '#9ee7ff', '#e6e6e6']
const r = seeded(4444)
// Tags live in the side margins so they never sit under the headline or text.
const TAGS = TAG_WORDS.map((word, i) => ({
  word,
  x: Math.round(i % 2 ? 80 + r() * 13 : 1 + r() * 13),
  y: Math.round(9 + Math.floor(i / 2) * 7 + r() * 3),
  size: Math.round(20 + r() * 22),
  rot: Math.round((r() - 0.5) * 22),
  color: TAG_COLORS[i % TAG_COLORS.length],
  drip: r() < 0.45,
}))

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/** One subway car, side view, with the 4EVER piece under the windows. */
function TrainCar({ x, piece }: { x: number; piece: boolean }) {
  const windows = [40, 140, 330, 430, 620, 720]
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="0" y="20" width="860" height="250" rx="22" fill="url(#l4-steel)" stroke="#0a0a0d" strokeWidth="4" />
      {Array.from({ length: 42 }, (_, i) => <rect key={i} x={12 + i * 20} y="150" width="2" height="112" fill="#00000026" />)}
      <rect x="0" y="134" width="860" height="8" fill="#5a2bd6" />
      {windows.map(wx => <rect key={wx} x={wx} y="46" width="78" height="66" rx="8" fill="#141220" stroke="#0a0a0d" strokeWidth="3" />)}
      {windows.map(wx => <rect key={`g${wx}`} x={wx + 8} y="52" width="22" height="54" rx="4" fill="#ffffff14" />)}
      {[238, 528].map(dx => <g key={dx}><rect x={dx} y="38" width="72" height="226" rx="6" fill="#9a9aa6" stroke="#0a0a0d" strokeWidth="3" /><line x1={dx + 36} y1="40" x2={dx + 36} y2="262" stroke="#0a0a0d" strokeWidth="3" /><rect x={dx + 10} y="52" width="20" height="60" rx="4" fill="#141220" /><rect x={dx + 42} y="52" width="20" height="60" rx="4" fill="#141220" /></g>)}
      <circle cx="806" cy="78" r="26" fill="#5a2bd6" stroke="#fff" strokeWidth="5" />
      <text x="806" y="90" textAnchor="middle" className="l4-car-number">4</text>
      {piece && (
        <g className="l4-piece">
          <text x="430" y="252" textAnchor="middle" className="l4-piece-shadow">4EVER</text>
          <text x="424" y="246" textAnchor="middle" className="l4-piece-fill">4EVER</text>
          <text x="424" y="246" textAnchor="middle" className="l4-piece-shine">4EVER</text>
          {[150, 248, 333, 452, 560, 676].map((dx, i) => <rect key={dx} x={dx} y="244" width="5" height={10 + (i % 3) * 7} rx="2.5" fill="#b18cff" />)}
          <text x="96" y="214" className="l4-piece-tag">L4E</text>
          <text x="700" y="232" className="l4-piece-tag">all city</text>
        </g>
      )}
      <rect x="20" y="270" width="820" height="16" fill="#0a0a0d" />
      {[90, 210, 650, 770].map(wx => <circle key={wx} cx={wx} cy="290" r="18" fill="#1b1b22" stroke="#0a0a0d" strokeWidth="4" />)}
    </g>
  )
}

export function TransitWorld() {
  const reduced = useReducedMotion()
  return (
    <div className="transit-world" aria-hidden="true">
      <div className="l4-tiles" />
      <div className="l4-grime" />
      <div className="l4-tags">
        {TAGS.map(tag => (
          <span key={tag.word} className={`${tag.drip ? 'drip' : ''} ${tag.word.length > 8 ? 'long' : ''}`} style={{ left: `${tag.x}%`, top: `${tag.y}vh`, fontSize: tag.size, color: tag.color, transform: `rotate(${tag.rot}deg)` } as CSSProperties}>{tag.word}</span>
        ))}
      </div>
      <div className="l4-throwup l4-throwup-a">4E</div>
      <div className="l4-throwup l4-throwup-b">L4</div>
      <div className="l4-sign"><b>4</b><span>LINEA 4 EVER</span></div>
      <svg className={`l4-train ${reduced ? 'still' : ''}`} viewBox="0 0 1800 320" preserveAspectRatio="xMinYMax slice">
        <defs>
          <linearGradient id="l4-steel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d7d7df" /><stop offset=".45" stopColor="#a6a6b2" /><stop offset=".55" stopColor="#bdbdc8" /><stop offset="1" stopColor="#7c7c88" />
          </linearGradient>
          <linearGradient id="l4-paint" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c4dff" /><stop offset=".5" stopColor="#ff5fb8" /><stop offset="1" stopColor="#d4ff3a" />
          </linearGradient>
        </defs>
        <TrainCar x={20} piece />
        <TrainCar x={900} piece={false} />
      </svg>
      <div className="pl-edge"><span>STAND BEHIND THE YELLOW LINE · LINEA 4 EVER · ALL CITY · STAND BEHIND THE YELLOW LINE · LINEA 4 EVER · ALL CITY</span></div>
    </div>
  )
}

type Row = { time: string; dest: string; plat: string; status: string; go: () => void; label: string }
const FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+'

/** Split-flap departures board. Each row is a shortcut to a tool. */
export function TransitBoard({ onTool, onCollective }: { onTool: (tool: 'converter' | 'analyzer' | 'lab') => void; onCollective: () => void }) {
  const rows: Row[] = [
    { time: 'NOW', dest: 'URL CONVERTER', plat: '1', status: 'ON TIME', go: () => onTool('converter'), label: 'Platform 1, URL converter, on time' },
    { time: '2 MIN', dest: 'BPM + KEY', plat: '2', status: 'BOARDING', go: () => onTool('analyzer'), label: 'Platform 2, BPM and key analyzer, boarding' },
    { time: '4 MIN', dest: '4EVER LAB', plat: '3', status: 'NOW OPEN', go: () => onTool('lab'), label: 'Platform 3, 4EVER LAB, now open' },
    { time: 'LATE', dest: 'RADIO 4EVER', plat: '4', status: 'ALL NIGHT', go: onCollective, label: 'Platform 4, Radio 4EVER and the collective, all night' },
  ]
  const reduced = useReducedMotion()
  const [flipping, setFlipping] = useState<number[]>([0, 1, 2, 3])
  const [tick, setTick] = useState(0)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 20_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (reduced) { setFlipping([]); return }
    const settle = window.setTimeout(() => setFlipping([]), 900)
    let reset = 0
    const again = window.setInterval(() => {
      setFlipping([Math.floor(Math.random() * 4)])
      reset = window.setTimeout(() => setFlipping([]), 900)
    }, 9000)
    return () => { window.clearTimeout(settle); window.clearTimeout(reset); window.clearInterval(again) }
  }, [reduced])

  // The flaps only spin while a row is changing.
  const spinning = flipping.length > 0
  useEffect(() => {
    if (!spinning) return
    const spin = window.setInterval(() => setTick(t => t + 1), 55)
    return () => window.clearInterval(spin)
  }, [spinning])

  const flap = (text: string, row: number, width: number) => {
    const padded = text.padEnd(width, ' ').slice(0, width)
    const active = flipping.includes(row)
    return padded.split('').map((char, i) => {
      const shown = active && char !== ' ' && (tick + i * 7 + row * 3) % 5 !== 0 ? FLAP[(tick * 3 + i * 11 + row * 5) % FLAP.length] : char
      return <i key={i} className={shown === ' ' ? 'blank' : ''}>{shown}</i>
    })
  }

  const hh = String(clock.getHours()).padStart(2, '0')
  const mm = String(clock.getMinutes()).padStart(2, '0')

  return (
    <div className="pl-board">
      <div className="pl-board-head">
        <span className="pl-bullet" aria-hidden="true">4</span>
        <strong>DEPARTURES</strong>
        <span>NIGHT LOCAL</span>
        <time aria-label={`Time ${hh}:${mm}`}>{hh}:{mm}</time>
      </div>
      <div className="pl-board-cols" aria-hidden="true"><span>DUE</span><span>DESTINATION</span><span>PL.</span><span>STATUS</span></div>
      {rows.map((row, index) => (
        <button key={row.dest} className="pl-board-row" onClick={row.go} aria-label={row.label}>
          <span className="pl-cells pl-c-time" aria-hidden="true">{flap(row.time, index, 5)}</span>
          <span className="pl-cells pl-c-dest" aria-hidden="true">{flap(row.dest, index, 13)}</span>
          <span className="pl-cells pl-c-plat" aria-hidden="true">{flap(row.plat, index, 1)}</span>
          <span className="pl-cells pl-c-status" aria-hidden="true">{flap(row.status, index, 9)}</span>
        </button>
      ))}
    </div>
  )
}
