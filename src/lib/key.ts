/**
 * 4EVERTOOLS key engine v2.
 *
 * Pipeline:
 *  1. Long FFT frames (16384 @ 22.05 kHz ≈ 1.35 Hz resolution, enough to
 *     separate semitones down to ~55 Hz where 808s and bass live).
 *  2. Spectral PEAKS only (local maxima well above the local floor), with
 *     sub-bin frequency refinement — drums and noise barely contribute.
 *  3. Tuning estimate from all peaks (circular mean of the cent offsets), so
 *     a sample pitched +30 cents is still read in the right key.
 *  4. Pitch-class profile (chroma) per frame, weighted by how tonal the frame
 *     is, summed over the whole track; the bass register is counted extra
 *     because it carries chord roots.
 *  5. Correlation against major/minor key profiles → best key, confidence
 *     from the margin, alternatives, Camelot code.
 *
 * Pure functions, no DOM: runs in the browser and in Node (benchmarks).
 */
import { fft } from './tempo.ts'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']

export type KeyMode = 'major' | 'minor'
export type KeyCandidate = { tonic: number; mode: KeyMode; name: string; camelot: string; score: number }
export type KeyResult = KeyCandidate & {
  confidence: number
  alternatives: KeyCandidate[]
  /** Global tuning offset vs A=440, in cents (e.g. -25 = a quarter-tone flat). */
  tuningCents: number
  /** Normalised 12-bin pitch-class profile, C first. */
  chroma: number[]
}

export type KeyOptions = {
  fftSize?: number
  maxFrames?: number
  profile?: 'krumhansl' | 'temperley' | 'mixed'
  bassBoost?: number
  harmonicFold?: boolean
  compress?: number
}

// Krumhansl & Kessler (1982) probe-tone ratings.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// Temperley (2005) corpus-derived profiles.
const TP_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]
const TP_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export function keyName(tonic: number, mode: KeyMode): string {
  return `${NOTE_NAMES[tonic]} ${mode === 'major' ? 'MAJ' : 'MIN'}`
}

export function camelotOf(tonic: number, mode: KeyMode): string {
  return mode === 'major' ? CAMELOT_MAJOR[tonic] : CAMELOT_MINOR[tonic]
}

/** Inverse of camelotOf: "8A" → "A MIN". */
export function camelotToKey(code: string): string {
  const minor = code.endsWith('A')
  const index = (minor ? CAMELOT_MINOR : CAMELOT_MAJOR).indexOf(code)
  return index < 0 ? code : keyName(index, minor ? 'minor' : 'major')
}

/** Keys that mix harmonically with a Camelot code: same code, ±1 hour, relative major/minor. */
export function compatibleCamelot(code: string): string[] {
  const hour = Number(code.slice(0, -1))
  const letter = code.slice(-1)
  const wrap = (h: number) => ((h + 11) % 12) + 1
  return [`${wrap(hour - 1)}${letter}`, `${wrap(hour + 1)}${letter}`, `${hour}${letter === 'A' ? 'B' : 'A'}`]
}

