/**
 * 4EVER SFX synth.
 *
 * Renders every interface sound in code (no audio files): 15 sounds × 10
 * packs, one pack per theme world. Pure DSP over Float32Array, deterministic
 * (seeded noise), so it runs the same in the browser and in Node selftests.
 *
 * A sound = a GESTURE (what the sound means: open, error, download ready…)
 * played by a pack VOICE (how that theme sounds: 8-bit square, vinyl, metro
 * chime, festival synth, marker squeak, glass, wood, bubbles…).
 * The user's own WAVs in public/audio/sfx always win over these (see sfx.ts).
 */

export type SfxName =
  | 'ui-hover' | 'ui-click' | 'ui-open' | 'ui-close'
  | 'player-play' | 'player-pause' | 'player-next' | 'player-shuffle'
  | 'theme-switch' | 'secret-unlock'
  | 'analyzer-start' | 'analyzer-ready' | 'converter-start' | 'download-ready' | 'error'

export const SFX_NAMES: SfxName[] = [
  'ui-hover', 'ui-click', 'ui-open', 'ui-close',
  'player-play', 'player-pause', 'player-next', 'player-shuffle',
  'theme-switch', 'secret-unlock',
  'analyzer-start', 'analyzer-ready', 'converter-start', 'download-ready', 'error',
]

export type SfxPack = 'pixel' | 'vinyl' | 'transit' | 'stage' | 'marker' | 'glass' | 'leaf' | 'bubble' | 'oldweb' | 'comic'
export const SFX_PACKS: SfxPack[] = ['pixel', 'vinyl', 'transit', 'stage', 'marker', 'glass', 'leaf', 'bubble', 'oldweb', 'comic']

export const PACK_LABEL: Record<SfxPack, string> = {
  pixel: '8-BIT QUEST', vinyl: 'BASEMENT VINYL', transit: 'NIGHT METRO', stage: 'FESTIVAL SYNTH', marker: 'MARKER & SPRAY',
  glass: 'LIQUID GLASS', leaf: 'WARM WOOD', bubble: 'DEEP BUBBLES', oldweb: 'OLD WEB CLICKS', comic: 'COMIC BOINGS',
}

/** Which pack each theme world uses. */
export const PACK_BY_THEME: Record<string, SfxPack> = {
  tale: 'pixel',
  'red-block': 'vinyl',
  'purple-subway': 'transit',
  'neon-tour': 'stage',
  blackbook: 'marker',
  'secret-true': 'glass',
  'legacy-label': 'leaf',
  'aqua-cartoon': 'bubble',
  'star-rule': 'oldweb',
  'comic-hit': 'comic',
}
export const packForTheme = (themeId: string): SfxPack => PACK_BY_THEME[themeId] ?? 'pixel'

export const SAMPLE_RATE = 44100

// ---------------------------------------------------------------- primitives

type Wave = 'sine' | 'square' | 'triangle' | 'saw' | 'pulse'

function prng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1 }
}
function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const semi = (base: number, n: number) => base * Math.pow(2, n / 12)

function waveAt(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p)
    case 'square': return p < 0.5 ? 1 : -1
    case 'pulse': return p < 0.25 ? 1 : -1
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5)
    case 'saw': return 2 * p - 1
  }
  return 0
}

type ToneOpts = { wave: Wave; gain: number; attack?: number; decay?: number; vibrato?: number; vibratoRate?: number; detune?: number }

/** Adds a tone gliding exponentially from f0 to f1, with a percussive envelope. */
function tone(buf: Float32Array, sr: number, t0: number, dur: number, f0: number, f1: number, o: ToneOpts) {
  const start = Math.max(0, Math.round(t0 * sr))
  const n = Math.min(buf.length - start, Math.round(dur * sr))
  if (n <= 0) return
  const attack = Math.max(1, Math.round((o.attack ?? 0.004) * sr))
  const decayPow = o.decay ?? 2
  let phase = 0
  let phase2 = 0.37
  for (let i = 0; i < n; i++) {
    const x = i / n
    let f = f0 * Math.pow(f1 / f0, x)
    if (o.vibrato) f *= 1 + o.vibrato * Math.sin(2 * Math.PI * (o.vibratoRate ?? 6) * (i / sr))
    phase += f / sr
    let v = waveAt(o.wave, phase)
    if (o.detune) { phase2 += (f * (1 + o.detune)) / sr; v = (v + waveAt(o.wave, phase2)) * 0.5 }
    const env = (i < attack ? i / attack : 1) * Math.pow(1 - x, decayPow)
    buf[start + i] += v * env * o.gain
  }
}

