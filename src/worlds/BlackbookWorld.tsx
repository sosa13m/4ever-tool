/**
 * 4EVER WHITE BLACKBOOK world: the sketchbook.
 *
 * Behind the UI: the black cover of a graffiti blackbook — worn grain, an
 * elastic strap, white-paint doodles and drips. The tools become cream sketch
 * pages with spiral binding. In the hero: a to-do page torn out of the book,
 * whose lines are real shortcuts (and get crossed out once done).
 * All doodles and copy are original.
 */
import { useState } from 'react'
import './blackbook.css'

export function BlackbookWorld() {
  return (
    <div className="blackbook-cover-world" aria-hidden="true">
      <div className="bk-grain" />
      <svg className="bk-drips" viewBox="0 0 1600 140" preserveAspectRatio="none">
        <path d="M0 0H1600V18C1560 18 1556 34 1550 70C1546 92 1534 92 1532 70C1528 40 1520 22 1470 22C1420 22 1416 30 1412 46C1408 60 1398 60 1396 46C1392 26 1360 20 1260 20C1180 20 1170 26 1166 54C1162 128 1146 128 1144 54C1140 24 1120 18 1020 18C940 18 930 22 926 36C922 50 912 50 910 36C906 22 860 16 760 16C680 16 672 24 668 60C664 96 652 96 650 60C646 26 620 20 520 20C440 20 430 24 426 42C422 58 410 58 408 42C404 24 360 18 260 18C200 18 190 24 186 70C182 110 168 110 166 70C162 28 140 20 80 20C40 20 20 18 0 18Z" />
      </svg>
      <svg className="bk-doodle bk-crown" viewBox="0 0 120 90"><path d="M10 78 L18 24 L42 52 L60 10 L78 52 L102 24 L110 78 Z M10 78 H110" /><circle cx="18" cy="20" r="5" /><circle cx="60" cy="6" r="5" /><circle cx="102" cy="20" r="5" /></svg>
      <svg className="bk-doodle bk-star" viewBox="0 0 100 100"><path d="M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z" /><path d="M2 20 L14 26 M86 8 L80 20 M96 70 L84 66" /></svg>
      <svg className="bk-doodle bk-arrow" viewBox="0 0 220 80"><path d="M6 60 C50 10 110 10 150 40 C162 50 176 52 196 40 M176 22 L198 40 L178 58" /></svg>
      <svg className="bk-doodle bk-throw" viewBox="0 0 260 120"><path d="M20 96 C10 60 30 20 60 24 C82 26 80 60 70 80 C96 30 130 14 140 40 C148 60 128 92 110 100 C140 92 170 30 200 34 C232 38 240 80 214 100 C196 112 120 112 20 96 Z" /><path d="M48 104 V118 M120 108 V116 M190 106 V120" /></svg>
      <div className="bk-strap" />
      <div className="bk-label"><b>PROPERTY OF 4EVER</b><span>IF FOUND: DO NOT READ PAGE 134</span></div>
    </div>
  )
}

type Item = { key: string; text: string; go: () => void }

/** Torn to-do page. Each line opens a tool and gets crossed out. */
export function BlackbookChecklist({ onTool, onCollective }: { onTool: (tool: 'converter' | 'analyzer' | 'lab') => void; onCollective: () => void }) {
  const [done, setDone] = useState<string[]>([])
  const items: Item[] = [
    { key: 'rip', text: 'rip the beat → url converter', go: () => onTool('converter') },
    { key: 'bpm', text: 'find the bpm + key', go: () => onTool('analyzer') },
    { key: 'flip', text: 'flip it in the lab', go: () => onTool('lab') },
    { key: 'aux', text: 'pass the aux → radio 4ever', go: onCollective },
  ]
  return (
    <div className="bk-todo">
      <strong>to do tonight:</strong>
      <ul>
        {items.map(item => {
          const checked = done.includes(item.key)
          return (
            <li key={item.key}>
              <button className={checked ? 'done' : ''} aria-pressed={checked} onClick={() => { setDone(list => list.includes(item.key) ? list : [...list, item.key]); item.go() }}>
                <i aria-hidden="true">{checked ? '✗' : ''}</i>{item.text}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
