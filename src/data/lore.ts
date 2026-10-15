/**
 * Underground lore.
 *
 * Short facts about the scene the collective lives in, shown on the entry
 * screen and in the hero instead of describing each theme. Every fact comes
 * from a public source (kept here so anyone can check it); facts about 4EVER
 * come from the collective's own data in this project.
 *
 * To add one: copy an entry, keep it short (one or two sentences), add the source.
 */

export type LoreScene = 'usa' | 'argentina' | 'latam' | 'chile'

export type LoreFact = {
  id: string
  artist: string
  scene: LoreScene
  text: string
  source: { label: string; url?: string }
}

const WIKI_RCB = { label: 'Wikipedia — Reptilian Club Boyz', url: 'https://en.wikipedia.org/wiki/Reptilian_Club_Boyz' }
const WIKI_HIC = { label: 'Wikipedia — Hi-C (rapper, born 1998)', url: 'https://en.wikipedia.org/wiki/Hi-C_(rapper,_born_1998)' }
const WIKI_HEXD = { label: 'Wikipedia — Rare RCB hexD.mp3', url: 'https://en.wikipedia.org/wiki/Rare_RCB_hexD.mp3' }
const WIKI_LIST = { label: 'Wikipedia — List of Internet rap collectives', url: 'https://en.wikipedia.org/wiki/List_of_Internet_rap_collectives' }
const WIKI_NOVA = { label: 'Wikipedia — Novagang', url: 'https://en.wikipedia.org/wiki/Novagang' }
const FADER_NOVA = { label: 'The Fader (2023)', url: 'https://www.thefader.com/2023/08/04/novagang-htng-vol-2-judgement-day' }
const NOBELLS = { label: 'No Bells — Papyrus Rap', url: 'https://nobells.blog/papyrus-rap-shed-theory-1c34/' }
const WIKI_AGUS = { label: 'Wikipedia — AgusFortnite2008', url: 'https://en.wikipedia.org/wiki/AgusFortnite2008' }
const LUCUMA = { label: 'Lúcuma Lúcuma — GS3 y la era VRITNI', url: 'https://lucumalucuma.com/gs3-de-sakoro-nostalgia-alucinada-y-la-llegada-de-la-era-vritni/' }
const VRITNI_TOUR = { label: 'VRITNI España Tour — Barcelona', url: 'https://events.musicofourdesire.com/event/f1rd-vritni-espana-tour-event-barcelona-spain' }
const FOUREVER = { label: 'Datos del colectivo en 4EVERTOOLS' }

