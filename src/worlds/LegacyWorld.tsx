/**
 * LEGACY LABEL world.
 *
 * Mood of a classic leaf-wrap label website: near-black background with a
 * flickering dark-red grain, cured-leaf brown panels, condensed headlines,
 * charcoal cards and red pill buttons. Everything here is original 4EVER
 * artwork (no third-party logos, slogans or photos).
 *
 * Pure decoration: aria-hidden, pointer-events none, honours reduced motion.
 */
import './legacy.css'

export function LegacyWorld() {
  return (
    <div className="legacy-world" aria-hidden="true">
      <div className="lg-grain" />
      <div className="lg-vignette" />
      <svg className="lg-leaf lg-leaf-a" viewBox="0 0 200 420">
        <path d="M100 6C40 90 18 200 46 300c14 50 36 86 54 112 18-26 40-62 54-112C182 200 160 90 100 6Z" />
        <path className="lg-vein" d="M100 20V410M100 90 62 130M100 90l38 40M100 160 52 214M100 160l48 54M100 236 58 292M100 236l42 56M100 310 70 350M100 310l30 40" />
      </svg>
      <svg className="lg-leaf lg-leaf-b" viewBox="0 0 200 420">
        <path d="M100 6C40 90 18 200 46 300c14 50 36 86 54 112 18-26 40-62 54-112C182 200 160 90 100 6Z" />
        <path className="lg-vein" d="M100 20V410M100 90 62 130M100 90l38 40M100 160 52 214M100 160l48 54M100 236 58 292M100 236l42 56M100 310 70 350M100 310l30 40" />
      </svg>
    </div>
  )
}

/** Header label, in the spirit of a product warning box — but about 808s. */
export function LegacyWarning() {
  return (
    <div className="lg-warning" role="note">
      <b>4EVER GENERAL WARNING:</b>
      <span>Heavy 808s may cause repeated listening and late nights.</span>
    </div>
  )
}

/** Red footer band with an arched emblem drawn in SVG (original lettering). */
export function LegacyFooter({ onOpenCollective, onOpenThemes, onOpenTools }: { onOpenCollective: () => void; onOpenThemes: () => void; onOpenTools: () => void }) {
  return (
    <footer className="lg-footer">
      <nav>
        <button onClick={onOpenTools}>Tools</button>
        <button onClick={onOpenCollective}>Collective &amp; Radio</button>
        <button onClick={onOpenThemes}>Theme Archive</button>
      </nav>
      <svg className="lg-emblem" viewBox="0 0 260 150" role="img" aria-label="Original 4EVER">
        <defs><path id="lg-arc" d="M30 92 Q130 18 230 92" /></defs>
        <text className="lg-emblem-arc"><textPath href="#lg-arc" startOffset="50%" textAnchor="middle">ORIGINAL</textPath></text>
        <text className="lg-emblem-main" x="130" y="134" textAnchor="middle">4EVER</text>
      </svg>
      <p>Underground audio tools made by the 4EVER collective.<br />Every file is processed for you and deleted after an hour.</p>
    </footer>
  )
}
