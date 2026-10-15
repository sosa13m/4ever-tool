/**
 * 4EVERTALE returns as a 16-bit JRPG world (same pixel logo).
 * black, white and purple only: a pure black void with an
 * original pixel fortress on a cliff (spired keep, towers with pointed roofs,
 * banners, a gate lit from inside and a path winding up to it). Drawn with
 * crisp SVG rectangles, no image files. All art is original.
 *
 * Pure decoration: aria-hidden, pointer-events none, honours reduced motion.
 */
import { useEffect, useState } from 'react'
import './tale.css'

function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}
const rand = seeded(2727)
const STARS = Array.from({ length: 34 }, () => ({ x: Math.round(rand() * 100 * 10) / 10, y: Math.round(rand() * 50 * 10) / 10, size: rand() < 0.12 ? 3 : 2, delay: -Math.round(rand() * 40) / 10, tint: rand() < 0.2 }))
const FIREFLIES = Array.from({ length: 10 }, () => ({ x: Math.round(rand() * 96 + 2), y: Math.round(66 + rand() * 26), delay: -Math.round(rand() * 80) / 10, drift: Math.round((rand() - 0.5) * 80) }))

type R = [number, number, number, number]
/** Stepped (pixel) pointed roof: rows of 2px narrowing to a tip. */
function roof(x: number, w: number, base: number, h: number): R[] {
  const rows = Math.round(h / 2)
  return Array.from({ length: rows }, (_, r) => {
    const inset = Math.round((r * (w / 2 - 1)) / rows)
    return [x + inset, base - 2 * (r + 1), w - 2 * inset, 2] as R
  })
}
/** Merlons along the top of a wall. */
function crenels(x: number, w: number, top: number): R[] {
  const out: R[] = []
  for (let cx = x; cx + 2 <= x + w; cx += 4) out.push([cx, top - 2, 2, 2])
  return out
}
/** A stepped cliff / ridge polygon over the 320×90 grid. */
function ridge(seed: number, from: number, to: number, base: number, amp: number): string {
  const r = seeded(seed)
  const pts: string[] = [`${from},90`]
  let y = base
  for (let x = from; x <= to; x += 6) {
    y = Math.max(base - amp, Math.min(base, y + Math.round((r() - 0.5) * 3) * 2))
    pts.push(`${x},${y}`, `${x + 6},${y}`)
  }
  pts.push(`${to + 6},90`)
  return pts.join(' ')
}

const HILLS = ridge(13, -6, 326, 80, 8)
// The cliff the fortress stands on: rises from the middle to a plateau on the right.
const CLIFF = '150,90 150,84 160,84 160,78 170,78 170,72 178,72 178,64 186,64 186,56 192,56 192,48 326,48 326,90'
const CLIFF_EDGE: R[] = [[160, 78, 10, 1], [170, 72, 8, 1], [178, 64, 8, 1], [186, 56, 6, 1], [192, 48, 134, 1]]
// Path winding from the bottom left up to the gate.
const PATH: R[] = [[40, 88, 40, 2], [78, 86, 30, 2], [106, 84, 24, 2], [128, 82, 26, 2], [152, 80, 12, 2], [162, 76, 10, 2], [170, 70, 10, 2], [178, 62, 10, 2], [186, 54, 8, 2], [192, 50, 54, 2]]

const STONE: R[] = [
  [200, 34, 112, 14], // curtain wall
  [198, 22, 12, 26], // west tower
  [238, 14, 26, 34], // keep
  [290, 18, 14, 30], // east tower
  [266, 28, 10, 20], // small turret
]
const MERLONS: R[] = [...crenels(210, 28, 34), ...crenels(264, 26, 34), ...crenels(304, 8, 34), ...crenels(266, 10, 28)]
const ROOFS: R[] = [...roof(196, 16, 22, 14), ...roof(236, 30, 14, 20), ...roof(288, 18, 18, 14)]
const SPIRE: R[] = [[250, 0, 2, 8]]
const WINDOWS: R[] = [[202, 27, 2, 3], [202, 36, 2, 3], [244, 20, 2, 3], [250, 20, 2, 3], [256, 20, 2, 3], [244, 28, 2, 3], [256, 28, 2, 3], [294, 23, 2, 3], [298, 31, 2, 3], [270, 32, 2, 3], [218, 39, 2, 3], [282, 39, 2, 3]]
const WHITE_LIGHTS: R[] = [[250, 28, 2, 3], [298, 23, 2, 3]]
const GATE: R[] = [[246, 40, 10, 8], [247, 39, 8, 1], [248, 38, 6, 1]]
const MOONLIT: R[] = [[198, 22, 1, 26], [238, 14, 1, 34], [290, 18, 1, 30], [200, 34, 112, 1]]

