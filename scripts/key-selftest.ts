/**
 * Key engine self-test: synthesizes short chord progressions (with bass, a
 * melody and drums) in a known key — some deliberately detuned — and checks
 * the detector, the tuning estimate and the Camelot helpers.
 * Run:  npm run test:key   (Node 22.18+)
 */
import { camelotOf, camelotToKey, compatibleCamelot, estimateKey, NOTE_NAMES } from '../src/lib/key.ts'

const SR = 22050
let seed = Number(process.env.KEY_SEED ?? 4242)
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const noise = () => random() * 2 - 1
const hz = (midi: number, cents: number) => 440 * 2 ** ((midi - 69 + cents / 100) / 12)

type Timbre = 'pad' | 'epiano' | 'pluck' | 'sub' | '808'
type Case = { name: string; tonic: number; mode: 'major' | 'minor'; chords: number[][]; bpm: number; timbre: Timbre; cents?: number; bass808?: boolean }

function render(item: Case, seconds = 32): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR))
  const cents = item.cents ?? 0
  const add = (at: number, length: number, fn: (t: number) => number) => {
    const start = Math.floor(at * SR)
    for (let i = 0; i < length * SR && start + i < out.length; i += 1) out[start + i] += fn(i / SR)
  }
  const note = (midi: number, at: number, length: number, timbre: Timbre, gain: number) => {
    const f = hz(midi, cents)
    const phase = random() * 6
    const env = (t: number) => Math.min(1, t / 0.01) * Math.max(0, Math.min(1, (length - t) / 0.15))
    if (timbre === 'pad') add(at, length, t => { let v = 0; for (let h = 1; h < 9; h += 1) v += Math.sin(2 * Math.PI * f * h * t + phase * h) / h; return gain * v * env(t) })
    else if (timbre === 'epiano') add(at, length, t => gain * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t / 1.2) * env(t))
    else if (timbre === 'pluck') add(at, length, t => { let v = 0; for (let h = 0; h < 5; h += 1) v += 0.6 ** h * Math.sin(2 * Math.PI * f * (h + 1) * t); return gain * v * Math.exp(-t / 0.25) * env(t) })
    else if (timbre === '808') { let p = 0; add(at, length, t => { p += (2 * Math.PI * f * (1 + 0.25 * Math.exp(-t / 0.03))) / SR; return gain * Math.tanh(2.2 * Math.sin(p)) * Math.exp(-t / (length * 0.6)) * env(t) }) }
    else add(at, length, t => gain * Math.sin(2 * Math.PI * f * t) * env(t))
  }
  const bar = (4 * 60) / item.bpm
  const base = 48 + item.tonic
  for (let b = 0; b * bar < seconds; b += 1) {
    const chord = item.chords[b % item.chords.length]
    const t0 = b * bar
    for (const n of chord) note(base + n, t0, bar, item.timbre, item.timbre === 'pad' ? 0.07 : 0.11)
    note(base - 12 + chord[0] - (item.bass808 ? 12 : 0), t0, bar * 0.85, item.bass808 ? '808' : 'sub', item.bass808 ? 0.4 : 0.25)
    for (let k = 0; k < 8; k += 1) if (random() < 0.6) note(base + 12 + chord[Math.floor(random() * chord.length)], t0 + (k * bar) / 8, bar / 9, 'pluck', 0.06)
    // drums: kick on the beat, snare on 2 and 4, hats on 8ths
    for (let beat = 0; beat < 4; beat += 1) {
      const at = t0 + (beat * bar) / 4
      let p = 0
      add(at, 0.25, t => { p += (2 * Math.PI * (50 + 90 * Math.exp(-t / 0.03))) / SR; return 0.35 * Math.sin(p) * Math.exp(-t / 0.1) })
      if (beat % 2) add(at, 0.18, t => 0.18 * noise() * Math.exp(-t / 0.06))
      for (let h = 0; h < 2; h += 1) add(at + (h * bar) / 8, 0.03, t => 0.05 * noise() * Math.exp(-t / 0.01))
    }
  }
  let peak = 0
  for (let i = 0; i < out.length; i += 1) { out[i] += 0.003 * noise(); peak = Math.max(peak, Math.abs(out[i])) }
  for (let i = 0; i < out.length; i += 1) out[i] *= 0.9 / (peak || 1)
  return out
}

// Chords as semitone offsets from the tonic.
const I = [0, 4, 7], IV = [5, 9, 12], V = [7, 11, 14], vi = [9, 12, 16], ii = [2, 5, 9]
const i = [0, 3, 7], iv = [5, 8, 12], Vh = [7, 11, 14], VI = [8, 12, 15], v = [7, 10, 14]

const cases: Case[] = [
  { name: 'pop C major I-IV-V-I', tonic: 0, mode: 'major', chords: [I, IV, V, I], bpm: 100, timbre: 'pad' },
  { name: 'trap A minor i-iv-V-i (808)', tonic: 9, mode: 'minor', chords: [i, iv, Vh, i], bpm: 140, timbre: 'pluck', bass808: true },
  { name: 'lo-fi D# major I-vi-ii-V', tonic: 3, mode: 'major', chords: [I, vi, ii, V], bpm: 80, timbre: 'epiano' },
  { name: 'house G minor i-VI-iv-V', tonic: 7, mode: 'minor', chords: [i, VI, iv, Vh], bpm: 124, timbre: 'pluck' },
  { name: 'drill F# minor +30c i-iv-v-i', tonic: 6, mode: 'minor', chords: [i, iv, v, i], bpm: 142, timbre: 'pad', bass808: true, cents: 30 },
  { name: 'pop D major -25c I-V-vi-IV', tonic: 2, mode: 'major', chords: [I, V, vi, IV], bpm: 96, timbre: 'pad', cents: -25 },
]

let failures = 0
const check = (ok: boolean, label: string) => { if (!ok) failures += 1; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`) }

for (const item of cases) {
  const result = await estimateKey(render(item), SR)
  const expected = `${NOTE_NAMES[item.tonic]} ${item.mode === 'major' ? 'MAJ' : 'MIN'}`
  const keyOk = result.name === expected
  const tuningOk = Math.abs(result.tuningCents - (item.cents ?? 0)) <= 8
  check(keyOk && tuningOk, `${item.name.padEnd(32)} expected ${expected.padEnd(6)} got ${result.name.padEnd(6)} ${result.camelot.padEnd(3)} tuning ${String(result.tuningCents).padStart(3)}c conf ${Math.round(result.confidence * 100)}%`)
}

check(camelotOf(9, 'minor') === '8A' && camelotOf(0, 'major') === '8B', 'camelot: A MIN = 8A, C MAJ = 8B')
check(JSON.stringify(compatibleCamelot('8A')) === '["7A","9A","8B"]', 'camelot: 8A mixes with 7A, 9A, 8B')
check(JSON.stringify(compatibleCamelot('1B')) === '["12B","2B","1A"]', 'camelot: wheel wraps (1B → 12B, 2B, 1A)')
check(camelotToKey('8A') === 'A MIN' && camelotToKey('12B') === 'E MAJ', 'camelot: code → key name')

const silent = await estimateKey(new Float32Array(SR * 5), SR)
check(silent.confidence === 0, `silence gives low confidence (${Math.round(silent.confidence * 100)}%)`)

const total = cases.length + 5
console.log(`\nKEY SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
