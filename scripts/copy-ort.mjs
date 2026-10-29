// Copies the ONNX Runtime Web runtime files (.mjs / .wasm) we need into
// public/ort/ so they are served same-origin, hash-stable and easily
// precached by the service worker for offline use.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)); // scripts/
const projectRoot = join(root, '..');
const dist = join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
const out = join(projectRoot, 'public', 'ort');

const files = [
  // WebAssembly (CPU) execution provider — the always-works fallback.
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  // JSEP — required for the optional WebGPU acceleration.
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  // The full `onnxruntime-web/all` bundle. The app imports THIS copy at
  // runtime (`import(${RUNTIME_PATH}ort.all.bundle.min.mjs)`) instead of
  // bundling it: exported EM modules load their internals with dynamic
  // import()/blob URLs that must never be rewritten by bundler dev tools.
  'ort.all.bundle.min.mjs',
];

mkdirSync(out, { recursive: true });

// Keep ORT's build hash in a marker so stale copies get refreshed.
try {
  for (const file of files) copyFileSync(join(dist, file), join(out, file));
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8'));
  writeFileSync(join(out, 'version.json'), JSON.stringify({ version: pkg.version }, null, 2));
  console.log(`[copy-ort] copied runtime files for onnxruntime-web ${pkg.version}`);
} catch (err) {
  console.error('[copy-ort] failed to copy runtime files — run `npm install` first?', err);
  process.exitCode = 1;
}
