import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Check, ClipboardPaste, Disc3, Download, ExternalLink, FlaskConical, History, Menu, Music2, Palette, Pause, Play, Shuffle, SkipForward, Sparkles, Trash2, Upload, Volume2, VolumeX, X, Zap } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { collective, memberById, memberIdFromHash, signalMatch } from './data/collective'
import { MemberWorld } from './collective/MemberWorld'
import { MemberAvatar } from './collective/MemberAvatar'
import { useMemberMetadata } from './collective/metadata'
import { loadFoundSignals, markSignalFound } from './collective/signals'
import { inkOn } from './lib/sigil'
import { getTheme, publicThemes, Theme, themes, weightedTheme } from './data/themes'
import { heritageLogos } from './data/heritage'
import { factAt, randomFactIndex } from './data/lore'
import type { LoreFact } from './data/lore'
import { analyzeAudioFile, AudioAnalysis, foldToRange, snapBpm } from './lib/analysisEngine'
import { getSfxSources, getSfxVolume, playSfx, setSfxEnabled, setSfxTheme, setSfxVolume, warmSfxCache } from './lib/sfx'
import type { SfxName } from './lib/sfx'
import { PACK_LABEL, packForTheme } from './lib/sfxSynth'
import { RadioEngine, type RadioState, type RadioStatus } from './lib/radioEngine'
import { addToHistory, clearHistory, describeOutput, formatBytes, HOME_TUNNEL, jobUrl, loadActiveJob, loadHistory, postConversion, saveActiveJob, timeLeft, type ActiveJob, type ConvertFormat, type HistoryEntry, type OutputInfo } from './lib/converter'
import { AeroGadget, AeroWorld } from './worlds/AeroWorld'
import { AquaWorld } from './worlds/AquaWorld'
import { LegacyFooter, LegacyWarning, LegacyWorld } from './worlds/LegacyWorld'
import { TaleDialogue, TaleWorld } from './worlds/TaleWorld'
import { BlackbookChecklist, BlackbookWorld } from './worlds/BlackbookWorld'
import { NeonLineup, NeonWorld } from './worlds/NeonWorld'
import { TransitBoard, TransitWorld } from './worlds/TransitWorld'
import { UndergroundCrate, UndergroundWorld } from './worlds/UndergroundWorld'
import { apiUrl } from './lib/api'

type Tool = 'converter' | 'analyzer' | 'lab'

// 4EVER LAB loads only when opened: its DSP is not in the main bundle.
const Lab = lazy(() => import('./lab/Lab'))
type ThemeMode = 'random' | 'locked'

const randomRadioMember = () => {
  const radio = collective.filter(member => member.radio)
  return radio[Math.floor(Math.random() * radio.length)]
}

const makeSeed = () => Math.floor(Math.random() * 100000)

/** Black or white, whichever reads better on top of a theme colour (WCAG luminance). */
function readableOn(hex: string): string {
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#0b0b0b' : '#ffffff'
}

