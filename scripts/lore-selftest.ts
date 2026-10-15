/**
 * Underground lore self-test: every fact is short, sourced, unique, and the
 * rotation always lands on a real fact. Run:  npm run test:lore
 */
import { LORE, factAt, randomFactIndex } from '../src/data/lore.ts'

let failures = 0, total = 0
const check = (ok: boolean, label: string, detail = '') => {
  total += 1
  if (!ok) failures += 1
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ' :: ' + detail : ''}`)
}

check(LORE.length >= 20, 'at least 20 facts', String(LORE.length))
check(new Set(LORE.map(f => f.id)).size === LORE.length, 'ids are unique')
const long = LORE.filter(f => f.text.length > 230)
check(long.length === 0, 'every fact fits in two lines (≤ 230 characters)', long.map(f => `${f.id}:${f.text.length}`).join(', '))
const unsourced = LORE.filter(f => !f.source.label || (f.scene !== 'chile' && !f.source.url?.startsWith('https://')))
check(unsourced.length === 0, 'every outside fact links to a public source', unsourced.map(f => f.id).join(', '))
for (const artist of ['Reptilian Club Boyz', 'Hi-C', '1c34', 'Novagang', 'Shed Theory', 'Swaggerboyz', 'VRITNI', '4EVER']) {
  check(LORE.some(f => f.artist.includes(artist)), `has facts about ${artist}`)
}
check(LORE.some(f => f.scene === 'chile') && LORE.some(f => f.scene === 'latam') && LORE.some(f => f.scene === 'argentina'), 'the Latin American scene is represented')
check([0, 1, LORE.length, -1, 1e6].every(i => LORE.includes(factAt(i))), 'rotation always lands on a real fact (any index)')
check(factAt(3) !== factAt(4), 'next fact is a different fact')
check(Array.from({ length: 200 }, () => randomFactIndex()).every(i => i >= 0 && i < LORE.length), 'random start is in range')

console.log(`\nLORE SELFTEST: ${total - failures}/${total} passed`)
process.exit(failures ? 1 : 0)
