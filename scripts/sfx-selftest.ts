/**
 * 4EVER SFX self-test: every sound of every pack is rendered and checked —
 * no clicks at the edges, no clipping, no silence, no DC, deterministic,
 * every pack sounds different, and the gestures mean what they should
 * (play goes up, pause goes down, errors are low, hovers are quiet).
 * Run:  npm run test:sfx   (Node 22.18+)
 */
import { PACK_BY_THEME, SFX_NAMES, SFX_PACKS, renderSfx, toWav } from '../src/lib/sfxSynth.ts'
import type { SfxName, SfxPack } from '../src/lib/sfxSynth.ts'

const SR = 44100
let failures = 0, total = 0
const check = (ok: boolean, label: string, detail = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ' :: ' + detail : ''}`)
}
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const zcr = (x: Float32Array, from: number, to: number) => {
  let c = 0
  const a = Math.round(from * SR), b = Math.min(x.length, Math.round(to * SR))
  for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++
  return c / ((b - a) / SR) / 2 // ≈ Hz
}

const t0 = performance.now()
const all = new Map<string, Float32Array>()
for (const pack of SFX_PACKS) for (const name of SFX_NAMES) all.set(`${pack}:${name}`, renderSfx(name, pack, SR))
const ms = performance.now() - t0
check(ms < 3000, `renders ${all.size} sounds quickly`, `${ms.toFixed(0)} ms`)

let bad: string[] = []
for (const [key, x] of all) {
  const secs = x.length / SR
  if (!(secs >= 0.05 && secs <= 2.2)) bad.push(`${key} length ${secs.toFixed(2)}s`)
  if (x.some(v => !Number.isFinite(v))) bad.push(`${key} NaN`)
}
check(bad.length === 0, 'every sound has a sane length and finite samples', bad.slice(0, 3).join(', '))

bad = []
for (const [key, x] of all) { const p = peak(x); if (p < 0.2 || p > 0.82) bad.push(`${key} peak ${p.toFixed(2)}`) }
check(bad.length === 0, 'no silence and no clipping (peak 0.2–0.82)', bad.slice(0, 3).join(', '))

bad = []
for (const [key, x] of all) {
  const head = Math.abs(x[0])
  const tail = peak(x.subarray(x.length - Math.round(0.002 * SR)))
  if (head > 0.01 || tail > 0.02) bad.push(`${key} head ${head.toFixed(3)} tail ${tail.toFixed(3)}`)
}
check(bad.length === 0, 'no click at the start or the end', bad.slice(0, 3).join(', '))

bad = []
for (const [key, x] of all) { const mean = x.reduce((s, v) => s + v, 0) / x.length; if (Math.abs(mean) > 0.01) bad.push(`${key} dc ${mean.toFixed(3)}`) }
check(bad.length === 0, 'no DC offset', bad.slice(0, 3).join(', '))

const again = renderSfx('download-ready', 'vinyl', SR), first = all.get('vinyl:download-ready')!
check(again.length === first.length && again.every((v, i) => v === first[i]), 'deterministic: same sound every time')

// Every pack must sound different for the same gesture.
const sig = (x: Float32Array) => { const n = Math.min(x.length, 8192); let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; return { n, s } }
const corr = (a: Float32Array, b: Float32Array) => {
  const n = Math.min(a.length, b.length, 16384); let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  return ab / Math.sqrt(aa * bb || 1)
}
bad = []
for (const name of SFX_NAMES) for (let i = 0; i < SFX_PACKS.length; i++) for (let j = i + 1; j < SFX_PACKS.length; j++) {
  const c = corr(all.get(`${SFX_PACKS[i]}:${name}`)!, all.get(`${SFX_PACKS[j]}:${name}`)!)
  if (c > 0.9) bad.push(`${name} ${SFX_PACKS[i]}≈${SFX_PACKS[j]} (${c.toFixed(2)})`)
}
void sig
check(bad.length === 0, 'all 10 packs sound different for every gesture', bad.slice(0, 3).join(', '))

// Gestures mean what they should.
for (const pack of ['pixel', 'glass', 'transit'] as SfxPack[]) {
  const play = all.get(`${pack}:player-play`)!, pause = all.get(`${pack}:player-pause`)!
  const up = zcr(play, 0.085, 0.13) > zcr(play, 0.005, 0.05)
  const down = zcr(pause, 0.085, 0.13) < zcr(pause, 0.005, 0.05)
  check(up && down, `${pack}: play rises, pause falls`)
}
bad = []
for (const pack of SFX_PACKS) {
  const h = all.get(`${pack}:ui-hover`)!, d = all.get(`${pack}:download-ready`)!
  if (!(rms(h) < rms(d) && h.length < d.length)) bad.push(pack)
}
check(bad.length === 0, 'hover is the shortest and quietest, download-ready the celebration', bad.join(', '))
bad = []
for (const pack of ['pixel', 'glass', 'transit', 'oldweb', 'bubble'] as SfxPack[]) {
  const err = all.get(`${pack}:error`)!, ok = all.get(`${pack}:analyzer-ready`)!
  if (!(zcr(err, 0, 0.3) < zcr(ok, 0, 0.3))) bad.push(pack)
}
check(bad.length === 0, 'errors sound lower than success', bad.join(', '))

// Every theme world has a pack and every pack is used.
const themeIds = ['red-block', 'purple-subway', 'star-rule', 'neon-tour', 'blackbook', 'comic-hit', 'aqua-cartoon', 'legacy-label', 'tale', 'secret-true']
check(themeIds.every(id => id in PACK_BY_THEME), 'every public theme + the secret one has a sound pack')
check(SFX_PACKS.every(p => Object.values(PACK_BY_THEME).includes(p)), 'every pack belongs to a theme')
check(new Set<SfxName>(SFX_NAMES).size === 15, '15 sound names (same as public/audio/sfx/README.txt)')

const wav = toWav(all.get('pixel:ui-click')!, SR)
const dv = new DataView(wav.buffer)
check(String.fromCharCode(...wav.subarray(0, 4)) === 'RIFF' && dv.getUint32(24, true) === SR && dv.getUint32(40, true) === all.get('pixel:ui-click')!.length * 2, 'WAV export header')

console.log(`\nSFX SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
