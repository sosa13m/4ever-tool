/**
 * 4EVER LAB audio engine: trim, reverse, speed, pitch, WAV export.
 * Pure functions on Float32Array channels — no DOM, so it runs (and is tested) in Node.
 *
 * Speed and pitch share one path:
 *   tempo T (1.25 = 25 % faster) and pitch factor P (2^(semitones/12)).
 *   Tape mode ("varispeed") also raises pitch with speed, like a turntable.
 *   1. time-stretch by R = P_total / T (phase vocoder, keeps pitch)
 *   2. resample by P_total (sinc, changes pitch and length)
 *   → final length = len / T, final pitch = × P_total.
 *   When R = 1 only the resampler runs (no stretch artefacts); when P_total = 1 only the stretch runs.
 */

export type Channels = Float32Array[]
export type Progress = (fraction: number, label: string) => void

export type LabSettings = {
  /** Selection in seconds. */
  start: number
  end: number
  reverse: boolean
  /** 0.5 – 2. */
  speed: number
  /** true = time-stretch (pitch stays); false = tape (pitch follows speed). */
  keepPitch: boolean
  /** −12 … +12. */
  semitones: number
  /** Fade at the cut points, in ms (avoids clicks). */
  fadeMs: number
}

export type LabResult = { channels: Channels; sampleRate: number; peakGainDb: number; seconds: number }

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

// ---------------------------------------------------------------- basics

export function trim(channels: Channels, sampleRate: number, start: number, end: number, fadeMs = 4): Channels {
  const length = channels[0]?.length ?? 0
  const a = Math.max(0, Math.min(length, Math.round(start * sampleRate)))
  const b = Math.max(a, Math.min(length, Math.round(end * sampleRate)))
  const fade = Math.min(Math.floor((b - a) / 2), Math.round((fadeMs / 1000) * sampleRate))
  return channels.map(channel => {
    const out = channel.slice(a, b)
    for (let i = 0; i < fade; i += 1) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade) // raised cosine 0 → 1
      out[i] *= g
      out[out.length - 1 - i] *= g
    }
    return out
  })
}

export function reverse(channels: Channels): Channels {
  return channels.map(channel => channel.slice().reverse())
}

export const pitchFactor = (semitones: number) => 2 ** (semitones / 12)

/** Final pitch/tempo plan for a set of settings. */
export function plan(settings: Pick<LabSettings, 'speed' | 'keepPitch' | 'semitones'>) {
  const tempo = settings.speed
  const pitch = pitchFactor(settings.semitones) * (settings.keepPitch ? 1 : settings.speed)
  return { tempo, pitch, stretch: pitch / tempo }
}

// ---------------------------------------------------------------- resampler (windowed sinc, table driven)

const SINC_ZEROS = 10 // half-width in zero crossings
const SINC_RES = 1024 // table points per zero crossing
let sincTable: Float32Array | null = null

function kernel(): Float32Array {
  if (sincTable) return sincTable
  const size = SINC_ZEROS * SINC_RES + 2
  sincTable = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    const x = i / SINC_RES
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
    // Blackman window over [-ZEROS, ZEROS]
    const t = x / SINC_ZEROS
    const window = t >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t)
    sincTable[i] = sinc * window
  }
  return sincTable
}

/**
 * Read the input `rate` times faster (rate 2 = an octave up, half as long).
 * Anti-aliased: when speeding up, the kernel widens to low-pass below the new Nyquist.
 */
export async function resample(input: Float32Array, rate: number, onProgress?: (f: number) => void): Promise<Float32Array> {
  if (Math.abs(rate - 1) < 1e-9) return input.slice()
  const table = kernel()
  const cutoff = Math.min(1, 1 / rate)
  const outLength = Math.max(1, Math.floor(input.length / rate))
  const out = new Float32Array(outLength)
  const halfWidth = SINC_ZEROS / cutoff
  const step = SINC_RES * cutoff
  for (let n = 0; n < outLength; n += 1) {
    const t = n * rate
    const lo = Math.max(0, Math.ceil(t - halfWidth))
    const hi = Math.min(input.length - 1, Math.floor(t + halfWidth))
    let sum = 0
    for (let k = lo; k <= hi; k += 1) {
      const pos = Math.abs(t - k) * step
      const idx = pos | 0
      if (idx >= table.length - 1) continue
      const frac = pos - idx
      sum += input[k] * (table[idx] + (table[idx + 1] - table[idx]) * frac)
    }
    out[n] = sum * cutoff
    if ((n & 0x3ffff) === 0 && n) {
      onProgress?.(n / outLength)
      await yieldToUi()
    }
  }
  onProgress?.(1)
  return out
}

// ---------------------------------------------------------------- FFT (precomputed, power of two)

