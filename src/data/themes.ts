import trueUndergroundOg from '../assets/logos/logo-true-underground-og.webp'
import purpleLine from '../assets/logos/logo-purple-line.webp'
import starRule from '../assets/logos/logo-star-rule.webp'
import neonOg from '../assets/logos/logo-neon-og.webp'
import blackbookOg from '../assets/logos/logo-blackbook-white-og.webp'
import hotComic from '../assets/logos/logo-hot-comic.webp'
import aquaCartoon from '../assets/logos/logo-aqua-cartoon.webp'
import legacyLabel from '../assets/logos/logo-legacy-label-og.webp'
import frutigerSecret from '../assets/logos/logo-frutiger-secret.webp'
import retroRpg from '../assets/logos/logo-retro-rpg.webp'

export type Texture = 'subway' | 'chrome' | 'pixel' | 'acid' | 'poster' | 'ink' | 'cosmic' | 'aero' | 'oldweb' | 'aqua' | 'leaf' | 'quest'

export type Theme = {
  id: string
  name: string
  logo: string
  /** width / height of the trimmed logo file; drives area-based sizing. */
  logoRatio: number
  accent: string
  accent2: string
  surface: string
  paper: string
  ink: string
  rarity: number
  texture: Texture
  headline: string
  subline: string
  stamp: string
}