const rects = (list: R[], cls?: string) => list.map(([x, y, w, h], i) => <rect key={`${cls ?? 'r'}-${i}`} x={x} y={y} width={w} height={h} className={cls} />)

export function TaleWorld() {
  return (
    <div className="tale-world" aria-hidden="true">
      <div className="tw-sky" />
      <div className="tw-stars">{STARS.map((s, i) => <i key={i} className={s.tint ? 'tint' : ''} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} />)}</div>
      <i className="tw-shooting" />
      <svg className="tw-moon" viewBox="0 0 16 16" shapeRendering="crispEdges">
        <path d="M5 1h6v1h2v2h1v2h1v4h-1v2h-1v2h-2v1H5v-1H3v-2H2v-2H1V6h1V4h1V2h2z" fill="#f4f0ff" />
        <path d="M5 4h2v2H5zM9 8h3v2H9zM6 10h2v2H6z" fill="#cdbff0" />
      </svg>
      <svg className="tw-land" viewBox="0 -24 320 114" preserveAspectRatio="xMaxYMax slice" shapeRendering="crispEdges">
        <polygon className="tw-hills" points={HILLS} />
        <polygon className="tw-cliff" points={CLIFF} />
        <g className="tw-cliff-edge">{rects(CLIFF_EDGE)}</g>
        <g className="tw-path">{rects(PATH)}</g>
        <g className="tw-stone">{rects(STONE)}{rects(MERLONS)}</g>
        <g className="tw-moonlit">{rects(MOONLIT)}</g>
        <g className="tw-roof">{rects(ROOFS)}</g>
        <g className="tw-spire">{rects(SPIRE)}<rect x="252" y="0" width="7" height="4" className="tw-flag" /><rect x="198" y="4" width="2" height="5" /><rect x="200" y="4" width="5" height="3" className="tw-flag" /><rect x="296" y="0" width="2" height="5" /><rect x="298" y="0" width="5" height="3" className="tw-flag" /></g>
        <g className="tw-glow">{rects(GATE)}</g>
        <g className="tw-windows">{rects(WINDOWS)}</g>
        <g className="tw-windows tw-white">{WHITE_LIGHTS.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} className={i === 0 ? 'blink' : ''} />)}</g>
      </svg>
      <div className="tw-fireflies">{FIREFLIES.map((f, i) => <i key={i} style={{ left: `${f.x}%`, top: `${f.y}%`, animationDelay: `${f.delay}s`, '--drift': `${f.drift}px` } as React.CSSProperties} />)}</div>
      <div className="tw-save"><span>✦</span><small>SAVE POINT</small></div>
    </div>
  )
}

const LINES = [
  '* Welcome back, traveler.',
  '* The party menu holds every tool you need.',
  '* Choose a quest: CONVERT, SCAN or the LAB.',
]

/** Typewriter dialogue box shown in the hero. Skips straight to the text when motion is reduced. */
export function TaleDialogue() {
  const [line, setLine] = useState(0)
  const [chars, setChars] = useState(0)
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setChars(LINES[line].length); return }
    if (chars < LINES[line].length) {
      const id = window.setTimeout(() => setChars(c => c + 1), 38)
      return () => window.clearTimeout(id)
    }
    const id = window.setTimeout(() => { setLine(l => (l + 1) % LINES.length); setChars(0) }, 2600)
    return () => window.clearTimeout(id)
  }, [chars, line])
  return (
    <div className="tale-dialogue" role="status" aria-live="off">
      <span aria-hidden="true">{LINES[line].slice(0, chars)}</span>
      <span className="visually-hidden">{LINES[line]}</span>
      <i className={chars >= LINES[line].length ? 'tale-caret done' : 'tale-caret'} aria-hidden="true">▼</i>
    </div>
  )
}