export async function estimateKey(signal: Float32Array, sampleRate: number, options: KeyOptions = {}, onProgress?: (fraction: number) => void): Promise<KeyResult> {
  const N = options.fftSize ?? 16384
  const maxFrames = options.maxFrames ?? 220
  const compress = options.compress ?? 0.5
  const bassBoost = options.bassBoost ?? 1.5
  const harmonicFold = options.harmonicFold ?? false
  const binHz = sampleRate / N
  const kMin = Math.max(3, Math.floor(50 / binHz))
  const kMax = Math.min(N / 2 - 3, Math.ceil(4200 / binHz))
  const hop = Math.max(N >> 1, Math.floor((signal.length - N) / maxFrames))

  const window = new Float64Array(N)
  for (let i = 0; i < N; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const mag = new Float64Array(N / 2)

  type Peak = { midi: number; weight: number }
  const frames: { peaks: Peak[]; tonal: number }[] = []
  const totalFrames = Math.max(1, Math.floor((signal.length - N) / hop) + 1)

  for (let start = 0, f = 0; start + N <= signal.length; start += hop, f += 1) {
    let energy = 0
    for (let i = 0; i < N; i += 1) {
      re[i] = signal[start + i] * window[i]
      im[i] = 0
      energy += re[i] * re[i]
    }
    if (energy < 1e-6) continue
    fft(re, im)
    let total = 0
    for (let k = kMin - 2; k <= kMax + 2; k += 1) {
      mag[k] = Math.hypot(re[k], im[k])
      total += mag[k] * mag[k]
    }
    // Local floor: running mean over ±24 bins (prefix sums).
    const span = 24
    const prefix = new Float64Array(kMax + span + 3)
    for (let k = 1; k < prefix.length; k += 1) prefix[k] = prefix[k - 1] + (mag[k - 1] ?? 0)
    const peaks: Peak[] = []
    let peakEnergy = 0
    for (let k = kMin; k <= kMax; k += 1) {
      const m = mag[k]
      if (m <= mag[k - 1] || m < mag[k + 1] || m <= mag[k - 2] || m < mag[k + 2]) continue
      const lo = Math.max(0, k - span), hi = Math.min(prefix.length - 1, k + span)
      const floor = (prefix[hi] - prefix[lo]) / (hi - lo)
      if (m < 2.5 * floor) continue
      // Parabolic interpolation on log magnitude for the true peak frequency.
      const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mag[k + 1] + 1e-12)
      const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c || 1e-12)))
      const freq = (k + delta) * binHz
      const midi = 69 + 12 * Math.log2(freq / 440)
      const weight = (m - floor) * (freq < 260 ? bassBoost : 1)
      peaks.push({ midi, weight })
      peakEnergy += m * m
    }
    if (peaks.length) frames.push({ peaks, tonal: Math.min(1, (peakEnergy / (total || 1)) * 2) })
    if (f % 24 === 0) {
      onProgress?.(0.8 * (f / totalFrames))
      await yieldToUi()
    }
  }

  // Tuning: weighted circular mean of each peak's offset from equal temperament.
  let sx = 0, sy = 0
  for (const frame of frames) for (const peak of frame.peaks) {
    const angle = 2 * Math.PI * (peak.midi - Math.round(peak.midi))
    sx += peak.weight * Math.cos(angle)
    sy += peak.weight * Math.sin(angle)
  }
  const tuning = Math.atan2(sy, sx) / (2 * Math.PI) // semitones, -0.5..0.5

  const chroma = new Float64Array(12)
  for (const frame of frames) {
    const local = new Float64Array(12)
    for (const peak of frame.peaks) {
      const m = peak.midi - tuning
      const nearest = Math.round(m)
      const d = m - nearest
      const w = Math.pow(peak.weight, compress) * Math.cos(Math.PI * d) ** 2
      const pc = ((nearest % 12) + 12) % 12
      local[pc] += w
      if (harmonicFold) {
        // Credit the fundamental a 12th below (3rd harmonic) a little.
        local[(pc + 5) % 12] += 0.25 * w
      }
    }
    let sum = 0
    for (let i = 0; i < 12; i += 1) sum += local[i]
    if (!sum) continue
    for (let i = 0; i < 12; i += 1) chroma[i] += (local[i] / sum) * frame.tonal
  }
  const total = chroma.reduce((s, v) => s + v, 0) || 1
  const profile = Array.from(chroma, v => v / total)
  onProgress?.(0.9)

  const candidates: KeyCandidate[] = []
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ['major', 'minor'] as const) {
      candidates.push({ tonic, mode, name: keyName(tonic, mode), camelot: camelotOf(tonic, mode), score: keyScore(profile, tonic, mode, options.profile ?? 'mixed') })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const second = candidates[1]
  const margin = best.score - second.score
  // No tonal material at all (silence, pure drums): say so instead of guessing C major.
  const confidence = frames.length ? clamp(0.25 + best.score * 0.35 + margin * 3, 0.1, 0.97) : 0
  return {
    ...best,
    confidence,
    alternatives: candidates.slice(1, 4),
    tuningCents: Math.round(tuning * 100),
    chroma: profile.map(v => Math.round(v * 1000) / 1000),
  }
}

function keyScore(chroma: number[], tonic: number, mode: KeyMode, profile: NonNullable<KeyOptions['profile']>): number {
  const kk = correlation(chroma, rotate(mode === 'major' ? KK_MAJOR : KK_MINOR, tonic))
  if (profile === 'krumhansl') return kk
  const tp = correlation(chroma, rotate(mode === 'major' ? TP_MAJOR : TP_MINOR, tonic))
  if (profile === 'temperley') return tp
  return (kk + tp) / 2
}

function rotate(profile: number[], tonic: number): number[] {
  return profile.map((_, index) => profile[(index - tonic + 12) % 12])
}

function correlation(a: number[], b: number[]): number {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length
  const meanB = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - meanA, y = b[i] - meanB
    num += x * y; da += x * x; db += y * y
  }
  return num / (Math.sqrt(da * db) + 1e-12)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
