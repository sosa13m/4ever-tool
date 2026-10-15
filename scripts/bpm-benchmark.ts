/**
 * Measure the BPM and KEY engines on YOUR tracks.
 *
 *   npm run bench:bpm -- "C:\ruta\a\tus\temas"     (same as npm run bench:key)
 *
 * Put the real values in each file name:
 *   BPM:  "beat oscuro 140bpm.mp3", "loop_87 BPM.wav"
 *   KEY:  "Am", "F#m", "Ebmin", "C maj", "Bb major", "G minor" or a Camelot code "8A"
 *         e.g. "beat oscuro 140bpm Am.mp3", "loop 87bpm 10B.wav"
 * Files without a value in the name are analysed but not scored for it.
 * Needs FFmpeg in PATH (same as the backend) and Node 22.18+.
 * Writes bpm-benchmark.csv next to package.json.
 */
import { spawn } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { camelotOf, estimateKey, NOTE_NAMES } from '../src/lib/key.ts'
import { estimateTempo } from '../src/lib/tempo.ts'

const SR = 22050
const AUDIO = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aiff', '.aif', '.opus', '.webm'])
const folder = process.argv[2]
if (!folder) {
  console.log('Uso: npm run bench:bpm -- "C:\\ruta\\a\\tus\\temas"')
  process.exit(1)
}

function listAudio(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...listAudio(path))
    else if (AUDIO.has(extname(name).toLowerCase())) files.push(path)
  }
  return files.sort()
}

function decode(path: string): Promise<Float32Array> {
  return new Promise((resolvePromise, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-i', path, '-t', '480', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'])
    const chunks: Buffer[] = []
    let stderr = ''
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
    ffmpeg.stderr.on('data', chunk => { stderr += chunk })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `ffmpeg exit ${code}`))
      const buffer = Buffer.concat(chunks)
      resolvePromise(new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4)))
    })
  })
}

function expectedFromName(path: string): number | null {
  const match = /(\d{2,3}(?:[.,]\d+)?)\s*bpm/i.exec(path.split(/[\\/]/).pop() ?? '')
  return match ? Number(match[1].replace(',', '.')) : null
}

type Key = { tonic: number; mode: 'major' | 'minor' }
const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const CAMELOT_CODES = Array.from({ length: 24 }, (_, index) => ({ tonic: index % 12, mode: index < 12 ? 'major' as const : 'minor' as const }))