function initialThemeState() {
  const mode = localStorage.getItem('4ever-theme-mode') as ThemeMode | null
  const stored = getTheme(localStorage.getItem('4ever-theme-id'))
  // archived worlds are gone; an old lock on one falls back to a random world.
  const storedAllowed = stored && (stored.rarity > 0 || stored.id === 'secret-true')
  return mode === 'locked' && storedAllowed ? stored : weightedTheme()
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => initialThemeState())
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem('4ever-theme-mode') as ThemeMode | null) ?? 'random')
  const [entered, setEntered] = useState(false)
  const [crewOpen, setCrewOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [tool, setTool] = useState<Tool>('converter')
  const [playing, setPlaying] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [apiReady, setApiReady] = useState<'checking' | 'ready' | 'degraded'>('checking')
  // A free host puts the API to sleep when nobody uses it; the first call wakes it (about a minute).
  const [apiWaking, setApiWaking] = useState(false)
  const [radioVolume, setRadioVolume] = useState(() => Number(localStorage.getItem('4ever-radio-volume') ?? 22))
  const [uiSound, setUiSound] = useState(() => { try { return localStorage.getItem('4ever-ui-sound') !== 'off' } catch { return true } })
  const [sfxVolume, setSfxVolumeState] = useState(() => getSfxVolume())
  const [assetProgress, setAssetProgress] = useState(0)
  const [radioPreload, setRadioPreload] = useState({ loaded: 0, total: collective.filter(member => member.radio).length, tracks: 0 })
  const [preloadBypass, setPreloadBypass] = useState(false)
  const [radioRequest, setRadioRequest] = useState<{ memberId: string; nonce: number } | null>(null)
  const [activeRadioMemberId, setActiveRadioMemberId] = useState(() => randomRadioMember().id)
  const [memberSecret, setMemberSecret] = useState<string | null>(null)
  const [worldMemberId, setWorldMemberId] = useState<string | null>(null)
  // an underground fact instead of describing the theme; a new one with every world.
  const [factIndex, setFactIndex] = useState(() => randomFactIndex())
  const fact = factAt(factIndex)
  // A WAV made in the LAB, handed to the converter to become an MP3.
  const [handoff, setHandoff] = useState<{ file: File; nonce: number } | null>(null)
  // A shared #crew/<id> link opens that member's world once the visitor is past the gate.
  const [pendingWorld, setPendingWorld] = useState<string | null>(() => memberIdFromHash(window.location.hash))
  const [foundSignals, setFoundSignals] = useState<string[]>(() => loadFoundSignals())
  const [secretNotice, setSecretNotice] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [compositionSeed, setCompositionSeed] = useState(makeSeed)
  const typed = useRef('')

  const stickerLayout = useMemo(() => {
    const labels = ['NO SKIPS', '4E RADIO', theme.name, theme.stamp, 'BPM / KEY', 'EST. 4EVER', 'NO SLEEP', 'UNDERGROUND ONLY', 'SIDE B', '145 BPM', 'KEEP OUT', '4EVER AVE']
    return labels.map((label, index) => ({
      label,
      left: `${5 + ((compositionSeed * (index + 3)) % 84)}%`,
      top: `${8 + ((compositionSeed * (index + 7)) % 78)}%`,
      rotate: -16 + ((compositionSeed + index * 19) % 32),
      scale: .78 + (((compositionSeed + index * 13) % 24) / 100),
    }))
  }, [compositionSeed, theme.name, theme.stamp])

  const applyTheme = (next: Theme, lock = themeMode === 'locked') => {
    if (next.id === theme.id) return
    // The new world's sound pack announces the switch.
    setSfxTheme(next.id)
    void playSfx('theme-switch')
    setFactIndex(index => index + 1)
    setTransitioning(true)
    window.setTimeout(() => {
      setTheme(next)
      setCompositionSeed(makeSeed())
      if (lock) localStorage.setItem('4ever-theme-id', next.id)
      window.setTimeout(() => setTransitioning(false), 280)
    }, 230)
  }

  /** Theme-world shortcuts (crate, departures board, checklist…): pick a tool and scroll to it. */
  const openTool = (next: Tool) => {
    setTool(next)
    document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })
  }

  const shuffleTheme = () => {
    const candidates = publicThemes.filter(item => item.id !== theme.id)
    applyTheme(candidates[Math.floor(Math.random() * candidates.length)], false)
  }

  const chooseTheme = (next: Theme) => {
    setThemeMode('locked')
    localStorage.setItem('4ever-theme-mode', 'locked')
    localStorage.setItem('4ever-theme-id', next.id)
    applyTheme(next, true)
  }

  const setMode = (mode: ThemeMode) => {
    setThemeMode(mode)
    localStorage.setItem('4ever-theme-mode', mode)
    if (mode === 'random') {
      localStorage.removeItem('4ever-theme-id')
      shuffleTheme()
    } else {
      localStorage.setItem('4ever-theme-id', theme.id)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea')) return
      if (event.key.length !== 1) return
      typed.current = (typed.current + event.key.toLowerCase()).slice(-20)
      if (typed.current.endsWith('#4ever')) {
        const secret = themes.find(item => item.id === 'secret-true')!
        setThemeMode('locked')
        localStorage.setItem('4ever-theme-mode', 'locked')
        localStorage.setItem('4ever-theme-id', secret.id)
        applyTheme(secret, true)
        window.setTimeout(() => void playSfx('secret-unlock'), 260)
        setSecretNotice(true)
        window.setTimeout(() => setSecretNotice(false), 3600)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theme.id, uiSound])

  useEffect(() => {
    localStorage.setItem('4ever-radio-volume', String(radioVolume))
  }, [radioVolume])

  useEffect(() => {
    const anyDrawerOpen = crewOpen || themeOpen || mobileNavOpen || Boolean(worldMemberId)
    document.body.style.overflow = anyDrawerOpen ? 'hidden' : ''
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCrewOpen(false)
      setThemeOpen(false)
      setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEscape)
    }
  }, [crewOpen, themeOpen, mobileNavOpen, worldMemberId])

  useEffect(() => {
    warmSfxCache()
    const urls = themes.map(item => item.logo)
    let finished = 0
    if (!urls.length) { setAssetProgress(100); return }
    urls.forEach(url => {
      const image = new Image()
      const done = () => {
        finished += 1
        setAssetProgress(Math.round((finished / urls.length) * 100))
      }
      image.onload = done
      image.onerror = done
      image.src = url
    })
    const bypass = window.setTimeout(() => setPreloadBypass(true), 12000)
    return () => window.clearTimeout(bypass)
  }, [])

  useEffect(() => {
    setSfxVolume(sfxVolume)
  }, [sfxVolume])

  // interface sounds: mute toggle, theme pack, global hover/click, drawers.
  useEffect(() => {
    setSfxEnabled(uiSound)
    try { localStorage.setItem('4ever-ui-sound', uiSound ? 'on' : 'off') } catch { /* private mode */ }
  }, [uiSound])

  useEffect(() => { setSfxTheme(theme.id) }, [theme.id])

  useEffect(() => {
    let hovered: Element | null = null
    const target = (event: Event) => {
      const el = (event.target as Element | null)?.closest?.('button, a[href], [role="button"], summary')
      if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-sfx="off"], .drawer-backdrop')) return null
      return el
    }
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const el = target(event)
      if (el && el !== hovered) void playSfx('ui-hover', .5)
      hovered = el
    }
    const onClick = (event: MouseEvent) => { if (target(event)) void playSfx('ui-click') }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  const anyPanelOpen = crewOpen || themeOpen || mobileNavOpen || Boolean(worldMemberId)
  const panelWasOpen = useRef(anyPanelOpen)
  useEffect(() => {
    if (panelWasOpen.current !== anyPanelOpen) void playSfx(anyPanelOpen ? 'ui-open' : 'ui-close')
    panelWasOpen.current = anyPanelOpen
  }, [anyPanelOpen])

  const findSignal = (id: string) => {
    const result = markSignalFound(id)
    setFoundSignals(result.found)
    setMemberSecret(id)
    void playSfx('secret-unlock')
    window.setTimeout(() => setMemberSecret(current => (current === id ? null : current)), 5200)
  }

  useEffect(() => {
    const onMemberKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea')) return
      if (event.key.length !== 1) return
      const id = signalMatch(typed.current)
      if (id) {
        typed.current = '' // one signal per word typed
        findSignal(id)
      }
    }
    window.addEventListener('keyup', onMemberKey)
    return () => window.removeEventListener('keyup', onMemberKey)
  }, [])

  // Member worlds: #crew/<id> links, browser back/forward, and opening after the gate.
  useEffect(() => {
    const onHash = () => {
      const id = memberIdFromHash(window.location.hash)
      if (id) setPendingWorld(id)
      else setWorldMemberId(null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (entered && pendingWorld) {
      setWorldMemberId(pendingWorld)
      setPendingWorld(null)
    }
  }, [entered, pendingWorld])

  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}`
    if (worldMemberId) {
      if (window.location.hash !== `#crew/${worldMemberId}`) window.history.replaceState(null, '', `${url}#crew/${worldMemberId}`)
    } else if (memberIdFromHash(window.location.hash)) {
      window.history.replaceState(null, '', url)
    }
  }, [worldMemberId])

  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
    const controller = new AbortController()
    const slow = window.setTimeout(() => setApiWaking(true), 4000)
    fetch(apiUrl('/api/ready'), { signal: controller.signal })
      .then(response => setApiReady(response.ok ? 'ready' : 'degraded'))
      .catch(() => setApiReady('degraded'))
      .finally(() => { window.clearTimeout(slow); setApiWaking(false) })
    return () => {
      window.clearTimeout(slow)
      controller.abort()
      window.removeEventListener('online', syncOnline)
      window.removeEventListener('offline', syncOnline)
    }
  }, [])

  const cssVars = {
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--surface': theme.surface,
    '--paper': theme.paper,
    '--ink': theme.ink,
    '--logo-sqrt-ar': Math.sqrt(theme.logoRatio).toFixed(3),
    '--on-accent': readableOn(theme.accent),
  } as React.CSSProperties

  return (
    <div className={`app texture-${theme.texture} theme-${theme.id}`} style={cssVars}>
      <div className="noise" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <div className="ambient ambient-a" aria-hidden="true" />
      <div className="ambient ambient-b" aria-hidden="true" />
      <div className="floating-stickers" aria-hidden="true">
        {stickerLayout.map((sticker, index) => <span key={`${sticker.label}-${index}`} style={{ left: sticker.left, top: sticker.top, rotate: `${sticker.rotate}deg`, scale: sticker.scale }}>{sticker.label}</span>)}
      </div>
      <div className="maximal-world" aria-hidden="true">
        <span className="world-warning">WARNING / HIGH AUDIO PRESSURE</span>
        <span className="world-street">4EVER AVE</span>
        <span className="world-number">04</span>
        <span className="world-cross">+</span>
        <span className="world-cross world-cross-b">+</span>
        <span className="world-ticket">ADMIT ONE · NIGHT SHIFT · {theme.name}</span>
      </div>
      {theme.id === 'star-rule' && (
        <div className="star-rule-world" aria-hidden="true">
          <div className="sr-top-links">My Account &nbsp; Posts &nbsp; Comments &nbsp; Wiki &nbsp; Aliases &nbsp; Artists &nbsp; Tags &nbsp; Pools &nbsp; Forum</div>
          <div className="sr-search-box"><b>Search</b><input tabIndex={-1} aria-hidden="true" /><button tabIndex={-1}>Search</button></div>
          <div className="sr-marquee">★ WELCOME TO THE 4EVER INTERNET ★ RADIO ONLINE ★ BPM ENGINE READY ★ RULE4EVER ★</div>
          <div className="sr-counter">VISITORS: 000004EVER</div>
          <div className="sr-status-card"><b>System Status</b><span>Radio: ONLINE</span><span>BPM: READY</span><span>Key: READY</span><span>Last update: 04:44</span></div>
          <div className="sr-link-cloud"><a>Video</a><a>Upload</a><a>Random</a><a>Contact Us</a><a>About</a><a>Help</a><a>TOS</a></div>
          <div className="sr-star sr-star-a">★</div><div className="sr-star sr-star-b">☆</div><div className="sr-star sr-star-c">★</div>
        </div>
      )}
      {theme.id === 'comic-hit' && (
        <div className="hot-comic-world" aria-hidden="true">
          <div className="hc-halftone hc-halftone-a" />
          <div className="hc-halftone hc-halftone-b" />
          <div className="hc-speedline hc-speedline-a" />
          <div className="hc-speedline hc-speedline-b" />
          <div className="hc-portal-stamp">4EVER<br/><b>CHOX</b></div>
          <div className="hc-portal-stamp hc-portal-stamp-b">4EVER<br/><b>TOOLS</b></div>
        </div>
      )}
      {theme.id === 'aqua-cartoon' && <AquaWorld />}
      {theme.id === 'legacy-label' && <LegacyWorld />}
      {theme.id === 'tale' && <TaleWorld />}
      {theme.id === 'red-block' && <UndergroundWorld />}
      {theme.id === 'purple-subway' && <TransitWorld />}
      {theme.id === 'neon-tour' && <NeonWorld />}
      {theme.id === 'blackbook' && <BlackbookWorld />}
      {theme.id === 'secret-true' && <AeroWorld />}

      <AnimatePresence>{transitioning && <motion.div className="theme-transition" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} exit={{ scaleY: 0 }} transition={{ duration: .24 }}><span>{theme.name}</span></motion.div>}</AnimatePresence>

      <AnimatePresence mode="wait">
        {!entered ? (
          <motion.section className="gate" key="gate" exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: .55 }}>
            <motion.img className="gate-logo" src={theme.logo} alt="#4ever" initial={{ y: -40, rotate: -4, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} />
            <p className="eyebrow">UNDERGROUND AUDIO LAB / {theme.name}</p>
            <h1>{theme.headline}</h1>
            <LoreLine fact={fact} onNext={() => setFactIndex(index => index + 1)} paragraphClass="gate-subline" />
            <div className="preload-console">
              <div><span>ASSETS</span><strong>{assetProgress}%</strong></div>
              <div className="preload-line"><i style={{ width: `${assetProgress}%` }} /></div>
              <div><span>RADIO 4EVER</span><strong>{radioPreload.loaded}/{radioPreload.total} ARTISTS · {radioPreload.tracks} TRACKS</strong></div>
              <div className="preload-line"><i style={{ width: `${radioPreload.total ? (radioPreload.loaded / radioPreload.total) * 100 : 0}%` }} /></div>
            </div>
            <div className="gate-actions">
              <button className="sticker-button primary" disabled={!preloadBypass && (assetProgress < 100 || radioPreload.loaded < radioPreload.total)} onClick={() => { setEntered(true); setPlaying(true) }}>ENTER WITH SOUND <Play size={18} /></button>
              <button className="text-button" disabled={!preloadBypass && assetProgress < 100} onClick={() => setEntered(true)}>ENTER MUTED</button>
            </div>
            <div className="gate-controls">
              <button className="theme-peek" onClick={shuffleTheme}><Shuffle size={16} /> shuffle identity</button>
              <button className="theme-peek" onClick={() => setThemeOpen(true)}><Palette size={16} /> theme archive</button>
            </div>
            <span className="gate-note">TYPE <b>#4EVER</b> ANYWHERE TO UNLOCK THE BACK ROOM.</span>
          </motion.section>
        ) : (
          <motion.div className="shell" key="shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {online && apiReady === 'checking' && apiWaking && <div className="system-banner" role="status"><strong>WAKING UP THE CONVERTER</strong><span>The converter server sleeps when nobody uses it. It is ready in about a minute; everything else already works.</span></div>}
            {(!online || apiReady === 'degraded') && <div className="system-banner" role="status"><strong>{!online ? 'OFFLINE MODE' : 'PROCESSING API DEGRADED'}</strong><span>{!online ? 'Local playback and browser analysis remain available. URL conversion requires connection.' : 'The interface is online, but server conversion may be temporarily unavailable.'}</span></div>}
            <header className="header">
              <button className="brand-button" onClick={() => setThemeOpen(true)} aria-label="Open themes"><img src={theme.logo} alt="#4ever" /></button>
              {theme.id === 'comic-hit' && (
                <div className="hot-comic-search">
                  <input aria-label="Search 4EVERTOOLS" placeholder="Buscar..." />
                  <button aria-label="Search">⌕</button>
                </div>
              )}
              <nav className="desktop-nav">
                <button className={tool === 'converter' ? 'active' : ''} onClick={() => setTool('converter')}>URL CONVERTER</button>
                <button className={tool === 'analyzer' ? 'active' : ''} onClick={() => setTool('analyzer')}>BPM + KEY</button>
                <button onClick={() => setCrewOpen(true)}>COLLECTIVE</button>
                <button onClick={() => setThemeOpen(true)}>THEMES</button>
              </nav>
              {theme.id === 'legacy-label' && <LegacyWarning />}
              <div className="header-actions">
                <span className="theme-badge"><i />{theme.name} / {themeMode}</span>
                <button className="icon-button" onClick={() => setUiSound(!uiSound)} aria-label="Toggle interface sounds">{uiSound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
                <button className="icon-button" onClick={shuffleTheme} aria-label="Shuffle theme"><Shuffle size={19} /></button>
                <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
              </div>
            </header>
            {theme.id === 'comic-hit' && (
              <div className="hot-comic-subnav">
                <button onClick={() => setTool('converter')}>Inicio</button>
                <button onClick={() => setCrewOpen(true)}>Exclusivos ★</button>
                <button onClick={() => setTool('analyzer')}>BPM / Key</button>
                <button onClick={() => setTool('lab')}>Lab</button>
                <button onClick={() => setThemeOpen(true)}>Categorías ▦</button>
                <button onClick={() => setCrewOpen(true)}>Artistas</button>
                <button onClick={() => setThemeOpen(true)}>Tags</button>
                <button onClick={() => setCompositionSeed(makeSeed())}>Random</button>
              </div>
            )}

            <main>
              <section className="hero">
                <motion.div className="hero-copy" key={theme.id} initial={{ x: -45, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
                  <span className="tape">4EVERTOOLS / {theme.name.toUpperCase()}</span>
                  <h1>{theme.headline.split(' ').slice(0, 2).join(' ')}<br /><span>{theme.headline.split(' ').slice(2).join(' ') || '4EVER.'}</span></h1>
                  <LoreLine fact={fact} onNext={() => setFactIndex(index => index + 1)} />
                  {theme.id === 'tale' && <TaleDialogue />}
                  {theme.id === 'blackbook' && <BlackbookChecklist onTool={openTool} onCollective={() => setCrewOpen(true)} />}
                  {theme.id === 'secret-true' && <AeroGadget />}
                  {theme.id === 'purple-subway' && <TransitBoard onTool={openTool} onCollective={() => setCrewOpen(true)} />}
                  <div className="hero-actions">
                    <button className="sticker-button primary" onClick={() => setTool('converter')}>OPEN TOOLS <Zap size={18} /></button>
                    <button className="sticker-button ghost" onClick={() => setThemeOpen(true)}>CHANGE REALITY <Palette size={18} /></button>
                  </div>
                  <div className="theme-passport"><span>ACTIVE IDENTITY</span><strong>{theme.name}</strong><em>{theme.texture} / {theme.stamp}</em></div>
                </motion.div>
                <motion.div className="hero-art" key={`art-${theme.id}`} initial={{ rotate: 7, opacity: 0, y: 30 }} animate={{ rotate: 2, opacity: 1, y: 0 }}>
                  <div className="poster poster-main"><img src={theme.logo} alt="" /><strong>{theme.stamp}</strong></div>
                  <div className="poster poster-small">4EVERTOOLS<br />THEME ARCHIVE<br />{theme.name}</div>
                  <div className="sticker-round">BPM<br />KEY<br />MP3</div>
                  <div className="barcode">|||| ||| |||||| | |||</div>
                </motion.div>
              </section>

              {theme.id === 'comic-hit' && (
                <aside className="hot-comic-sidebar">
                  <section>
                    <h3>Más Tools</h3>
                    <button onClick={() => setTool('converter')}>› URL Converter</button>
                    <button onClick={() => setTool('analyzer')}>› BPM + Key</button>
                    <button onClick={() => setCrewOpen(true)}>› Radio 4EVER</button>
                    <button onClick={() => setCrewOpen(true)}>› Collective</button>
                    <button onClick={() => setThemeOpen(true)}>› Theme Archive</button>
                  </section>
                  <section>
                    <h3>Radio 4EVER</h3>
                    <div className="hc-radio-card">
                      <span>GLOBAL SHUFFLE</span>
                      <strong>{radioPreload.tracks} TRACKS</strong>
                      <small>{radioPreload.loaded}/{radioPreload.total} CATALOGS READY</small>
                    </div>
                  </section>
                  <section>
                    <h3>Etiquetas</h3>
                    <div className="hc-tags">
                      <span>BPM</span><span>MP3</span><span>KEY</span><span>TRAP</span><span>WAV</span><span>RADIO</span><span>4EVER</span><span>UNDERGROUND</span>
                    </div>
                  </section>
                  <section>
                    <h3>Estado</h3>
                    <div className="hc-status-list">
                      <span>API <b>{apiReady === 'ready' ? 'ONLINE' : 'CHECK'}</b></span>
                      <span>NETWORK <b>{online ? 'ONLINE' : 'OFFLINE'}</b></span>
                      <span>THEME <b>4EVERCHOX</b></span>
                    </div>
                  </section>
                </aside>
              )}

              <section className="identity-strip">
                <span>IDENTITY ENGINE ONLINE</span><b>{publicThemes.length} PUBLIC THEMES</b><b>1 SECRET THEME</b><button onClick={() => setCompositionSeed(makeSeed())}><Sparkles size={15} /> REMIX LAYOUT</button>
              </section>

              <section className="tool-stage" id="tools">
                <div className="tool-tabs tool-tabs-3">
                  <button className={tool === 'converter' ? 'active' : ''} onClick={() => setTool('converter')}><Download size={17} /> URL CONVERTER</button>
                  <button className={tool === 'analyzer' ? 'active' : ''} onClick={() => setTool('analyzer')}><Music2 size={17} /> BPM + KEY</button>
                  <button className={tool === 'lab' ? 'active' : ''} onClick={() => setTool('lab')}><FlaskConical size={17} /> 4EVER LAB</button>
                </div>
                <AnimatePresence mode="wait">
                  {tool === 'converter' ? <Converter key="converter" incoming={handoff} />
                    : tool === 'analyzer' ? <Analyzer key="analyzer" />
                      : <Suspense key="lab" fallback={<div className="tool-card lab-loading">OPENING THE LAB…</div>}>
                        <Lab onSendToConverter={file => { setHandoff({ file, nonce: Date.now() }); setTool('converter'); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }) }} />
                      </Suspense>}
                </AnimatePresence>
              </section>

              <section className="lab-teaser">
                <span>NOW OPEN · ROOM 1</span>
                <h2>4EVER LAB</h2>
                <button className="sticker-button primary lab-open" onClick={() => { setTool('lab'); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }) }}>TRIM · REVERSE · SPEED · PITCH <FlaskConical size={18} /></button>
                <div className="tool-cloud">NEXT ROOMS: STEM SPLITTER · VOCAL REMOVER · LUFS METER · COVER ART</div>
              </section>
              {theme.id === 'red-block' && <UndergroundCrate onTool={openTool} onCollective={() => setCrewOpen(true)} />}
              {theme.id === 'neon-tour' && <NeonLineup onMember={id => setWorldMemberId(id)} onCollective={() => setCrewOpen(true)} />}
              {theme.id === 'legacy-label' && <LegacyFooter onOpenTools={() => document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' })} onOpenCollective={() => setCrewOpen(true)} onOpenThemes={() => setThemeOpen(true)} />}
            </main>

            <AnimatePresence>{mobileNavOpen && <>
              <motion.button className="drawer-backdrop mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              <motion.aside className="mobile-nav-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
                <div className="drawer-head"><div><span>QUICK ACCESS</span><h2>4EVER MENU</h2></div><button className="icon-button" onClick={() => setMobileNavOpen(false)}><X /></button></div>
                <button className={tool === 'converter' ? 'active' : ''} onClick={() => { setTool('converter'); setMobileNavOpen(false); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }) }}><Download size={18} /> URL CONVERTER</button>
                <button className={tool === 'analyzer' ? 'active' : ''} onClick={() => { setTool('analyzer'); setMobileNavOpen(false); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }) }}><Music2 size={18} /> BPM + KEY</button>
                <button className={tool === 'lab' ? 'active' : ''} onClick={() => { setTool('lab'); setMobileNavOpen(false); document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' }) }}><FlaskConical size={18} /> 4EVER LAB</button>
                <button onClick={() => { setMobileNavOpen(false); setCrewOpen(true) }}><Disc3 size={18} /> COLLECTIVE / RADIO</button>
                <button onClick={() => { setMobileNavOpen(false); setThemeOpen(true) }}><Palette size={18} /> THEME ARCHIVE</button>
                <button onClick={() => { setCompositionSeed(makeSeed()); setMobileNavOpen(false) }}><Sparkles size={18} /> REMIX LAYOUT</button>
              </motion.aside>
            </>}</AnimatePresence>

            <CrewDrawer open={crewOpen} onClose={() => setCrewOpen(false)} activeMemberId={activeRadioMemberId} foundSignals={foundSignals} onOpenMember={id => setWorldMemberId(id)} onPlayMember={(member) => { setRadioRequest({ memberId: member.id, nonce: Date.now() }); setPlaying(true); setCrewOpen(false) }} />
          </motion.div>
        )}
      </AnimatePresence>

      <RadioBar visible={entered} playing={playing} setPlaying={setPlaying} request={radioRequest} volume={radioVolume} setVolume={setRadioVolume} onPreload={setRadioPreload} onActiveMemberChange={setActiveRadioMemberId} onOpenMember={id => setWorldMemberId(id)} />
      <MemberWorld memberId={worldMemberId} onClose={() => setWorldMemberId(null)} onNavigate={id => setWorldMemberId(id)}
        onPlay={member => { setRadioRequest({ memberId: member.id, nonce: Date.now() }); setPlaying(true) }}
        radioMemberId={activeRadioMemberId} radioPlaying={playing} foundSignals={foundSignals} onSignalFound={findSignal} />
      <ThemeDrawer open={themeOpen} current={theme} mode={themeMode} sfxVolume={sfxVolume} uiSound={uiSound} onSfxVolume={setSfxVolumeState} onClose={() => setThemeOpen(false)} onChoose={chooseTheme} onMode={setMode} />
      <AnimatePresence mode="wait">{memberSecret && (() => {
        const member = memberById(memberSecret)
        if (!member) return null
        return <motion.button key={member.id} className="rare-toast member-secret-toast" style={{ '--m1': member.accent, '--m2': member.accent2 } as React.CSSProperties}
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={() => { setMemberSecret(null); if (entered) setWorldMemberId(member.id); else setPendingWorld(member.id) }}>
          <span className="secret-symbol">{member.symbol}</span> SIGNAL FOUND: {member.name.toUpperCase()} · {foundSignals.length}/{collective.length} <b>OPEN WORLD →</b>
        </motion.button>
      })()}</AnimatePresence>
      <AnimatePresence>{secretNotice && <motion.div className="rare-toast" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}><Zap /> RARE THEME UNLOCKED: 4EVER VISTA</motion.div>}</AnimatePresence>
    </div>
  )
}