type NoiseOpts = { gain: number; center?: number; q?: number; centerEnd?: number; attack?: number; decay?: number; seed: number }

/** Adds band-passed noise (center may sweep to centerEnd). center undefined = white. */
function noise(buf: Float32Array, sr: number, t0: number, dur: number, o: NoiseOpts) {
  const start = Math.max(0, Math.round(t0 * sr))
  const n = Math.min(buf.length - start, Math.round(dur * sr))
  if (n <= 0) return
  const rnd = prng(o.seed)
  const attack = Math.max(1, Math.round((o.attack ?? 0.002) * sr))
  const decayPow = o.decay ?? 2
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const x = i / n
    let v = rnd()
    if (o.center) {
      const fc = Math.min(sr * 0.45, o.center * Math.pow((o.centerEnd ?? o.center) / o.center, x))
      const w0 = (2 * Math.PI * fc) / sr
      const alpha = Math.sin(w0) / (2 * (o.q ?? 1.2))
      const a0 = 1 + alpha
      const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0
      const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = v; y2 = y1; y1 = y
      v = y * 2.2
    }
    const env = (i < attack ? i / attack : 1) * Math.pow(1 - x, decayPow)
    buf[start + i] += v * env * o.gain
  }
}

/** Two cascaded one-pole low-passes (soft 12 dB/oct). */
function lowpass(buf: Float32Array, sr: number, fc: number) {
  const a = Math.exp((-2 * Math.PI * fc) / sr)
  let y1 = 0, y2 = 0
  for (let i = 0; i < buf.length; i++) { y1 = (1 - a) * buf[i] + a * y1; y2 = (1 - a) * y1 + a * y2; buf[i] = y2 }
}

// ---------------------------------------------------------------- pack voices

type Voice = {
  base: number
  tail: number
  note: (buf: Float32Array, sr: number, t: number, dur: number, s0: number, s1: number, gain: number, seed: number) => void
  click: (buf: Float32Array, sr: number, t: number, gain: number, seed: number) => void
  whoosh: (buf: Float32Array, sr: number, t: number, dur: number, up: boolean, seed: number) => void
  buzz: Wave
  post?: (buf: Float32Array, sr: number, seed: number) => void
}

