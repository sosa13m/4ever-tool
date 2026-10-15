/**
 * Radio 4EVER engine.
 *
 * Owns all playback decisions for the hidden SoundCloud widgets (one per
 * artist) so the React component only renders state. Pure TypeScript: the
 * widgets and timers are injected, which lets `scripts/radio-selftest.ts`
 * drive it with a simulated SoundCloud.
 *
 * Guarantees (checked by the self-test):
 *  - only the selected widget may play; late PLAY events from other widgets
 *    (SoundCloud auto-advancing after FINISH, buffering hiccups) are paused;
 *  - the title/artist shown is the sound the playing widget reports;
 *  - the volume applied to every new track is the CURRENT volume;
 *  - a track that never starts (deleted, private, geo-blocked) is skipped;
 *  - every track enters the shuffle, including catalogs that load late or
 *    grow after the first read; no artist plays twice in a row if avoidable;
 *  - SoundCloud reports PAUSE right before PLAY whenever a sound (re)starts and
 *    right before FINISH; those are not the user pausing, so a PAUSE only counts
 *    if no PLAY/FINISH follows shortly. A pause right after a track change
 *    (another widget auto-advancing) is undone, so the radio keeps going;
 *  - in a background tab the next track stays in the same widget, because
 *    browsers may not let a different player start while the tab is hidden.
 */

export type RadioMember = { id: string; name: string; alias?: string; profileUrl: string }

export type RadioSound = {
  id?: number | string
  title?: string
  permalink_url?: string
  user?: { username?: string; permalink_url?: string }
}

/** The subset of the SoundCloud Widget API the engine uses. */
export interface RadioWidget {
  play(): void
  pause(): void
  skip(index: number): void
  setVolume(volume: number): void
  getSounds(callback: (sounds: RadioSound[]) => void): void
  getCurrentSound(callback: (sound: RadioSound) => void): void
}

export type RadioTrack = {
  memberId: string
  index: number
  id: string
  title: string | null
  artist: string
  url: string
}

export type RadioStatus = 'loading' | 'idle' | 'switching' | 'playing' | 'paused' | 'skipping' | 'unavailable'

export type RadioState = {
  status: RadioStatus
  /** The user wants music (drives the play/pause button). */
  wantPlay: boolean
  current: RadioTrack | null
  /** Track requested but not confirmed by its widget yet. */
  pending: RadioTrack | null
  poolSize: number
  readyMembers: number
  totalMembers: number
  volume: number
  skippedTracks: number
}

export type RadioTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type RadioOptions = {
  volume?: number
  random?: () => number
  timers?: RadioTimers
  /** Max time a selected track may take to start before it is skipped. */
  startTimeoutMs?: number
  /** Re-read catalogs after READY: SoundCloud can grow lists lazily. */
  catalogRefreshMs?: number[]
  sfx?: (name: 'player-shuffle' | 'player-next' | 'player-play' | 'player-pause') => void
  onChange?: (state: RadioState) => void
  /** True while the page is in a background tab (document.hidden). */
  isHidden?: () => boolean
  /** Current time in ms (injected so the self-test can use its own clock). */
  now?: () => number
}

/** A pause of the current track this soon after a switch is treated as interference, not the user. */
const INTERFERENCE_WINDOW_MS = 4000
const MAX_INTERFERENCE_RETRIES = 3
/** How long a PAUSE must stand (no PLAY/FINISH after it) before it counts as a real pause. */
const PAUSE_SETTLE_MS = 700
/** skip() already starts the sound; play() is only sent if nothing started by then. */
const START_NUDGE_MS = 1500

type Selection = { track: RadioTrack; token: number }

const keyOf = (memberId: string, id: string) => `${memberId}::${id}`

