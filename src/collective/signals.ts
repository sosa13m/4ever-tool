/** Hidden member signals the visitor has found (typing an alias, or tapping a sigil). */
const KEY = '4ever-signals-found'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function local(): StorageLike | null {
  try { return window.localStorage } catch { return null }
}

export function loadFoundSignals(store: StorageLike | null = local()): string[] {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Returns the new list; `isNew` is false when it was already found. */
export function markSignalFound(id: string, store: StorageLike | null = local()): { found: string[]; isNew: boolean } {
  const found = loadFoundSignals(store)
  if (found.includes(id)) return { found, isNew: false }
  const next = [...found, id]
  try { store?.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: found for this visit only */ }
  return { found: next, isNew: true }
}

/** Taps on a member's sigil needed to find their signal on a phone (no keyboard). */
export const SIGIL_TAPS = 5