function keyFromName(path: string): Key | null {
  const name = (path.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '')
  const camelot = /(?:^|[\s_\-([])(1[0-2]|[1-9])([AB])(?=$|[\s_\-)\]])/.exec(name)
  if (camelot) return CAMELOT_CODES.find(key => camelotOf(key.tonic, key.mode) === camelot[1] + camelot[2]) ?? null
  // Uppercase note letter, optional #/b, then a REQUIRED quality (m, min, minor, maj, major).
  const note = /(?:^|[\s_\-([])([A-G])(#|♯|b|♭)?\s?(m(?:in(?:or)?)?|maj(?:or)?)(?=$|[\s_\-)\]])/.exec(name)
  if (!note) return null
  const accidental = note[2] === '#' || note[2] === '♯' ? 1 : note[2] ? -1 : 0
  return { tonic: (LETTERS[note[1]] + accidental + 12) % 12, mode: note[3].startsWith('maj') ? 'major' : 'minor' }
}

/** MIREX key score: exact 1, fifth 0.5, relative 0.3, parallel 0.2. */
function keyVerdict(truth: Key, guess: Key): { label: string; score: number } {
  if (truth.tonic === guess.tonic && truth.mode === guess.mode) return { label: 'OK', score: 1 }
  const interval = (guess.tonic - truth.tonic + 12) % 12
  if (truth.mode === guess.mode && (interval === 7 || interval === 5)) return { label: 'FIFTH', score: 0.5 }
  const relative = truth.mode === 'major' ? (truth.tonic + 9) % 12 : (truth.tonic + 3) % 12
  if (truth.mode !== guess.mode && guess.tonic === relative) return { label: 'RELAT', score: 0.3 }
  if (truth.tonic === guess.tonic) return { label: 'PARAL', score: 0.2 }
  return { label: 'WRONG', score: 0 }
}
const keyLabel = (key: Key) => `${NOTE_NAMES[key.tonic]}${key.mode === 'minor' ? 'm' : ''} ${camelotOf(key.tonic, key.mode)}`

const files = listAudio(resolve(folder))
if (!files.length) {
  console.log('No encontré archivos de audio en esa carpeta.')
  process.exit(1)
}

const rows = [['file', 'expected', 'detected', 'raw', 'confidence', 'verdict', 'key_expected', 'key_detected', 'key_confidence', 'key_verdict', 'tuning_cents']]
let exact = 0, octave = 0, wrong = 0, scored = 0, absError = 0
const keyTally: Record<string, number> = { OK: 0, FIFTH: 0, RELAT: 0, PARAL: 0, WRONG: 0 }
let keyScored = 0, keyPoints = 0
for (const file of files) {
  const name = file.split(/[\\/]/).pop() ?? file
  try {
    const signal = await decode(file)
    const result = await estimateTempo(signal, SR)
    const key = await estimateKey(signal, SR)
    const keyTruth = keyFromName(file)
    let keyResult = 'n/a'
    if (keyTruth && key.confidence > 0) {
      const verdict = keyVerdict(keyTruth, key)
      keyScored += 1; keyPoints += verdict.score; keyTally[verdict.label] += 1
      keyResult = verdict.label
    }
    const expected = expectedFromName(file)
    let verdict = 'n/a'
    if (expected) {
      scored += 1
      const ratio = result.bpm / expected
      if (Math.abs(result.bpm - expected) <= 0.5) { verdict = 'OK'; exact += 1; absError += Math.abs(result.rawBpm - expected) }
      else if (Math.abs(ratio - 2) < 0.02 || Math.abs(ratio - 0.5) < 0.01) { verdict = ratio > 1 ? 'DOUBLE' : 'HALF'; octave += 1 }
      else { verdict = 'WRONG'; wrong += 1 }
    }
    const keyText = key.confidence > 0 ? keyLabel(key) : 'no key'
    console.log(`${verdict.padEnd(6)} ${String(result.bpm).padEnd(6)} ${expected ? `(real ${expected})`.padEnd(13) : ''.padEnd(13)} conf ${String(Math.round(result.confidence * 100)).padStart(2)}%  | ${keyResult.padEnd(5)} ${keyText.padEnd(8)} ${keyTruth ? `(real ${keyLabel(keyTruth)})`.padEnd(15) : ''.padEnd(15)} ${name}`)
    rows.push([name, String(expected ?? ''), String(result.bpm), String(result.rawBpm), String(Math.round(result.confidence * 100)), verdict, keyTruth ? keyLabel(keyTruth) : '', keyText, String(Math.round(key.confidence * 100)), keyResult, String(key.tuningCents)])
  } catch (error) {
    console.log(`ERROR  ${name}: ${error instanceof Error ? error.message : error}`)
    rows.push([name, '', '', '', '', 'ERROR', '', '', '', 'ERROR', ''])
  }
}

if (scored) {
  console.log(`\nCon BPM en el nombre: ${scored}`)
  console.log(`  Exactos (±0.5):      ${exact} (${Math.round((exact / scored) * 100)}%)`)
  console.log(`  Half/double-time:    ${octave} (${Math.round((octave / scored) * 100)}%)  ← usa BPM RANGE si tu género se lee distinto`)
  console.log(`  Incorrectos:         ${wrong} (${Math.round((wrong / scored) * 100)}%)`)
  if (exact) console.log(`  Error medio (exactos): ${(absError / exact).toFixed(2)} BPM`)
}
if (keyScored) {
  const pct = (n: number) => `${n} (${Math.round((n / keyScored) * 100)}%)`
  console.log(`\nCon tonalidad en el nombre: ${keyScored}`)
  console.log(`  Exactas:             ${pct(keyTally.OK)}`)
  console.log(`  Quinta (±1 Camelot): ${pct(keyTally.FIFTH)}`)
  console.log(`  Relativa (A <-> B):  ${pct(keyTally.RELAT)}  ← mismo número Camelot, mezcla igual`)
  console.log(`  Paralela:            ${pct(keyTally.PARAL)}`)
  console.log(`  Incorrectas:         ${pct(keyTally.WRONG)}`)
  console.log(`  Compatibles Camelot: ${pct(keyTally.OK + keyTally.FIFTH + keyTally.RELAT)}`)
  console.log(`  Puntaje MIREX:       ${(keyPoints / keyScored).toFixed(3)}  (1 = perfecto)`)
}
const csv = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
writeFileSync(resolve('bpm-benchmark.csv'), csv)
console.log('\nResultados guardados en bpm-benchmark.csv')
