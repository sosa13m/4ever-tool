import { useId, useMemo } from 'react'
import type { CollectiveMember } from '../data/collective'
import { makeSigil, SIGIL_GRID } from '../lib/sigil'

/** The member's generated mark: their colours, a mirrored pattern and their symbol in the middle. */
export function Sigil({ member, className = '', title }: { member: CollectiveMember; className?: string; title?: string }) {
  const sigil = useMemo(() => makeSigil(member.id), [member.id])
  // Unique per render: the same member's sigil can be on screen several times.
  const gradient = `sigil-${member.id}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const cell = 76 / SIGIL_GRID
  return (
    <svg className={`sigil ${className}`} viewBox="0 0 100 100" role="img" aria-label={title ?? `${member.name} sigil`}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={member.accent} />
          <stop offset="1" stopColor={member.accent2} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="#0b0b0f" />
      <rect width="100" height="100" fill={`url(#${gradient})`} opacity=".16" />
      {sigil.ring > 0 && <circle cx="50" cy="50" r="46" fill="none" stroke={`url(#${gradient})`} strokeWidth="2.2" strokeDasharray={sigil.ring === 2 ? '9 6' : sigil.ring === 3 ? '1.5 5' : undefined} strokeLinecap="round" />}
      <g transform={`rotate(${sigil.rotation} 50 50)`} fill={`url(#${gradient})`}>
        {sigil.cells.map(([x, y]) => <rect key={`${x}-${y}`} x={12 + x * cell + 1} y={12 + y * cell + 1} width={cell - 2} height={cell - 2} rx="2.2" />)}
      </g>
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="800" fill={member.accent}>{member.symbol}</text>
    </svg>
  )
}
