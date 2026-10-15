/**
 * Saves each member's SoundCloud avatar address in src/data/avatars.json, so
 * the site shows them right away without waiting for the converter API.
 * Runs on its own before every build (npm "prebuild"); run it by hand with
 * `npm run avatars`. If SoundCloud can't be reached, the last saved addresses
 * stay and the build goes on: this script never fails the build.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const COLLECTIVE = new URL('../src/data/collective.ts', import.meta.url)
const OUT = new URL('../src/data/avatars.json', import.meta.url)

const source = readFileSync(COLLECTIVE, 'utf8')
const members = [...source.matchAll(/\{\s*id:\s*'([^']+)'[^\n]*?profileUrl:\s*'([^']+)'/g)].map(([, id, url]) => ({ id, url }))
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}

async function avatarOf(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json()
    const thumb = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : ''
    // Only real avatar images on SoundCloud's image CDN, over https.
    return /^https:\/\/[a-z0-9-]+\.sndcdn\.com\/[^\s"'<>]+$/i.test(thumb) ? thumb : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const results = await Promise.all(members.map(async member => [member.id, await avatarOf(member.url)]))
const next = {}
let fresh = 0
for (const [id, avatar] of results) {
  if (avatar) { next[id] = avatar; fresh += 1 } else if (previous[id]) next[id] = previous[id]
}
writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n')
console.log(`SoundCloud avatars: ${fresh}/${members.length} updated, ${Object.keys(next).length} saved.`)
