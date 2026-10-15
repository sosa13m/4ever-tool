/**
 * 4EVERTOOLS tempo engine v2.
 *
 * Pipeline:
 *  1. Multi-band onset envelope: log-magnitude spectral flux in 4 bands
 *     (kick / low-mid / snare / hats), each band normalized so a loud hi-hat
 *     line cannot drown out the kick and snare.
 *  2. Autocorrelation of the envelope (via FFT) over the whole track.
 *  3. Comb salience: for every candidate BPM, average the autocorrelation at
 *     1..N beat periods. Using many periods makes the peak very sharp, which
 *     gives ~0.1 BPM precision even though one envelope frame is ~11 ms.
 *  4. Octave decision (half-time vs double-time) combining salience with a
 *     soft log-tempo prior, then a fine refinement and integer snapping.
 *
 * Pure functions, no DOM: runs in the browser and in Node (benchmarks).
 */

export type TempoCandidate = { bpm: number; score: number }

export type TempoResult = {
  bpm: number
  /** Unsnapped estimate, useful to spot tracks that are not on an integer grid. */
  rawBpm: number
  confidence: number
  /** Strongest distinct tempi (octaves of the winner excluded), best first. */
  candidates: TempoCandidate[]
  /** Seconds analysed (after skipping leading silence). */
  analysedSeconds: number
}

export type ProgressFn = (fraction: number) => void

const FRAME = 1024
const HOP = 256
const MIN_BPM = 50
const MAX_BPM = 220
const BANDS: [number, number, number][] = [
  // [lowHz, highHz, weight]
  [30, 150, 1.0], // kick / 808
  [150, 500, 0.6], // low-mid body
  [500, 3000, 1.0], // snare / clap
  [3000, 9000, 0.7], // hats / shakers
]
const PRIOR_CENTER_BPM = 120
const HAT_BAND = 3
/** Above this the double reading is not offered automatically (boom bap 90 stays 90, not 180). */
const MAX_DOUBLE_BPM = 178
const MIN_HAT_PERIODICITY = 0.12
const HAT_DENSITY_THRESHOLD = 0.25
const PRIOR_OCTAVES = 0.85

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export async function estimateTempo(signal: Float32Array, sampleRate: number, onProgress?: ProgressFn): Promise<TempoResult> {
  const trimmed = trimSilence(signal, sampleRate)
  const analysedSeconds = trimmed.length / sampleRate
  if (analysedSeconds < 4) {
    return { bpm: 0, rawBpm: 0, confidence: 0, candidates: [], analysedSeconds }
  }

  const { combined, bands } = await onsetEnvelope(trimmed, sampleRate, onProgress)
  const rate = sampleRate / HOP
  const acf = autocorrelation(combined)
  const hatAcf = autocorrelation(bands[HAT_BAND])
  onProgress?.(0.9)

  // Coarse salience curve over the full BPM range.
  const coarse: TempoCandidate[] = []
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    coarse.push({ bpm, score: combSalience(acf, rate, bpm, 16) })
  }
  const peaks = pickPeaks(coarse)
  if (!peaks.length) {
    return { bpm: 0, rawBpm: 0, confidence: 0, candidates: [], analysedSeconds }
  }

  // 1) Strongest tempo family: best salience x soft prior among the top peaks.
  let family = peaks[0].bpm
  let familyValue = -Infinity
  for (const peak of peaks.slice(0, 6)) {
    const value = peak.score * tempoPrior(peak.bpm)
    if (value > familyValue) {
      familyValue = value
      family = peak.bpm
    }
  }

  // 2) Octave decision. Fold the family into [60, 120) = "slow" reading S and
  //    decide between S and 2S the way producers label tracks: if the hats run
  //    16ths (or triplets) of S, the track is quoted at 2S (trap 140, DnB 174,
  //    house 124); with plain 8th hats it stays at S (boom bap 84, lo-fi 75).
  const slow = foldToRange(family, 60, 120)
  const fast = slow * 2
  let chosen = slow
  if (fast <= MAX_DOUBLE_BPM) {
    const density = hatDensity(hatAcf, rate, slow)
    if (density !== null) {
      chosen = density >= HAT_DENSITY_THRESHOLD ? fast : slow
    } else {
      // No usable hat line: fall back to salience x prior.
      chosen = combSalience(acf, rate, fast, 16) * tempoPrior(fast) > combSalience(acf, rate, slow, 16) * tempoPrior(slow) ? fast : slow
    }
  }

  // 3) Fine refinement with many periods for sub-BPM precision.
  const rawBpm = refine(acf, rate, refine(acf, rate, chosen, 0.03, 16), 0.01, 48)
  const bpm = snapBpm(rawBpm)

  // Confidence: how much the winner stands out from non-octave competitors,
  // scaled by how periodic the track is at all.
  const winnerScore = combSalience(acf, rate, rawBpm, 16)
  const competitors = peaks.filter(peak => !octaveRelated(peak.bpm, rawBpm))
  const runnerUp = competitors[0]?.score ?? 0
  const floor = median(coarse.map(item => item.score))
  const prominence = (winnerScore - floor) / (Math.abs(winnerScore) + 1e-9)
  const separation = (winnerScore - Math.max(runnerUp, floor)) / (Math.abs(winnerScore) + 1e-9)
  const periodicity = clamp(winnerScore / 0.35, 0, 1)
  const confidence = clamp(0.15 + 0.35 * clamp(separation, 0, 1) + 0.25 * clamp(prominence, 0, 1) + 0.25 * periodicity, 0.05, 0.98)

  return {
    bpm,
    rawBpm: round2(rawBpm),
    confidence,
    candidates: competitors.slice(0, 3).map(item => ({ bpm: round1(item.bpm), score: round2(item.score / (winnerScore || 1)) })),
    analysedSeconds,
  }
}