/** "DATO UNDERGROUND" — a scene fact with a button for another one. Renders siblings (no wrapper) so theme styles for the paragraph keep working. */
function LoreLine({ fact, onNext, paragraphClass }: { fact: LoreFact; onNext: () => void; paragraphClass?: string }) {
  return <>
    <span className="lore-tag">DATO UNDERGROUND · {fact.artist}</span>
    <p className={paragraphClass} aria-live="polite">{fact.text}</p>
    <button className="lore-next" onClick={onNext}>OTRO DATO <span aria-hidden="true">↻</span></button>
  </>
}

const SOUND_TESTS: [SfxName, string][] = [['ui-click', 'CLICK'], ['ui-open', 'OPEN'], ['player-next', 'NEXT'], ['download-ready', 'READY'], ['secret-unlock', 'SECRET'], ['error', 'ERROR']]

/** shows the theme's sound pack, lets you audition it, and says which sounds are your WAVs. */
function SoundBoard({ themeId, muted }: { themeId: string; muted: boolean }) {
  const [sources, setSources] = useState<Record<SfxName, 'custom' | 'synth'> | null>(null)
  useEffect(() => {
    let alive = true
    void getSfxSources().then(result => { if (alive) setSources(result) })
    return () => { alive = false }
  }, [])
  const mine = sources ? Object.values(sources).filter(source => source === 'custom').length : 0
  const note = muted ? 'Interface sounds are off — turn them on with the speaker button in the header.'
    : !sources ? 'Checking for your WAVs…'
      : mine ? `${mine}/15 sounds are your WAVs · the rest use the 4EVER synth.`
        : 'Built-in 4EVER synth · drop WAVs in public/audio/sfx to replace any sound.'
  return (
    <div className="sound-board" data-sfx="off">
      <div className="sound-board-head"><span>SOUND PACK</span><strong>{PACK_LABEL[packForTheme(themeId)]}</strong></div>
      <div className="sound-board-tests">{SOUND_TESTS.map(([name, label]) => <button key={name} disabled={muted} onClick={() => void playSfx(name)}>{label}{sources?.[name] === 'custom' && <i> · WAV</i>}</button>)}</div>
      <small>{note}</small>
    </div>
  )
}

