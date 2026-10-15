/**
 * Faithful transcription of the Radio 4EVER logic that shipped before the current engine
 * (RadioBar in App.tsx), kept only to compare against the new engine in
 * scripts/radio-selftest.ts. Includes its stale-closure behaviour: handlers
 * bound once at mount captured the volume of the first render.
 */
import type { RadioSound, RadioWidget } from '../src/lib/radioEngine.ts'

type PoolTrack = { memberId: string; index: number; sound: RadioSound }

export class LegacyRadio {
  widgets: Record<string, RadioWidget> = {}
  catalogs: Record<string, RadioSound[]> = {}
  ready = new Set<string>()
  bag: PoolTrack[] = []
  active: PoolTrack | null = null
  pending: PoolTrack | null = null
  playing = false
  volume: number
  readonly mountVolume: number
  shownMember: string | null = null
  shownId: string | null = null

  private memberIds: string[]
  private random: () => number
  private timers: { setTimeout: (fn: () => void, ms: number) => unknown }

  constructor(memberIds: string[], volume: number, random: () => number, timers: { setTimeout: (fn: () => void, ms: number) => unknown }) {
    this.memberIds = memberIds
    this.random = random
    this.timers = timers
    this.volume = volume
    this.mountVolume = volume
  }

  attach(memberId: string, widget: RadioWidget) { this.widgets[memberId] = widget }

  private allTracks() { return Object.entries(this.catalogs).flatMap(([memberId, sounds]) => sounds.map((sound, index) => ({ memberId, index, sound }))) }
  private rebuild() {
    const tracks = this.allTracks()
    for (let i = tracks.length - 1; i > 0; i -= 1) { const j = Math.floor(this.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]] }
    if (this.active && tracks.length > 1 && tracks[0]?.sound.id === this.active.sound.id) [tracks[0], tracks[1]] = [tracks[1], tracks[0]]
    this.bag = tracks
  }
  private confirm(memberId: string) {
    this.widgets[memberId].getCurrentSound(sound => {
      const catalog = this.catalogs[memberId] ?? []
      const index = Math.max(0, catalog.findIndex(item => item.id === sound?.id))
      this.active = { memberId, index, sound: sound ?? catalog[index] }
      this.pending = null
      this.shownMember = memberId
      this.shownId = String(sound?.id)
      this.playing = true
    })
  }
  private playSelection(selection: PoolTrack, shouldPlay: boolean, volume: number) {
    const widget = this.widgets[selection.memberId]
    if (!widget) return false
    this.pending = selection
    Object.entries(this.widgets).forEach(([id, item]) => { if (id !== selection.memberId) item.pause() })
    widget.setVolume(volume)
    widget.skip(selection.index)
    if (shouldPlay) this.timers.setTimeout(() => widget.play(), 40)
    return true
  }
  /** `fromMountClosure` = called from a handler bound at mount (FINISH, effects) → old volume. */
  nextGlobal(shouldPlay: boolean, fromMountClosure = false) {
    if (!this.bag.length) this.rebuild()
    let next = this.bag.shift()
    if (!next) return
    if (this.active && next.sound.id === this.active.sound.id && this.bag.length) { this.bag.push(next); next = this.bag.shift() }
    if (next) this.playSelection(next, shouldPlay, fromMountClosure ? this.mountVolume : this.volume)
  }
  randomFromMember(memberId: string) {
    const sounds = this.catalogs[memberId] ?? []
    if (!sounds.length) return false
    const currentIndex = this.active?.memberId === memberId ? this.active.index : -1
    let index = Math.floor(this.random() * sounds.length)
    if (sounds.length > 1 && index === currentIndex) index = (index + 1 + Math.floor(this.random() * (sounds.length - 1))) % sounds.length
    return this.playSelection({ memberId, index, sound: sounds[index] }, true, this.volume)
  }

  // SoundCloud events (bound once at mount)
  handleReady(memberId: string) {
    this.widgets[memberId].setVolume(this.mountVolume)
    this.widgets[memberId].getSounds(sounds => {
      this.catalogs[memberId] = (sounds ?? []).filter(Boolean)
      this.ready.add(memberId)
      if (this.ready.size === this.memberIds.length) this.rebuild()
    })
  }
  handlePlay(memberId: string) { this.confirm(memberId) }
  handlePause(memberId: string) { if (this.active?.memberId === memberId && !this.pending) this.playing = false }
  handleFinish() { this.nextGlobal(true, true) }
  handleError() { /* not handled */ }

  // user actions
  shuffle() { this.nextGlobal(true) }
  nextFromArtist() { const id = this.active?.memberId; if (id) this.randomFromMember(id); else this.nextGlobal(true) }
  playArtist(memberId: string) { this.randomFromMember(memberId) }
  setVolume(volume: number) { this.volume = volume; Object.values(this.widgets).forEach(widget => widget.setVolume(volume)) }
  pause() { this.playing = false; Object.values(this.widgets).forEach(widget => widget.pause()) }
  play() {
    this.playing = true
    if (this.active) { this.widgets[this.active.memberId]?.play(); return }
    if (this.allTracks().length) this.nextGlobal(true, true)
  }
}