/** Skip leading/trailing near-silence so fades and intros do not dilute the analysis. */
function trimSilence(signal: Float32Array, sampleRate: number): Float32Array {
  const block = Math.floor(sampleRate * 0.05)
  let peak = 0
  for (let i = 0; i < signal.length; i += 1) peak = Math.max(peak, Math.abs(signal[i]))
  const threshold = peak * 0.01
  const loud = (start: number) => {
    let sum = 0
    const end = Math.min(signal.length, start + block)
    for (let i = start; i < end; i += 1) sum += signal[i] * signal[i]
    return Math.sqrt(sum / Math.max(1, end - start)) > threshold
  }
  let start = 0
  while (start < signal.length && !loud(start)) start += block
  let end = signal.length
  while (end > start && !loud(Math.max(start, end - block))) end -= block
  return signal.subarray(start, end)
}

async function onsetEnvelope(signal: Float32Array, sampleRate: number, onProgress?: ProgressFn): Promise<{ combined: Float32Array; bands: Float32Array[] }> {
  const frames = Math.max(0, Math.floor((signal.length - FRAME) / HOP))
  const binHz = sampleRate / FRAME
  const bandBins = BANDS.map(([low, high]) => [Math.max(1, Math.floor(low / binHz)), Math.min(FRAME / 2 - 1, Math.ceil(high / binHz))])
  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))

  // Normalize level so the log compression behaves the same for quiet and loud masters.
  let sumSquares = 0
  for (let i = 0; i < signal.length; i += 1) sumSquares += signal[i] * signal[i]
  const gain = 1 / (Math.sqrt(sumSquares / Math.max(1, signal.length)) + 1e-9)

  const bandFlux = BANDS.map(() => new Float32Array(frames))
  const previous = new Float64Array(FRAME / 2)
  const current = new Float64Array(FRAME / 2)
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)

  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * HOP
    for (let i = 0; i < FRAME; i += 1) {
      re[i] = signal[start + i] * window[i] * gain
      im[i] = 0
    }
    fft(re, im)
    for (let k = 1; k < FRAME / 2; k += 1) current[k] = Math.log1p(10 * Math.hypot(re[k], im[k]))
    if (frame > 0) {
      for (let b = 0; b < BANDS.length; b += 1) {
        const [lo, hi] = bandBins[b]
        let flux = 0
        for (let k = lo; k <= hi; k += 1) {
          const diff = current[k] - previous[k]
          if (diff > 0) flux += diff
        }
        bandFlux[b][frame] = flux / (hi - lo + 1)
      }
    }
    previous.set(current)
    if (frame % 4000 === 0) {
      onProgress?.(0.85 * (frame / frames))
      await yieldToUi()
    }
  }

  // Per band: remove the slow trend (~1 s moving average), half-wave rectify,
  // normalize by standard deviation, then mix with band weights.
  const rate = sampleRate / HOP
  const envelope = new Float32Array(frames)
  const bands: Float32Array[] = []
  for (let b = 0; b < BANDS.length; b += 1) {
    const detrended = detrend(bandFlux[b], Math.round(rate))
    const std = standardDeviation(detrended) || 1
    const weight = BANDS[b][2]
    for (let i = 0; i < frames; i += 1) {
      detrended[i] /= std
      envelope[i] += weight * detrended[i]
    }
    bands.push(detrended)
  }
  return { combined: envelope, bands }
}

