/**
 * Converter helpers: upload with progress, the job a tab switch
 * must not lose, the recent-files history and human-readable file details.
 * No React here, so it can be tested in Node.
 */
import { apiUrl } from './api.ts'

export type ConvertFormat = 'mp3' | 'wav'
export type OutputInfo = {
  format: string
  bytes: number
  duration: number | null
  sample_rate: number | null
  channels: number | null
  codec: string | null
  bit_rate: number | null
}

export type HistoryEntry = {
  id: string
  title: string
  format: ConvertFormat
  detail: string
  downloadUrl: string
  finishedAt: number
  /** Unix ms; after this the server has deleted the file. */
  expiresAt: number
}

/** The job being converted right now; survives switching to BPM + KEY and back. */
export type ActiveJob = { id: string; format: ConvertFormat; quality: string; bitDepth: string; title: string | null; startedAt: number }

const HISTORY_KEY = '4ever-converter-history'
const ACTIVE_KEY = '4ever-converter-active'
const HISTORY_LIMIT = 12
/** Expired entries stay visible (marked EXPIRED) for a day, then disappear. */
const HISTORY_GRACE_MS = 24 * 60 * 60 * 1000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(kind: 'local' | 'session'): StorageLike | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function readJson<T>(store: StorageLike | null, key: string): T | null {
  try {
    const raw = store?.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeJson(store: StorageLike | null, key: string, value: unknown) {
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, JSON.stringify(value))
  } catch { /* private mode / quota: history just isn't remembered */ }
}

export function pruneHistory(entries: HistoryEntry[], now = Date.now()): HistoryEntry[] {
  const seen = new Set<string>()
  return entries
    .filter(entry => entry && typeof entry.id === 'string' && typeof entry.expiresAt === 'number')
    .filter(entry => now - entry.expiresAt < HISTORY_GRACE_MS)
    .filter(entry => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, HISTORY_LIMIT)
}

export function loadHistory(store: StorageLike | null = storage('local'), now = Date.now()): HistoryEntry[] {
  const entries = readJson<HistoryEntry[]>(store, HISTORY_KEY)
  return Array.isArray(entries) ? pruneHistory(entries, now) : []
}

export function addToHistory(entry: HistoryEntry, store: StorageLike | null = storage('local'), now = Date.now()): HistoryEntry[] {
  const next = pruneHistory([entry, ...loadHistory(store, now)], now)
  writeJson(store, HISTORY_KEY, next)
  return next
}

export function clearHistory(store: StorageLike | null = storage('local')) {
  writeJson(store, HISTORY_KEY, null)
}

export function loadActiveJob(store: StorageLike | null = storage('session')): ActiveJob | null {
  const job = readJson<ActiveJob>(store, ACTIVE_KEY)
  // A job older than 30 min is not "running" any more: the server gave up on it long ago.
  return job && typeof job.id === 'string' && Date.now() - job.startedAt < 30 * 60 * 1000 ? job : null
}

export function saveActiveJob(job: ActiveJob | null, store: StorageLike | null = storage('session')) {
  writeJson(store, ACTIVE_KEY, job)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 100 * 1024 * 1024) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "MP3 · 320 KBPS · 3:12 · 7.4 MB" / "WAV · 24-BIT · 48 KHZ · STEREO · 3:12 · 52.8 MB" */
export function describeOutput(output: OutputInfo | null | undefined, format: ConvertFormat, quality: string, bitDepth: string): string {
  const parts: string[] = [format.toUpperCase()]
  if (format === 'mp3') parts.push(`${output?.bit_rate ? Math.round(output.bit_rate / 1000) : quality} KBPS`)
  else {
    const depth = output?.codec === 'pcm_s24le' ? '24' : output?.codec === 'pcm_s16le' ? '16' : bitDepth
    parts.push(`${depth}-BIT`)
    if (output?.sample_rate) parts.push(`${+(output.sample_rate / 1000).toFixed(1)} KHZ`)
  }
  if (output?.channels) parts.push(output.channels === 1 ? 'MONO' : 'STEREO')
  if (output?.duration) parts.push(formatDuration(output.duration))
  if (output?.bytes) parts.push(formatBytes(output.bytes))
  return parts.join(' · ')
}

export function timeLeft(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now
  if (ms <= 0) return 'EXPIRED'
  const minutes = Math.ceil(ms / 60000)
  if (minutes <= 60) return `${minutes} MIN LEFT`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} H${rest ? ` ${rest} MIN` : ''} LEFT`
}

export type UploadResult = { status: number; payload: { id?: string; detail?: unknown } | null }

/**
 * POST the form with XMLHttpRequest: fetch() cannot report upload progress, and
 * a 200 MB WAV over home Wi-Fi otherwise sits at 0 % for a minute.
 */
export function postConversion(form: FormData, onUpload?: (fraction: number) => void, url = apiUrl('/api/conversions')): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.responseType = 'text'
    if (onUpload) request.upload.onprogress = event => { if (event.lengthComputable && event.total) onUpload(event.loaded / event.total) }
    request.onload = () => {
      let payload: UploadResult['payload'] = null
      try { payload = JSON.parse(request.responseText) } catch { /* non-JSON error page */ }
      resolve({ status: request.status, payload })
    }
    request.onerror = () => reject(new TypeError('network'))
    request.ontimeout = () => reject(new TypeError('timeout'))
    request.send(form)
  })
}
