/**
 * Radio 4EVER self-test. Run:  npm run test:radio   (Node 22.18+)
 *
 * 1. Scenario tests for the new engine against a simulated SoundCloud.
 * 2. Randomised stress test: the SAME simulated world and user behaviour is
 *    run through the old logic and the new engine, counting how
 *    often each one breaks the radio's promises.
 */
import { RadioEngine, type RadioMember } from '../src/lib/radioEngine.ts'
import { LegacyRadio } from './radio-legacy.ts'
import { Clock, FakeWidget, mulberry32, type MemberSpec } from './radio-sim.ts'

type World = { clock: Clock; widgets: Record<string, FakeWidget>; specs: MemberSpec[] }

function makeWorld(specs: MemberSpec[], seed: number): World {
  const clock = new Clock()
  const rng = mulberry32(seed)
  const widgets: Record<string, FakeWidget> = {}
  for (const spec of specs) widgets[spec.id] = new FakeWidget(spec, clock, rng)
  return { clock, widgets, specs }
}

const members = (specs: MemberSpec[]): RadioMember[] => specs.map(spec => ({ id: spec.id, name: spec.id, profileUrl: `https://soundcloud.com/${spec.id}` }))

function newEngine(world: World, seed: number, extra: { isHidden?: () => boolean } = {}) {
  const engine = new RadioEngine(members(world.specs), { volume: 22, random: mulberry32(seed * 7 + 1), timers: world.clock, startTimeoutMs: 9000, catalogRefreshMs: [4000, 15000, 45000], now: () => world.clock.now, ...extra })
  for (const [id, widget] of Object.entries(world.widgets)) {
    engine.attach(id, widget)
    widget.on('READY', m => engine.handleReady(m))
    widget.on('PLAY', m => engine.handlePlay(m))
    widget.on('PAUSE', m => engine.handlePause(m))
    widget.on('FINISH', m => engine.handleFinish(m))
    widget.on('ERROR', m => engine.handleError(m))
    widget.start()
  }
  return engine
}

