/**
 * The 4EVER collective. Each member has their own "world" on the site.
 *
 * HOW TO FILL A PROFILE (see COLLECTIVE.md for the full guide):
 *  - Photo: drop `<id>.webp` (or .jpg / .png) into src/assets/collective/ — no code needed.
 *    Without a photo the site uses the SoundCloud avatar, and without that, the member's sigil.
 *  - Everything marked optional below can stay empty: the site simply hides it.
 */
export type MemberLinks = {
  instagram?: string
  youtube?: string
  tiktok?: string
  spotify?: string
  bandcamp?: string
  website?: string
}

export type CollectiveMember = {
  /** URL-safe id; also the photo file name and the share link (#crew/<id>). */
  id: string
  name: string
  alias?: string
  role?: string
  profileUrl: string
  /** Plays on Radio 4EVER. */
  radio: boolean
  /** Main colour of their world (hex). */
  accent: string
  /** Second colour of their world (hex). */
  accent2: string
  /** One character that marks them: a letter, ✦, ☾, ⚡… */
  symbol: string
  /** One line under the name, in their words. */
  tagline?: string
  /** Two or three sentences. */
  bio?: string
  /** Shown as a sticker in their world and in the radio cameo. */
  cameo?: string
  links?: MemberLinks
  /** Typing any of these anywhere on the site finds their hidden signal. */
  signals: string[]
}

export const collective: CollectiveMember[] = [
  { id: 'moneynlust', name: 'moneynlust', role: 'dev', profileUrl: 'https://soundcloud.com/moneynlust13', radio: true, accent: '#7c4dff', accent2: '#00e5ff', symbol: '$', signals: ['moneynlust', 'moneynlust13'] },
  { id: 'cinho', name: 'cinho', profileUrl: 'https://soundcloud.com/1cinho', radio: true, accent: '#f044ff', accent2: '#ffd60a', symbol: '✦', signals: ['cinho', '1cinho'] },
  { id: 'rani', name: 'rani', profileUrl: 'https://soundcloud.com/umjammer_rani', radio: true, accent: '#66ffbf', accent2: '#3a86ff', symbol: '☾', signals: ['rani'] },
  { id: 'agus', name: 'agus', alias: 'mella', profileUrl: 'https://soundcloud.com/ordinariiio', radio: true, accent: '#ff3b30', accent2: '#ffffff', symbol: '✕', signals: ['agus', 'mella'] },
  { id: 'aletsandrr', name: 'aletsandrr', alias: '1000blunts', profileUrl: 'https://soundcloud.com/1000bluntsss', radio: true, accent: '#d9ff43', accent2: '#2bff88', symbol: '❀', signals: ['aletsandrr', '1000blunts'] },
  { id: 'dj-chupalito', name: 'dj chupalito', profileUrl: 'https://soundcloud.com/djchupalito', radio: true, accent: '#ff9f0a', accent2: '#ff2d55', symbol: '◉', signals: ['djchupalito', 'chupalito'] },
  { id: 'maxoxo', name: 'maxoxo', profileUrl: 'https://soundcloud.com/maxillopillo', radio: false, accent: '#5ac8fa', accent2: '#ff9ff3', symbol: '♡', signals: ['maxoxo'] },
  { id: 'hueviti', name: 'hueviti', profileUrl: 'https://soundcloud.com/user-952228687', radio: false, accent: '#ffcc00', accent2: '#ff6b00', symbol: '☀', signals: ['hueviti'] },
  { id: 'anderratedasf', name: 'anderratedasf', profileUrl: 'https://soundcloud.com/kevinx654x', radio: false, accent: '#ff2d55', accent2: '#7c4dff', symbol: '▲', signals: ['anderratedasf'] },
  { id: 'mundane', name: 'mundane', alias: '2012', profileUrl: 'https://soundcloud.com/rnundane', radio: true, accent: '#bf5af2', accent2: '#64d2ff', symbol: '∞', signals: ['mundane', '2012'] },
]

export const memberById = (id: string | null | undefined) => collective.find(member => member.id === id) ?? null

/** "#crew/rani" → "rani" (only for real members). */
export function memberIdFromHash(hash: string): string | null {
  const match = /^#crew\/([a-z0-9-]+)$/i.exec(hash.trim())
  return match && memberById(match[1].toLowerCase()) ? match[1].toLowerCase() : null
}

/** Which member's signal ends the typed buffer, if any. */
export function signalMatch(buffer: string, members: CollectiveMember[] = collective): string | null {
  const typed = buffer.toLowerCase()
  let best: { id: string; length: number } | null = null
  for (const member of members) {
    for (const signal of member.signals) {
      // Longest match wins, so "1000blunts" is never mistaken for a shorter alias.
      if (typed.endsWith(signal.toLowerCase()) && (!best || signal.length > best.length)) best = { id: member.id, length: signal.length }
    }
  }
  return best?.id ?? null
}