function detrend(values: Float32Array, windowSize: number): Float32Array {
  const output = new Float32Array(values.length)
  const half = Math.floor(windowSize / 2)
  const prefix = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i += 1) prefix[i + 1] = prefix[i] + values[i]
  for (let i = 0; i < values.length; i += 1) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(values.length, i + half + 1)
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo)
    output[i] = Math.max(0, values[i] - mean)
  }
  return output
}

/** Normalized autocorrelation (acf[0] = 1) computed with an FFT. */
function autocorrelation(envelope: Float32Array): Float64Array {
  let mean = 0
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i]
  mean /= Math.max(1, envelope.length)
  let size = 1
  while (size < envelope.length * 2) size <<= 1
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < envelope.length; i += 1) re[i] = envelope[i] - mean
  fft(re, im)
  for (let i = 0; i < size; i += 1) {
    re[i] = re[i] * re[i] + im[i] * im[i]
    im[i] = 0
  }
  // Inverse FFT via conjugation trick (power spectrum is real and symmetric).
  fft(re, im)
  const length = envelope.length
  const acf = new Float64Array(length)
  const zero = re[0] || 1
  // Unbiased: compensate for fewer overlapping samples at long lags.
  for (let lag = 0; lag < length; lag += 1) acf[lag] = (re[lag] / zero) * (length / Math.max(1, length - lag))
  return acf
}

function acfAt(acf: Float64Array, lag: number): number {
  const i = Math.floor(lag)
  if (i < 0 || i + 1 >= acf.length) return 0
  const fraction = lag - i
  return acf[i] * (1 - fraction) + acf[i + 1] * fraction
}

/** Average autocorrelation at 1..N beat periods (only lags that fit the track). */
function combSalience(acf: Float64Array, rate: number, bpm: number, periods: number): number {
  const period = (60 * rate) / bpm
  const usable = Math.min(periods, Math.floor((acf.length * 0.5) / period))
  if (usable < 2) return 0
  let sum = 0
  for (let n = 1; n <= usable; n += 1) {
    // Take the local max within ±1 frame so slight swing/humanize is tolerated.
    const lag = n * period
    sum += Math.max(acfAt(acf, lag - 0.5), acfAt(acf, lag), acfAt(acf, lag + 0.5))
  }
  return sum / usable
}

function acfMaxAround(acf: Float64Array, lag: number, halfWidth: number): number {
  let best = -Infinity
  const steps = Math.max(1, Math.ceil(halfWidth * 2))
  for (let i = 0; i <= steps; i += 1) best = Math.max(best, acfAt(acf, lag - halfWidth + (2 * halfWidth * i) / steps))
  return best
}

/**
 * How busy the hats are relative to the slow beat S:
 * ~0 when hats play 8ths of S, high when they play 16ths or triplets of S.
 * Compares hat-band autocorrelation at odd 16th lags (and non-8th triplet lags)
 * against the 8th off-beat lags. Returns null when the hat band has no
 * periodic content to judge from.
 */
