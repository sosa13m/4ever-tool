/**
 * Where the converter API lives.
 *
 * Same server (local dev, Docker/VPS): leave VITE_API_URL empty and every call
 * goes to /api on this site. Separate host (web on Vercel, API on Render): set
 * VITE_API_URL to the API's address, e.g. https://4ever-tool-api.onrender.com
 */
// import.meta.env only exists in Vite builds; the Node self-tests run without it.
const env = (import.meta.env ?? {}) as Record<string, string | undefined>
export const API_BASE = String(env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')

/** Full URL for an API path such as "/api/ready". */
export const apiUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${API_BASE}${path}`)
