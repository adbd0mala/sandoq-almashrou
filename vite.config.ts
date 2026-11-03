import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Published as a GitHub Pages PROJECT site (https://<user>.github.io/sandoq-almashrou/),
// so every absolute path needs this prefix instead of "/". Override with
// BASE_PATH="/" for local dev/preview at the root if ever needed.
const base = process.env.BASE_PATH ?? '/sandoq-almashrou/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
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
      },
    }),
  ],
})