const VOICES: Record<SfxPack, Voice> = {
  pixel: {
    base: 523.25, tail: 1, buzz: 'square',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d, semi(523.25, s0), semi(523.25, s1), { wave: 'square', gain: g * 0.55, decay: 0.6, attack: 0.001 }),
    click: (b, sr, t, g, seed) => noise(b, sr, t, 0.02, { gain: g * 0.5, seed, decay: 1 }),
    whoosh: (b, sr, t, d, up) => tone(b, sr, t, d, up ? 220 : 1760, up ? 1760 : 220, { wave: 'pulse', gain: 0.35, decay: 0.8 }),
    post: (b) => { // 6-bit, sample-and-hold at ~11 kHz
      let held = 0
      for (let i = 0; i < b.length; i++) { if (i % 4 === 0) held = Math.round(b[i] * 32) / 32; b[i] = held }
    },
  },
  vinyl: {
    base: 196, tail: 1.2, buzz: 'saw',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d * 1.3, semi(196, s0), semi(196, s1), { wave: 'triangle', gain: g * 0.9, vibrato: 0.006, vibratoRate: 0.9, decay: 1.6 }),
    click: (b, sr, t, g, seed) => noise(b, sr, t, 0.03, { gain: g * 0.8, center: 2600, q: 0.8, seed }),
    whoosh: (b, sr, t, d, up, seed) => noise(b, sr, t, d, { gain: 0.9, center: up ? 700 : 3200, centerEnd: up ? 3200 : 700, q: 2.5, seed, decay: 0.9, attack: 0.02 }), // a scratch
    post: (b, sr, seed) => { // vinyl crackle
      const rnd = prng(seed ^ 0x51ed)
      for (let i = 0; i < b.length; i += Math.round(sr / 90)) {
        const at = i + Math.floor(Math.abs(rnd()) * (sr / 90))
        if (at < b.length - 2) { const k = rnd() * 0.07; b[at] += k; b[at + 1] -= k * 0.6 }
      }
    },
  },
  transit: {
    base: 659.25, tail: 2.4, buzz: 'triangle',
    note: (b, sr, t, d, s0, s1, g) => { // station chime: fundamental + soft 2.76× partial, long ring
      tone(b, sr, t, d * 2.4, semi(659.25, s0), semi(659.25, s1), { wave: 'sine', gain: g * 0.75, decay: 2.2, attack: 0.002 })
      tone(b, sr, t, d * 1.2, semi(659.25, s0) * 2.76, semi(659.25, s1) * 2.76, { wave: 'sine', gain: g * 0.18, decay: 3 })
    },
    click: (b, sr, t, g, seed) => noise(b, sr, t, 0.015, { gain: g * 0.45, center: 5000, q: 1.5, seed }),
    whoosh: (b, sr, t, d, _up, seed) => noise(b, sr, t, d, { gain: 0.8, center: 300, centerEnd: 1400, q: 0.7, seed, decay: 1.2, attack: d * 0.4 }), // passing train
  },
  stage: {
    base: 220, tail: 1.1, buzz: 'saw',
    note: (b, sr, t, d, s0, s1, g) => {
      tone(b, sr, t, d * 1.2, semi(220, s0), semi(220, s1), { wave: 'saw', gain: g * 0.45, detune: 0.012, decay: 1.4 })
      tone(b, sr, t, d * 1.2, semi(110, s0), semi(110, s1), { wave: 'sine', gain: g * 0.4, decay: 1.4 })
    },
    click: (b, sr, t, g, seed) => noise(b, sr, t, 0.025, { gain: g * 0.6, center: 7000, q: 0.9, seed }),
    whoosh: (b, sr, t, d, up) => tone(b, sr, t, d, up ? 110 : 3520, up ? 3520 : 110, { wave: 'saw', gain: 0.4, detune: 0.02, decay: 0.7 }), // laser zap
    post: (b, sr) => lowpass(b, sr, 3800), // tame the raw saws
  },
  marker: {
    base: 880, tail: 1, buzz: 'triangle',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d, semi(880, s0), semi(880, s1), { wave: 'sine', gain: g * 0.6, vibrato: 0.03, vibratoRate: 22, decay: 1.2 }), // squeak
    click: (b, sr, t, g, seed) => noise(b, sr, t, 0.03, { gain: g * 0.7, center: 1800, q: 3, seed }), // cap click
    whoosh: (b, sr, t, d, _up, seed) => noise(b, sr, t, d, { gain: 0.85, center: 6500, centerEnd: 5200, q: 0.6, seed, attack: 0.03, decay: 0.7 }), // spray can
  },
  glass: {
    base: 1046.5, tail: 2, buzz: 'sine',
    note: (b, sr, t, d, s0, s1, g) => {
      tone(b, sr, t, d * 2, semi(1046.5, s0), semi(1046.5, s1), { wave: 'sine', gain: g * 0.6, decay: 2.5, attack: 0.002 })
      tone(b, sr, t, d * 1.4, semi(2093, s0), semi(2093, s1), { wave: 'sine', gain: g * 0.25, decay: 3, vibrato: 0.004, vibratoRate: 7 })
    },
    click: (b, sr, t, g) => tone(b, sr, t, 0.05, 2600, 3400, { wave: 'sine', gain: g * 0.5, decay: 3 }), // glass tap
    whoosh: (b, sr, t, d, up, seed) => noise(b, sr, t, d, { gain: 0.6, center: up ? 1200 : 6000, centerEnd: up ? 6000 : 1200, q: 4, seed, attack: d * 0.3, decay: 1.5 }),
  },
  leaf: {
    base: 330, tail: 1, buzz: 'triangle',
    note: (b, sr, t, d, s0, s1, g) => { // wood marimba-ish knock
      tone(b, sr, t, d * 1.1, semi(330, s0), semi(330, s1), { wave: 'sine', gain: g * 0.8, decay: 3.2, attack: 0.001 })
      tone(b, sr, t, 0.025, semi(330, s0) * 3.9, semi(330, s0) * 3.9, { wave: 'sine', gain: g * 0.3, decay: 4 })
    },
    click: (b, sr, t, g, seed) => { tone(b, sr, t, 0.04, 900, 420, { wave: 'sine', gain: g * 0.7, decay: 3 }); noise(b, sr, t, 0.012, { gain: g * 0.3, center: 2500, seed }) },
    whoosh: (b, sr, t, d, up, seed) => noise(b, sr, t, d, { gain: 0.6, center: up ? 500 : 2000, centerEnd: up ? 2000 : 500, q: 1, seed, attack: d * 0.35, decay: 1.4 }),
  },
  bubble: {
    base: 392, tail: 1, buzz: 'sine',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d, semi(392, s0), semi(392, s1 + 7), { wave: 'sine', gain: g * 0.8, decay: 1.5, attack: 0.003 }), // bloop: rises
    click: (b, sr, t, g) => tone(b, sr, t, 0.05, 500, 1400, { wave: 'sine', gain: g * 0.7, decay: 1.6 }), // pop
    whoosh: (b, sr, t, d, up) => {
      for (let k = 0; k < 6; k++) tone(b, sr, t + (k * d) / 7, 0.06, (up ? 400 : 900) + k * 90, (up ? 1100 : 1600) + k * 90, { wave: 'sine', gain: 0.4, decay: 1.6 })
    },
  },
  oldweb: {
    base: 1000, tail: 0.8, buzz: 'square',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d * 0.8, semi(1000, s0), semi(1000, s1), { wave: 'square', gain: g * 0.3, decay: 0.4, attack: 0.001 }),
    click: (b, sr, t, g, seed) => { noise(b, sr, t, 0.008, { gain: g * 0.9, seed, decay: 0.5 }); noise(b, sr, t + 0.045, 0.006, { gain: g * 0.6, seed: seed + 1, decay: 0.5 }) }, // mouse down/up
    whoosh: (b, sr, t, d, up) => tone(b, sr, t, d, up ? 600 : 1800, up ? 1800 : 600, { wave: 'square', gain: 0.25, decay: 0.5 }),
  },
  comic: {
    base: 294, tail: 1.2, buzz: 'triangle',
    note: (b, sr, t, d, s0, s1, g) => tone(b, sr, t, d * 1.2, semi(294, s0), semi(294, s1), { wave: 'triangle', gain: g * 0.85, vibrato: 0.05, vibratoRate: 14, decay: 1.4 }), // boing
    click: (b, sr, t, g) => tone(b, sr, t, 0.06, 1400, 300, { wave: 'triangle', gain: g * 0.7, decay: 1.2 }), // pop
    whoosh: (b, sr, t, d, up) => tone(b, sr, t, d, up ? 150 : 1200, up ? 1200 : 150, { wave: 'triangle', gain: 0.6, vibrato: 0.08, vibratoRate: 18, decay: 0.9 }), // slide whistle
  },
}

