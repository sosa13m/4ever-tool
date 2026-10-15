/**
 * Simulated SoundCloud for Radio 4EVER tests: a virtual clock and fake
 * widgets that behave like the real SC Widget API in the ways that matter:
 * async replies with latency, PLAY/PAUSE/FINISH/ERROR events, SoundCloud's own
 * auto-advance to the next sound after FINISH, catalogs that load late or grow
 * lazily, and tracks that never start (deleted / private / geo-blocked).
 */
import type { RadioSound, RadioWidget } from '../src/lib/radioEngine.ts'

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Clock {
  now = 0
  private seq = 0
  private queue: { t: number; seq: number; fn: () => void }[] = []
  setTimeout = (fn: () => void, ms: number) => { const seq = ++this.seq; this.queue.push({ t: this.now + Math.max(0, ms), seq, fn }); return seq }
  clearTimeout = (handle: unknown) => { this.queue = this.queue.filter(item => item.seq !== handle) }
  run(ms: number) {
    const end = this.now + ms
    for (let guard = 0; guard < 100000; guard += 1) {
      this.queue.sort((a, b) => a.t - b.t || a.seq - b.seq)
      const item = this.queue[0]
      if (!item || item.t > end) break
      this.queue.shift()
      this.now = item.t
      item.fn()
    }
    this.now = end
  }
}

export type MemberSpec = { id: string; tracks: number; readyAt?: number; lazyVisible?: number; lazyFullAt?: number; broken?: number[]; errorEvent?: boolean }
type Handler = (memberId: string) => void

export class FakeWidget implements RadioWidget {
  index = 0
  playing = false
  volume = 100
  private starting = 0
  private handlers: Record<string, Handler | undefined> = {}
  readonly sounds: RadioSound[]
  readonly spec: MemberSpec
  private clock: Clock
  private rng: () => number

  constructor(spec: MemberSpec, clock: Clock, rng: () => number) {
    this.spec = spec
    this.clock = clock
    this.rng = rng
    this.sounds = Array.from({ length: spec.tracks }, (_, i) => ({ id: `${spec.id}-${i}`, title: `${spec.id} track ${i}`, permalink_url: `https://soundcloud.com/${spec.id}/t${i}` }))
  }

  on(event: string, handler: Handler) { this.handlers[event] = handler }
  private emit(event: string) { this.handlers[event]?.(this.spec.id) }
  private latency(min = 30, max = 450) { return min + Math.floor(this.rng() * (max - min)) }
  private broken(i = this.index) { return (this.spec.broken ?? []).includes(i) }

  start() {
    this.clock.setTimeout(() => this.emit('READY'), this.spec.readyAt ?? this.latency(100, 1200))
  }

  private beginPlayback() {
    const ticket = ++this.starting
    const index = this.index
    this.clock.setTimeout(() => {
      if (ticket !== this.starting || index !== this.index) return
      if (this.broken(index)) { if (this.spec.errorEvent) this.emit('ERROR'); return }
      if (this.playing) return
      this.playing = true
      this.emit('PLAY')
    }, this.latency())
  }

  // Real SoundCloud (checked in a browser): play() on a sound that is already
  // playing restarts it and reports PAUSE immediately followed by PLAY.
  play() {
    if (!this.playing) { this.beginPlayback(); return }
    this.emit('PAUSE')
    this.emit('PLAY')
  }
  pause() {
    this.starting += 1 // cancel a start in flight
    if (!this.playing) return
    this.playing = false
    this.clock.setTimeout(() => this.emit('PAUSE'), this.latency(10, 120))
  }
  skip(index: number) {
    const wasPlaying = this.playing
    this.index = Math.max(0, Math.min(index, this.sounds.length - 1))
    if (wasPlaying) { this.playing = false; this.emit('PAUSE') }
    this.beginPlayback() // SoundCloud starts the sound it skips to
  }
  setVolume(volume: number) { this.volume = volume }
  getSounds(callback: (sounds: RadioSound[]) => void) {
    this.clock.setTimeout(() => {
      const lazy = this.spec.lazyVisible !== undefined && this.clock.now < (this.spec.lazyFullAt ?? 0)
      callback((lazy ? this.sounds.slice(0, this.spec.lazyVisible) : this.sounds).map(sound => ({ ...sound })))
    }, this.latency(20, 200))
  }
  getCurrentSound(callback: (sound: RadioSound) => void) {
    // Reports the sound at the moment it answers (harsher than at call time).
    this.clock.setTimeout(() => callback({ ...this.sounds[this.index] }), this.latency(10, 150))
  }

  /** Test helper: the current sound reaches its end. Like real SoundCloud it reports
   *  PAUSE, then FINISH, then auto-advances to the next sound in the list. */
  finish() {
    if (!this.playing) return
    this.playing = false
    this.emit('PAUSE')
    this.emit('FINISH')
    const ticket = ++this.starting
    this.clock.setTimeout(() => {
      if (ticket !== this.starting) return // paused/skip in between stops auto-advance
      this.index = (this.index + 1) % this.sounds.length
      if (this.broken()) return
      this.playing = true
      this.emit('PLAY')
    }, this.latency(40, 300))
  }
}
