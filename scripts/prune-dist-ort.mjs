// Removes the unused hashed ORT .wasm asset the bundler emits. At runtime the
// ORT engine always resolves its runtime binary through wasmPaths=/ort/ (see
// src/worker/engineWorker.ts), so this hashed copy is dead weight in dist.
import { readdirSync, unlinkSync } from 'node:fs';
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
  // public/models ships exactly one file: the committed fp16 model. Drop the
  // dev-only fp32 duplicate from dist.
  try {
    unlinkSync(join(process.cwd(), 'dist', 'models', 'model.onnx'));
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