export class RadioEngine {
  private readonly members: RadioMember[]
  private readonly widgets = new Map<string, RadioWidget>()
  private readonly catalogs = new Map<string, RadioSound[]>()
  private readonly ready = new Set<string>()
  private readonly failures = new Map<string, number>()
  private readonly refreshTimers: unknown[] = []
  private bag: RadioTrack[] = []
  private selection: Selection | null = null
  private current: RadioTrack | null = null
  private token = 0
  private watchdog: unknown = null
  private wantPlay = false
  private startWhenReady = false
  private queuedArtist: string | null = null
  private volume: number
  private skipped = 0
  private unavailable = false
  /** Token of a selection made automatically because the previous track failed. */
  private skipToken: number | null = null
  private readonly random: () => number
  private readonly timers: RadioTimers
  private readonly startTimeoutMs: number
  private readonly catalogRefreshMs: number[]
  private readonly sfx: NonNullable<RadioOptions['sfx']>
  private readonly onChange: NonNullable<RadioOptions['onChange']>
  private readonly isHidden: () => boolean
  private readonly now: () => number
  private lastSuppressAt = Number.NEGATIVE_INFINITY
  private lastConfirmAt = Number.NEGATIVE_INFINITY
  private interferenceRetries = 0
  private pendingPause: unknown = null

  constructor(members: RadioMember[], options: RadioOptions = {}) {
    this.members = members
    this.volume = options.volume ?? 22
    this.random = options.random ?? Math.random
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
    this.startTimeoutMs = options.startTimeoutMs ?? 9000
    this.catalogRefreshMs = options.catalogRefreshMs ?? [4000, 15000, 45000]
    this.sfx = options.sfx ?? (() => {})
    this.onChange = options.onChange ?? (() => {})
    this.isHidden = options.isHidden ?? (() => false)
    this.now = options.now ?? (() => Date.now())
  }

  // ------------------------------------------------------------ wiring

  attach(memberId: string, widget: RadioWidget): void {
    this.widgets.set(memberId, widget)
  }

  /** True once this member's catalog has been read at least once. */
  hasCatalog(memberId: string): boolean {
    return this.ready.has(memberId)
  }

  markUnavailable(): void {
    this.unavailable = true
    this.emit()
  }

  /** Widget READY: read its catalog now and a few more times later. */
  handleReady(memberId: string): void {
    this.readCatalog(memberId)
    for (const delay of this.catalogRefreshMs) {
      this.refreshTimers.push(this.timers.setTimeout(() => this.readCatalog(memberId), delay))
    }
  }

  handlePlay(memberId: string): void {
    const widget = this.widgets.get(memberId)
    if (!widget) return
    if (this.current?.memberId === memberId) this.cancelPendingPause()
    const selected = this.selection?.track ?? this.current
    // A widget we did not choose is playing (SoundCloud auto-advance after
    // FINISH, a late PLAY after we switched away, or music the user paused).
    if (!selected || selected.memberId !== memberId || (!this.wantPlay && !this.selection)) {
      widget.pause()
      // SoundCloud answers a widget starting by pausing the others, which can hit
      // the track we DO want: remember this so that pause is undone (handlePause).
      this.lastSuppressAt = this.now()
      return
    }
    const token = this.token
    widget.getCurrentSound(sound => {
      if (token !== this.token) return // a newer selection superseded this one
      const catalog = this.catalogs.get(memberId) ?? []
      const id = sound?.id !== undefined ? String(sound.id) : selected.id
      const found = catalog.findIndex(item => String(item.id) === id)
      const index = found >= 0 ? found : selected.index
      if (this.selection && id !== this.selection.track.id) {
        // The widget is playing something other than what we asked for
        // (e.g. it auto-advanced). Re-issue the request instead of lying in the UI.
        widget.skip(this.selection.track.index)
        return
      }
      if (this.watchdog) this.timers.clearTimeout(this.watchdog)
      this.watchdog = null
      this.failures.delete(keyOf(memberId, id))
      const isNewTrack = this.current?.memberId !== memberId || this.current?.id !== id
      if (isNewTrack) this.interferenceRetries = 0
      this.lastConfirmAt = this.now()
      this.current = this.describe(memberId, index, sound)
      this.selection = null
      this.wantPlay = true
      this.emit()
    })
  }