export const LORE: LoreFact[] = [
  // ---- Reptilian Club Boyz / Hi-C
  { id: 'rcb-origin', artist: 'Reptilian Club Boyz', scene: 'usa', source: WIKI_RCB,
    text: 'Reptilian Club Boyz nació en Tennessee en 2016, de la mano de Hi-C y Diamondsonmydick. Se les señala como una de las raíces del underground de los 2020.' },
  { id: 'rcb-tapes', artist: 'Reptilian Club Boyz', scene: 'usa', source: WIKI_RCB,
    text: 'La primera mixtape de RCB fue Reptilian Shrine (2017). La última, #RockOutGang, salió el 15 de marzo de 2020.' },
  { id: 'rcb-castlevania', artist: 'Reptilian Club Boyz', scene: 'usa', source: WIKI_RCB,
    text: 'Complex notó que algunos temas de RCB usaban efectos sacados del videojuego Castlevania: Aria of Sorrow.' },
  { id: 'rcb-hexd', artist: 'Rare RCB hexD.mp3', scene: 'usa', source: WIKI_HEXD,
    text: 'En junio de 2019, Stacy Minajj subió como tomoe_theundy1ng "Rare RCB hexD.mp3": temas de RCB pasados por bitcrush. Ese archivo se considera el punto de partida del hexD.' },
  { id: 'hic-name', artist: 'Hi-C', scene: 'usa', source: WIKI_HIC,
    text: 'Hi-C (Christian Shaw, Nashville) sacó su nombre de un ex jefe que pensaba que siempre andaba "high". Se quedó con el apodo.' },
  { id: 'hic-fader', artist: 'Hi-C', scene: 'usa', source: WIKI_HIC,
    text: 'The Fader llamó a Hi-C "una fuerza clave en el desarrollo del hexD" al reseñar su álbum L3Ft 4 D3ad (2023).' },

  // ---- 1c34
  { id: '1c34-clan', artist: '1c34', scene: 'usa', source: WIKI_LIST,
    text: '1c34 empezó en Nueva York en 2021 como un clan de videojuegos. Lo fundaron Xaviersobased, Glost y Cranes, y se les atribuye el microgénero jerk.' },
  { id: '1c34-install', artist: 'Xaviersobased', scene: 'usa', source: NOBELLS,
    text: 'Install (2022), de Xaviersobased, explotó en internet en 2023 gracias a un edit de Slayworldalbania que se volvió meme.' },

  // ---- Novagang
  { id: 'nova-name', artist: 'Novagang', scene: 'usa', source: WIKI_NOVA,
    text: 'Prblm fundó Novagang en 2018. El nombre junta su alias "Nova" con "gang".' },
  { id: 'nova-digicore', artist: 'Novagang', scene: 'usa', source: WIKI_NOVA,
    text: 'Novagang es uno de los colectivos base del digicore. Su mixtape H.T.N.G. VOL 2: JUDGEMENT DAY salió el 6 de agosto de 2023.' },
  { id: 'nova-style', artist: 'Novagang', scene: 'usa', source: WIKI_NOVA,
    text: 'Angelus, de Novagang, describe su sonido como "NOVA style": fuerte, nightcoreado y para todos lados.' },
  { id: 'nova-fader', artist: 'Novagang', scene: 'usa', source: FADER_NOVA,
    text: 'En 2023, The Fader los llamó "los outsiders más hype que hay".' },

  // ---- Shed Theory
  { id: 'shed-1team', artist: 'Shed Theory', scene: 'usa', source: NOBELLS,
    text: 'Antes de llamarse Shed Theory, el grupo se llamaba 1team. Su figura central es Joeyy, y por ahí han pasado Marlon DuBois y Laker.' },
  { id: 'shed-sound', artist: 'Shed Theory', scene: 'usa', source: NOBELLS,
    text: 'El rap de Shed Theory es deconstruido: invierten los bajos y cantan como si se estuvieran quedando dormidos sobre el beat.' },
  { id: 'shed-papyrus', artist: 'Shed Theory', scene: 'usa', source: NOBELLS,
    text: 'Los memes en tipografía Papyrus que esparcieron a Shed Theory y a 1c34 se inspiraron en Tek lintowe, ex Shed Theory.' },

  // ---- Swaggerboyz (Argentina)
  { id: 'swag-minecraft', artist: 'Swaggerboyz', scene: 'argentina', source: WIKI_AGUS,
    text: 'Swaggerboyz son AgusFortnite2008 y Stiffy: se conocieron jugando Minecraft online en 2020 y armaron el dúo ese mismo año.' },
  { id: 'swag-rs', artist: 'Swaggerboyz', scene: 'argentina', source: WIKI_AGUS,
    text: 'Murió la Música (2024), de AgusFortnite2008 y Stiffy, quedó #22 entre los 50 mejores álbumes latinos del año para Rolling Stone.' },
  { id: 'swag-palooza', artist: 'Swaggerboyz', scene: 'argentina', source: WIKI_AGUS,
    text: 'Swaggerboyz tiene su propio festival anual: Swaggerpalooza. Ahí conocieron a turrobaby y Zell y armaron el grupo P.I.L.F.' },
  { id: 'agus-merlo', artist: 'AgusFortnite2008', scene: 'argentina', source: WIKI_AGUS,
    text: 'AgusFortnite2008 creció en Merlo, Buenos Aires, y se describe a sí mismo como una parodia del artista de hip-hop moderno.' },

  // ---- VRITNI (Latam, con Chile)
  { id: 'vritni-network', artist: 'VRITNI', scene: 'latam', source: LUCUMA,
    text: 'VRITNI es una red del trap underground en español con artistas en Colombia, Argentina, Chile y Canadá. Sa!koro lo llamó "el primer intento por crear una red a gran escala".' },
  { id: 'vritni-nulko', artist: 'VRITNI', scene: 'latam', source: VRITNI_TOUR,
    text: 'Nulko (DJ SXJJ) es el fundador y director de VRITNI. En septiembre de 2026 llevó el VRITNI España Tour a Barcelona con Sa!koro y Joshu Joshu.' },
  { id: 'vritni-gs3', artist: 'Sa!koro · VRITNI', scene: 'latam', source: LUCUMA,
    text: 'Sa!koro, del círculo VRITNI, cerró su trilogía GRACIAS SAIKO con GS3. Invitó a AgusFortnite2008 y Stiffy, y el disco termina con una canción para su perrita Lucy.' },

  // ---- 4EVER (Chile)
  { id: '4ever-crew', artist: '4EVER', scene: 'chile', source: FOUREVER,
    text: '4EVER es un colectivo chileno de 10 integrantes. 7 de ellos suenan en la Radio 4EVER de esta misma web.' },
  { id: '4ever-signals', artist: '4EVER', scene: 'chile', source: FOUREVER,
    text: 'Cada integrante de 4EVER tiene su propio mundo aquí, con un sigilo único. Escribe su nombre en la web (fuera de los campos de texto) y encuentras su señal.' },
  { id: '4ever-aliases', artist: '4EVER', scene: 'chile', source: FOUREVER,
    text: 'En 4EVER varios firman doble: aletsandrr también es 1000blunts, mundane también es 2012 y agus también es mella.' },
]

/** Deterministic pick so the same session keeps its fact until you ask for another. */
export function factAt(index: number): LoreFact {
  const n = LORE.length
  return LORE[((index % n) + n) % n]
}

export function randomFactIndex(random: () => number = Math.random): number {
  return Math.floor(random() * LORE.length)
}