const playingWidgets = (world: World) => Object.values(world.widgets).filter(widget => widget.playing)
const nowPlaying = (world: World) => { const [widget] = playingWidgets(world); return widget ? { memberId: widget.spec.id, id: String(widget.sounds[widget.index].id), volume: widget.volume } : null }

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`)
}

const BASE: MemberSpec[] = [
  { id: 'moneynlust', tracks: 12 }, { id: 'cinho', tracks: 5 }, { id: 'rani', tracks: 30 },
  { id: 'agus', tracks: 8 }, { id: 'aletsandrr', tracks: 3 }, { id: 'mundane', tracks: 15 },
]

// ---------------------------------------------------------------- scenarios

{ // T1 coverage + no back-to-back artist
  const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 300 })), 1)
  const engine = newEngine(world, 1)
  world.clock.run(2000)
  const pool = engine.getState().poolSize
  engine.play(); world.clock.run(2500)
  const heard: string[] = []; let sameArtist = 0
  for (let i = 0; i < pool; i += 1) {
    const state = engine.getState()
    if (state.current) heard.push(`${state.current.memberId}/${state.current.id}`)
    const before = state.current?.memberId
    if (i < pool - 1) engine.shuffle()
    world.clock.run(2500)
    if (i < pool - 1 && engine.getState().current?.memberId === before) sameArtist += 1
  }
  check('T1 every track of the pool plays once per cycle', new Set(heard).size === pool && heard.length === pool, `${new Set(heard).size}/${pool} distinct`)
  check('T1 no artist twice in a row (avoidable cases)', sameArtist <= 3, `${sameArtist} repeats in ${pool - 1} changes`)
}

{ // T2 + T3 volume after auto-next, SoundCloud auto-advance race
  let volumeOk = true, singleOk = true, metaOk = true
  for (let seed = 1; seed <= 40; seed += 1) {
    const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 200 })), seed)
    const engine = newEngine(world, seed)
    world.clock.run(2000); engine.play(); world.clock.run(2500)
    engine.setVolume(63)
    for (let k = 0; k < 4; k += 1) { playingWidgets(world)[0]?.finish(); world.clock.run(2500) }
    const playing = nowPlaying(world), state = engine.getState()
    if (!playing || playing.volume !== 63) volumeOk = false
    if (playingWidgets(world).length !== 1) singleOk = false
    if (!playing || state.current?.id !== playing.id || state.current?.memberId !== playing.memberId) metaOk = false
  }
  check('T2 new tracks keep the volume the user set (40 seeds)', volumeOk)
  check('T3 after SoundCloud auto-advance only one widget plays (40 seeds)', singleOk)
  check('T3 shown title = the sound actually playing (40 seeds)', metaOk)
}

{ // T4 broken tracks are skipped, never a silent radio
  const specs: MemberSpec[] = [{ id: 'ok', tracks: 4, readyAt: 200 }, { id: 'ghost', tracks: 3, readyAt: 200, broken: [0, 1, 2] }, { id: 'half', tracks: 4, readyAt: 200, broken: [1, 3], errorEvent: true }]
  const world = makeWorld(specs, 4)
  const engine = newEngine(world, 4)
  world.clock.run(1500)
  engine.playArtist('ghost'); world.clock.run(30000)
  const state = engine.getState()
  check('T4 a track that never starts is skipped within the timeout', playingWidgets(world).length === 1 && state.status === 'playing', `status ${state.status}, skipped ${state.skippedTracks}`)
  for (let i = 0; i < 12; i += 1) { engine.shuffle(); world.clock.run(12000) }
  check('T4 radio keeps playing through broken tracks', playingWidgets(world).length === 1 && engine.getState().status === 'playing', `skipped ${engine.getState().skippedTracks}`)
}

{ // T5 late artist joins the running shuffle
  const specs = BASE.map(spec => ({ ...spec, readyAt: spec.id === 'cinho' ? 6000 : 300 }))
  const world = makeWorld(specs, 5)
  const engine = newEngine(world, 5)
  world.clock.run(1500); engine.play(); world.clock.run(6000)
  const pool = engine.getState().poolSize
  let lateHeard = 0
  for (let i = 0; i < pool; i += 1) { engine.shuffle(); world.clock.run(2500); if (engine.getState().current?.memberId === 'cinho') lateHeard += 1 }
  check('T5 artist that loads late enters the current shuffle cycle', lateHeard >= 4, `cinho heard ${lateHeard}/5 times in one cycle (pool ${pool})`)
}

{ // T6 catalog that grows lazily
  const specs = BASE.map(spec => spec.id === 'rani' ? { ...spec, readyAt: 300, lazyVisible: 5, lazyFullAt: 10000 } : { ...spec, readyAt: 300 })
  const world = makeWorld(specs, 6)
  const engine = newEngine(world, 6)
  world.clock.run(3000)
  const early = engine.getState().poolSize
  world.clock.run(50000)
  const later = engine.getState().poolSize
  check('T6 tracks SoundCloud loads later are added to the pool', later === early + 25, `${early} → ${later}`)
}

{ // T7 rapid shuffle burst, T8 pause/resume, T9 artist requested before it loads
  const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: spec.id === 'mundane' ? 5000 : 300 })), 7)
  const engine = newEngine(world, 7)
  world.clock.run(1500); engine.play(); world.clock.run(2500)
  for (let i = 0; i < 8; i += 1) { engine.shuffle(); world.clock.run(50) }
  world.clock.run(2500)
  const p = nowPlaying(world), s = engine.getState()
  check('T7 8 shuffles in 0.4 s end with one widget and matching title', playingWidgets(world).length === 1 && s.current?.id === p?.id)
  const before = s.current?.id
  engine.pause(); world.clock.run(1500)
  check('T8 pause silences every widget', playingWidgets(world).length === 0 && engine.getState().status === 'paused')
  engine.play(); world.clock.run(1500)
  check('T8 play resumes the same track', engine.getState().current?.id === before && playingWidgets(world).length === 1)
  const world2 = makeWorld(BASE.map(spec => ({ ...spec, readyAt: spec.id === 'mundane' ? 5000 : 300 })), 8)
  const engine2 = newEngine(world2, 8)
  world2.clock.run(1000); engine2.playArtist('mundane'); world2.clock.run(7000)
  check('T9 artist chosen before its catalog loads plays once it loads', engine2.getState().current?.memberId === 'mundane' && playingWidgets(world2).length === 1)
}

{ // T10 SoundCloud pauses our new track when the old widget auto-advances: the radio must keep going
  let kept = 0
  const runs = 20
  for (let seed = 1; seed <= runs; seed += 1) {
    const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 200 })), 100 + seed)
    const engine = newEngine(world, 100 + seed)
    world.clock.run(2000); engine.play(); world.clock.run(2500)
    const first = playingWidgets(world)[0]
    first.finish(); world.clock.run(2500)
    const second = playingWidgets(world)[0]
    // The finished widget auto-advances (late PLAY) and SoundCloud pauses the one we picked.
    first.play(); world.clock.run(30)
    second?.pause(); world.clock.run(3000)
    if (playingWidgets(world).length === 1 && engine.getState().status === 'playing' && engine.getState().wantPlay) kept += 1
  }
  check('T10 a track change is not stopped by SoundCloud pausing the new widget', kept === runs, `${kept}/${runs} kept playing`)
}

{ // T11 a real pause later on (e.g. the keyboard media key) is still respected
  const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 200 })), 131)
  const engine = newEngine(world, 131)
  world.clock.run(2000); engine.play(); world.clock.run(2500)
  world.clock.run(20000)
  playingWidgets(world)[0]?.pause(); world.clock.run(1500)
  check('T11 a pause long after the track started is respected', engine.getState().wantPlay === false && playingWidgets(world).length === 0)
}

{ // T12 background tab: the next track stays in the same widget; stalls do not mark tracks broken
  let hidden = false
  const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 200 })), 141)
  const engine = newEngine(world, 141, { isHidden: () => hidden })
  world.clock.run(2000); engine.play(); world.clock.run(2500)
  hidden = true
  let sameWidget = 0
  for (let i = 0; i < 6; i += 1) {
    const widget = playingWidgets(world)[0]
    const before = widget?.spec.id
    widget?.finish(); world.clock.run(2500)
    if (engine.getState().current?.memberId === before && playingWidgets(world).length === 1) sameWidget += 1
  }
  check('T12 hidden tab: after a song ends the next one plays in the same widget', sameWidget === 6, `${sameWidget}/6`)
  // A selection that cannot start while hidden is kept, not skipped as broken.
  const stuck = Object.values(world.widgets).find(w => !w.playing)!
  const skippedBefore = engine.getState().skippedTracks
  const realPlay = stuck.play.bind(stuck), realSkip = stuck.skip.bind(stuck)
  stuck.play = () => {}; stuck.skip = (index: number) => { stuck.index = index }
  engine.playArtist(stuck.spec.id); world.clock.run(30000)
  check('T12 hidden tab: a track waiting to start is not marked broken', engine.getState().skippedTracks === skippedBefore)
  stuck.play = realPlay; stuck.skip = realSkip
  hidden = false; engine.resumeIfStalled(); world.clock.run(2500)
  check('T12 back to the tab: the waiting track starts', engine.getState().current?.memberId === stuck.spec.id && playingWidgets(world).length === 1)
}

{ // T13 song after song with real SoundCloud events (PAUSE before FINISH, PAUSE+PLAY on restart)
  let ok = 0
  for (let seed = 1; seed <= 20; seed += 1) {
    const world = makeWorld(BASE.map(spec => ({ ...spec, readyAt: 200 })), 300 + seed)
    const engine = newEngine(world, 300 + seed)
    world.clock.run(2000); engine.play(); world.clock.run(3000)
    let alive = true
    for (let k = 0; k < 10; k += 1) {
      playingWidgets(world)[0]?.finish(); world.clock.run(4000)
      if (playingWidgets(world).length !== 1 || !engine.getState().wantPlay) { alive = false; break }
    }
    if (alive) ok += 1
  }
  check('T13 the radio keeps playing through 10 song endings in a row (20 sessions)', ok === 20, `${ok}/20`)
}

// ---------------------------------------------------------------- stress: old vs new

type Driver = {
  ready(m: string): void; play(m: string): void; pause(m: string): void; finish(m: string): void; error(m: string): void
  shuffle(): void; nextFromArtist(): void; playArtist(id: string): void; setVolume(v: number): void; userPause(): void; userPlay(): void
  shown(): { memberId: string; id: string } | null; uiPlaying(): boolean; volume(): number
}

function stress(kind: 'old' | 'new', seed: number) {
  const specs: MemberSpec[] = [
    { id: 'moneynlust', tracks: 12 }, { id: 'cinho', tracks: 5, readyAt: 7000 }, { id: 'rani', tracks: 30, lazyVisible: 6, lazyFullAt: 20000 },
    { id: 'agus', tracks: 8, broken: [2] }, { id: 'aletsandrr', tracks: 3, broken: [1], errorEvent: true }, { id: 'mundane', tracks: 15 },
  ]
  const world = makeWorld(specs, seed)
  let driver: Driver
  if (kind === 'new') {
    const engine = new RadioEngine(members(specs), { volume: 22, random: mulberry32(seed * 13), timers: world.clock })
    for (const [id, widget] of Object.entries(world.widgets)) engine.attach(id, widget)
    driver = {
      ready: m => engine.handleReady(m), play: m => engine.handlePlay(m), pause: m => engine.handlePause(m), finish: m => engine.handleFinish(m), error: m => engine.handleError(m),
      shuffle: () => engine.shuffle(), nextFromArtist: () => engine.nextFromArtist(), playArtist: id => engine.playArtist(id), setVolume: v => engine.setVolume(v),
      userPause: () => engine.pause(), userPlay: () => engine.play(),
      shown: () => { const c = engine.getState().current; return c ? { memberId: c.memberId, id: c.id } : null },
      uiPlaying: () => engine.getState().status === 'playing', volume: () => engine.getState().volume,
    }
  } else {
    const legacy = new LegacyRadio(specs.map(spec => spec.id), 22, mulberry32(seed * 13), world.clock)
    for (const [id, widget] of Object.entries(world.widgets)) legacy.attach(id, widget)
    driver = {
      ready: m => legacy.handleReady(m), play: m => legacy.handlePlay(m), pause: m => legacy.handlePause(m), finish: () => legacy.handleFinish(), error: () => legacy.handleError(),
      shuffle: () => legacy.shuffle(), nextFromArtist: () => legacy.nextFromArtist(), playArtist: id => legacy.playArtist(id), setVolume: v => legacy.setVolume(v),
      userPause: () => legacy.pause(), userPlay: () => legacy.play(),
      shown: () => legacy.shownMember ? { memberId: legacy.shownMember, id: String(legacy.shownId) } : null,
      uiPlaying: () => legacy.playing, volume: () => legacy.volume,
    }
  }
  for (const [, widget] of Object.entries(world.widgets)) {
    widget.on('READY', m => driver.ready(m)); widget.on('PLAY', m => driver.play(m)); widget.on('PAUSE', m => driver.pause(m))
    widget.on('FINISH', m => driver.finish(m)); widget.on('ERROR', m => driver.error(m)); widget.start()
  }
  const rng = mulberry32(seed * 31 + 7)
  const stats = { checks: 0, twoPlaying: 0, wrongTitle: 0, wrongVolume: 0, silentChecks: 0, longChecks: 0 }
  world.clock.run(2500); driver.userPlay(); world.clock.run(3000)
  let userWants = true
  for (let step = 0; step < 120; step += 1) {
    const r = rng()
    if (r < 0.25) driver.shuffle()
    else if (r < 0.33) driver.nextFromArtist()
    else if (r < 0.41) driver.playArtist(specs[Math.floor(rng() * specs.length)].id)
    else if (r < 0.66) playingWidgets(world)[0]?.finish()
    else if (r < 0.76) driver.setVolume(Math.floor(rng() * 100))
    else if (r < 0.80) { driver.userPause(); userWants = false }
    else if (r < 0.86) { driver.userPlay(); userWants = true }
    else { for (let k = 0; k < 4; k += 1) { driver.shuffle(); world.clock.run(60) } }
    if (r < 0.41 || r >= 0.86) userWants = true
    world.clock.run(2500)
    stats.checks += 1
    const playing = playingWidgets(world)
    if (playing.length > 1) stats.twoPlaying += 1
    const p = nowPlaying(world)
    if (p && driver.uiPlaying()) {
      const shown = driver.shown()
      if (!shown || shown.memberId !== p.memberId || shown.id !== p.id) stats.wrongTitle += 1
      if (p.volume !== driver.volume()) stats.wrongVolume += 1
    }
    if (step % 10 === 9) {
      world.clock.run(12000); stats.longChecks += 1
      if (userWants && playingWidgets(world).length === 0) stats.silentChecks += 1
    }
  }
  return stats
}

const total = (kind: 'old' | 'new') => {
  const sum = { checks: 0, twoPlaying: 0, wrongTitle: 0, wrongVolume: 0, silentChecks: 0, longChecks: 0 }
  for (let seed = 1; seed <= 25; seed += 1) { const s = stress(kind, seed); for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += s[key] }
  return sum
}
const oldStats = total('old'), newStats = total('new')
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`.padStart(6)
console.log('\nStress test: 25 simulated sessions × 120 user actions (same world & behaviour for both)')
console.log('                                   OLD ENGINE        NEW ENGINE')
console.log(`two tracks playing at once          ${pct(oldStats.twoPlaying, oldStats.checks)}            ${pct(newStats.twoPlaying, newStats.checks)}`)
console.log(`title/artist ≠ what is playing      ${pct(oldStats.wrongTitle, oldStats.checks)}            ${pct(newStats.wrongTitle, newStats.checks)}`)
console.log(`volume ≠ the user's volume          ${pct(oldStats.wrongVolume, oldStats.checks)}            ${pct(newStats.wrongVolume, newStats.checks)}`)
console.log(`silent although music was wanted    ${pct(oldStats.silentChecks, oldStats.longChecks)}            ${pct(newStats.silentChecks, newStats.longChecks)}`)
check('STRESS new engine never plays two tracks at once', newStats.twoPlaying === 0)
check('STRESS new engine title always matches the playing track', newStats.wrongTitle === 0)
check('STRESS new engine volume always matches the user', newStats.wrongVolume === 0)
check('STRESS new engine never goes silent while music is wanted', newStats.silentChecks === 0)

console.log(`\nRADIO SELFTEST: ${failures === 0 ? 'all passed' : failures + ' failed'}`)
process.exit(failures ? 1 : 0)
