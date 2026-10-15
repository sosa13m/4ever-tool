/**
 * Member photos dropped into src/assets/collective/<id>.webp|jpg|png are found
 * automatically by Vite (hashed, cached, optimised like any other asset).
 */
const files = import.meta.glob<string>('../assets/collective/*.{webp,png,jpg,jpeg,avif}', { eager: true, import: 'default' })

export const memberPhotos: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase(), url]),
)
