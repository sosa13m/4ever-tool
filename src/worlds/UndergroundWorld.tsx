/**
 * TRUE UNDERGROUND OG world: a basement record shop.
 *
 * A concrete wall covered in wheat-pasted, photocopied flyers under a bare
 * bulb, masking tape everywhere, and a crate of record sleeves at the bottom of
 * the page that doubles as navigation. All flyer copy and artwork is original.
 *
 * The wall is pure decoration (aria-hidden, pointer-events none) and honours
 * reduced motion. The crate is real UI: each sleeve is a button.
 */
import type { CSSProperties } from 'react'
import './underground.css'

function seeded(seed: number) {
  let value = seed
  return () => ((value = (value * 9301 + 49297) % 233280) / 233280)
}

/** Jagged, torn-paper outline for clip-path (percent coordinates). */
function torn(seed: number): string {
  const r = seeded(seed)
  const pts: string[] = []
  for (let x = 0; x <= 100; x += 5) pts.push(`${x}% ${(r() * 2.6).toFixed(1)}%`)
  for (let y = 5; y <= 95; y += 6) pts.push(`${(100 - r() * 1.6).toFixed(1)}% ${y}%`)
  for (let x = 100; x >= 0; x -= 5) pts.push(`${x}% ${(100 - r() * 3.2).toFixed(1)}%`)
  for (let y = 95; y >= 5; y -= 6) pts.push(`${(r() * 1.6).toFixed(1)}% ${y}%`)
  return `polygon(${pts.join(',')})`
}

type Flyer = { cls: string; x: string; y: string; w: string; rot: number; seed: number }
const FLYERS: Flyer[] = [
  { cls: 'ug-f-session', x: '1.5vw', y: '14vh', w: 'clamp(150px,13vw,230px)', rot: -4, seed: 3 },
  { cls: 'ug-f-arrivals', x: '3vw', y: '52vh', w: 'clamp(140px,12vw,210px)', rot: 3, seed: 7 },
  { cls: 'ug-f-lost', x: '1vw', y: '80vh', w: 'clamp(130px,11vw,190px)', rot: -2, seed: 11 },
  { cls: 'ug-f-nosleep', x: 'calc(100vw - clamp(160px,14vw,240px) - 2vw)', y: '11vh', w: 'clamp(160px,14vw,240px)', rot: 5, seed: 13 },
  { cls: 'ug-f-bpm', x: 'calc(100vw - clamp(130px,11vw,190px) - 1vw)', y: '47vh', w: 'clamp(130px,11vw,190px)', rot: -6, seed: 17 },
  { cls: 'ug-f-diggers', x: 'calc(100vw - clamp(150px,12vw,220px) - 3vw)', y: '74vh', w: 'clamp(150px,12vw,220px)', rot: 2, seed: 19 },
  { cls: 'ug-f-allnight', x: '36vw', y: '-2vh', w: 'clamp(150px,12vw,210px)', rot: -3, seed: 23 },
  { cls: 'ug-f-remnant', x: '58vw', y: '-4vh', w: 'clamp(170px,15vw,260px)', rot: 4, seed: 29 },
]

function FlyerBody({ cls }: { cls: string }) {
  switch (cls) {
    case 'ug-f-session': return <><small>4EVER PRESENTS</small><strong>BASE<br />MENT<br />SESSIONS</strong><span>EVERY FRIDAY · 04:44</span></>
    case 'ug-f-arrivals': return <><strong>NEW<br />ARRIVALS</strong><span>CRATE 04 · TAPES · DUBS</span><i className="ug-halftone" /></>
    case 'ug-f-lost': return <><strong>LOST:</strong><span>MY SLEEP SCHEDULE.<br />IF FOUND, KEEP IT.</span><b className="ug-tabs">{Array.from({ length: 6 }, (_, i) => <em key={i}>#4EVER RADIO</em>)}</b></>
    case 'ug-f-nosleep': return <><strong>NO<br />SLEEP</strong><span>TIL THE CRATE IS EMPTY</span></>
    case 'ug-f-bpm': return <><small>MINIMUM</small><strong>145</strong><span>BPM · NO EXCEPTIONS</span></>
    case 'ug-f-diggers': return <><strong>CRATE<br />DIGGERS<br />WELCOME</strong><span>BRING YOUR OWN EARS</span></>
    case 'ug-f-allnight': return <><strong>ALL AGES<br />ALL NIGHT</strong><span>DOWNSTAIRS · DOOR ON THE LEFT</span></>
    default: return <><strong>4EVER</strong><span>— — — — — — —</span></>
  }
}

export function UndergroundWorld() {
  return (
    <div className="underground-world" aria-hidden="true">
      <div className="ug-wall" />
      <div className="ug-bulb"><i /></div>
      {FLYERS.map((f, i) => (
        <div key={f.cls} className={`ug-flyer ${f.cls}`} style={{ left: f.x, top: f.y, width: f.w, '--rot': `${f.rot}deg`, '--i': i } as CSSProperties}>
          <div className="ug-paper" style={{ clipPath: torn(f.seed) }}><FlyerBody cls={f.cls} /></div>
          <span className="ug-tape ug-tape-a" /><span className="ug-tape ug-tape-b" />
        </div>
      ))}
      <div className="ug-stencil">BASEMENT · RECORDS · TAPES · TOOLS</div>
    </div>
  )
}

type Sleeve = { key: string; title: string; side: string; art: string; action: () => void }

/** "New arrivals" crate: four record sleeves that open the tools. */
export function UndergroundCrate({ onTool, onCollective }: { onTool: (tool: 'converter' | 'analyzer' | 'lab') => void; onCollective: () => void }) {
  const sleeves: Sleeve[] = [
    { key: 'converter', title: 'URL CONVERTER', side: 'SIDE A · MP3 / WAV', art: 'dots', action: () => onTool('converter') },
    { key: 'analyzer', title: 'BPM + KEY', side: 'SIDE B · TEMPO / CAMELOT', art: 'stripes', action: () => onTool('analyzer') },
    { key: 'lab', title: '4EVER LAB', side: 'DUB · TRIM / PITCH', art: 'type', action: () => onTool('lab') },
    { key: 'radio', title: 'RADIO 4EVER', side: 'LIVE · THE COLLECTIVE', art: 'circle', action: onCollective },
  ]
  return (
    <section className="ug-crate" aria-label="New arrivals">
      <header>
        <strong>NEW ARRIVALS</strong>
        <span>CRATE 04 · EVERYTHING FREE · NO RETURNS</span>
      </header>
      <div className="ug-crate-box">
        {sleeves.map(sleeve => (
          <button key={sleeve.key} className={`ug-sleeve ug-art-${sleeve.art}`} onClick={sleeve.action}>
            <i className="ug-vinyl" aria-hidden="true" />
            <span className="ug-sleeve-face" aria-hidden="true"><b>4EVER</b></span>
            <span className="ug-sleeve-label"><strong>{sleeve.title}</strong><small>{sleeve.side}</small></span>
            <em className="ug-price" aria-hidden="true">FREE</em>
          </button>
        ))}
      </div>
    </section>
  )
}
