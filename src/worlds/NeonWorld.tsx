/**
 * 4EVER NEON OG world: the festival / tour site.
 *
 * Behind the UI: a lighting truss with moving heads, sweeping beams, a laser fan
 * from the stage, haze and a crowd with raised hands. At the bottom of the page:
 * a lineup poster built from the real collective (each name opens that member's
 * world). All copy and artwork are original.
 *
 * The stage is pure decoration (aria-hidden, pointer-events none) and honours
 * reduced motion. Nothing flashes: the lights sweep, they never strobe.
 */
import type { CSSProperties } from 'react'
import { collective } from '../data/collective'
import './neon.css'

function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}

const r = seeded(404)
/** Crowd silhouette across a 1600×200 strip: heads, shoulders and raised hands. */
const CROWD = (() => {
  const shapes: string[] = []
  for (let x = -10; x < 1620; x += 26 + Math.round(r() * 14)) {
    const h = 118 + Math.round(r() * 40)
    const head = 12 + Math.round(r() * 4)
    const sh = h + head - 3
    shapes.push(`M${x - 25} 200 C${x - 25} ${sh + 16} ${x - 18} ${sh} ${x} ${sh} C${x + 18} ${sh} ${x + 25} ${sh + 16} ${x + 25} 200 Z`)
    shapes.push(`M${x - head} ${h} a${head} ${head + 1} 0 1 0 ${head * 2} 0 a${head} ${head + 1} 0 1 0 ${-head * 2} 0`)
    if (r() < 0.34) {
      const side = r() < 0.5 ? -1 : 1
      const ax = x + side * 17
      const top = h - 26 - Math.round(r() * 26)
      shapes.push(`M${ax - 6} ${sh + 10} L${ax + side * 8 - 5} ${top} L${ax + side * 8 + 5} ${top} L${ax + 6} ${sh + 10} Z`)
      shapes.push(`M${ax + side * 8 - 7} ${top - 4} a7 8 0 1 0 14 0 a7 8 0 1 0 -14 0`)
    }
  }
  return shapes.join(' ')
})()

const HEADS = [12, 26, 40, 60, 74, 88]
const LASERS = Array.from({ length: 9 }, (_, i) => ({ angle: -48 + i * 12, delay: -i * 0.7 }))

export function NeonWorld() {
  return (
    <div className="neon-tour-world" aria-hidden="true">
      <div className="nn-haze nn-haze-a" />
      <div className="nn-haze nn-haze-b" />
      <div className="nn-truss" />
      {HEADS.map((x, i) => (
        <div key={x} className={`nn-head ${i % 2 ? 'pink' : 'green'}`} style={{ left: `${x}%`, '--d': `${-i * 1.3}s`, '--swing': `${i % 2 ? 18 : -18}deg` } as CSSProperties}>
          <i className="nn-beam" />
        </div>
      ))}
      <div className="nn-lasers">
        {LASERS.map(laser => <i key={laser.angle} style={{ '--a': `${laser.angle}deg`, animationDelay: `${laser.delay}s` } as CSSProperties} />)}
      </div>
      <svg className="nn-crowd" viewBox="0 0 1600 200" preserveAspectRatio="xMidYMax slice"><path d={CROWD} /></svg>
      <div className="nn-stage-lip" />
    </div>
  )
}

/** Festival lineup poster from the collective. Names open each member's world. */
export function NeonLineup({ onMember, onCollective }: { onMember: (id: string) => void; onCollective: () => void }) {
  const headliners = collective.slice(0, 3)
  const second = collective.slice(3, 7)
  const third = collective.slice(7)
  const tier = (list: typeof collective, cls: string) => (
    <p className={`nn-tier ${cls}`}>
      {list.map((member, i) => (
        <span key={member.id}>
          {i > 0 && <i aria-hidden="true"> ✦ </i>}
          <button onClick={() => onMember(member.id)}>{member.name}</button>
        </span>
      ))}
    </p>
  )
  return (
    <section className="nn-lineup" aria-label="4EVER tour lineup">
      <header>
        <small>4EVERTOOLS PRESENTS</small>
        <strong>4EVER TOUR</strong>
        <span>THREE NIGHTS · ONE COLLECTIVE · NO SLEEP</span>
      </header>
      {tier(headliners, 'nn-tier-1')}
      {tier(second, 'nn-tier-2')}
      {tier(third, 'nn-tier-3')}
      <button className="nn-radio" onClick={onCollective}>+ RADIO 4EVER · ALL NIGHT</button>
      <footer>
        <span>NIGHT 01 · THE BASEMENT</span>
        <span>NIGHT 02 · THE ROOFTOP</span>
        <span>NIGHT 03 · THE LAB</span>
      </footer>
    </section>
  )
}
