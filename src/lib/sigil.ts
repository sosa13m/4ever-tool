/**
 * Member sigils: a small symmetric mark generated from the member id, so every
 * profile has its own visual identity even before photos exist. Deterministic:
 * the same id always draws the same sigil. Pure, no DOM (tested in Node).
 */

export type Sigil = {
  /** Filled cells of a 7×7 grid, mirrored left/right. */
  cells: Array<[number, number]>
  /** 0–3: how the outer ring is drawn (none, solid, dashed, dotted). */
  ring: 0 | 1 | 2 | 3
  /** Rotation of the whole mark, in degrees (multiples of 90). */
  rotation: number
  /** Stable fingerprint, useful for tests and for picking pattern variants. */
  seed: number
}

export const SIGIL_GRID = 7

/** FNV-1a 32-bit. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeSigil(id: string): Sigil {
  const seed = hashString(`4ever:${id}`)
  const random = mulberry32(seed)
  const half = Math.ceil(SIGIL_GRID / 2)
  const center = Math.floor(SIGIL_GRID / 2)
  const filled = new Set<string>()
  // Keep the middle of the mark free for the member's symbol: denser near the edge.
  for (let y = 0; y < SIGIL_GRID; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const distance = Math.max(Math.abs(x - center), Math.abs(y - center))
      if (distance <= 1) continue
      if (random() < (distance === 3 ? 0.46 : 0.58)) {
        filled.add(`${x},${y}`)
        filled.add(`${SIGIL_GRID - 1 - x},${y}`)
      }
    }
  }
  // Too sparse reads as noise: guarantee a recognisable mark.
  for (let y = 0; filled.size < 12 && y < SIGIL_GRID; y += 2) {
    filled.add(`0,${y}`)
    filled.add(`${SIGIL_GRID - 1},${y}`)
  }
  const cells = [...filled].map(key => key.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  return { cells, ring: (Math.floor(random() * 4) as Sigil['ring']), rotation: Math.floor(random() * 4) * 90, seed }
}

/** WCAG relative luminance → black or white text on that colour. */
export function inkOn(hex: string): '#0b0b0b' | '#ffffff' {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.179 ? '#0b0b0b' : '#ffffff'
}

export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const clean = hex.replace('#', '')
    const [r, g, bl] = [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