type FftPlan = { n: number; rev: Uint32Array; twR: Float64Array; twI: Float64Array }
const plans = new Map<number, FftPlan>()

function fftPlan(n: number): FftPlan {
  let p = plans.get(n)
  if (p) return p
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i += 1) {
    let r = 0
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  // Twiddles laid out stage by stage (half = 1, 2, 4 … n/2) so the inner loop reads them contiguously.
  const twR = new Float64Array(n)
  const twI = new Float64Array(n)
  for (let half = 1; half < n; half <<= 1) {
    for (let j = 0; j < half; j += 1) {
      twR[half + j] = Math.cos((-Math.PI * j) / half)
      twI[half + j] = Math.sin((-Math.PI * j) / half)
    }
  }
  p = { n, rev, twR, twI }
  plans.set(n, p)
  return p
}

/** In-place complex FFT; inverse = true gives the unscaled inverse. */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false) {
  const { n, rev, twR, twI } = fftPlan(re.length)
  for (let i = 0; i < n; i += 1) {
    const j = rev[i]
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  // First stage (half = 1) has twiddle 1: plain butterflies.
  for (let a = 0; a < n; a += 2) {
    const b = a + 1
    const xr = re[b], xi = im[b]
    re[b] = re[a] - xr; im[b] = im[a] - xi
    re[a] += xr; im[a] += xi
  }
  const sign = inverse ? -1 : 1
  for (let half = 2; half < n; half <<= 1) {
    const size = half << 1
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j += 1) {
        const wr = twR[half + j]
        const wi = sign * twI[half + j]
        const a = start + j
        const b = a + half
        const br = re[b], bi = im[b]
        const xr = br * wr - bi * wi
        const xi = br * wi + bi * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

// ---------------------------------------------------------------- phase vocoder with identity phase locking

const TWO_PI = Math.PI * 2
const wrap = (x: number) => x - TWO_PI * Math.round(x / TWO_PI)

type PvState = {
  mag: Float64Array; prevMag: Float64Array
  xr: Float64Array; xi: Float64Array // this frame's input spectrum
  pr: Float64Array; pi: Float64Array // previous input spectrum
  yr: Float64Array; yi: Float64Array // this frame's output spectrum
  qr: Float64Array; qi: Float64Array // previous output spectrum
  rotR: Float64Array; rotI: Float64Array
  peaks: Int32Array
  flux: number; magSum: number
}

function pvState(half: number): PvState {
  const f = () => new Float64Array(half)
  return { mag: f(), prevMag: f(), xr: f(), xi: f(), pr: f(), pi: f(), yr: f(), yi: f(), qr: f(), qi: f(), rotR: f(), rotI: f(), peaks: new Int32Array(half), flux: 0, magSum: 0 }
}

/**
 * One frame of the vocoder for one channel. Only the spectral peaks need trig
 * (phase advance from their true frequency); every other bin is rotated with
 * its peak (identity phase locking, Laroche & Dolson) by one complex multiply.
 */
function pvFrame(s: PvState, half: number, omega: Float64Array, Ha: number, Hs: number, first: boolean) {
  let magSum = 0, flux = 0
  for (let k = 0; k < half; k += 1) {
    const m = Math.sqrt(s.xr[k] * s.xr[k] + s.xi[k] * s.xi[k])
    flux += Math.max(0, m - s.prevMag[k]) * k
    s.mag[k] = m
    magSum += m
  }
  // Onset (sudden high-frequency rise): restart phases from the input, keeps kicks and snares sharp.
  const onset = first || (flux > 2.2 * s.flux && magSum > 1.4 * s.magSum && magSum > 1e-3)
  s.flux = flux * 0.6 + s.flux * 0.4
  s.magSum = magSum
  if (onset) {
    s.yr.set(s.xr); s.yi.set(s.xi)
  } else {
    let count = 0
    const m = s.mag
    for (let k = 2; k < half - 2; k += 1) if (m[k] > m[k - 1] && m[k] >= m[k + 1] && m[k] > m[k - 2] && m[k] >= m[k + 2]) s.peaks[count++] = k
    if (!count) {
      // Silence / noise floor: plain phase advance by the bin frequency.
      for (let k = 0; k < half; k += 1) {
        const a = omega[k] * Hs - omega[k] * Ha
        const c = Math.cos(a), d = Math.sin(a)
        const qa = Math.atan2(s.qi[k], s.qr[k]) - Math.atan2(s.pi[k], s.pr[k]) // keep continuity with the previous output
        const cr = Math.cos(qa) * c - Math.sin(qa) * d, ci = Math.cos(qa) * d + Math.sin(qa) * c
        s.yr[k] = s.xr[k] * cr - s.xi[k] * ci
        s.yi[k] = s.xr[k] * ci + s.xi[k] * cr
      }
    } else {
      for (let p = 0; p < count; p += 1) {
        const k = s.peaks[p]
        const phase = Math.atan2(s.xi[k], s.xr[k])
        const prevPhase = Math.atan2(s.pi[k], s.pr[k])
        const prevOut = Math.atan2(s.qi[k], s.qr[k])
        const freq = omega[k] + wrap(phase - prevPhase - omega[k] * Ha) / Ha
        const rot = prevOut + Hs * freq - phase
        s.rotR[k] = Math.cos(rot)
        s.rotI[k] = Math.sin(rot)
      }
      // Each bin follows the peak on its side of the magnitude valley between two peaks.
      let start = 0
      for (let p = 0; p < count; p += 1) {
        const k = s.peaks[p]
        const next = p + 1 < count ? s.peaks[p + 1] : -1
        let end = half
        if (next > 0) {
          let min = Infinity
          for (let j = k; j <= next; j += 1) if (m[j] < min) { min = m[j]; end = j }
        }
        const cr = s.rotR[k], ci = s.rotI[k]
        for (let j = start; j < end; j += 1) {
          s.yr[j] = s.xr[j] * cr - s.xi[j] * ci
          s.yi[j] = s.xr[j] * ci + s.xi[j] * cr
        }
        start = end
      }
    }
  }
  s.pr.set(s.xr); s.pi.set(s.xi)
  s.qr.set(s.yr); s.qi.set(s.yi)
  s.prevMag.set(s.mag)
}

/**
 * Change length by `ratio` (2 = twice as long) keeping pitch, for 1 or 2 channels.
 * Stereo is packed into one complex FFT (left = real, right = imaginary), so
 * both channels cost the same as one.
 */
export async function timeStretchChannels(channels: Channels, ratio: number, onProgress?: (f: number) => void, fftSize = 2048): Promise<Channels> {
  if (Math.abs(ratio - 1) < 1e-9) return channels.map(channel => channel.slice())
  if (channels.length > 2) {
    const out: Channels = []
    for (let i = 0; i < channels.length; i += 2) out.push(...await timeStretchChannels(channels.slice(i, i + 2), ratio, onProgress, fftSize))
    return out
  }
  const N = fftSize
  const Hs = N / 4
  const Ha = Hs / ratio
  const stereo = channels.length === 2
  const [left, right] = channels
  const inLength = left.length
  const outLength = Math.max(1, Math.round(inLength * ratio))
  const outL = new Float64Array(outLength + N)
  const outR = stereo ? new Float64Array(outLength + N) : null
  const norm = new Float64Array(outLength + N)
  const window = new Float64Array(N)
  for (let i = 0; i < N; i += 1) window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / N)
  const half = N / 2 + 1
  const omega = new Float64Array(half)
  for (let k = 0; k < half; k += 1) omega[k] = (TWO_PI * k) / N
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const A = pvState(half)
  const B = stereo ? pvState(half) : null
  const frames = Math.ceil(outLength / Hs) + 1
  let lastAnalysis = 0

  for (let f = 0; f < frames; f += 1) {
    const position = Math.round(f * Ha)
    const actualHa = f === 0 ? Ha : Math.max(1, position - lastAnalysis)
    lastAnalysis = position
    const analysis = position - N / 2
    for (let i = 0; i < N; i += 1) {
      const idx = analysis + i
      const inside = idx >= 0 && idx < inLength
      re[i] = inside ? left[idx] * window[i] : 0
      im[i] = inside && stereo ? right[idx] * window[i] : 0
    }
    fftInPlace(re, im)
    // Unpack: X_L[k] = (Z[k] + conj Z[N-k]) / 2 ; X_R[k] = (Z[k] - conj Z[N-k]) / 2i
    for (let k = 0; k < half; k += 1) {
      const nk = (N - k) % N
      if (stereo) {
        A.xr[k] = (re[k] + re[nk]) / 2; A.xi[k] = (im[k] - im[nk]) / 2
        B!.xr[k] = (im[k] + im[nk]) / 2; B!.xi[k] = (re[nk] - re[k]) / 2
      } else {
        A.xr[k] = re[k]; A.xi[k] = im[k]
      }
    }
    pvFrame(A, half, omega, actualHa, Hs, f === 0)
    if (B) pvFrame(B, half, omega, actualHa, Hs, f === 0)
    // Repack Z = Y_L + i·Y_R with Hermitian symmetry, inverse FFT → left = real, right = imaginary.
    for (let k = 0; k < half; k += 1) {
      const lr = A.yr[k], li = A.yi[k]
      const rr = B ? B.yr[k] : 0, ri = B ? B.yi[k] : 0
      re[k] = lr - ri; im[k] = li + rr
      if (k > 0 && k < N / 2) {
        re[N - k] = lr + ri; im[N - k] = -li + rr
      }
    }
    fftInPlace(re, im, true)
    const synthesis = f * Hs - N / 2
    for (let i = 0; i < N; i += 1) {
      const idx = synthesis + i
      if (idx < 0 || idx >= norm.length) continue
      const w = window[i]
      outL[idx] += (re[i] / N) * w
      if (outR) outR[idx] += (im[i] / N) * w
      norm[idx] += w * w
    }
    if ((f & 255) === 0 && f) {
      onProgress?.(f / frames)
      await yieldToUi()
    }
  }
  const finish = (buffer: Float64Array) => {
    const result = new Float32Array(outLength)
    for (let i = 0; i < outLength; i += 1) result[i] = norm[i] > 1e-6 ? buffer[i] / norm[i] : 0
    return result
  }
  onProgress?.(1)
  return outR ? [finish(outL), finish(outR)] : [finish(outL)]
}

/** Mono convenience wrapper. */
export async function timeStretch(input: Float32Array, ratio: number, onProgress?: (f: number) => void, fftSize = 2048): Promise<Float32Array> {
  return (await timeStretchChannels([input], ratio, onProgress, fftSize))[0]
}

// ---------------------------------------------------------------- full chain

export async function processAudio(source: Channels, sampleRate: number, settings: LabSettings, onProgress?: Progress): Promise<LabResult> {
  const { stretch, pitch } = plan(settings)
  let channels = trim(source, sampleRate, settings.start, settings.end, settings.fadeMs)
  if (settings.reverse) channels = reverse(channels)
  const count = channels.length
  const steps = (Math.abs(stretch - 1) > 1e-6 ? 1 : 0) + (Math.abs(pitch - 1) > 1e-6 ? 1 : 0)
  let done = 0
  const report = (label: string) => (f: number) => onProgress?.((done + f) / Math.max(1, steps * count), label)
  if (Math.abs(stretch - 1) > 1e-6) {
    channels = await timeStretchChannels(channels, stretch, f => report(settings.keepPitch && settings.semitones === 0 ? 'STRETCHING TIME…' : 'SHIFTING PITCH…')(f * count))
    done += count
  }
  if (Math.abs(pitch - 1) > 1e-6) {
    const next: Channels = []
    for (const channel of channels) { next.push(await resample(channel, pitch, report('RESAMPLING…'))); done += 1 }
    channels = next
  }
  // Clip guard: pitching and stretching can push peaks over 0 dBFS.
  let peak = 0
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) { const v = Math.abs(channel[i]); if (v > peak) peak = v }
  let peakGainDb = 0
  if (peak > 0.995) {
    const gain = 0.98 / peak
    for (const channel of channels) for (let i = 0; i < channel.length; i += 1) channel[i] *= gain
    peakGainDb = 20 * Math.log10(gain)
  }
  onProgress?.(1, 'DONE')
  return { channels, sampleRate, peakGainDb, seconds: (channels[0]?.length ?? 0) / sampleRate }
}

// ---------------------------------------------------------------- WAV

/** PCM WAV, 16-bit (with TPDF dither) or 24-bit. */
export function encodeWav(channels: Channels, sampleRate: number, bitDepth: 16 | 24 = 16, seed = 1): Uint8Array {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const bytes = bitDepth / 8
  const dataSize = frames * count * bytes
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * bytes, true); view.setUint16(32, count * bytes, true); view.setUint16(34, bitDepth, true)
  text(36, 'data'); view.setUint32(40, dataSize, true)
  let state = seed >>> 0
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
  let offset = 44
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < count; c += 1) {
      const v = Math.max(-1, Math.min(1, channels[c][i]))
      if (bitDepth === 16) {
        const dithered = v * 32767 + (rand() - rand())
        view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(dithered))), true)
        offset += 2
      } else {
        const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)))
        view.setUint8(offset, s & 0xff); view.setUint8(offset + 1, (s >> 8) & 0xff); view.setUint8(offset + 2, (s >> 16) & 0xff)
        offset += 3
      }
    }
  }
  return new Uint8Array(buffer)
}

/** "beat oscuro" + settings → "beat oscuro (trim, rev, x1.25, +2st).wav" */
export function labFileName(base: string, settings: LabSettings, duration: number): string {
  const tags: string[] = []
  if (settings.start > 0.001 || settings.end < duration - 0.001) tags.push('trim')
  if (settings.reverse) tags.push('rev')
  if (Math.abs(settings.speed - 1) > 1e-3) tags.push(`x${+settings.speed.toFixed(2)}${settings.keepPitch ? '' : ' tape'}`)
  if (settings.semitones) tags.push(`${settings.semitones > 0 ? '+' : ''}${settings.semitones}st`)
  const clean = base.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '').trim() || '4ever-lab'
  return `${clean}${tags.length ? ` (${tags.join(', ')})` : ' (4ever lab)'}.wav`
}
