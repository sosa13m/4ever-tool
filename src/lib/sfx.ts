/**
 * Interface sound effects.
 *
 * - One shared AudioContext, created lazily on the first sound (browsers only
 *   allow audio after a user gesture, so nothing plays before the first click).
 * - Your WAVs win: public/audio/sfx/<name>.wav is used when it exists.
 *   Otherwise the theme's built-in 4EVER synth pack renders the sound.
 * - The header speaker button mutes every interface sound; the volume slider
 *   lives in Theme Archive. Radio volume is separate and untouched.
 * - Hovers are throttled, a click that triggers a "bigger" sound (open,
 *   download ready…) lets that sound play alone, and at most 8 voices overlap.
 */
import { SFX_NAMES, packForTheme, renderSfx } from './sfxSynth'
import type { SfxName, SfxPack } from './sfxSynth'

export type { SfxName, SfxPack } from './sfxSynth'

type Source = 'custom' | 'synth'

let context: AudioContext | null = null
let pack: SfxPack = 'pixel'
let enabled = true
let active = 0
/** The click of the last pointer press; a bigger sound triggered by the same click cancels it. */
let pendingClick: { at: number; cancelled: boolean; gain?: GainNode; source?: AudioBufferSourceNode } | null = null
const raw = new Map<SfxName, Promise<ArrayBuffer | null>>()
const custom = new Map<SfxName, AudioBuffer | null>()
const synth = new Map<string, AudioBuffer>()
const lastPlayed = new Map<SfxName, number>()

export function getSfxVolume() {
  try {
    const stored = Number(localStorage.getItem('4ever-sfx-volume') ?? 45)
    return Number.isFinite(stored) ? Math.max(0, Math.min(100, stored)) : 45
  } catch { return 45 }
}

export function setSfxVolume(value: number) {
  try { localStorage.setItem('4ever-sfx-volume', String(Math.max(0, Math.min(100, value)))) } catch { /* private mode */ }
}

/** Header speaker button: false silences every interface sound. */
export function setSfxEnabled(value: boolean) { enabled = value }
export function getSfxEnabled() { return enabled }

/** The theme decides which synth pack fills in for missing WAVs. */
export function setSfxTheme(themeId: string) { pack = packForTheme(themeId) }
export function getSfxPack() { return pack }

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!context) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try { context = new Ctor() } catch { return null }
  }
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

/** Fetches public/audio/sfx/<name>.wav once. SPA servers answer missing files with index.html, so only audio counts. */
function fetchCustom(name: SfxName): Promise<ArrayBuffer | null> {
  let pending = raw.get(name)
  if (!pending) {
    pending = fetch(`/audio/sfx/${name}.wav`, { cache: 'force-cache' })
      .then(async response => {
        const type = response.headers.get('content-type') ?? ''
        if (!response.ok || type.includes('text/html')) return null
        const bytes = await response.arrayBuffer()
        const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
        return String.fromCharCode(...head) === 'RIFF' ? bytes : null
      })
      .catch(() => null)
    raw.set(name, pending)
  }
  return pending
}

async function customBuffer(ctx: AudioContext, name: SfxName): Promise<AudioBuffer | null> {
  if (custom.has(name)) return custom.get(name) ?? null
  const bytes = await fetchCustom(name)
  let buffer: AudioBuffer | null = null
  if (bytes) { try { buffer = await ctx.decodeAudioData(bytes.slice(0)) } catch { buffer = null } }
  custom.set(name, buffer)
  return buffer
}

function synthBuffer(ctx: AudioContext, name: SfxName, which: SfxPack): AudioBuffer {
  const key = `${which}:${name}`
  let buffer = synth.get(key)
  if (!buffer) {
    const samples = renderSfx(name, which, ctx.sampleRate)
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.getChannelData(0).set(samples)
    synth.set(key, buffer)
  }
  return buffer
}

const MIN_GAP: Partial<Record<SfxName, number>> = { 'ui-hover': 70, 'ui-click': 40 }

export async function playSfx(name: SfxName, volumeMultiplier = 1) {
  if (!enabled) return
  const volume = (getSfxVolume() / 100) * volumeMultiplier
  if (volume <= 0) return
  const now = performance.now()
  if (now - (lastPlayed.get(name) ?? -1e9) < (MIN_GAP[name] ?? 25)) return
  lastPlayed.set(name, now)
  let token: typeof pendingClick = null
  if (name === 'ui-click') {
    // Wait a beat: if the same click opens a drawer, finishes a download… that sound plays alone.
    token = pendingClick = { at: now, cancelled: false }
    await new Promise(resolve => window.setTimeout(resolve, 30))
    if (token.cancelled) return
  } else if (name !== 'ui-hover' && pendingClick && now - pendingClick.at < 250) {
    const click = pendingClick
    click.cancelled = true
    if (click.gain && click.source && context) {
      click.gain.gain.setTargetAtTime(0, context.currentTime, 0.004)
      try { click.source.stop(context.currentTime + 0.03) } catch { /* already ended */ }
    }
    pendingClick = null
  }
  if (active >= 8) return
  const ctx = getContext()
  if (!ctx) return
  try {
    const buffer = (await customBuffer(ctx, name)) ?? synthBuffer(ctx, name, pack)
    if (!enabled || token?.cancelled) return
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    if (token) { token.source = source; token.gain = gain }
    gain.gain.value = Math.min(1, volume)
    source.buffer = buffer
    source.connect(gain).connect(ctx.destination)
    active += 1
    source.onended = () => { active = Math.max(0, active - 1); source.disconnect(); gain.disconnect() }
    source.start()
  } catch {
    // Audio is decoration: it never blocks the app.
  }
}

/** Starts downloading any custom WAVs early (no audio context needed yet). */
export function warmSfxCache() {
  SFX_NAMES.forEach(name => void fetchCustom(name))
}

/** Which sounds are your WAVs and which use the built-in synth (for the Theme Archive). */
export async function getSfxSources(): Promise<Record<SfxName, Source>> {
  const entries = await Promise.all(SFX_NAMES.map(async name => [name, (await fetchCustom(name)) ? 'custom' : 'synth'] as const))
  return Object.fromEntries(entries) as Record<SfxName, Source>
}
