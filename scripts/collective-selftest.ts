/**
 * Collective self-test: profile data, share links, signals and sigils.
 * Run:  npm run test:collective   (Node 22.18+)
 */
import { collective, memberIdFromHash, signalMatch } from '../src/data/collective.ts'
import { contrastRatio, inkOn, makeSigil, SIGIL_GRID } from '../src/lib/sigil.ts'
import { loadFoundSignals, markSignalFound } from '../src/collective/signals.ts'

let failures = 0, total = 0
const check = (ok: boolean, label: string, detail = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` :: ${detail}` : ''}`)
}
const HEX = /^#[0-9a-f]{6}$/i
const WORLD_BG = '#0b0b0f'

// Profile data — the things a typo would silently break.
const ids = collective.map(member => member.id)
check(new Set(ids).size === ids.length, 'member ids are unique')
check(ids.every(id => /^[a-z0-9-]+$/.test(id)), 'ids are URL/file safe (photo name + share link)', ids.filter(id => !/^[a-z0-9-]+$/.test(id)).join())
check(collective.every(member => /^https:\/\/soundcloud\.com\/[^/]+$/.test(member.profileUrl)), 'every SoundCloud profile URL is valid')
check(collective.every(member => HEX.test(member.accent) && HEX.test(member.accent2)), 'world colours are 6-digit hex')
check(collective.every(member => [...member.symbol].length >= 1 && [...member.symbol].length <= 2), 'every member has a one-character symbol')
check(collective.filter(member => member.radio).length === 7, 'Radio 4EVER has 7 catalogs', String(collective.filter(member => member.radio).length))
const links = collective.flatMap(member => Object.values(member.links ?? {}))
check(links.every(href => !href || /^https:\/\//.test(href)), 'extra links are https', links.filter(href => href && !/^https:\/\//.test(href)).join())

// Readability of each world: button text on the accent, accent text on the dark world.
const badInk = collective.filter(member => contrastRatio(member.accent, inkOn(member.accent)) < 4.5)
check(!badInk.length, 'text on each accent button is readable (≥ 4.5:1)', badInk.map(member => member.id).join())
// Small labels use the colour mixed 75/25 with white (color-mix in srgb), as in collective.css.
const lift = (hex: string) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.75 + 255 * 0.25).toString(16).padStart(2, '0')).join('')
const badAccent = collective.filter(member => contrastRatio(lift(member.accent), WORLD_BG) < 4.5 || contrastRatio(lift(member.accent2), WORLD_BG) < 4.5)
check(!badAccent.length, 'accent labels on the dark world are readable (≥ 4.5:1)', badAccent.map(member => `${member.id} ${contrastRatio(lift(member.accent), WORLD_BG).toFixed(2)}`).join())

// Share links.
check(memberIdFromHash('#crew/rani') === 'rani' && memberIdFromHash('#crew/RANI') === 'rani', 'share link #crew/rani opens rani')
check(memberIdFromHash('#crew/nobody') === null && memberIdFromHash('#tools') === null && memberIdFromHash('') === null, 'unknown or unrelated hashes open nothing')
check(collective.every(member => memberIdFromHash(`#crew/${member.id}`) === member.id), 'every member has a working share link')

// Hidden signals (typing a name anywhere).
const signals = collective.flatMap(member => member.signals.map(signal => [signal, member.id] as const))
check(collective.every(member => member.signals.length > 0), 'every member hides at least one signal')
check(new Set(signals.map(([signal]) => signal)).size === signals.length, 'no signal is shared by two members')
check(signals.every(([signal]) => signal === signal.toLowerCase() && !/\s/.test(signal)), 'signals are lowercase, no spaces (typed as-is)')
const wrong = signals.filter(([signal, id]) => signalMatch(`blah ${signal}`) !== id)
check(!wrong.length, 'typing each signal finds its own member', wrong.map(([signal]) => signal).join())
check(signalMatch('1000blunts') === 'aletsandrr' && signalMatch('#4ever') === null && signalMatch('hello') === null, 'longest alias wins, the #4ever secret stays separate')

// Found signals persist and never double count.
class MemoryStorage { data = new Map<string, string>(); getItem(k: string) { return this.data.get(k) ?? null } setItem(k: string, v: string) { this.data.set(k, v) } }
const store = new MemoryStorage()
check(markSignalFound('rani', store).isNew && !markSignalFound('rani', store).isNew && loadFoundSignals(store).length === 1, 'a signal is counted once')
store.setItem('4ever-signals-found', '{oops')
check(loadFoundSignals(store).length === 0, 'corrupt storage does not crash')
check(markSignalFound('agus', null).found.includes('agus'), 'works with storage blocked')

// Sigils.
const sigils = collective.map(member => makeSigil(member.id))
check(JSON.stringify(makeSigil('rani')) === JSON.stringify(makeSigil('rani')), 'sigils are deterministic')
check(new Set(sigils.map(sigil => JSON.stringify(sigil.cells))).size === sigils.length, 'every member gets a different sigil')
check(sigils.every(sigil => sigil.cells.length >= 12 && sigil.cells.length <= 40), 'sigils are neither empty nor solid', sigils.map(sigil => sigil.cells.length).join(','))
const mirrored = sigils.every(sigil => { const set = new Set(sigil.cells.map(([x, y]) => `${x},${y}`)); return sigil.cells.every(([x, y]) => set.has(`${SIGIL_GRID - 1 - x},${y}`)) })
check(mirrored, 'sigils are mirror-symmetric')
check(sigils.every(sigil => sigil.cells.every(([x, y]) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) > 1)), 'the centre stays free for the symbol')

console.log(`\nCOLLECTIVE SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
