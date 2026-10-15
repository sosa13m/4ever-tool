/**
 * Heritage logo library (the first originals), shown read-only in the
 * Theme Archive. Images are only downloaded when the archive is opened.
 */
import redBlock from '../assets/logos/heritage/logo-1-red-block-og.webp'
import purple from '../assets/logos/heritage/logo-2-purple-og.webp'
import drip from '../assets/logos/heritage/logo-3-drip-og.webp'
import chrome from '../assets/logos/heritage/logo-4-chrome-og.webp'
import neon from '../assets/logos/heritage/logo-5-neon-og.webp'
import pixel from '../assets/logos/heritage/logo-6-pixel-og.webp'
import label from '../assets/logos/heritage/logo-7-label-og.webp'
import blackbook from '../assets/logos/heritage/logo-8-blackbook-og.webp'
import comic from '../assets/logos/heritage/logo-9-comic-og.webp'
import backRoom from '../assets/logos/heritage/logo-backwoods-og.webp'
import presentsHandA from '../assets/logos/heritage/logo-presents-handstyle-a-og.webp'
import presentsHandB from '../assets/logos/heritage/logo-presents-handstyle-b-og.webp'
import presentsRound from '../assets/logos/heritage/logo-presents-rounded-og.webp'
import presentsRoundB from '../assets/logos/heritage/logo-presents-rounded-b-og.webp'

export type HeritageLogo = { id: string; name: string; note: string; src: string }

export const heritageLogos: HeritageLogo[] = [
  { id: 'h-01', name: 'Red Block OG', note: 'First red identity', src: redBlock },
  { id: 'h-02', name: 'Purple OG', note: 'Before the train logo', src: purple },
  { id: 'h-03', name: 'Drip Tag OG', note: 'Graffiti drip', src: drip },
  { id: 'h-04', name: 'Chrome OG', note: 'Chrome archive', src: chrome },
  { id: 'h-05', name: 'Neon OG', note: 'Active in 4EVERPALOOZA', src: neon },
  { id: 'h-06', name: 'Pixel OG', note: '8-bit block', src: pixel },
  { id: 'h-07', name: 'Red Label OG', note: 'Active in 4EVERWOODS', src: label },
  { id: 'h-08', name: 'Blackbook OG', note: 'Active in LIBRETA NEGRA', src: blackbook },
  { id: 'h-09', name: 'Comic OG', note: 'First comic burst', src: comic },
  { id: 'h-10', name: 'Back Room OG', note: 'Active in SÓTANO 4EVER (HD rebuild)', src: backRoom },
  { id: 'h-11', name: '#4ever presents · handstyle A', note: 'Intro card', src: presentsHandA },
  { id: 'h-12', name: '#4ever presents · handstyle B', note: 'Intro card', src: presentsHandB },
  { id: 'h-13', name: '#4ever presents · rounded', note: 'Intro card', src: presentsRound },
  { id: 'h-14', name: '#4ever presents · rounded B', note: 'Intro card', src: presentsRoundB },
]
