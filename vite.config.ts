import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // public address of the site for the share image (Docker passes it at build time).
  const siteUrl = (loadEnv(mode, '.', 'VITE_').VITE_SITE_URL ?? '').replace(/\/$/, '')
  return {
    plugins: [
      react(),
      { name: '4ever-site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl) },
    ],
    server: {
      proxy: { '/api': 'http://localhost:8000' }, host: true, port: 4173 },
  }
})
