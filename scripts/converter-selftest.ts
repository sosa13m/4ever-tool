/**
 * Converter helpers self-test (history, active job, file details).
 * Run:  npm run test:converter   (Node 22.18+)
 */
import { addToHistory, clearHistory, describeOutput, formatBytes, formatDuration, loadActiveJob, loadHistory, pruneHistory, saveActiveJob, timeLeft, type HistoryEntry } from '../src/lib/converter.ts'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

let failures = 0, total = 0
const check = (ok: boolean, label: string, detail = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`)
}

const HOUR = 3600_000
const now = Date.parse('2026-10-14T12:00:00Z')
const entry = (id: string, finishedAgoH: number, ttlH = 1): HistoryEntry => ({
  id, title: `Track ${id}`, format: 'mp3', detail: 'MP3 · 320 KBPS', downloadUrl: `/api/conversions/${id}/download`,
  finishedAt: now - finishedAgoH * HOUR, expiresAt: now - finishedAgoH * HOUR + ttlH * HOUR,
})

// History: newest first, de-duplicated, capped, old expired entries dropped.
const store = new MemoryStorage()
for (let i = 0; i < 15; i += 1) addToHistory(entry(`n${i}`, (15 - i) * 0.01), store, now)
let list = loadHistory(store, now)
check(list.length === 12, 'history keeps the 12 most recent', String(list.length))
check(list[0].id === 'n14' && list.at(-1)?.id === 'n3', 'history is newest first', `${list[0].id} … ${list.at(-1)?.id}`)
addToHistory(entry('n14', 0), store, now)
check(loadHistory(store, now).filter(item => item.id === 'n14').length === 1, 'same job is never listed twice')
const pruned = pruneHistory([entry('fresh', 0.5), entry('expired-today', 3), entry('ancient', 30)], now)
check(pruned.map(item => item.id).join() === 'fresh,expired-today', 'expired files stay a day, then vanish', pruned.map(item => item.id).join())
store.setItem('4ever-converter-history', '{not json')
check(loadHistory(store, now).length === 0, 'corrupt storage does not crash')
store.setItem('4ever-converter-history', JSON.stringify([{ nope: true }, entry('ok', 0)]))
check(loadHistory(store, now).map(item => item.id).join() === 'ok', 'malformed entries are skipped')
clearHistory(store)
check(loadHistory(store, now).length === 0, 'clear empties the history')
check(loadHistory(null, now).length === 0 && addToHistory(entry('x', 0), null, now).length === 1, 'works with storage blocked (private mode)')

// Active job survives a tab switch, but not forever.
const session = new MemoryStorage()
saveActiveJob({ id: 'abc', format: 'wav', quality: '320', bitDepth: '24', title: 'Beat', startedAt: Date.now() }, session)
check(loadActiveJob(session)?.bitDepth === '24', 'running job is remembered across tab switches')
saveActiveJob({ id: 'old', format: 'mp3', quality: '320', bitDepth: '16', title: null, startedAt: Date.now() - 31 * 60_000 }, session)
check(loadActiveJob(session) === null, 'a 31-minute-old job is not resumed')
saveActiveJob(null, session)
check(loadActiveJob(session) === null, 'finished job is forgotten')

// Human-readable details.
const wav = { format: 'wav', bytes: 55_300_000, duration: 192.4, sample_rate: 48000, channels: 2, codec: 'pcm_s24le', bit_rate: 2304000 }
check(describeOutput(wav, 'wav', '320', '16') === 'WAV · 24-BIT · 48 KHZ · STEREO · 3:12 · 52.7 MB', 'WAV details come from the real file', describeOutput(wav, 'wav', '320', '16'))
const mp3 = { format: 'mp3', bytes: 7_700_000, duration: 192.4, sample_rate: 44100, channels: 2, codec: 'mp3', bit_rate: 320000 }
check(describeOutput(mp3, 'mp3', '192', '16') === 'MP3 · 320 KBPS · STEREO · 3:12 · 7.3 MB', 'MP3 details', describeOutput(mp3, 'mp3', '192', '16'))
check(describeOutput(null, 'mp3', '256', '16') === 'MP3 · 256 KBPS', 'old server without details still reads well')
check(describeOutput({ ...wav, sample_rate: 44100, codec: 'pcm_s16le', channels: 1 }, 'wav', '320', '24').includes('16-BIT · 44.1 KHZ · MONO'), '44.1 kHz mono')
check(formatBytes(999) === '999 B' && formatBytes(2048) === '2 KB' && formatBytes(262_144_000) === '250 MB' && formatBytes(7_700_000) === '7.3 MB', 'byte sizes', formatBytes(262_144_000))
check(formatDuration(3725) === '1:02:05' && formatDuration(59.6) === '1:00' && formatDuration(null) === '—', 'durations')
check(timeLeft(now + 59 * 60_000, now) === '59 MIN LEFT' && timeLeft(now + 90 * 60_000, now) === '1 H 30 MIN LEFT' && timeLeft(now + 60 * 60_000, now) === '60 MIN LEFT' && timeLeft(now + 120 * 60_000, now) === '2 H LEFT' && timeLeft(now - 1, now) === 'EXPIRED', 'time left')

console.log(`\nCONVERTER SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
