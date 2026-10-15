/**
 * 4EVER LAB self-test: every tool is checked with signals whose answer is known
 * (pitch of a tone, BPM of a drum loop, lengths, stereo separation, WAV bytes).
 * Run:  npm run test:lab   (Node 22.18+)
 */
import { encodeWav, fftInPlace, labFileName, plan, processAudio, resample, reverse, timeStretch, trim, type LabSettings } from '../src/lib/lab.ts'
import { estimateTempo } from '../src/lib/tempo.ts'

const SR = 44100
let failures = 0, total = 0
const check = (ok: boolean, label: string, detail = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`)
}
const near = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= tolerance
const sine = (hz: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR))
const base: LabSettings = { start: 0, end: 3, reverse: false, speed: 1, keepPitch: true, semitones: 0, fadeMs: 4 }

/** Dominant frequency (parabolic peak on a 32k FFT) and how much energy sits away from it. */
function analyse(x: Float32Array) {
  const N = 32768, re = new Float64Array(N), im = new Float64Array(N)
  const offset = Math.max(0, Math.floor(x.length / 2 - N / 2))
  for (let i = 0; i < N; i += 1) re[i] = (x[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  fftInPlace(re, im)
  const power = new Float64Array(N / 2)
  let best = 1
  for (let k = 1; k < N / 2; k += 1) { power[k] = re[k] ** 2 + im[k] ** 2; if (power[k] > power[best]) best = k }
  const [a, b, c] = [power[best - 1], power[best], power[best + 1]].map(v => Math.log(v + 1e-30))
  const hz = ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
  const span = Math.ceil((25 * N) / SR)
  let inside = 0, all = 0
  for (let k = 1; k < N / 2; k += 1) { all += power[k]; if (Math.abs(k - best) <= span) inside += power[k] }
  return { hz, purityDb: 10 * Math.log10(inside / Math.max(1e-30, all - inside)) }
}

function drumLoop(bpm: number, seconds: number) {
  const out = new Float32Array(Math.round(SR * seconds))
  let seed = 7
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const beat = 60 / bpm
  for (let b = 0; b * beat < seconds; b += 1) {
    const at = Math.round(b * beat * SR)
    let phase = 0
    for (let i = 0; i < 0.25 * SR && at + i < out.length; i += 1) { phase += (2 * Math.PI * (50 + 100 * Math.exp(-i / SR / 0.03))) / SR; out[at + i] += 0.7 * Math.sin(phase) * Math.exp(-i / SR / 0.1) }
    if (b % 2) for (let i = 0; i < 0.15 * SR && at + i < out.length; i += 1) out[at + i] += 0.35 * noise() * Math.exp(-i / SR / 0.05)
    for (let h = 0; h < 2; h += 1) { const s = at + Math.round(h * beat * 0.5 * SR); for (let i = 0; i < 0.03 * SR && s + i < out.length; i += 1) out[s + i] += 0.12 * noise() * Math.exp(-i / SR / 0.008) }
  }
  return out
}
const toAnalysisRate = (x: Float32Array) => { const out = new Float32Array(Math.floor(x.length / 2)); for (let i = 0; i < out.length; i += 1) out[i] = (x[2 * i] + x[2 * i + 1]) / 2; return out }
const bpmOf = async (x: Float32Array) => (await estimateTempo(toAnalysisRate(x), SR / 2)).bpm

// ---- trim / reverse
const tone = sine(440, 3)
const cut = trim([tone], SR, 0.5, 1.5)[0]
check(cut.length === SR, 'trim keeps exactly the selection (1.000 s)', String(cut.length))
check(cut[0] === 0 && Math.abs(cut[cut.length - 1]) < 1e-6, 'trim fades in/out (no clicks at the cut)')
check(trim([tone], SR, 2.5, 9)[0].length === Math.round(0.5 * SR), 'selection past the end is clamped')
const twice = reverse(reverse([tone]))[0]
check(twice.every((v, i) => v === tone[i]), 'reverse twice gives back the original')
check(reverse([Float32Array.from([1, 2, 3])])[0].join() === '3,2,1', 'reverse flips the order')

// ---- pitch / speed accuracy
const up7 = analyse(await resample(tone, 2 ** (7 / 12)))
check(near(up7.hz, 659.26, 2), 'resample +7 st: 440 → 659.3 Hz', up7.hz.toFixed(1))
const stretched = await timeStretch(tone, 1.5)
const st = analyse(stretched)
check(near(st.hz, 440, 1.5) && stretched.length === Math.round(tone.length * 1.5), 'time-stretch ×1.5 keeps 440 Hz and lasts 4.5 s', `${st.hz.toFixed(1)} Hz, ${(stretched.length / SR).toFixed(2)} s`)
check(st.purityDb > 25, 'time-stretch stays clean (energy near the tone ≫ artefacts)', `${st.purityDb.toFixed(1)} dB`)

const pitched = await processAudio([tone], SR, { ...base, semitones: 5 })
const p5 = analyse(pitched.channels[0])
check(near(p5.hz, 587.33, 2.5) && near(pitched.seconds, 3, 0.01), 'pitch +5 st: 587 Hz, same 3 s length', `${p5.hz.toFixed(1)} Hz, ${pitched.seconds.toFixed(3)} s`)
const down12 = await processAudio([tone], SR, { ...base, semitones: -12 })
check(near(analyse(down12.channels[0]).hz, 220, 1.5) && near(down12.seconds, 3, 0.01), 'pitch −12 st: an octave down, same length', analyse(down12.channels[0]).hz.toFixed(1))
const tape = await processAudio([tone], SR, { ...base, speed: 0.8, keepPitch: false })
check(near(analyse(tape.channels[0]).hz, 352, 1.5) && near(tape.seconds, 3.75, 0.01), 'tape ×0.8: slower AND lower (352 Hz, 3.75 s)', `${analyse(tape.channels[0]).hz.toFixed(1)} Hz, ${tape.seconds.toFixed(2)} s`)
const keep = await processAudio([tone], SR, { ...base, speed: 1.25, keepPitch: true })
check(near(analyse(keep.channels[0]).hz, 440, 1.5) && near(keep.seconds, 2.4, 0.01), 'speed ×1.25 keep pitch: 440 Hz, 2.4 s', `${analyse(keep.channels[0]).hz.toFixed(1)} Hz, ${keep.seconds.toFixed(2)} s`)
const combo = await processAudio([tone], SR, { ...base, speed: 1.25, keepPitch: false, semitones: -2 })
check(near(analyse(combo.channels[0]).hz, 440 * 1.25 * 2 ** (-2 / 12), 2.5) && near(combo.seconds, 2.4, 0.01), 'tape ×1.25 plus −2 st combine correctly', analyse(combo.channels[0]).hz.toFixed(1))

// ---- tempo on a real groove
const loop = drumLoop(120, 16)
const faster = await processAudio([loop], SR, { ...base, end: 16, speed: 1.25 })
const fasterBpm = await bpmOf(faster.channels[0])
check(near(fasterBpm, 150, 1), 'drum loop 120 BPM × 1.25 (keep pitch) → 150 BPM', String(fasterBpm))
const slowed = await processAudio([loop], SR, { ...base, end: 16, speed: 0.9, keepPitch: false })
const slowedBpm = await bpmOf(slowed.channels[0])
check(near(slowedBpm, 108, 1), 'drum loop 120 BPM tape × 0.9 → 108 BPM', String(slowedBpm))
const pitchedLoop = await processAudio([loop], SR, { ...base, end: 16, semitones: 3 })
const pitchedBpm = await bpmOf(pitchedLoop.channels[0])
check(near(pitchedBpm, 120, 1), 'pitching a loop +3 st keeps its 120 BPM', String(pitchedBpm))

// ---- stereo, silence, clipping
const stereo = await processAudio([sine(440, 3), sine(660, 3)], SR, { ...base, semitones: 12 })
const [l, r] = stereo.channels.map(analyse)
check(near(l.hz, 880, 3) && near(r.hz, 1320, 4), 'stereo channels stay separate (L 440→880, R 660→1320)', `${l.hz.toFixed(0)} / ${r.hz.toFixed(0)}`)
check(l.purityDb > 20 && r.purityDb > 20, 'no bleed between left and right', `${l.purityDb.toFixed(1)} / ${r.purityDb.toFixed(1)} dB`)
const silent = await processAudio([new Float32Array(SR * 2)], SR, { ...base, end: 2, semitones: 4, speed: 1.1 })
check(silent.channels[0].every(v => v === 0 || Math.abs(v) < 1e-9), 'silence stays silent (no NaN, no noise)')
const loud = await processAudio([sine(300, 2, 0.999), sine(300, 2, 0.999)], SR, { ...base, end: 2, semitones: 7, speed: 0.9 })
const peak = Math.max(...loud.channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
check(peak <= 0.981, 'output never clips (clip guard)', `peak ${peak.toFixed(3)}, gain ${loud.peakGainDb.toFixed(2)} dB`)
const untouched = await processAudio([tone], SR, { ...base, start: 1, end: 2 })
check(untouched.channels[0].length === SR && untouched.channels[0][SR / 2] === tone[SR + SR / 2], 'no speed/pitch change = untouched audio (only the trim)')

// ---- plan, WAV, file names
check(JSON.stringify(plan({ speed: 1.25, keepPitch: true, semitones: 0 })) === JSON.stringify({ tempo: 1.25, pitch: 1, stretch: 0.8 }), 'plan: speed keep-pitch = pure stretch')
check(Math.abs(plan({ speed: 0.8, keepPitch: false, semitones: 0 }).stretch - 1) < 1e-12, 'plan: tape mode = resample only (no stretch artefacts)')
const wav16 = encodeWav([Float32Array.from([0, 0.5, -0.5, 1]), Float32Array.from([0, 0, 0, -1])], 48000, 16)
const v16 = new DataView(wav16.buffer)
check(new TextDecoder().decode(wav16.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(wav16.slice(8, 12)) === 'WAVE', 'WAV header')
check(v16.getUint16(22, true) === 2 && v16.getUint32(24, true) === 48000 && v16.getUint16(34, true) === 16 && v16.getUint32(40, true) === 16 && wav16.length === 60, 'WAV 16-bit: stereo, 48 kHz, right size')
check(Math.abs(v16.getInt16(44 + 4, true) - 16384) <= 1 && v16.getInt16(44 + 12, true) === 32767 && v16.getInt16(44 + 14, true) === -32768, 'WAV 16-bit sample values (dithered ±1 LSB)')
const wav24 = encodeWav([Float32Array.from([0.25, -1])], 44100, 24)
const s24 = (o: number) => { const v = wav24[o] | (wav24[o + 1] << 8) | (wav24[o + 2] << 16); return v & 0x800000 ? v - 0x1000000 : v }
check(wav24.length === 44 + 6 && s24(44) === Math.round(0.25 * 8388607) && s24(47) === -8388607, 'WAV 24-bit sample values')
check(labFileName('beat oscuro.mp3', { ...base, start: 1, end: 2, reverse: true, speed: 1.25, semitones: 2 }, 3) === 'beat oscuro (trim, rev, x1.25, +2st).wav', 'file name says what was done')
check(labFileName('loop.wav', { ...base, speed: 0.8, keepPitch: false }, 3) === 'loop (x0.8 tape).wav' && labFileName('a/b:c.wav', base, 3) === 'abc (4ever lab).wav', 'file names: tape mode, unsafe characters removed')

console.log(`\nLAB SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
