import { estimateTempo, type TempoCandidate } from './tempo'
import { camelotToKey, compatibleCamelot, estimateKey, type KeyCandidate } from './key'

export { foldToRange, snapBpm } from './tempo'

export type AudioAnalysis = {
  bpm: number
  /** Unsnapped tempo (e.g. 139.97), used when the user forces a BPM range. */
  rawBpm: number
  halfTime: number
  doubleTime: number
  bpmConfidence: number
  /** Other strong, non-octave pulses (e.g. a 3:2 triplet feel). */
  bpmCandidates: TempoCandidate[]
  analysedSeconds: number
  key: string
  mode: 'major' | 'minor'
  camelot: string
  keyConfidence: number
  /** Next-best keys, e.g. "C MAJ · 8B". */
  alternatives: string[]
  keyCandidates: KeyCandidate[]
  /** Camelot codes that mix harmonically with the detected key (±1 hour, relative). */
  compatibleKeys: { camelot: string; key: string }[]
  /** How far the track sits from A=440 tuning, in cents. */
  tuningCents: number
}

/** Long enough for a full track; very long mixes are cut to keep memory reasonable. */
const MAX_ANALYSIS_SECONDS = 480

export async function analyzeAudioFile(file: File, onProgress?: (progress: number, label: string) => void): Promise<AudioAnalysis> {
  onProgress?.(5, 'DECODING AUDIO…')
  const raw = await file.arrayBuffer()
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioContextClass()
  try {
    const decoded = await context.decodeAudioData(raw.slice(0))
    onProgress?.(18, 'PREPARING SIGNAL…')
    const mono = mixToMono(decoded)
    const signal = resample(mono, decoded.sampleRate, 22050, Math.min(decoded.duration, MAX_ANALYSIS_SECONDS))

    onProgress?.(20, 'FINDING TRANSIENTS…')
    const tempo = await estimateTempo(signal, 22050, fraction => onProgress?.(20 + fraction * 55, fraction < 0.86 ? 'FINDING TRANSIENTS…' : 'LOCKING THE GRID…'))
    if (!tempo.bpm) throw new Error('No steady pulse found')
    onProgress?.(76, 'READING THE HARMONY…')
    const harmony = await estimateKey(signal, 22050, {}, fraction => onProgress?.(76 + fraction * 20, fraction < 0.85 ? 'READING THE HARMONY…' : 'MATCHING THE KEY…'))
    const tonal = harmony.confidence > 0
    onProgress?.(96, 'FINALIZING RESULT…')

    return {
      bpm: tempo.bpm,
      rawBpm: tempo.rawBpm,
      halfTime: round1(tempo.bpm / 2),
      doubleTime: round1(tempo.bpm * 2),
      bpmConfidence: Math.round(tempo.confidence * 100),
      bpmCandidates: tempo.candidates,
      analysedSeconds: Math.round(tempo.analysedSeconds),
      // confidence 0 = no tonal material (e.g. a drum loop): show no key rather than a guess.
      key: tonal ? harmony.name : 'NO KEY',
      mode: harmony.mode,
      camelot: tonal ? harmony.camelot : '—',
      keyConfidence: Math.round(harmony.confidence * 100),
      alternatives: tonal ? harmony.alternatives.map(item => `${item.name} · ${item.camelot}`) : [],
      keyCandidates: tonal ? harmony.alternatives : [],
      compatibleKeys: tonal ? compatibleCamelot(harmony.camelot).map(code => ({ camelot: code, key: camelotToKey(code) })) : [],
      tuningCents: harmony.tuningCents,
    }
  } finally {
    await context.close()
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(buffer.length)
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex)
    for (let i = 0; i < channel.length; i += 1) output[i] += channel[i] / buffer.numberOfChannels
  }
  return output
}

function resample(input: Float32Array, sourceRate: number, targetRate: number, maxSeconds: number): Float32Array {
  const targetLength = Math.min(Math.floor(maxSeconds * targetRate), Math.floor(input.length * targetRate / sourceRate))
  const output = new Float32Array(targetLength)
  const ratio = sourceRate / targetRate
  for (let i = 0; i < targetLength; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const fraction = position - left
    output[i] = input[left] * (1 - fraction) + (input[Math.min(left + 1, input.length - 1)] ?? 0) * fraction
  }
  return output
}

const round1 = (value: number) => Math.round(value * 10) / 10
