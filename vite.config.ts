import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Published as a GitHub Pages PROJECT site (https://<user>.github.io/sandoq-almashrou/),
// so every absolute path needs this prefix instead of "/". Override with
// BASE_PATH="/" for local dev/preview at the root if ever needed.
const base = process.env.BASE_PATH ?? '/sandoq-almashrou/'

// Shown on the settings screen so "which version am I on?" has an answer:
// when it was built (Cairo time) and from which commit.
function appVersion(): string {
  if (process.env.APP_VERSION_LABEL) return process.env.APP_VERSION_LABEL
  let commit = process.env.GITHUB_SHA ?? ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      commit = 'local'
    }
  }
  const builtAt = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })
  return `${builtAt} · ${commit.slice(0, 7)}`
}

// https://vite.dev/config/
export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version downloads in the background and then WAITS: the one
      // on screen keeps working from its own files until src/pwa.ts tells
      // the new one to take over and reloads the page onto it. (Taking over
      // behind an open page would pull its lazily-loaded parts — the Excel
      // and PDF exporters — out from under it.)
      registerType: 'prompt',
      // Registered by src/pwa.ts, which also looks for a new version
      // whenever the app comes back to the front.
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        id: base,
        name: 'صندوق المشروع - إدارة الممولين والمصروفات',
        short_name: 'صندوق المشروع',
        description: 'تطبيق محلي لإدارة صندوق مشروع: ممولين، بنود مصروفات، تقارير',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: `${base}index.html`,
        // First install only: work offline from the first visit, not the second.
        clientsClaim: true,
      },
    }),
  ],
})