function ThemeDrawer({ open, current, mode, sfxVolume, uiSound, onSfxVolume, onClose, onChoose, onMode }: { open: boolean; current: Theme; mode: ThemeMode; sfxVolume: number; uiSound: boolean; onSfxVolume: (value: number) => void; onClose: () => void; onChoose: (theme: Theme) => void; onMode: (mode: ThemeMode) => void }) {
  return <AnimatePresence>{open && <>
    <motion.button className="drawer-backdrop" aria-label="Close theme archive" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.aside className="theme-drawer" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 240, damping: 28 }}>
      <div className="drawer-head"><div><span>VISUAL OPERATING SYSTEM</span><h2>THEME ARCHIVE</h2></div><button className="icon-button" onClick={onClose}><X /></button></div>
      <div className="audio-settings"><span>INTERFACE SFX</span><input type="range" min="0" max="100" value={sfxVolume} onChange={event => onSfxVolume(Number(event.target.value))} /><strong>{sfxVolume}%</strong></div>
      <SoundBoard themeId={current.id} muted={!uiSound} />
      <div className="mode-switch"><button className={mode === 'random' ? 'active' : ''} onClick={() => onMode('random')}><Shuffle size={16} /> RANDOM ON ENTRY</button><button className={mode === 'locked' ? 'active' : ''} onClick={() => onMode('locked')}><Check size={16} /> LOCK IDENTITY</button></div>
      <div className="theme-grid">{publicThemes.map(item => <button className={`theme-card theme-card-${item.id} ${current.id === item.id ? 'selected' : ''}`} onClick={() => onChoose(item)} key={item.id} style={{ '--card-accent': item.accent, '--card-surface': item.surface, '--logo-sqrt-ar': Math.sqrt(item.logoRatio).toFixed(3) } as React.CSSProperties}>
        <img src={item.logo} alt={item.name} /><div><strong>{item.name}</strong><em>{item.texture}</em></div>{current.id === item.id && <Check className="selected-check" size={18} />}
      </button>)}</div>
      <div className="secret-slot"><span>???</span><div><strong>SECRET IDENTITY / ???</strong><em>Type #4ever outside input fields.</em></div></div>
      <section className="archive-section" aria-label="Heritage logos">
        <details className="heritage-details">
          <summary>HERITAGE LOGOS · THE ORIGINALS ({heritageLogos.length})</summary>
          <div className="heritage-grid">{heritageLogos.map(logo => <figure key={logo.id}><img src={logo.src} alt={logo.name} loading="lazy" /><figcaption>{logo.name}<small>{logo.note}</small></figcaption></figure>)}</div>
        </details>
      </section>
    </motion.aside>
  </>}</AnimatePresence>
}

const HOME_PC_OFF = 'THE YOUTUBE CONVERTER (THE 4EVER PC AT HOME) IS OFF RIGHT NOW. TRY AGAIN LATER, OR UPLOAD THE AUDIO FILE.'
const HOME_PC_UNREACHABLE = "THE YOUTUBE CONVERTER (THE 4EVER PC AT HOME) ISN'T ANSWERING. TRY AGAIN IN A FEW MINUTES, OR UPLOAD THE AUDIO FILE."