// ---------------------------------------------------------------- gestures

type Plan = { length: number; draw: (buf: Float32Array, sr: number, v: Voice, seed: number) => void; level: number }

const seq = (notes: number[], step: number, dur: number, gain = 0.8) => (b: Float32Array, sr: number, v: Voice, seed: number) =>
  notes.forEach((n, i) => v.note(b, sr, i * step, dur, n, n, gain, seed + i))

const PLANS: Record<SfxName, Plan> = {
  'ui-hover': { length: 0.09, level: 0.35, draw: (b, sr, v, s) => v.note(b, sr, 0, 0.03, 12, 12, 0.6, s) },
  'ui-click': { length: 0.14, level: 0.6, draw: (b, sr, v, s) => { v.click(b, sr, 0, 0.8, s); v.note(b, sr, 0.004, 0.05, 7, 7, 0.7, s) } },
  'ui-open': { length: 0.34, level: 0.55, draw: (b, sr, v, s) => { v.note(b, sr, 0, 0.16, 0, 12, 0.8, s) } },
  'ui-close': { length: 0.3, level: 0.5, draw: (b, sr, v, s) => { v.note(b, sr, 0, 0.14, 12, 0, 0.8, s) } },
  'player-play': { length: 0.4, level: 0.6, draw: seq([0, 7], 0.08, 0.1) },
  'player-pause': { length: 0.4, level: 0.6, draw: seq([7, 0], 0.08, 0.1) },
  'player-next': { length: 0.4, level: 0.6, draw: seq([0, 4, 7], 0.055, 0.07) },
  'player-shuffle': { length: 0.45, level: 0.6, draw: seq([7, 2, 9, 4], 0.05, 0.06) },
  'theme-switch': { length: 0.75, level: 0.7, draw: (b, sr, v, s) => { v.whoosh(b, sr, 0, 0.32, true, s); v.note(b, sr, 0.24, 0.16, 12, 12, 0.7, s + 3); v.note(b, sr, 0.32, 0.2, 19, 19, 0.6, s + 4) } },
  'secret-unlock': { length: 1.35, level: 0.8, draw: (b, sr, v, s) => { [0, 4, 7, 12, 16, 19].forEach((n, i) => v.note(b, sr, i * 0.07, 0.09, n, n, 0.7, s + i)); [0, 7, 12, 24].forEach((n, i) => v.note(b, sr, 0.45, 0.42, n, n, 0.35, s + 10 + i)) } },
  'analyzer-start': { length: 0.6, level: 0.6, draw: (b, sr, v, s) => { v.note(b, sr, 0, 0.36, 0, 19, 0.6, s); v.click(b, sr, 0, 0.6, s + 1) } },
  'analyzer-ready': { length: 1, level: 0.7, draw: (b, sr, v, s) => { [0, 4, 7].forEach((n, i) => v.note(b, sr, 0, 0.42, n, n, 0.45, s + i)); v.note(b, sr, 0.12, 0.3, 19, 19, 0.35, s + 5) } },
  'converter-start': { length: 0.62, level: 0.65, draw: (b, sr, v, s) => { v.whoosh(b, sr, 0, 0.3, true, s); v.note(b, sr, 0.04, 0.3, -12, 0, 0.6, s + 1) } },
  'download-ready': { length: 1.15, level: 0.8, draw: (b, sr, v, s) => { [0, 4, 7, 12].forEach((n, i) => v.note(b, sr, i * 0.085, 0.1, n, n, 0.7, s + i)); [4, 7, 12].forEach((n, i) => v.note(b, sr, 0.38, 0.4, n, n, 0.35, s + 8 + i)) } },
  'error': { length: 0.55, level: 0.65, draw: (b, sr, v, s) => {
    tone(b, sr, 0, 0.14, semi(v.base / 2, -1), semi(v.base / 2, -1), { wave: v.buzz, gain: 0.5, decay: 0.9 })
    tone(b, sr, 0.17, 0.2, semi(v.base / 2, -6), semi(v.base / 2, -7), { wave: v.buzz, gain: 0.5, decay: 0.9 })
  } },
}

