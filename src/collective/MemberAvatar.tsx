import { useState } from 'react'
import type { CollectiveMember } from '../data/collective'
import soundcloudAvatars from '../data/avatars.json'
import { memberPhotos } from './photos'
import { Sigil } from './Sigil'

const savedAvatars = soundcloudAvatars as Record<string, string>

/**
 * Photo you dropped in src/assets/collective → their SoundCloud avatar (saved at
 * build time, see scripts/fetch-avatars.mjs) → the live one from the API → sigil.
 */
export function MemberAvatar({ member, thumbnail, className = '' }: { member: CollectiveMember; thumbnail?: string | null; className?: string }) {
  const [failed, setFailed] = useState<string[]>([])
  const candidates = [memberPhotos[member.id], savedAvatars[member.id], thumbnail ?? undefined].filter((src): src is string => Boolean(src) && !failed.includes(src!))
  const src = candidates[0]
  if (!src) return <Sigil member={member} className={className} />
  return <img className={`member-photo ${className}`} src={src} alt={`${member.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(list => [...list, src])} />
}

export const hasOwnPhoto = (member: CollectiveMember) => Boolean(memberPhotos[member.id])

/** Any picture at all (own photo or SoundCloud avatar), so the sigil can sit beside it as a badge. */
export const hasPicture = (member: CollectiveMember, thumbnail?: string | null) => Boolean(memberPhotos[member.id] || savedAvatars[member.id] || thumbnail)
