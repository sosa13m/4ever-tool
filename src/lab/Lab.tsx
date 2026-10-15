import { motion } from 'framer-motion'
import { Check, Download, FlaskConical, Pause, Play, RotateCcw, Scissors, Upload, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { camelotOf, estimateKey, keyName, type KeyResult } from '../lib/key'
import { encodeWav, labFileName, plan, processAudio, resample, type Channels, type LabSettings } from '../lib/lab'
import { estimateTempo } from '../lib/tempo'

const MAX_SECONDS = 15 * 60
const SPEEDS = [0.75, 0.85, 1, 1.15, 1.25]
const SEMIS = [-5, -2, -1, 0, 1, 2, 5]

type Source = { name: string; channels: Channels; sampleRate: number; duration: number; buffer: AudioBuffer }
type Rendered = { url: string; settingsKey: string; seconds: number; peakGainDb: number; channels: Channels; sampleRate: number }

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`
}

function audioContext(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new Ctx()
}

/** The tools of 4EVER LAB: trim, reverse, speed, pitch — all in the browser. */
export default function Lab({ onSendToConverter }: { onSendToConverter: (file: File) => void }) {
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<LabSettings>({ start: 0, end: 0, reverse: false, speed: 1, keepPitch: true, semitones: 0, fadeMs: 4 })
  const [bpm, setBpm] = useState<number | null>(null)
  const [key, setKey] = useState<KeyResult | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('DROP A SOUND TO START')
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [bitDepth, setBitDepth] = useState<16 | 24>(16)
  const [targetBpm, setTargetBpm] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const preview = useRef<{ ctx: AudioContext; node: AudioBufferSourceNode } | null>(null)
  const drag = useRef<{ mode: 'start' | 'end' | 'new'; anchor: number } | null>(null)
  const generation = useRef(0)

  const settingsKey = JSON.stringify(settings)
  const stale = Boolean(rendered && rendered.settingsKey !== settingsKey)
  const selection = Math.max(0, settings.end - settings.start)
  const { tempo, pitch } = plan(settings)
  const totalSemis = 12 * Math.log2(pitch)
  const resultSeconds = selection / tempo

  useEffect(() => () => { stopPreview(); generation.current += 1 }, [])
  useEffect(() => () => { if (rendered) URL.revokeObjectURL(rendered.url) }, [rendered])

  // ---------------------------------------------------------------- loading
  const load = async (file?: File | null) => {
    if (!file) return
    const gen = ++generation.current
    stopPreview()
    setError(null)
    setRendered(null)
    setBpm(null); setKey(null); setTargetBpm('')
    setLabel('DECODING…'); setProgress(5)
    if (file.size > 300 * 1024 * 1024) { setError('FILE TOO LARGE FOR THE LAB — MAX 300 MB.'); return }
    const ctx = audioContext()
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      if (gen !== generation.current) return
      if (buffer.duration > MAX_SECONDS) { setError(`THE LAB TAKES UP TO ${MAX_SECONDS / 60} MINUTES. TRIM IT IN YOUR DAW OR USE A SHORTER FILE.`); return }
      // Surround → stereo: the LAB works on one or two channels.
      let channels: Channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice())
      if (channels.length > 2) {
        const l = new Float32Array(buffer.length), r = new Float32Array(buffer.length)
        channels.forEach((channel, i) => { const target = i % 2 ? r : l; for (let n = 0; n < channel.length; n += 1) target[n] += channel[n] / Math.ceil(channels.length / 2) })
        channels = [l, r]
      }
      setSource({ name: file.name, channels, sampleRate: buffer.sampleRate, duration: buffer.duration, buffer })
      setSettings(current => ({ ...current, start: 0, end: buffer.duration }))
      setLabel('READY · SELECT A PART OR KEEP IT ALL'); setProgress(0)
      void analyse(channels, buffer.sampleRate, gen)
    } catch {
      setError('THE BROWSER COULD NOT DECODE THIS FILE. TRY WAV OR MP3.')
      setLabel('DROP A SOUND TO START')
    } finally {
      void ctx.close()
    }
  }

  /** BPM + key of the whole file, so the LAB can show what the result will be. */
  const analyse = async (channels: Channels, sampleRate: number, gen: number) => {
    setAnalysing(true)
    try {
      const mono = new Float32Array(channels[0].length)
      channels.forEach(channel => { for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / channels.length })
      const signal = await resample(mono.subarray(0, Math.min(mono.length, sampleRate * 480)) as Float32Array, sampleRate / 22050)
      const tempoResult = await estimateTempo(signal, 22050)
      if (gen !== generation.current) return
      if (tempoResult.bpm) setBpm(tempoResult.bpm)
      const keyResult = await estimateKey(signal, 22050)
      if (gen !== generation.current) return
      if (keyResult.confidence > 0) setKey(keyResult)
    } catch { /* analysis is a bonus; the tools work without it */ }
    finally { if (gen === generation.current) setAnalysing(false) }
  }

  // ---------------------------------------------------------------- waveform + selection
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    const context = canvas.getContext('2d')
    if (!context) return
    const { width, height } = canvas
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#7c4dff'
    const data = source.channels
    const per = Math.max(1, Math.floor(data[0].length / width))
    context.clearRect(0, 0, width, height)
    const a = (settings.start / source.duration) * width
    const b = (settings.end / source.duration) * width
    for (let x = 0; x < width; x += 1) {
      let min = 1, max = -1
      const from = x * per
      for (const channel of data) for (let i = 0; i < per && from + i < channel.length; i += 4) { const v = channel[from + i]; if (v < min) min = v; if (v > max) max = v }
      context.globalAlpha = x >= a && x <= b ? 1 : 0.28
      context.fillStyle = accent
      context.fillRect(x, (1 + min) * 0.5 * height, 1, Math.max(1, (max - min) * 0.5 * height))
    }
    context.globalAlpha = 1
  }, [source, settings.start, settings.end])

  const timeAt = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas || !source) return 0
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(source.duration, ((clientX - rect.left) / rect.width) * source.duration))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!source || busy) return
    const t = timeAt(event.clientX)
    const rect = canvasRef.current!.getBoundingClientRect()
    const px = (s: number) => (s / source.duration) * rect.width
    const x = event.clientX - rect.left
    const mode = Math.abs(x - px(settings.start)) < 14 ? 'start' : Math.abs(x - px(settings.end)) < 14 ? 'end' : 'new'
    drag.current = { mode, anchor: t }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (mode === 'new') setSettings(s => ({ ...s, start: t, end: t }))
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !source) return
    const t = timeAt(event.clientX)
    const { mode, anchor } = drag.current
    setSettings(s => mode === 'start' ? { ...s, start: Math.min(t, s.end - 0.01) }
      : mode === 'end' ? { ...s, end: Math.max(t, s.start + 0.01) }
        : { ...s, start: Math.min(anchor, t), end: Math.max(anchor, t) })
  }
  const onPointerUp = () => {
    if (!drag.current || !source) return
    drag.current = null
    // A click without a drag means "select everything".
    setSettings(s => (s.end - s.start < 0.02 ? { ...s, start: 0, end: source.duration } : s))
  }

  const setTime = (which: 'start' | 'end', value: number) => {
    if (!source || !Number.isFinite(value)) return
    setSettings(s => which === 'start'
      ? { ...s, start: Math.max(0, Math.min(value, s.end - 0.01)) }
      : { ...s, end: Math.min(source.duration, Math.max(value, s.start + 0.01)) })
  }

  // ---------------------------------------------------------------- preview of the original selection
  function stopPreview() {
    try { preview.current?.node.stop() } catch { /* already stopped */ }
    void preview.current?.ctx.close()
    preview.current = null
    setPreviewing(false)
  }
  const togglePreview = () => {
    if (!source) return
    if (preview.current) return stopPreview()
    const ctx = audioContext()
    const node = ctx.createBufferSource()
    node.buffer = source.buffer
    node.connect(ctx.destination)
    node.onended = () => { if (preview.current?.node === node) stopPreview() }
    node.start(0, settings.start, selection)
    preview.current = { ctx, node }
    setPreviewing(true)
  }

  // ---------------------------------------------------------------- render
  const render = async () => {
    if (!source || busy || selection < 0.02) return
    stopPreview()
    const gen = generation.current
    setBusy(true); setProgress(1); setLabel('COOKING…')
    try {
      const result = await processAudio(source.channels, source.sampleRate, settings, (fraction, step) => {
        if (gen !== generation.current) return
        setProgress(Math.max(1, Math.round(fraction * 96)))
        setLabel(step)
      })
      if (gen !== generation.current) return
      const wav = encodeWav(result.channels, result.sampleRate, bitDepth)
      const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }))
      setRendered({ url, settingsKey, seconds: result.seconds, peakGainDb: result.peakGainDb, channels: result.channels, sampleRate: result.sampleRate })
      setProgress(100); setLabel('READY · LISTEN, THEN DOWNLOAD')
    } catch (problem) {
      console.error(problem)
      setError('THE LAB COULD NOT PROCESS THIS. TRY A SHORTER SELECTION.')
    } finally {
      if (gen === generation.current) setBusy(false)
    }
  }

  const fileName = source ? labFileName(source.name, settings, source.duration) : '4ever-lab.wav'
  const wavFile = () => {
    if (!rendered) return null
    const bytes = encodeWav(rendered.channels, rendered.sampleRate, bitDepth)
    return new File([bytes as BlobPart], fileName, { type: 'audio/wav' })
  }
  const download = () => {
    const file = wavFile()
    if (!file) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const applyTargetBpm = (value: string) => {
    setTargetBpm(value)
    const target = Number(value.replace(',', '.'))
    if (bpm && target > 0) setSettings(s => ({ ...s, speed: Math.max(0.5, Math.min(2, +(target / bpm).toFixed(4))) }))
  }

  const newBpm = bpm ? +(bpm * tempo).toFixed(1) : null
  const shifted = useMemo(() => {
    if (!key) return null
    const steps = Math.round(totalSemis)
    const tonic = (((key.tonic + steps) % 12) + 12) % 12
    return { name: keyName(tonic, key.mode), camelot: camelotOf(tonic, key.mode), exact: Math.abs(totalSemis - steps) < 0.15 }
  }, [key, totalSemis])
  const changed = settings.reverse || Math.abs(settings.speed - 1) > 1e-3 || settings.semitones !== 0 || (source && (settings.start > 0.001 || settings.end < source.duration - 0.001))

  return (
    <motion.div className="tool-card lab-card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }}>
      <div className="tool-heading"><span>03</span><div><p>4EVER LAB · TRIM · REVERSE · SPEED · PITCH</p><h2>FLIP THE SAMPLE.</h2></div></div>

      <label className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={event => { event.preventDefault(); setDragging(false) }}
        onDrop={event => { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files?.[0]) }}>
        <Upload size={30} />
        <strong>{source?.name ?? 'DROP A SAMPLE, LOOP OR TRACK'}</strong>
        <span>{source ? `${fmt(source.duration)} · ${source.sampleRate / 1000} KHZ · ${source.channels.length === 1 ? 'MONO' : 'STEREO'}` : `MP3 · WAV · FLAC · M4A · OGG · UP TO ${MAX_SECONDS / 60} MIN · NOTHING IS UPLOADED`}</span>
        <input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aif,.aiff" disabled={busy} onChange={event => void load(event.target.files?.[0])} />
      </label>

      {error && <div className="analysis-error">{error}</div>}

      {source && <>
        <div className="local-player lab-wave ready">
          <div className="lab-wave-surface" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            role="slider" aria-label="Selection on the waveform" aria-valuemin={0} aria-valuemax={source.duration} aria-valuenow={settings.start} aria-valuetext={`${fmt(settings.start)} to ${fmt(settings.end)}`}>
            <canvas ref={canvasRef} width="1100" height="150" />
            <span className="lab-handle" style={{ left: `${(settings.start / source.duration) * 100}%` }} />
            <span className="lab-handle end" style={{ left: `${(settings.end / source.duration) * 100}%` }} />
          </div>
          <div className="lab-selection">
            <button className="player-button" onClick={togglePreview} aria-label={previewing ? 'Stop preview' : 'Preview selection'} disabled={busy}>{previewing ? <Pause /> : <Play />}</button>
            <label>START <input type="number" min={0} step={0.01} value={+settings.start.toFixed(2)} onChange={e => setTime('start', Number(e.target.value))} disabled={busy} /></label>
            <label>END <input type="number" min={0} step={0.01} value={+settings.end.toFixed(2)} onChange={e => setTime('end', Number(e.target.value))} disabled={busy} /></label>
            <span><Scissors size={14} /> {fmt(selection)} SELECTED</span>
            <button className="text-button" onClick={() => setSettings(s => ({ ...s, start: 0, end: source.duration }))} disabled={busy}>SELECT ALL</button>
          </div>
        </div>

        <div className="option-grid lab-controls">
          <div className="option">
            <span>SPEED · {settings.speed.toFixed(2)}×</span>
            <input className="lab-slider" type="range" min={0.5} max={2} step={0.01} value={settings.speed} disabled={busy} onChange={e => { setTargetBpm(''); setSettings(s => ({ ...s, speed: Number(e.target.value) })) }} aria-label="Speed" />
            <div>{SPEEDS.map(v => <button key={v} disabled={busy} className={Math.abs(settings.speed - v) < 1e-3 ? 'selected' : ''} onClick={() => { setTargetBpm(''); setSettings(s => ({ ...s, speed: v })) }}>{v}×</button>)}</div>
            <div className="lab-mode">
              <button disabled={busy} className={settings.keepPitch ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, keepPitch: true }))}>KEEP PITCH</button>
              <button disabled={busy} className={!settings.keepPitch ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, keepPitch: false }))}>TAPE (PITCH FOLLOWS)</button>
            </div>
            {bpm && <label className="lab-target">TARGET BPM <input inputMode="decimal" placeholder={String(bpm)} value={targetBpm} disabled={busy} onChange={e => applyTargetBpm(e.target.value)} /></label>}
          </div>
          <div className="option">
            <span>PITCH · {settings.semitones > 0 ? '+' : ''}{settings.semitones} ST</span>
            <input className="lab-slider" type="range" min={-12} max={12} step={1} value={settings.semitones} disabled={busy} onChange={e => setSettings(s => ({ ...s, semitones: Number(e.target.value) }))} aria-label="Pitch in semitones" />
            <div>{SEMIS.map(v => <button key={v} disabled={busy} className={settings.semitones === v ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, semitones: v }))}>{v > 0 ? `+${v}` : v}</button>)}</div>
            <div className="lab-mode">
              <button disabled={busy} className={settings.reverse ? 'selected' : ''} onClick={() => setSettings(s => ({ ...s, reverse: !s.reverse }))}><RotateCcw size={15} /> REVERSE {settings.reverse ? 'ON' : 'OFF'}</button>
              <button disabled={busy} onClick={() => { setTargetBpm(''); setSettings(s => ({ ...s, reverse: false, speed: 1, semitones: 0, keepPitch: true })) }}>RESET FX</button>
            </div>
          </div>
        </div>

        <div className="lab-forecast" aria-live="polite">
          <div><small>LENGTH</small><strong>{fmt(resultSeconds)}</strong></div>
          <div><small>BPM</small><strong>{newBpm ?? (analysing ? '…' : '—')}</strong>{bpm && Math.abs(tempo - 1) > 1e-3 && <em>FROM {bpm}</em>}</div>
          <div><small>KEY</small><strong>{shifted ? `${shifted.name}` : analysing ? '…' : '—'}</strong>{shifted && <em>{shifted.camelot}{!shifted.exact ? ` · ≈${totalSemis > 0 ? '+' : ''}${totalSemis.toFixed(1)} ST` : key && Math.round(totalSemis) !== 0 ? ` · FROM ${key.name}` : ''}</em>}</div>
          <div><small>PITCH</small><strong>{Math.abs(totalSemis) < 0.05 ? 'ORIGINAL' : `${totalSemis > 0 ? '+' : ''}${totalSemis.toFixed(Number.isInteger(+totalSemis.toFixed(2)) ? 0 : 1)} ST`}</strong></div>
        </div>

        <button className="massive-action" disabled={busy || selection < 0.02} onClick={() => void render()}>
          {busy ? 'COOKING IN YOUR BROWSER…' : rendered && !stale ? 'RENDER AGAIN' : changed ? 'RENDER' : 'RENDER (NO CHANGES YET)'} <FlaskConical />
        </button>

        {(busy || progress > 0) && (
          <div className={`analysis-console ${busy ? '' : 'idle'}`} role="status">
            <div><span>{label}</span><strong>{Math.round(progress)}%</strong></div>
            <div className="analysis-progress"><motion.i initial={false} animate={{ width: `${progress}%` }} /></div>
          </div>
        )}

        {rendered && (
          <div className={`conversion-result lab-result ${stale ? 'is-stale' : ''}`}>
            <div><Check size={22} /><span><small>{fileName.toUpperCase()}</small><strong>{fmt(rendered.seconds)} · WAV · {bitDepth}-BIT · {rendered.sampleRate / 1000} KHZ{rendered.peakGainDb < -0.05 ? ` · ${rendered.peakGainDb.toFixed(1)} DB TO AVOID CLIPPING` : ''}</strong>{stale && <em>SETTINGS CHANGED — RENDER AGAIN TO HEAR THEM</em>}</span></div>
            <audio className="lab-audio" controls src={rendered.url} />
            <div className="lab-export">
              <div className="option lab-depth"><div>{([16, 24] as const).map(depth => <button key={depth} className={bitDepth === depth ? 'selected' : ''} onClick={() => setBitDepth(depth)}>{depth}-BIT</button>)}</div></div>
              <button className="sticker-button primary" onClick={download}>DOWNLOAD WAV <Download size={18} /></button>
              <button className="text-button" onClick={() => { const file = wavFile(); if (file) onSendToConverter(file) }}><Zap size={14} /> MAKE AN MP3</button>
            </div>
          </div>
        )}
      </>}

      <p className="legal-copy">Everything happens in your browser: the audio never leaves your computer. Keep pitch uses a phase vocoder (like a DAW's "stretch"); tape mode changes speed and pitch together, like a turntable. Long files take longer — trim first.</p>
      <div className="prototype-tag">4EVER LAB · TRIM · REVERSE · SPEED · PITCH · WAV 16/24-BIT.</div>
    </motion.div>
  )
}
