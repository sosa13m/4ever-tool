import { useEffect, useState } from 'react'
import { collective } from '../data/collective'
import { apiUrl } from '../lib/api'

export type SoundCloudMetadata = {
  url: string
  title: string
  author_name?: string | null
  author_url?: string | null
  thumbnail_url?: string | null
  provider_name: string
}

// Shared by the crew drawer, the member worlds and the radio cameo: one fetch per visit.
const cache: Record<string, SoundCloudMetadata> = {}
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function loadAll(): Promise<void> {
  inflight ??= Promise.allSettled(collective.map(async member => {
    const response = await fetch(apiUrl(`/api/soundcloud/oembed?url=${encodeURIComponent(member.profileUrl)}`))
    if (!response.ok) throw new Error('metadata unavailable')
    cache[member.id] = await response.json() as SoundCloudMetadata
  })).then(() => {
    // API offline or SoundCloud down: allow a fresh try next time the drawer opens.
    if (Object.keys(cache).length < collective.length) inflight = null
    listeners.forEach(listener => listener())
  })
  return inflight
}

/** SoundCloud name + avatar for every member, loaded once when first needed. */
export function useMemberMetadata(enabled: boolean): { metadata: Record<string, SoundCloudMetadata>; loading: boolean } {
  const [, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const listener = () => { setVersion(v => v + 1); setLoading(false) }
    listeners.add(listener)
    if (enabled && Object.keys(cache).length < collective.length) {
      setLoading(true)
      void loadAll()
    }
    return () => { listeners.delete(listener) }
  }, [enabled])
  return { metadata: cache, loading }
}