// ---------------------------------------------------------------- render

/** Renders one sound for one pack. Deterministic; peak normalised to ~0.8 × level. */
export function renderSfx(name: SfxName, pack: SfxPack, sampleRate = SAMPLE_RATE): Float32Array {
  const voice = VOICES[pack]
  const plan = PLANS[name]
  const seed = hash(`${pack}:${name}`)
  const length = Math.round(plan.length * Math.min(1.6, voice.tail) * sampleRate)
  const buf = new Float32Array(length)
  plan.draw(buf, sampleRate, voice, seed)
  voice.post?.(buf, sampleRate, seed)

  // Remove DC (one-pole high-pass ~20 Hz).
  const r = 1 - (2 * Math.PI * 20) / sampleRate
  let prevX = 0, prevY = 0
  for (let i = 0; i < buf.length; i++) { const y = buf[i] - prevX + r * prevY; prevX = buf[i]; prevY = y; buf[i] = y }

  // Normalise, then short fades so nothing clicks at the edges.
  let peak = 0
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
  const target = 0.8 * plan.level
  const scale = peak > 1e-6 ? target / peak : 0
  const fadeIn = Math.round(0.0015 * sampleRate), fadeOut = Math.round(0.012 * sampleRate)
  for (let i = 0; i < buf.length; i++) {
    let g = scale
    if (i < fadeIn) g *= i / fadeIn
    if (i > buf.length - fadeOut) g *= (buf.length - i) / fadeOut
    buf[i] *= g
  }
  return buf
}

/** 16-bit PCM WAV bytes of a rendered sound (handy for exporting a pack). */
export function toWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(out.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return out
}
