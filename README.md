# Sketch Studio — Photo to Sketch, On-Device

An interactive playground for [`Willie999/photo-to-sketch-onnx`](https://huggingface.co/Willie999/photo-to-sketch-onnx):
turn photos into line-art sketches **entirely on your device**. Nothing is uploaded —
images never leave the browser.

The model is a U-Net (opset 17) taking a `1×3×256×256` RGB image scaled to `[0,1]`
and outputting a `1×1×256×256` sigmoid confidence map rendered as an artistic sketch.

## Features

- **01 · Model setup** — one-time 118 MB download from the Hugging Face CDN with a
  progress indicator, **resumable** partial downloads and SHA-256 verification, cached
  in IndexedDB. Shows storage usage; asks for persistent storage.
- **02 · Image workspace** — pick from gallery, drag & drop on desktop, live camera
  capture, or three built-in sample scenes. Preview shows exactly the centre square
  crop the model will see.
- **03 · Generate** — inference runs off the main thread in a Web Worker via
  [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (WASM first, optional
  WebGPU). Elapsed time display while running.
- **04 · Results studio** — draggable before/after slider, side-by-side view, pan/zoom,
  curve-strength and output-style controls (paper / transparent ink), PNG export at
  1×/2×/4× and Web Share on mobile.
- **05 · Device diagnostics** — runtime/backend, threads, inference time, storage,
  network state and "100% on-device" confirmation.
- **06 · Offline** — PWA with a precached app shell; the model lives in IndexedDB and
  the runtime binaries in a cache-first runtime cache. After first setup everything
  works in airplane mode.

## Tech

| Component | Choice |
| --- | --- |
| Frontend | React 19 + Vite + TypeScript |
| AI inference | ONNX Runtime Web 1.31 (`onnxruntime-web/all`) |
| Default runtime | WebAssembly (SIMD; multithreaded when cross-origin isolated) |
| Acceleration | WebGPU when available (falls back automatically) |
| Offline | PWA (`vite-plugin-pwa`) + IndexedDB + Cache Storage |
| Hosting | Vercel (`vercel.json` included) or GitHub Pages (workflow included) |

## Development

```bash
npm install
npm run dev        # serves on http://localhost:5173
```

In dev the model is loaded from `public/models/model.onnx` if you place a copy there
(see `.gitignore`), otherwise it downloads from the CDN. Runtime binaries are copied
to `public/ort/` by `scripts/copy-ort.mjs` (runs on `predev`/`prebuild`).

```bash
npm run build      # type-check, build, generate sw.js + manifest
npm run preview    # production preview with cross-origin isolation headers
```

## Deployment

- **Vercel** — import the repo; `vercel.json` sends `COOP/COEP: credentialless`
  headers so Safari/iOS stays fully functional and desktop Chrome gets
  multi-threaded WASM.
- **GitHub Pages** — the included workflow deploys to `/photo-sketch-playground/`
  via `BASE_PATH=`. Since Pages cannot set isolation headers the app runs
  single-threaded WASM there (still fully functional).

## Privacy

All processing is local: the photo is drawn into a `<canvas>`, preprocessed into a
tensor and fed to an in-browser session. There is no backend, no accounts and no
telemetry. The only network activity is the one-time model download.
