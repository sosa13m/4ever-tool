/**
 * BPM engine self-test: synthesizes drum patterns with a known tempo and checks
 * the detector. Run:  npm run test:bpm   (Node 22.18+)
 */
import { estimateTempo } from '../src/lib/tempo.ts'

const SR = 22050
let seed = 1234
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const noise = () => random() * 2 - 1

type Pattern = { kick?: number[]; snare?: number[]; hat?: number[]; tripletHats?: boolean }

function render(bpm: number, pattern: Pattern, seconds = 40, swing = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR))
  const step = 60 / bpm / 4
  const add = (at: number, length: number, fn: (t: number, i: number) => number) => {
    const start = Math.floor(at * SR)
    for (let i = 0; i < length * SR && start + i < out.length; i += 1) if (start + i >= 0) out[start + i] += fn(i / SR, i)
  }
  const kick = (at: number) => { let phase = 0; add(at, 0.3, t => { phase += (2 * Math.PI * (45 + 110 * Math.exp(-t / 0.03))) / SR; return Math.sin(phase) * Math.exp(-t / 0.12) }) }
  const snare = (at: number) => add(at, 0.2, t => (0.6 * noise() + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t / 0.06))
  let last = 0
  const hat = (at: number, gain = 0.35) => add(at, 0.04, t => { const n = noise(); const v = n - last; last = n; return gain * v * Math.exp(-t / 0.012) })
  for (let bar = 0; bar * 16 * step < seconds; bar += 1) {
    const t0 = bar * 16 * step
    for (let s = 0; s < 16; s += 1) {
      const at = t0 + s * step + (s % 2 ? step * (swing - 0.5) * 2 : 0) + (random() - 0.5) * 0.006
      if (pattern.kick?.includes(s)) kick(at)
      if (pattern.snare?.includes(s)) snare(at)
      if (pattern.hat?.includes(s)) hat(at, s % 4 === 0 ? 0.35 : 0.25)
    }
    if (pattern.tripletHats) for (let k = 0; k < 12; k += 1) hat(t0 + (k * 16 * step) / 12)
  }
  for (let i = 0; i < out.length; i += 1) out[i] = out[i] * 0.5 + 0.01 * noise()
  return out
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14]
const SIXTEENTHS = Array.from({ length: 16 }, (_, i) => i)
const cases: { name: string; bpm: number; pattern: Pattern; swing?: number }[] = [
  { name: 'trap 140 (half-time snare)', bpm: 140, pattern: { kick: [0, 7, 10], snare: [8], hat: EIGHTHS } },
  { name: 'trap 130 (triplet hats)', bpm: 130, pattern: { kick: [0, 6, 10], snare: [8], tripletHats: true } },
  { name: 'boom bap 90 (swing)', bpm: 90, pattern: { kick: [0, 3, 10], snare: [4, 12], hat: EIGHTHS }, swing: 0.58 },
  { name: 'lo-fi 75', bpm: 75, pattern: { kick: [0, 10], snare: [4, 12], hat: EIGHTHS }, swing: 0.62 },
  { name: 'house 124', bpm: 124, pattern: { kick: [0, 4, 8, 12], snare: [4, 12], hat: SIXTEENTHS } },
  { name: 'dnb 174', bpm: 174, pattern: { kick: [0, 10], snare: [4, 12], hat: EIGHTHS } },
  { name: 'dembow 96', bpm: 96, pattern: { kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: EIGHTHS } },
  { name: 'fractional 123.4', bpm: 123.4, pattern: { kick: [0, 4, 8, 12], snare: [4, 12], hat: EIGHTHS } },
]

let failures = 0
for (const item of cases) {
  const result = await estimateTempo(render(item.bpm, item.pattern, 40, item.swing ?? 0.5), SR)
  const ok = Math.abs(result.bpm - item.bpm) <= 0.5
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${item.name.padEnd(28)} expected ${String(item.bpm).padEnd(6)} got ${String(result.bpm).padEnd(6)} (raw ${result.rawBpm}, conf ${Math.round(result.confidence * 100)}%)`)
}
console.log(`\nBPM SELFTEST: ${cases.length - failures}/${cases.length} passed`)
process.exit(failures ? 1 : 0)
