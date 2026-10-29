// Removes the unused hashed ORT .wasm asset the bundler emits. At runtime the
// ORT engine always resolves its runtime binary through wasmPaths=/ort/ (see
// src/worker/engineWorker.ts), so this hashed copy is dead weight in dist.
import { readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist', 'assets');
let removed = 0;
try {
  for (const file of readdirSync(dist)) {
    if (file.startsWith('ort-wasm-simd-threaded') && file.endsWith('.wasm')) {
      unlinkSync(join(dist, file));
      removed++;
    }
  }
  // public/models is dev-only; never ship the 118 MB duplicate in dist.
  try {
    rmSync(join(process.cwd(), 'dist', 'models'), { recursive: true, force: true });
    removed++;
  } catch {
    /* not present */
  }
  console.log(`[prune-ort] removed ${removed} item(s) from dist (hashed ORT asset + dev model copy)`);
} catch (err) {
  if (err?.code !== 'ENOENT') {
    console.error('[prune-ort] failed', err);
    process.exitCode = 1;
  }
}