export const themes: Theme[] = [
  {
    id: 'red-block',
    name: 'SÓTANO 4EVER',
    logo: trueUndergroundOg, logoRatio: 1.488,
    accent: '#d93025',
    accent2: '#f6f1eb',
    surface: '#100708',
    paper: '#f6f1eb',
    ink: '#130807',
    rarity: 15,
    texture: 'poster',
    // a basement record shop — wheat-paste flyers, photocopies, tape and a crate.
    headline: 'THE BACK ROOM IS OPEN AGAIN.',
    subline: 'A basement record shop under a bare bulb: wheat-pasted flyers, photocopied paper, masking tape and a crate of new arrivals.',
    stamp: 'SÓTANO 4EVER',
  },
  {
    id: 'purple-subway',
    name: 'LINEA 4 EVER',
    logo: purpleLine, logoRatio: 2.954,
    accent: '#7c4dff',
    accent2: '#d8b4ff',
    surface: '#09060f',
    paper: '#f6f0ff',
    ink: '#070409',
    rarity: 22,
    texture: 'subway',
    headline: 'LAST TRAIN TO THE LAB.',
    // subway graffiti — tagged tiles, a bombed train, spray-paint buttons (texts now show underground facts).
    subline: 'Subway graffiti: tagged tiles, a bombed train with a 4EVER piece, spray-paint buttons and drips.',
    stamp: 'LINEA 4 · ALL CITY',
  },
  {
    id: 'star-rule',
    name: 'RULE4EVER',
    logo: starRule, logoRatio: 1.781,
    accent: '#07510b',
    accent2: '#ffffff',
    surface: '#a9e5a3',
    paper: '#f4f4f4',
    ink: '#050505',
    rarity: 14,
    texture: 'oldweb',
    headline: 'WELCOME TO THE 4EVER INTERNET.',
    subline: 'Pastel-green old-web minimalism with blue links, flat controls and modern motion hidden under deliberately simple HTML energy.',
    stamp: 'OLD WEB / RULE4EVER',
  },
  {
    id: 'neon-tour',
    name: '4EVERPALOOZA',
    logo: neonOg, logoRatio: 1.741,
    accent: '#56ff18',
    accent2: '#ff29bd',
    surface: '#020202',
    paper: '#f7fff3',
    ink: '#050505',
    rarity: 13,
    texture: 'acid',
    headline: 'KEEP IT TOXIC.',
    // festival / tour site — truss, beams, lasers, crowd and a lineup poster.
    subline: 'Festival night: a lighting truss, sweeping beams, a laser fan over the crowd, chamfered stage passes and a lineup built from the collective.',
    stamp: '4EVERPALOOZA',
  },
  {
    id: 'blackbook',
    name: 'LIBRETA NEGRA',
    logo: blackbookOg, logoRatio: 2.056,
    accent: '#ffffff',
    accent2: '#101010',
    surface: '#0a0a0a',
    paper: '#f4f1e9',
    ink: '#080808',
    rarity: 11,
    texture: 'ink',
    headline: 'BLACK INK. WHITE PAINT.',
    // the sketchbook — black cover, white-paint drips, cream pages, spiral binding.
    subline: 'The sketchbook: a worn black cover, white-paint drips and doodles, cream pages with spiral binding and a to-do list torn out of the book.',
    stamp: 'PAGE 134 / ALL CITY',
  },
  {
    id: 'comic-hit',
    name: '4EVERCHOX',
    logo: hotComic, logoRatio: 3.836,
    accent: '#ffb400',
    accent2: '#e51d1d',
    surface: '#171c28',
    paper: '#f3f3f3',
    ink: '#171717',
    rarity: 10,
    texture: 'poster',
    headline: 'WELCOME TO THE 4EVERCHOX PORTAL.',
    subline: 'Dark portal navigation, white content panels, yellow section bars, red outlines, tags, categories and old-web comic energy rebuilt for 4EVERTOOLS.',
    stamp: '4EVERCHOX / PORTAL',
  },
  {
    id: 'aqua-cartoon',
    name: 'SQUAREGODPANTS',
    logo: aquaCartoon, logoRatio: 1.95,
    accent: '#ffe735',
    accent2: '#15c9d6',
    surface: '#063c68',
    paper: '#eaffff',
    ink: '#05254a',
    rarity: 8,
    texture: 'aqua',
    headline: 'DROP BELOW THE SURFACE.',
    subline: 'A cartoon deep-sea world: sunlight through the waves, rising bubbles, swaying kelp, drifting jellyfish and squishy controls. Scroll to dive.',
    stamp: 'SQUAREGODPANTS',
  },
  {
    id: 'legacy-label',
    name: '4EVERWOODS',
    logo: legacyLabel, logoRatio: 2.306,
    accent: '#d82314',
    accent2: '#f2e6d0',
    surface: '#120808',
    paper: '#f2e6d0',
    ink: '#1a0d0b',
    rarity: 7,
    texture: 'leaf',
    // dressed after classic leaf-wrap label sites — dark red grain, leaf browns,
    // condensed type, red pills. Original 4EVER artwork only, no third-party marks.
    headline: 'Born raw. Stays 4EVER.',
    subline: 'Dark red grain, cured-leaf browns, condensed type and red pill buttons: the first red label, aged like a classic.',
    stamp: '4EVERWOODS',
  },

  // 4EVERTALE returns with a new 16-bit JRPG look (same pixel logo).
  {
    id: 'tale',
    name: '4EVERTALE',
    logo: retroRpg, logoRatio: 4.815,
    accent: '#b18cff',
    accent2: '#ffffff',
    surface: '#000000',
    paper: '#ffffff',
    ink: '#000000',
    rarity: 8,
    texture: 'quest',
    headline: 'A NEW QUEST BEGINS.',
    subline: 'A 16-bit adventure in the dark: a pixel fortress on the cliffs, black command windows, a party menu for every tool and HP bars for every upload.',
    stamp: 'SAVE POINT',
  },

  // Secret world remains Frutiger Aero and never appears in the normal archive.
  {
    id: 'secret-true',
    name: '4EVER VISTA',
    logo: frutigerSecret, logoRatio: 2.998,
    accent: '#00aef3',
    accent2: '#70e63c',
    surface: '#dff8ff',
    paper: '#ffffff',
    ink: '#08354f',
    rarity: 0,
    texture: 'aero',
    headline: 'THE AIR FEELS DIFFERENT HERE.',
    // Frutiger Aero — liquid glass, gel buttons, sky, ribbons, bubbles and gadgets.
    subline: 'Secret Frutiger Aero reality: liquid glass panes, aqua gel buttons, light ribbons over green hills, glossy bubbles and impossible optimism.',
    stamp: 'VISTA · SECRET',
  },
]

export const publicThemes = themes.filter(theme => theme.rarity > 0)


export const weightedTheme = () => {
  const pool = publicThemes.flatMap(theme => Array.from({ length: theme.rarity }, () => theme))
  return pool[Math.floor(Math.random() * pool.length)]
}

export const getTheme = (id: string | null) => themes.find(theme => theme.id === id)