function hatDensity(hatAcf: Float64Array, rate: number, slowBpm: number): number | null {
  const beat = (60 * rate) / slowBpm
  const tolerance = Math.max(0.6, beat * 0.03)
  const mean = (lags: number[]) => lags.reduce((sum, lag) => sum + Math.max(0, acfMaxAround(hatAcf, lag, tolerance)), 0) / lags.length
  const eighths = mean([0.5, 1.5, 2.5, 3.5].map(n => n * beat))
  const sixteenths = mean([0.25, 0.75, 1.25, 1.75, 2.25, 2.75].map(n => n * beat))
  const triplets = mean([1 / 6, 1 / 3, 2 / 3, 5 / 6, 7 / 6, 4 / 3].map(n => n * beat))
  const busy = Math.max(sixteenths, triplets)
  // Syncopated drill hats may skip the 8th off-beats entirely: still "busy".
  if (eighths < MIN_HAT_PERIODICITY && busy < MIN_HAT_PERIODICITY) return null
  return busy / Math.max(eighths, MIN_HAT_PERIODICITY)
}

function refine(acf: Float64Array, rate: number, bpm: number, relativeSpan: number, periods: number): number {
  let best = bpm
  let bestScore = -Infinity
  // Two passes: 0.05 BPM grid, then 0.01 around the winner.
  for (const [span, step] of [[bpm * relativeSpan, 0.05], [0.06, 0.01]] as const) {
    const center = best
    for (let candidate = center - span; candidate <= center + span + 1e-9; candidate += step) {
      const score = combSalience(acf, rate, candidate, periods)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
  }
  return best
}

function pickPeaks(curve: TempoCandidate[]): TempoCandidate[] {
  const peaks: TempoCandidate[] = []
  for (let i = 1; i < curve.length - 1; i += 1) {
    if (curve[i].score > curve[i - 1].score && curve[i].score >= curve[i + 1].score && curve[i].score > 0) peaks.push(curve[i])
  }
  return peaks.sort((a, b) => b.score - a.score)
}

/** Soft preference for the tempo range producers usually quote (log-normal around 120 BPM). */
/** Move a tempo by octaves (x2 / /2) until it lies in [min, max). */
export function foldToRange(bpm: number, min: number, max: number): number {
  if (!(bpm > 0) || max <= min * 1.99) return bpm
  let value = bpm
  while (value >= max) value /= 2
  while (value < min) value *= 2
  return value >= max ? bpm : Math.round(value * 100) / 100
}

export function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PRIOR_CENTER_BPM)
  return Math.exp(-0.5 * (octaves / PRIOR_OCTAVES) ** 2)
}

function octaveRelated(a: number, b: number): boolean {
  const ratio = Math.log2(a / b)
  return Math.abs(ratio - Math.round(ratio)) < 0.03
}

/** Produced music is almost always on an integer grid; snap when very close. */
export function snapBpm(bpm: number): number {
  const integer = Math.round(bpm)
  if (Math.abs(bpm - integer) <= 0.15) return integer
  return round1(bpm)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function standardDeviation(values: Float32Array): number {
  let mean = 0
  for (let i = 0; i < values.length; i += 1) mean += values[i]
  mean /= Math.max(1, values.length)
  let variance = 0
  for (let i = 0; i < values.length; i += 1) variance += (values[i] - mean) ** 2
  return Math.sqrt(variance / Math.max(1, values.length))
}

/** In-place radix-2 complex FFT. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const wLenRe = Math.cos(angle)
    const wLenIm = Math.sin(angle)
    const half = length / 2
    for (let i = 0; i < n; i += length) {
      let wRe = 1
      let wIm = 0
      for (let j = 0; j < half; j += 1) {
        const a = i + j
        const b = a + half
        const vRe = re[b] * wRe - im[b] * wIm
        const vIm = re[b] * wIm + im[b] * wRe
        re[b] = re[a] - vRe
        im[b] = im[a] - vIm
        re[a] += vRe
        im[a] += vIm
        const nextWRe = wRe * wLenRe - wIm * wLenIm
        wIm = wRe * wLenIm + wIm * wLenRe
        wRe = nextWRe
      }
    }
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100
