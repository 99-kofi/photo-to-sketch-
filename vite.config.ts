import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// Base path can be overridden for GitHub Pages style sub directory hosting:
//   BASE_PATH=/photo-sketch-playground/ npm run build
const BASE_PATH = process.env.BASE_PATH ?? '/';
const ORT_PATTERN = `${BASE_PATH}ort/*`;

// Enables multi-threaded WASM in supporting browsers (Safari has no
// cross-origin isolation yet — the app falls back to numThreads=1).
const CROSS_ORIGIN_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // "credentialless" keeps pure-CORS cross-origin fetches (e.g. the model from
  // the Hugging Face CDN) working while still enabling SharedArrayBuffer.
  // Safari ignores it and falls back to single-threaded WASM gracefully.
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      devOptions: { enabled: true },
      manifest: {
        name: 'Sketch Studio — Photo to Sketch, On-Device',
        short_name: 'Sketch Studio',
        description:
          'Turn photos into line-art sketches entirely on your device. Powered by a U-Net ONNX model running in your browser with ONNX Runtime Web. No uploads, works offline.',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,json}'],
        // Never precache: the 118 MB model (explicit IndexedDB cache) and the
        // large ORT runtime binaries (fetched on first inference and held in
        // the runtime cache below; a duplicate hashed copy is emitted by the
        // bundler and is never requested because the runtime always resolves
        // through wasmPaths=/ort/).
        globIgnores: ['models/**', 'ort/**', '**/ort-wasm-simd-threaded*.wasm'],
        navigateFallback: `${BASE_PATH}index.html`,
        navigateFallbackDenylist: [
          new RegExp(`^${BASE_PATH}ort/`),
          new RegExp(`^${BASE_PATH}models/`),
        ],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        runtimeCaching: [
          {
            // Served from a stable non-hashed URL and cached on first use.
            urlPattern: new RegExp(`${ORT_PATTERN.replace(/\*/g, '.*')}`),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-runtime',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
    // Dev-run fixup for ORT's dynamic imports: importAnalysis unconditionally
    // rewrites *variable* dynamic imports (import(r)) inside served modules to
    // `import(__vite__injectQuery(r, 'import'))`, which appends a `?import`
    // query at runtime. Requests for public/ort/*.mjs then land in the module
    // transform middleware and hard-fail ("should not be imported from source
    // code"). Serve those files raw in the "pre" middleware phase, ignoring the
    // query, so the browser gets a plain ES module it can import.
    {
      name: 'serve-public-ort-raw',
      apply: 'serve',
      configureServer(server) {
        const ortDir = resolve(fileURLToPath(new URL('./public/ort', import.meta.url)));
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0]; // strip ?import / ?t=...
          if (!path.startsWith('/ort/')) return next();
          const target = resolve(join(ortDir, path.slice('/ort/'.length)));
          if (!target.startsWith(ortDir + sep) || extname(target) !== '.mjs') return next();
          if (!existsSync(target)) {
            res.statusCode = 404;
            return res.end('not found');
          }
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(readFileSync(target));
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: CROSS_ORIGIN_HEADERS,
  },
  // ES-module workers: ORT runtime loads its internals with dynamic import(),
  // which requires a module worker context (default is IIFE).
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // ORT must ship as-is: the dep pre-bundler rewrites its dynamic import()
    // of the runtime proxy (public/ort/*.mjs) with ?import, which then fails
    // because public files cannot go through the transform pipeline.
    exclude: ['onnxruntime-web', 'onnxruntime-web/all', 'onnxruntime-web/webgpu'],
  },
  preview: {
    headers: CROSS_ORIGIN_HEADERS,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the (large) ORT glue code out of the initial chunk so first
        // paint is fast; the worker loads it on demand.
        manualChunks(id: string) {
          if (id.includes('onnxruntime-web')) return 'ort';
          return undefined;
        },
      },
    },
  },
});
