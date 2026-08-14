import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (instead of generateSW) so the service worker can be
      // hand-written to also handle Web Push `push` / `notificationclick`
      // events — generateSW only lets Workbox generate caching logic, with
      // no hook for custom event listeners. See src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
      },
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'mstile-150x150.png',
      ],
      manifest: {
        name: 'SocialPilot AI',
        short_name: 'SocialPilot',
        description: 'منصة ذكية لإدارة وجدولة المحتوى عبر حسابات التواصل الاجتماعي',
        id: '/app/dashboard',
        start_url: '/app/dashboard',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        lang: 'ar',
        dir: 'rtl',
        background_color: '#ffffff',
        theme_color: '#0d1222',
        categories: ['business', 'productivity', 'social'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Runtime caching (google fonts, network-only for Supabase), precache
      // injection point (self.__WB_MANIFEST), and the offline navigation
      // fallback all live directly in src/sw.ts now — under the
      // injectManifest strategy, only `injectManifest.globPatterns` (above)
      // is configured here; generateSW's declarative `workbox:` options
      // don't apply.
      // Keep the service worker inactive during `vite dev`; test it via `npm run build && npm run preview`.
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
