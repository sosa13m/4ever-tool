import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Disc3, ExternalLink, Link2, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { collective, memberById, type CollectiveMember, type MemberLinks } from '../data/collective'
import { inkOn } from '../lib/sigil'
import { useMemberMetadata } from './metadata'
import { hasPicture, MemberAvatar } from './MemberAvatar'
import { Sigil } from './Sigil'
import { SIGIL_TAPS } from './signals'

const LINK_LABELS: Record<keyof MemberLinks, string> = {
  instagram: 'INSTAGRAM', youtube: 'YOUTUBE', tiktok: 'TIKTOK', spotify: 'SPOTIFY', bandcamp: 'BANDCAMP', website: 'WEBSITE',
}

type Props = {
  memberId: string | null
  onClose: () => void
  onNavigate: (id: string) => void
  onPlay: (member: CollectiveMember) => void
  radioMemberId: string
  radioPlaying: boolean
  foundSignals: string[]
  onSignalFound: (id: string) => void
}

/** A member's own page inside the site: their colours, mark, words and music. Share link: #crew/<id>. */
export function MemberWorld({ memberId, onClose, onNavigate, onPlay, radioMemberId, radioPlaying, foundSignals, onSignalFound }: Props) {
  const member = memberById(memberId)
  const { metadata } = useMemberMetadata(Boolean(member))
  const [taps, setTaps] = useState(0)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const panel = useRef<HTMLElement | null>(null)
  const index = member ? collective.findIndex(item => item.id === member.id) : -1
  const prev = index >= 0 ? collective[(index - 1 + collective.length) % collective.length] : null
  const next = index >= 0 ? collective[(index + 1) % collective.length] : null

  useEffect(() => { setTaps(0); setCopied('idle'); panel.current?.focus() }, [memberId])

  useEffect(() => {
    if (!member) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Only this layer closes, not the drawer underneath.
        event.stopImmediatePropagation()
        onClose()
      } else if (event.key === 'ArrowRight' && next) onNavigate(next.id)
      else if (event.key === 'ArrowLeft' && prev) onNavigate(prev.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [member, next, prev, onClose, onNavigate])

  const data = member ? metadata[member.id] : undefined
  const found = member ? foundSignals.includes(member.id) : false
  const onAir = member ? radioMemberId === member.id && radioPlaying : false

  const tapPortrait = () => {
    if (!member || found) return
    const count = taps + 1
    setTaps(count)
    if (count >= SIGIL_TAPS) onSignalFound(member.id)
  }

  const share = async () => {
    if (!member) return
    const url = `${window.location.origin}${window.location.pathname}#crew/${member.id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  const links = member?.links ? (Object.entries(member.links) as Array<[keyof MemberLinks, string | undefined]>).filter(([, href]) => href) : []

  return <AnimatePresence>{member && (
    <motion.div className="member-world" key="member-world"
      style={{ '--m1': member.accent, '--m2': member.accent2, '--m-ink': inkOn(member.accent) } as React.CSSProperties}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button className="member-world-backdrop" aria-label="Close profile" onClick={onClose} />
      <motion.section ref={panel} tabIndex={-1} className="member-world-panel" role="dialog" aria-modal="true" aria-label={`${member.name} — 4EVER collective`}
        key={member.id} initial={{ y: 24, scale: .98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
        <div className="mw-symbol-field" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <span key={i}>{member.symbol}</span>)}</div>
        <header className="mw-head">
          <span>4EVER COLLECTIVE · {String(index + 1).padStart(2, '0')}/{String(collective.length).padStart(2, '0')}</span>
          <button className="mw-close" onClick={onClose} aria-label="Close profile"><X size={20} /></button>
        </header>

        <div className="mw-body">
          <figure className="mw-portrait">
            <button className={`mw-portrait-frame ${found ? 'is-found' : ''}`} onClick={tapPortrait} aria-label={found ? `${member.name}: signal found` : `${member.name} portrait`}>
              <MemberAvatar member={member} thumbnail={data?.thumbnail_url} className="mw-avatar" />
              {/* With a real photo, the sigil rides along as a badge; without one, the sigil IS the portrait. */}
              {hasPicture(member, data?.thumbnail_url) && <span className="mw-sigil-badge"><Sigil member={member} title={`${member.name} sigil`} /></span>}
            </button>
            <figcaption>
              {found
                ? <span className="mw-signal found"><Check size={14} /> SIGNAL FOUND</span>
                : <span className="mw-signal">{taps > 0 ? `${'●'.repeat(taps)}${'○'.repeat(SIGIL_TAPS - taps)}` : 'A SIGNAL IS HIDDEN HERE'}</span>}
            </figcaption>
          </figure>

          <div className="mw-copy">
            <span className="mw-role">{member.role ?? '4EVER MEMBER'}</span>
            <h2>{member.name}</h2>
            {member.alias && <p className="mw-alias">AKA {member.alias}</p>}
            {member.tagline && <p className="mw-tagline">“{member.tagline}”</p>}
            {member.bio && <p className="mw-bio">{member.bio}</p>}
            {member.cameo && <div className="mw-cameo">{member.cameo}</div>}

            <dl className="mw-facts">
              <div><dt>RADIO 4EVER</dt><dd>{onAir ? 'ON AIR NOW' : member.radio ? 'IN ROTATION' : 'PROFILE ONLY'}</dd></div>
              <div><dt>SOUNDCLOUD</dt><dd>{data?.author_name ?? new URL(member.profileUrl).pathname.slice(1)}</dd></div>
              <div><dt>SYMBOL</dt><dd>{member.symbol}</dd></div>
            </dl>

            <div className="mw-actions">
              {member.radio && <button className="mw-primary" onClick={() => onPlay(member)}>{onAir ? <><Pause size={17} /> ON AIR</> : <><Play size={17} /> PLAY {member.name.toUpperCase()}</>}</button>}
              <a href={member.profileUrl} target="_blank" rel="noreferrer">SOUNDCLOUD <ExternalLink size={14} /></a>
              {links.map(([kind, href]) => <a key={kind} href={href} target="_blank" rel="noreferrer">{LINK_LABELS[kind]} <ExternalLink size={14} /></a>)}
              <button onClick={() => void share()}>{copied === 'copied' ? <><Check size={14} /> LINK COPIED</> : <><Link2 size={14} /> SHARE</>}</button>
            </div>
            {copied === 'failed' && <p className="mw-share-fallback">COPY THIS LINK: <code>{`${window.location.origin}${window.location.pathname}#crew/${member.id}`}</code></p>}
          </div>
        </div>

        <nav className="mw-nav" aria-label="Other members">
          {prev && <button onClick={() => onNavigate(prev.id)}><ArrowLeft size={16} /> {prev.name}</button>}
          <div className="mw-dots">{collective.map(item => <button key={item.id} className={item.id === member.id ? 'active' : ''} style={{ '--dot': item.accent } as React.CSSProperties} onClick={() => onNavigate(item.id)} aria-label={item.name} aria-current={item.id === member.id ? 'true' : undefined}>{foundSignals.includes(item.id) ? <Disc3 size={9} /> : null}</button>)}</div>
          {next && <button onClick={() => onNavigate(next.id)}>{next.name} <ArrowRight size={16} /></button>}
        </nav>
      </motion.section>
    </motion.div>
  )}</AnimatePresence>
}