  handlePause(memberId: string): void {
    // Pauses we caused (switching, user pause) are expected; a pause of the
    // confirmed track that we did not ask for is surfaced as "paused".
    if (this.selection || this.current?.memberId !== memberId || !this.wantPlay) return
    // SoundCloud sends PAUSE just before PLAY (restart) and before FINISH: wait a
    // moment and only treat it as a pause if nothing else follows.
    this.cancelPendingPause()
    this.pendingPause = this.timers.setTimeout(() => {
      this.pendingPause = null
      this.settlePause(memberId)
    }, PAUSE_SETTLE_MS)
  }

  private settlePause(memberId: string): void {
    if (this.selection || this.current?.memberId !== memberId || !this.wantPlay) return
    const now = this.now()
    const nearSwitch = now - this.lastConfirmAt < INTERFERENCE_WINDOW_MS + PAUSE_SETTLE_MS || now - this.lastSuppressAt < INTERFERENCE_WINDOW_MS + PAUSE_SETTLE_MS
    if (nearSwitch && this.interferenceRetries < MAX_INTERFERENCE_RETRIES) {
      // Not the user: another widget's auto-advance made SoundCloud pause ours.
      this.interferenceRetries += 1
      this.widgets.get(memberId)?.play()
      return
    }
    this.wantPlay = false
    this.emit()
  }

  private cancelPendingPause(): void {
    if (this.pendingPause) this.timers.clearTimeout(this.pendingPause)
    this.pendingPause = null
  }

  handleFinish(memberId: string): void {
    // The PAUSE SoundCloud sent just before FINISH is the end of the song, not the user.
    if (this.current?.memberId === memberId) this.cancelPendingPause()
    // Stop SoundCloud from auto-advancing inside this artist's list: the
    // engine decides what plays next.
    this.widgets.get(memberId)?.pause()
    // In a background tab, stay in this widget: it is allowed to keep playing,
    // while a different player may be blocked until the tab is visible again.
    if (this.current?.memberId === memberId && !this.selection) this.next(true, this.isHidden() ? memberId : undefined)
  }

  /** Call when the tab becomes visible again: restart anything that stalled while hidden. */
  resumeIfStalled(): void {
    if (!this.wantPlay) return
    if (this.selection) {
      const { track, token } = this.selection
      const widget = this.widgets.get(track.memberId)
      if (!widget) return
      widget.skip(track.index)
      this.armWatchdog(track, token)
      return
    }
    if (this.current) this.widgets.get(this.current.memberId)?.play()
  }

  handleError(memberId: string): void {
    const target = this.selection?.track ?? this.current
    if (target?.memberId === memberId) this.skipBroken(target)
  }

  // ------------------------------------------------------------ user actions

  play(): void {
    this.wantPlay = true
    this.sfx('player-play')
    if (this.selection) { this.emit(); return }
    if (this.current) {
      const widget = this.widgets.get(this.current.memberId)
      widget?.setVolume(this.volume)
      widget?.play()
      this.emit()
      return
    }
    if (!this.next(true)) this.startWhenReady = true
    this.emit()
  }

  pause(): void {
    this.wantPlay = false
    this.startWhenReady = false
    this.cancelSelection()
    for (const widget of this.widgets.values()) widget.pause()
    this.sfx('player-pause')
    this.emit()
  }

  toggle(): void {
    if (this.wantPlay) this.pause()
    else this.play()
  }

  /** Random track from the whole collective (shuffle bag). */
  shuffle(): void {
    this.sfx('player-shuffle')
    if (!this.next(true)) this.startWhenReady = true
  }

  /** Random track from the artist that is playing (or global if none). */
  nextFromArtist(): void {
    const memberId = (this.selection?.track ?? this.current)?.memberId
    if (memberId) this.playArtist(memberId)
    else this.shuffle()
  }