type ConverterCapabilities = {
  /** relay_url: the PC at home that converts YouTube links (cloud servers get blocked), when it is on. */
  youtube: { enabled: boolean; requires_key: boolean; max_duration_seconds: number; relay_url?: string | null; relay_configured?: boolean }
  max_source_bytes: number
  file_ttl_seconds?: number
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
const YT_KEY_STORAGE = '4ever-yt-access-key'

function isYoutubeLink(value: string) {
  try {
    return YOUTUBE_HOSTS.has(new URL(value.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

function readStoredKey() {
  try { return window.localStorage.getItem(YT_KEY_STORAGE) ?? '' } catch { return '' }
}

function storeKey(value: string) {
  try {
    if (value) window.localStorage.setItem(YT_KEY_STORAGE, value)
    else window.localStorage.removeItem(YT_KEY_STORAGE)
  } catch { /* storage unavailable: key just isn't remembered */ }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try { return await response.json() as T } catch { return null }
}

function Converter({ incoming }: { incoming?: { file: File; nonce: number } | null }) {
  type ConversionMode = 'url' | 'file'
  type ConversionStatus = 'idle' | 'submitting' | 'uploading' | 'queued' | 'fetching' | 'processing' | 'complete' | 'error'
  type JobPayload = { status: ConversionStatus; progress: number; message?: string; title?: string | null; download_url?: string; output?: OutputInfo | null; expires_at?: number | null }

  const resumed = useMemo(loadActiveJob, [])
  const [fromLab, setFromLab] = useState<number | null>(null)
  const [mode, setMode] = useState<ConversionMode>('url')
  const [url, setUrl] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [format, setFormat] = useState<ConvertFormat>(resumed?.format ?? 'mp3')
  const [quality, setQuality] = useState<'192' | '256' | '320'>((resumed?.quality as '192' | '256' | '320') ?? '320')
  const [bitDepth, setBitDepth] = useState<'16' | '24'>((resumed?.bitDepth as '16' | '24') ?? '16')
  const [status, setStatus] = useState<ConversionStatus>(resumed ? 'queued' : 'idle')
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(resumed?.id ?? null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(resumed?.title ?? null)
  const [resultDetail, setResultDetail] = useState<string | null>(null)
  const [resultExpires, setResultExpires] = useState<number | null>(null)
  const [message, setMessage] = useState(resumed ? 'RECONNECTING TO YOUR CONVERSION…' : 'READY TO COOK')
  const [capabilities, setCapabilities] = useState<ConverterCapabilities | null>(null)
  const [accessKey, setAccessKey] = useState(readStoredKey)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [now, setNow] = useState(() => Date.now())
  const pollTimer = useRef<number | null>(null)
  const pollFailures = useRef(0)
  // Bumped on every mount and unmount: a poll loop or upload started by an
  // older mount sees a different number and stops (no double polling).
  const generation = useRef(0)
  const canPaste = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText)

  useEffect(() => {
    const gen = ++generation.current
    fetch(apiUrl('/api/capabilities'))
      .then(response => response.ok ? readJson<ConverterCapabilities>(response) : null)
      .then(payload => { if (gen === generation.current && payload) setCapabilities(payload) })
      .catch(() => { /* API offline: the converter shows the error on submit */ })
    // Came back from BPM + KEY (or reloaded) while a file was cooking: pick it up again.
    if (resumed) void pollJob(resumed.id, resumed, gen)
    const clock = window.setInterval(() => setNow(Date.now()), 30000)
    return () => {
      generation.current += 1
      window.clearInterval(clock)
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  // A WAV handed over from 4EVER LAB: preload it as an upload, ready to become an MP3.
  useEffect(() => {
    if (!incoming || incoming.nonce === fromLab || status === 'submitting' || status === 'uploading' || status === 'queued' || status === 'fetching' || status === 'processing') return
    setFromLab(incoming.nonce)
    setMode('file')
    setSourceFile(incoming.file)
    setFormat('mp3')
    setStatus('idle'); setProgress(0); setJobId(null); setDownloadUrl(null); setTitle(null); setMessage('READY TO COOK')
  }, [incoming?.nonce])

  const busy = status === 'submitting' || status === 'uploading' || status === 'queued' || status === 'fetching' || status === 'processing'
  const youtubeLink = mode === 'url' && isYoutubeLink(url)
  const youtube = capabilities?.youtube
  const youtubeBlocked = youtubeLink && youtube !== undefined && !youtube.enabled && !youtube.relay_configured
  // The PC at home is set up but has not checked in lately: say so before anyone presses COOK.
  const youtubeHomeOff = youtubeLink && Boolean(youtube?.relay_configured) && !youtube?.relay_url
  const needsKey = youtubeLink && Boolean(youtube?.requires_key)
  const maxBytes = capabilities?.max_source_bytes ?? null
  const fileTooBig = mode === 'file' && Boolean(sourceFile && maxBytes && sourceFile.size > maxBytes)

  const resetJob = () => {
    if (busy) return // never drop a running job because an input changed
    if (pollTimer.current) window.clearTimeout(pollTimer.current)
    setStatus('idle')
    setProgress(0)
    setJobId(null)
    setDownloadUrl(null)
    setTitle(null)
    setResultDetail(null)
    setResultExpires(null)
    setMessage('READY TO COOK')
  }

  const finishJob = (id: string, payload: JobPayload, job: ActiveJob) => {
    saveActiveJob(null)
    const detail = describeOutput(payload.output, job.format, job.quality, job.bitDepth)
    const expiresAt = payload.expires_at ? payload.expires_at * 1000 : Date.now() + (capabilities?.file_ttl_seconds ?? 3600) * 1000
    const entryTitle = payload.title || job.title || `4EVERTOOLS-${id.slice(0, 8).toUpperCase()}`
    setNow(Date.now())
    const download = jobUrl(job, payload.download_url ?? `/api/conversions/${id}/download`)
    setDownloadUrl(download)
    setResultDetail(detail)
    setResultExpires(expiresAt)
    setHistory(addToHistory({ id, title: entryTitle, format: job.format, detail, downloadUrl: download, finishedAt: Date.now(), expiresAt }))
    void playSfx('download-ready')
  }

  const pollJob = async (id: string, job: ActiveJob, gen = generation.current) => {
    const stale = () => gen !== generation.current
    if (stale()) return
    try {
      const response = await fetch(jobUrl(job, `/api/conversions/${id}`))
      if (stale()) return
      if (response.status === 429) {
        pollTimer.current = window.setTimeout(() => void pollJob(id, job, gen), 3000)
        return
      }
      if (response.status === 404) {
        saveActiveJob(null)
        setStatus('error')
        setMessage('THE SERVER LOST THIS CONVERSION (IT RESTARTED OR THE FILE EXPIRED). COOK IT AGAIN.')
        void playSfx('error')
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await readJson<JobPayload>(response)
      if (!payload) throw new Error('Invalid status payload')
      pollFailures.current = 0
      setStatus(payload.status)
      setProgress(payload.progress ?? 0)
      setMessage(payload.message ?? 'PROCESSING AUDIO')
      if (payload.title) setTitle(payload.title)
      if (payload.status === 'complete') return finishJob(id, payload, job)
      if (payload.status === 'error') {
        saveActiveJob(null)
        void playSfx('error')
        return
      }
      pollTimer.current = window.setTimeout(() => void pollJob(id, job, gen), 900)
    } catch (error) {
      if (stale()) return
      // Wi-Fi hiccup or the API restarting: keep trying for ~20 s before giving up.
      pollFailures.current += 1
      if (pollFailures.current <= 8) {
        setMessage(`CONNECTION HICCUP… RETRYING (${pollFailures.current}/8)`)
        pollTimer.current = window.setTimeout(() => void pollJob(id, job, gen), Math.min(4000, 700 * pollFailures.current))
        return
      }
      console.error(error)
      saveActiveJob(null)
      setStatus('error')
      setMessage("LOST CONTACT WITH THE CONVERTER SERVER. YOUR FILE MAY STILL BE COOKING — TRY AGAIN IN A MOMENT.")
    }
  }

  // A YouTube link was pasted: ask again whether the PC at home is on (it may have changed since the page loaded).
  useEffect(() => {
    if (!youtubeLink) return
    let live = true
    fetch(apiUrl('/api/capabilities'))
      .then(response => response.ok ? readJson<ConverterCapabilities>(response) : null)
      .then(payload => { if (live && payload) setCapabilities(payload) })
      .catch(() => undefined)
    return () => { live = false }
  }, [youtubeLink])

  const startConversion = async () => {
    if (busy || fileTooBig) return
    resetJob()
    pollFailures.current = 0
    setStatus('submitting')
    void playSfx('converter-start')
    setMessage(youtubeLink ? 'SENDING YOUTUBE LINK…' : mode === 'file' ? 'UPLOADING…' : 'SENDING LINK…')
    const job: ActiveJob = { id: '', format, quality, bitDepth, title: mode === 'file' ? sourceFile?.name.replace(/\.[^.]+$/, '') ?? null : null, startedAt: Date.now() }
    try {
      if (youtubeLink) {
        // YouTube blocks cloud servers, so YouTube links go to the 4EVER PC at home
        // when it is on. Ask fresh: it may have come online since the page loaded.
        const fresh = await fetch(apiUrl('/api/capabilities')).then(response => response.ok ? readJson<ConverterCapabilities>(response) : null).catch(() => null)
        if (fresh) setCapabilities(fresh)
        const info = (fresh ?? capabilities)?.youtube
        if (info?.relay_url && HOME_TUNNEL.test(info.relay_url)) job.apiBase = info.relay_url
        else if (info?.relay_configured) throw new Error(HOME_PC_OFF)
      }
      const form = new FormData()
      form.set('format', format)
      form.set('quality', quality)
      form.set('bit_depth', bitDepth)
      if (mode === 'url') {
        form.set('url', url.trim())
        if (needsKey) form.set('access_key', accessKey.trim())
      } else if (sourceFile) {
        form.set('file', sourceFile)
      }

      const gen = generation.current
      const { status: code, payload } = await postConversion(form, mode === 'file' ? fraction => {
        if (gen !== generation.current) return
        setStatus('uploading')
        // Upload is the first 4 % of the bar's journey; the server's own steps take over from there.
        setProgress(Math.round(fraction * 4))
        setMessage(fraction < 1 ? `UPLOADING ${Math.round(fraction * 100)}%${sourceFile ? ` OF ${formatBytes(sourceFile.size)}` : ''}…` : 'UPLOAD DONE · CHECKING THE FILE…')
      } : undefined, jobUrl(job, '/api/conversions'))
      if (code < 200 || code >= 300 || !payload?.id) {
        const detail = typeof payload?.detail === 'string' ? payload.detail : null
        if (code === 413) throw new Error(detail ?? 'FILE IS TOO BIG FOR THE SERVER')
        if (code === 429) throw new Error(detail ?? 'TOO MANY REQUESTS. WAIT A MOMENT')
        if (code === 415) throw new Error(detail ?? 'THAT IS NOT AN AUDIO OR VIDEO FILE')
        if ((code === 0 || code >= 502) && job.apiBase) throw new Error(HOME_PC_UNREACHABLE)
        if (code === 0 || code >= 502) throw new Error("CAN'T REACH THE CONVERTER SERVER. TRY AGAIN IN A MOMENT")
        throw new Error(detail ?? `CONVERSION REJECTED (HTTP ${code})`)
      }
      if (needsKey) storeKey(accessKey.trim())
      const active = { ...job, id: payload.id }
      saveActiveJob(active)
      // Left for BPM + KEY during the upload: the next mount resumes it from storage.
      if (gen !== generation.current) return
      setJobId(payload.id)
      setStatus('queued')
      setMessage('QUEUED…')
      void pollJob(payload.id, active)
    } catch (error) {
      setStatus('error')
      void playSfx('error')
      const text = error instanceof TypeError ? (job.apiBase ? HOME_PC_UNREACHABLE : "CAN'T REACH THE CONVERTER SERVER. TRY AGAIN IN A MOMENT") : error instanceof Error ? error.message : 'CONVERSION FAILED'
      setMessage(text.toUpperCase())
    }
  }

  const pasteLink = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (text) { setUrl(text); resetJob() }
    } catch { /* permission denied: the user can still paste by hand */ }
  }

  const chooseFile = (file: File | null) => {
    setSourceFile(file)
    resetJob()
  }

  const ready = mode === 'url'
    ? /^https?:\/\//i.test(url.trim()) && !youtubeBlocked && (!needsKey || accessKey.trim().length > 0)
    : Boolean(sourceFile) && !fileTooBig
  const maxMinutes = youtube ? Math.round(youtube.max_duration_seconds / 60) : null
  const recent = history.filter(entry => entry.id !== jobId || !downloadUrl).slice(0, 6)

  return (
    <motion.div className="tool-card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }}>
      <div className="tool-heading"><span>01</span><div><p>YOUTUBE + URL + FILE TO AUDIO</p><h2>MAKE THE FILE.</h2></div></div>

      <div className="converter-source-tabs">
        <button className={mode === 'url' ? 'active' : ''} disabled={busy} onClick={() => { setMode('url'); resetJob() }}>PASTE LINK</button>
        <button className={mode === 'file' ? 'active' : ''} disabled={busy} onClick={() => { setMode('file'); resetJob() }}>UPLOAD FILE</button>
      </div>

      {mode === 'url' ? (
        <>
          <label className="url-field">
            <span>YOUTUBE LINK OR DIRECT MEDIA URL</span>
            <div className="url-input-row">
              <input value={url} disabled={busy} onChange={e => { setUrl(e.target.value); resetJob() }} placeholder="https://youtu.be/…  ·  https://host.com/track.mp3" inputMode="url" autoComplete="off" spellCheck={false} />
              {canPaste && <button type="button" className="paste-button" disabled={busy} onClick={() => void pasteLink()} aria-label="Paste link from clipboard"><ClipboardPaste size={18} /> PASTE</button>}
            </div>
          </label>
          {youtubeLink && (
            <div className={`source-badge ${youtubeBlocked || youtubeHomeOff ? 'blocked' : ''}`}>
              <Zap size={14} />
              {youtubeBlocked
                ? 'YOUTUBE IS DISABLED ON THIS SERVER'
                : youtubeHomeOff
                ? 'THE YOUTUBE CONVERTER IS OFF RIGHT NOW · TRY LATER OR UPLOAD THE AUDIO FILE'
                : `YOUTUBE DETECTED · AUDIO ONLY · SINGLE VIDEOS${maxMinutes ? ` UP TO ${maxMinutes} MIN` : ''}`}
            </div>
          )}
          {needsKey && !youtubeBlocked && (
            <label className="url-field access-key-field">
              <span>COLLECTIVE ACCESS KEY</span>
              <input type="password" value={accessKey} disabled={busy} onChange={e => setAccessKey(e.target.value)} placeholder="ASK THE 4EVER CREW" autoComplete="off" />
            </label>
          )}
        </>
      ) : (
        <label className={`converter-file-zone ${dragging ? 'dragging' : ''} ${fileTooBig ? 'too-big' : ''} ${busy ? 'locked' : ''}`}
          onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={() => setDragging(false)}>
          <Upload size={30} />
          <strong>{dragging ? 'DROP IT' : sourceFile?.name ?? 'DROP A VIDEO OR AUDIO FILE'}</strong>
          {fromLab && sourceFile === incoming?.file && !dragging && <span className="from-lab"><FlaskConical size={13} /> FROM 4EVER LAB</span>}
          {sourceFile && !dragging
            ? <span className="file-meta">{formatBytes(sourceFile.size)}{fileTooBig && maxBytes ? ` · TOO BIG — LIMIT ${formatBytes(maxBytes)}` : ' · READY'}</span>
            : <span>MP3 · WAV · FLAC · M4A · OGG · OPUS · MP4 · MOV · MKV · WEBM{maxBytes ? ` · MAX ${formatBytes(maxBytes)}` : ''}</span>}
          <input type="file" accept="audio/*,video/*,.opus,.mkv,.flac,.aif,.aiff,.caf,.wv" disabled={busy} onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
        </label>
      )}

      <div className="option-grid">
        <div className="option"><span>FORMAT</span><div>{(['mp3', 'wav'] as const).map(item => <button key={item} disabled={busy} className={format === item ? 'selected' : ''} onClick={() => { setFormat(item); resetJob() }}>{item.toUpperCase()}</button>)}</div></div>
        {format === 'mp3'
          ? <div className="option"><span>QUALITY · KBPS</span><div>{(['192', '256', '320'] as const).map(item => <button key={item} disabled={busy} className={quality === item ? 'selected' : ''} onClick={() => { setQuality(item); resetJob() }}>{item}</button>)}</div></div>
          : <div className="option"><span>BIT DEPTH</span><div>{(['16', '24'] as const).map(item => <button key={item} disabled={busy} className={bitDepth === item ? 'selected' : ''} onClick={() => { setBitDepth(item); resetJob() }}>{item}-BIT</button>)}</div></div>}
      </div>

      <button className="massive-action" disabled={!ready || busy} onClick={() => void startConversion()}>
        {busy ? 'COOKING AUDIO…' : status === 'complete' ? 'COOK ANOTHER' : 'COOK AUDIO'} <Download />
      </button>

      {status !== 'idle' && (
        <div className={`conversion-console status-${status}`} role="status" aria-live="polite">
          <div><span>{message}</span><strong>{Math.round(progress)}%</strong></div>
          <div className="analysis-progress"><motion.i initial={false} animate={{ width: `${progress}%` }} /></div>
          {(jobId || title) && <small>{jobId ? `JOB / ${jobId.slice(0, 8).toUpperCase()}` : ''}{title ? ` · ${title}` : ''}</small>}
        </div>
      )}

      {downloadUrl && (
        <div className="conversion-result">
          <div><Check size={22} /><span><small>{title ? title.toUpperCase() : 'FILE READY'}</small><strong>{resultDetail}</strong>{resultExpires && <em>{timeLeft(resultExpires, now)} · THEN THE SERVER DELETES IT</em>}</span></div>
          <a className="sticker-button primary" href={downloadUrl} download>DOWNLOAD FILE <Download size={18} /></a>
          <button className="text-button" onClick={resetJob}>RESET</button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="conversion-history">
          <div className="conversion-history-head"><span><History size={15} /> RECENT FILES · THIS BROWSER</span><button className="text-button" onClick={() => { clearHistory(); setHistory([]) }}><Trash2 size={13} /> CLEAR</button></div>
          <ul>
            {recent.map(entry => {
              const expired = entry.expiresAt <= now
              return (
                <li key={entry.id} className={expired ? 'expired' : ''}>
                  <span><strong>{entry.title}</strong><small>{entry.detail}</small></span>
                  <em>{timeLeft(entry.expiresAt, now)}</em>
                  {expired ? <span className="history-gone">RE-COOK</span> : <a className="history-download" href={entry.downloadUrl} download aria-label={`Download ${entry.title}`}><Download size={16} /></a>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="legal-copy">4EVERTOOLS does not host third-party content. Only convert audio you own or have permission to use; downloading from YouTube may go against its Terms of Service. Users are responsible for how downloaded content is used. Converted files are deleted from the server after {Math.round((capabilities?.file_ttl_seconds ?? 3600) / 60)} minutes. <a href="/legal.html">Terms &amp; privacy</a></p>
      <div className="prototype-tag">UPLOAD PROGRESS · 24-BIT WAV · RECENT FILES · TEMPORARY FILES AUTO-EXPIRE.</div>
    </motion.div>
  )
}

const BPM_RANGES = {
  auto: { label: 'AUTO', min: 0, max: 0 },
  '60-120': { label: '60–120', min: 60, max: 120 },
  '80-160': { label: '80–160', min: 80, max: 160 },
  '100-200': { label: '100–200', min: 100, max: 200 },
} as const
type BpmRange = keyof typeof BPM_RANGES
const BPM_RANGE_STORAGE = '4ever-bpm-range'

function readBpmRange(): BpmRange {
  try {
    const stored = window.localStorage.getItem(BPM_RANGE_STORAGE)
    return stored && stored in BPM_RANGES ? stored as BpmRange : 'auto'
  } catch { return 'auto' }
}

function displayTempo(analysis: AudioAnalysis, range: BpmRange): number {
  if (range === 'auto') return analysis.bpm
  const { min, max } = BPM_RANGES[range]
  return snapBpm(foldToRange(analysis.rawBpm, min, max))
}

function Analyzer() {
  const [file, setFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(70)
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisLabel, setAnalysisLabel] = useState('READY TO SCAN')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [bpmRange, setBpmRange] = useState<BpmRange>(readBpmRange)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
  }, [audioUrl])

  const drawWaveform = async (selected: File) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const buffer = await selected.arrayBuffer()
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioContext = new AudioContextClass()
    try {
      const decoded = await audioContext.decodeAudioData(buffer.slice(0))
      const channel = decoded.getChannelData(0)
      const width = canvas.width
      const height = canvas.height
      const samplesPerPixel = Math.max(1, Math.floor(channel.length / width))
      context.clearRect(0, 0, width, height)
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c4dff'
      for (let x = 0; x < width; x += 1) {
        let min = 1
        let max = -1
        const start = x * samplesPerPixel
        for (let i = 0; i < samplesPerPixel && start + i < channel.length; i += 1) {
          const value = channel[start + i]
          if (value < min) min = value
          if (value > max) max = value
        }
        const y = (1 + min) * .5 * height
        const barHeight = Math.max(1, (max - min) * .5 * height)
        context.fillRect(x, y, 1, barHeight)
      }
      setDuration(decoded.duration)
    } finally {
      await audioContext.close()
    }
  }

  const selectFile = (selected?: File) => {
    if (!selected) return
    if (!selected.type.startsWith('audio/') && !/\.(mp3|wav|flac|m4a|ogg)$/i.test(selected.name)) {
      setAnalysisError('THAT FILE DOES NOT LOOK LIKE AUDIO.')
      return
    }
    if (selected.size > 180 * 1024 * 1024) {
      setAnalysisError('FILE TOO LARGE — MAXIMUM 180 MB.')
      return
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    const nextUrl = URL.createObjectURL(selected)
    setFile(selected)
    setAudioUrl(nextUrl)
    setPlaying(false)
    setPosition(0)
    setAnalysis(null)
    setAnalysisProgress(0)
    setAnalysisLabel('READY TO SCAN')
    setAnalysisError(null)
    window.setTimeout(() => void drawWaveform(selected), 0)
  }

  const runAnalysis = async () => {
    if (!file || analyzing) return
    setAnalyzing(true)
    void playSfx('analyzer-start')
    setAnalysis(null)
    setAnalysisError(null)
    setAnalysisProgress(1)
    try {
      const result = await analyzeAudioFile(file, (progress, label) => {
        setAnalysisProgress(progress)
        setAnalysisLabel(label)
      })
      setAnalysis(result)
      void playSfx('analyzer-ready')
      setAnalysisProgress(100)
      setAnalysisLabel('SCAN COMPLETE')
    } catch (error) {
      console.error(error)
      void playSfx('error')
      setAnalysisError('ANALYSIS FAILED. TRY WAV OR MP3, OR A SHORTER FILE.')
      setAnalysisLabel('SCAN FAILED')
    } finally {
      setAnalyzing(false)
    }
  }

  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const seek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = (value / 100) * duration
    setPosition(audio.currentTime)
  }

  const chooseRange = (range: BpmRange) => {
    setBpmRange(range)
    try { window.localStorage.setItem(BPM_RANGE_STORAGE, range) } catch { /* not remembered */ }
  }

  const shownBpm = analysis ? displayTempo(analysis, bpmRange) : null
  const otherPulses = analysis?.bpmCandidates.filter(item => item.score >= 0.75).slice(0, 2) ?? []

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${mins}:${secs}`
  }

  return (
    <motion.div className="tool-card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }}>
      <div className="tool-heading"><span>02</span><div><p>LOCAL AUDIO ANALYZER</p><h2>DROP. SCAN. VERIFY.</h2></div></div>
      <label
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={event => { event.preventDefault(); setDragging(false) }}
        onDrop={event => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]) }}
      >
        <Upload size={34} />
        <strong>{file?.name ?? 'DROP THE TRACK'}</strong>
        <span>MP3 · WAV · FLAC · M4A · OGG · MAX 180 MB</span>
        <input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" onChange={e => selectFile(e.target.files?.[0])} />
      </label>

      <div className={`local-player ${file ? 'ready' : ''}`}>
        <canvas ref={canvasRef} width="1100" height="160" aria-label="Audio waveform" />
        {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" onLoadedMetadata={e => { setDuration(e.currentTarget.duration); e.currentTarget.volume = volume / 100 }} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
        <div className="local-player-controls">
          <button className="player-button" onClick={togglePlayback} disabled={!audioUrl}>{playing ? <Pause /> : <Play />}</button>
          <span>{formatTime(position)}</span>
          <input className="seek-slider" type="range" min="0" max="100" value={duration ? (position / duration) * 100 : 0} onChange={e => seek(Number(e.target.value))} aria-label="Audio position" />
          <span>{formatTime(duration)}</span>
          <Volume2 size={17} />
          <input className="volume-slider compact" type="range" min="0" max="100" value={volume} onChange={e => { const next = Number(e.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next / 100 }} aria-label="Preview volume" />
        </div>
      </div>

      <button className="massive-action analyze-action" disabled={!file || analyzing} onClick={() => void runAnalysis()}>
        {analyzing ? 'SCANNING THE TRACK…' : analysis ? 'SCAN AGAIN' : 'FIND BPM + KEY'} <Zap />
      </button>

      {(file || analyzing || analysis) && (
        <div className="analysis-console">
          <div><span>{analysisLabel}</span><strong>{Math.round(analysisProgress)}%</strong></div>
          <div className="analysis-progress"><motion.i initial={false} animate={{ width: `${analysisProgress}%` }} /></div>
        </div>
      )}

      {analysisError && <div className="analysis-error">{analysisError}</div>}

      <div className={`results-grid ${analysis ? 'has-results' : ''}`}>
        <Metric label="BPM" value={shownBpm !== null ? String(shownBpm) : '—'} />
        <Metric label="HALF" value={shownBpm !== null ? String(Math.round(shownBpm * 5) / 10) : '—'} />
        <Metric label="DOUBLE" value={shownBpm !== null ? String(Math.round(shownBpm * 20) / 10) : '—'} />
        <Metric label="KEY" value={analysis?.key ?? '—'} />
        <Metric label="CAMELOT" value={analysis?.camelot ?? '—'} />
        <Metric label="BPM CONF." value={analysis ? `${analysis.bpmConfidence}%` : '—'} />
        <Metric label="KEY CONF." value={analysis ? `${analysis.keyConfidence}%` : '—'} />
      </div>

      <div className="bpm-range">
        <span>BPM RANGE</span>
        <div>{(Object.keys(BPM_RANGES) as BpmRange[]).map(range => <button key={range} className={bpmRange === range ? 'selected' : ''} onClick={() => chooseRange(range)}>{BPM_RANGES[range].label}</button>)}</div>
        <em>{bpmRange === 'auto' ? 'AUTO: TRAP / DRILL / DNB READ FAST, BOOM BAP / LO-FI READ SLOW.' : 'RESULT FOLDED INTO YOUR RANGE (×2 / ÷2).'}</em>
      </div>

      {analysis && analysis.alternatives.length > 0 && <div className="alternative-keys"><span>KEY ALTERNATIVES</span><strong>{analysis.alternatives.join('  /  ')}</strong></div>}
      {analysis && analysis.compatibleKeys.length > 0 && <div className="alternative-keys mixes-with"><span>MIXES WITH</span><strong>{analysis.compatibleKeys.map(item => <em key={item.camelot}><b>{item.camelot}</b> {item.key}</em>)}</strong></div>}
      {analysis && Math.abs(analysis.tuningCents) > 10 && <div className="alternative-keys"><span>TUNING</span><strong>{analysis.tuningCents > 0 ? '+' : ''}{analysis.tuningCents} CENTS · A = {(440 * 2 ** (analysis.tuningCents / 1200)).toFixed(1)} HZ</strong></div>}
      {analysis && otherPulses.length > 0 && <div className="alternative-keys"><span>OTHER PULSES</span><strong>{otherPulses.map(item => `${item.bpm} BPM`).join(' · ')}</strong></div>}
      {analysis && analysis.rawBpm > 0 && Math.abs(analysis.rawBpm - analysis.bpm) >= 0.1 && bpmRange === 'auto' && <div className="alternative-keys"><span>EXACT TEMPO</span><strong>{analysis.rawBpm} BPM (ROUNDED TO THE GRID)</strong></div>}
      <p className="legal-copy">Musical key is an algorithmic estimate. Songs that sit between a minor key and its relative major (same Camelot number) are the classic ambiguity — both mix the same way. Verify inside your DAW. BPM is read over the whole track (up to 8 min); half-time vs double-time is a convention, so pick a BPM RANGE if your genre reads differently.</p>
      <div className="prototype-tag">BPM + KEY · TUNING-AWARE · THE AUDIO NEVER LEAVES YOUR BROWSER.</div>
    </motion.div>
  )
}

function Option({ title, options }: { title: string; options: string[] }) {
  const [selected, setSelected] = useState(options.at(-1)!)
  return <div className="option"><span>{title}</span><div>{options.map(item => <button key={item} className={selected === item ? 'selected' : ''} onClick={() => setSelected(item)}>{item}</button>)}</div></div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}

function RadioBar({ visible, playing, setPlaying, request, volume, setVolume, onPreload, onActiveMemberChange, onOpenMember }: {
  onOpenMember: (id: string) => void
  visible: boolean
  playing: boolean
  setPlaying: (value: boolean) => void
  request: { memberId: string; nonce: number } | null
  volume: number
  setVolume: (value: number) => void
  onPreload: (state: { loaded: number; total: number; tracks: number }) => void
  onActiveMemberChange: (memberId: string) => void
}) {
  // every playback decision lives in RadioEngine (src/lib/radioEngine.ts);
  // this component only wires the SoundCloud widgets and renders its state.
  const radioMembers = useMemo(() => collective.filter(item => item.radio), [])
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
  const [state, setState] = useState<RadioState | null>(null)
  const engineRef = useRef<RadioEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current = new RadioEngine(radioMembers, { volume, sfx: name => void playSfx(name), onChange: setState, isHidden: () => document.hidden })
  }
  const engine = engineRef.current
  const lastPreload = useRef('')
  const lastMember = useRef('')

  useEffect(() => {
    const SC = window.SC
    if (!SC) { engine.markUnavailable(); return }
    const events = SC.Widget.Events
    const cleanups: Array<() => void> = []
    radioMembers.forEach(member => {
      const iframe = iframeRefs.current[member.id]
      if (!iframe) return
      const widget = SC.Widget(iframe)
      engine.attach(member.id, widget)
      const handlers: Array<[string, () => void]> = [
        [events.READY, () => engine.handleReady(member.id)],
        [events.PLAY, () => engine.handlePlay(member.id)],
        [events.PAUSE, () => engine.handlePause(member.id)],
        [events.FINISH, () => engine.handleFinish(member.id)],
      ]
      if (events.ERROR) handlers.push([events.ERROR, () => engine.handleError(member.id)])
      handlers.forEach(([event, handler]) => widget.bind(event, handler))
      cleanups.push(() => handlers.forEach(([event]) => widget.unbind(event)))
    })
    // If a widget became ready before we bound READY, read its catalog anyway.
    const fallback = window.setTimeout(() => radioMembers.forEach(member => { if (!engine.hasCatalog(member.id)) engine.handleReady(member.id) }), 6000)
    return () => {
      window.clearTimeout(fallback)
      cleanups.forEach(cleanup => cleanup())
      engine.dispose()
    }
  }, [])

  useEffect(() => { engine.setVolume(volume) }, [volume])

  // Back from another tab: restart a track that could not start while hidden.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) engine.resumeIfStalled() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // App-level play state (ENTER WITH SOUND, collective drawer) -> engine.
  useEffect(() => {
    if (playing === engine.getState().wantPlay) return
    if (playing) engine.play()
    else engine.pause()
  }, [playing])

  // Engine -> App (play button, preload gate, active collective member).
  useEffect(() => {
    if (!state) return
    if (state.wantPlay !== playing) setPlaying(state.wantPlay)
    const preload = `${state.readyMembers}/${state.totalMembers}/${state.poolSize}`
    if (preload !== lastPreload.current) {
      lastPreload.current = preload
      onPreload({ loaded: state.readyMembers, total: state.totalMembers, tracks: state.poolSize })
    }
    const memberId = state.current?.memberId ?? ''
    if (memberId && memberId !== lastMember.current) {
      lastMember.current = memberId
      onActiveMemberChange(memberId)
    }
  }, [state])

  useEffect(() => {
    if (request) engine.playArtist(request.memberId)
  }, [request?.nonce])

  const status = state?.status ?? 'loading'
  const shown = state?.pending ?? state?.current ?? null
  const artist = status === 'unavailable' ? '4EVER RADIO' : shown?.artist ?? '4EVER COLLECTIVE'
  const title = status === 'unavailable' ? 'SOUNDCLOUD IS UNREACHABLE RIGHT NOW'
    : status === 'loading' ? 'BUILDING GLOBAL TRACK POOL…'
      : status === 'skipping' ? 'SKIPPING AN UNAVAILABLE TRACK…'
        : shown?.title ?? (state?.pending ? 'LOADING TRACK…' : 'PRESS PLAY')
  const statusLabel: Record<RadioStatus, string> = { loading: 'TUNING IN', idle: 'READY', switching: 'LOADING', playing: 'ON AIR', paused: 'PAUSED', skipping: 'SKIPPING', unavailable: 'OFFLINE' }
  const isPlaying = status === 'playing'
  // Cameo: whoever is on air shows up in the bar, in their colours; tap to visit their world.
  const onAirMember = status === 'unavailable' ? null : memberById(shown?.memberId)
  const { metadata: memberMeta } = useMemberMetadata(visible)

  return <>
    <div className="radio-preload-rack" aria-hidden="true">
      {radioMembers.map(member => {
        const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(member.profileUrl)}&color=%237c4dff&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`
        return <iframe key={member.id} ref={node => { iframeRefs.current[member.id] = node }} title={`Preloaded SoundCloud catalog ${member.name}`} src={src} allow="autoplay" />
      })}
    </div>
    {visible && <footer className={`radio-bar radio-status-${status}`}>
      <button className="player-button" onClick={() => engine.toggle()} aria-label={state?.wantPlay ? 'Pause radio' : 'Play radio'}>{state?.wantPlay ? <Pause /> : <Play />}</button>
      <Disc3 className={isPlaying ? 'spin' : ''} />
      {onAirMember && <button className={`radio-cameo ${isPlaying ? 'is-live' : ''}`} style={{ '--m1': onAirMember.accent, '--m2': onAirMember.accent2 } as React.CSSProperties} onClick={() => onOpenMember(onAirMember.id)} title={`Open ${onAirMember.name}'s world`} aria-label={`Open ${onAirMember.name}'s world`}>
        <MemberAvatar member={onAirMember} thumbnail={memberMeta[onAirMember.id]?.thumbnail_url} />
      </button>}
      <div className={`track-meta ${state?.pending ? 'is-pending' : ''}`} aria-live="polite">
        <span><b className="radio-status-chip">{statusLabel[status]}</b> RADIO 4EVER · GLOBAL SHUFFLE · {state?.poolSize ?? 0} TRACKS · {state?.readyMembers ?? 0}/{radioMembers.length} CATALOGS</span>
        <strong>{artist} — {title}</strong>
      </div>
      <div className={`fake-wave ${isPlaying ? '' : 'is-idle'}`}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
      <div className="radio-volume"><button className="volume-icon" onClick={() => setVolume(volume === 0 ? 22 : 0)} aria-label={volume === 0 ? 'Unmute radio' : 'Mute radio'}>{volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="volume-slider" type="range" min="0" max="100" value={volume} onChange={e => setVolume(Number(e.target.value))} aria-label="Background music volume" /><span>{volume}%</span></div>
      <button className="icon-button" onClick={() => engine.shuffle()} title="Random track from the entire collective" aria-label="Random track from the entire collective"><Shuffle size={18} /></button>
      <button className="icon-button" onClick={() => engine.nextFromArtist()} title="Random track from the current artist" aria-label="Random track from the current artist"><SkipForward size={18} /></button>
      <a className="icon-button" href={shown?.url ?? 'https://soundcloud.com'} target="_blank" rel="noreferrer" aria-label="Open this track on SoundCloud"><ExternalLink size={18} /></a>
    </footer>}
  </>
}


function CrewDrawer({ open, onClose, activeMemberId, foundSignals, onOpenMember, onPlayMember }: { open: boolean; onClose: () => void; activeMemberId: string; foundSignals: string[]; onOpenMember: (id: string) => void; onPlayMember: (member: (typeof collective)[number]) => void }) {
  const { metadata, loading } = useMemberMetadata(open)
  const [filter, setFilter] = useState<'all' | 'radio'>('all')
  const members = filter === 'radio' ? collective.filter(member => member.radio) : collective
  const synced = collective.filter(member => metadata[member.id]).length

  return <AnimatePresence>{open && <>
    <motion.button className="drawer-backdrop" aria-label="Close drawer" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.aside className="crew-drawer crew-drawer-v2" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 240, damping: 28 }}>
      <div className="drawer-head"><div><span>THE PEOPLE BEHIND IT</span><h2>4EVER COLLECTIVE</h2></div><button className="icon-button" onClick={onClose} aria-label="Close collective"><X /></button></div>
      <div className="crew-toolbar">
        <div className="crew-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>ALL {collective.length}</button><button className={filter === 'radio' ? 'active' : ''} onClick={() => setFilter('radio')}>RADIO {collective.filter(member => member.radio).length}</button></div>
        <span>{loading ? 'SYNCING SOUNDCLOUD…' : `${synced}/${collective.length} PROFILES SYNCED`} · <b className="signals-count">SIGNALS {foundSignals.length}/{collective.length}</b></span>
      </div>
      <div className="crew-grid crew-grid-rich">{members.map(member => {
        const data = metadata[member.id]
        const active = activeMemberId === member.id
        const number = collective.indexOf(member) + 1
        const found = foundSignals.includes(member.id)
        return <article className={`crew-card-rich ${active ? 'active' : ''}`} key={member.id} style={{ '--member-accent': member.accent, '--member-accent-2': member.accent2, '--member-ink': inkOn(member.accent) } as React.CSSProperties}>
          <button className="crew-cover" onClick={() => onOpenMember(member.id)} aria-label={`Open ${member.name}'s world`}>
            <MemberAvatar member={member} thumbnail={data?.thumbnail_url} />
            <span className="crew-index">{String(number).padStart(2, '0')}</span>
            <span className="crew-symbol" aria-hidden="true">{member.symbol}</span>
            {member.radio && <span className="radio-ready"><Disc3 size={13} /> RADIO</span>}
          </button>
          <button className="crew-card-copy" onClick={() => onOpenMember(member.id)}>
            <span>{member.role ?? '4EVER MEMBER'}{found ? ' · SIGNAL ✓' : ''}</span>
            <strong>{member.name}</strong>
            <em>{member.tagline ?? (member.alias ? `aka ${member.alias}` : data?.author_name ?? '@4ever')}</em>
          </button>
          <div className="crew-card-actions">
            {member.radio ? <button onClick={() => onPlayMember(member)}>{active ? <><Pause size={15} /> ON AIR</> : <><Play size={15} /> PLAY</>}</button> : <span>PROFILE ONLY</span>}
            <button className="crew-open-world" onClick={() => onOpenMember(member.id)}>OPEN WORLD <ArrowUpRight size={14} /></button>
          </div>
        </article>
      })}</div>
      <div className="crew-manifesto"><span>HIDDEN SIGNALS</span><p>Every member hides a signal. Type their name anywhere on the site, or tap their portrait five times inside their world. Share a world with its link: it opens straight to that member.</p></div>
    </motion.aside>
  </>}</AnimatePresence>
}