  playArtist(memberId: string): void {
    const sounds = this.catalogs.get(memberId) ?? []
    const playable = sounds.map((sound, index) => this.describe(memberId, index, sound)).filter(track => !this.isBroken(track))
    if (!playable.length) {
      this.queuedArtist = memberId
      this.wantPlay = true
      this.emit()
      return
    }
    const avoid = (this.selection?.track ?? this.current)
    const options = playable.length > 1 && avoid?.memberId === memberId ? playable.filter(track => track.id !== avoid.id) : playable
    const track = options[Math.floor(this.random() * options.length)]
    this.sfx('player-next')
    this.removeFromBag(track)
    this.select(track, true)
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)))
    for (const widget of this.widgets.values()) widget.setVolume(this.volume)
    this.emit()
  }

  getState(): RadioState {
    const status: RadioStatus = this.unavailable ? 'unavailable'
      : this.ready.size === 0 ? 'loading'
        : this.selection ? (this.selection.token === this.skipToken ? 'skipping' : 'switching')
          : this.current ? (this.wantPlay ? 'playing' : 'paused')
            : 'idle'
    return {
      status,
      wantPlay: this.wantPlay,
      current: this.current,
      pending: this.selection?.track ?? null,
      poolSize: this.poolSize(),
      readyMembers: this.ready.size,
      totalMembers: this.members.length,
      volume: this.volume,
      skippedTracks: this.skipped,
    }
  }

  dispose(): void {
    this.cancelSelection()
    this.cancelPendingPause()
    for (const handle of this.refreshTimers) this.timers.clearTimeout(handle)
  }

  // ------------------------------------------------------------ internals

  private readCatalog(memberId: string): void {
    const widget = this.widgets.get(memberId)
    if (!widget) return
    widget.getSounds(sounds => {
      const list = (sounds ?? []).filter(Boolean)
      const previous = this.catalogs.get(memberId) ?? []
      const wasReady = this.ready.has(memberId)
      if (wasReady && list.length <= previous.length) {
        // Same list: keep it, but take any titles that loaded since.
        this.catalogs.set(memberId, list.length ? list : previous)
        return
      }
      this.catalogs.set(memberId, list)
      this.ready.add(memberId)
      // New tracks join the CURRENT shuffle bag at random places, so a late
      // artist does not wait for the whole cycle to finish.
      const known = new Set(previous.map(sound => String(sound.id)))
      for (let index = 0; index < list.length; index += 1) {
        const sound = list[index]
        if (sound?.id === undefined || known.has(String(sound.id))) continue
        const track = this.describe(memberId, index, sound)
        if (this.bag.length) this.bag.splice(Math.floor(this.random() * (this.bag.length + 1)), 0, track)
      }
      if (this.queuedArtist === memberId) {
        this.queuedArtist = null
        this.playArtist(memberId)
      } else if (this.startWhenReady && this.wantPlay && !this.current && !this.selection) {
        this.startWhenReady = false
        this.next(true)
      }
      this.emit()
    })
  }

  private allTracks(): RadioTrack[] {
    const tracks: RadioTrack[] = []
    for (const member of this.members) {
      const sounds = this.catalogs.get(member.id) ?? []
      sounds.forEach((sound, index) => {
        if (sound?.id === undefined) return
        const track = this.describe(member.id, index, sound)
        if (!this.isBroken(track)) tracks.push(track)
      })
    }
    return tracks
  }

  private poolSize(): number {
    return this.allTracks().length
  }

  private rebuildBag(): void {
    const tracks = this.allTracks()
    for (let i = tracks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1))
      ;[tracks[i], tracks[j]] = [tracks[j], tracks[i]]
    }
    this.bag = tracks
  }

  private removeFromBag(track: RadioTrack): void {
    const at = this.bag.findIndex(item => item.memberId === track.memberId && item.id === track.id)
    if (at >= 0) this.bag.splice(at, 1)
  }

  /** Pick the next bag track, avoiding the same track and (when possible) the same artist. */
  private next(autoplay: boolean, preferMember?: string): boolean {
    const last = this.selection?.track ?? this.current
    if (preferMember) {
      const sameWidget = (track: RadioTrack) => track.memberId === preferMember && (!last || track.id !== last.id) && !this.isBroken(track)
      let pick = this.bag.find(sameWidget)
      if (!pick) {
        const options = this.allTracks().filter(sameWidget)
        pick = options.length ? options[Math.floor(this.random() * options.length)] : undefined
      }
      if (pick) {
        this.removeFromBag(pick)
        this.select(pick, autoplay)
        return true
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.bag.length) this.rebuildBag()
      this.bag = this.bag.filter(track => !this.isBroken(track))
      if (!this.bag.length) continue
      let at = this.bag.findIndex(track => !last || track.memberId !== last.memberId)
      if (at < 0) at = this.bag.findIndex(track => !last || track.id !== last.id)
      if (at < 0) { this.bag = []; continue }
      const [track] = this.bag.splice(at, 1)
      this.select(track, autoplay)
      return true
    }
    // A pool of exactly one playable track: replay it rather than going silent.
    const only = this.allTracks()
    if (only.length === 1) {
      this.select(only[0], autoplay)
      return true
    }
    return false
  }

  private select(track: RadioTrack, autoplay: boolean): void {
    const widget = this.widgets.get(track.memberId)
    if (!widget) return
    this.cancelSelection()
    this.token += 1
    const token = this.token
    this.selection = { track, token }
    if (autoplay) this.wantPlay = true
    for (const [memberId, other] of this.widgets) if (memberId !== track.memberId) other.pause()
    widget.setVolume(this.volume)
    // skip() starts the sound by itself. Calling play() on top makes SoundCloud
    // restart it (PAUSE + PLAY), so only nudge if nothing has started by then.
    widget.skip(track.index)
    if (autoplay) this.timers.setTimeout(() => { if (this.token === token && this.selection) widget.play() }, START_NUDGE_MS)
    this.armWatchdog(track, token)
    this.emit()
  }

  private armWatchdog(track: RadioTrack, token: number): void {
    if (this.watchdog) this.timers.clearTimeout(this.watchdog)
    this.watchdog = this.timers.setTimeout(() => {
      if (this.token !== token || !this.selection) return
      // Hidden tab: the track may only be waiting for the tab to be visible
      // again. Keep waiting instead of marking a good track as broken.
      if (this.isHidden()) { this.armWatchdog(track, token); return }
      this.skipBroken(track)
    }, this.startTimeoutMs)
  }

  private cancelSelection(): void {
    if (this.watchdog) this.timers.clearTimeout(this.watchdog)
    this.watchdog = null
    this.selection = null
    this.token += 1
  }

  private skipBroken(track: RadioTrack): void {
    const key = keyOf(track.memberId, track.id)
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1)
    this.skipped += 1
    this.widgets.get(track.memberId)?.pause()
    this.cancelSelection()
    if (this.current && this.current.memberId === track.memberId && this.current.id === track.id) this.current = null
    if (this.wantPlay) this.next(true)
    this.skipToken = this.selection?.token ?? null
    this.emit()
  }

  private isBroken(track: RadioTrack): boolean {
    return (this.failures.get(keyOf(track.memberId, track.id)) ?? 0) >= 2
  }

  private describe(memberId: string, index: number, sound: RadioSound | undefined): RadioTrack {
    const member = this.members.find(item => item.id === memberId)
    const catalogSound = this.catalogs.get(memberId)?.[index]
    const best = sound?.title ? sound : catalogSound ?? sound
    return {
      memberId,
      index,
      id: String(sound?.id ?? catalogSound?.id ?? `${memberId}-${index}`),
      title: best?.title ?? null,
      artist: member ? `${member.name}${member.alias ? ` / ${member.alias}` : ''}` : (best?.user?.username ?? '4EVER'),
      url: best?.permalink_url ?? member?.profileUrl ?? 'https://soundcloud.com',
    }
  }

  private emit(): void {
    this.onChange(this.getState())
  }
}
