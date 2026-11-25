/// <reference lib="WebWorker" />
/**
 * Inference worker. Keeps ORT (and its 118 MB session) off the main thread so
 * the UI stays responsive while the sketch is generating.
 */
import type * as OrtNs from 'onnxruntime-web/all';
import {
  MODEL_INPUT,
  MODEL_INPUT_DIMS,
  MODEL_OUTPUT,
  MODEL_TILE,
  RUNTIME_PATH,
} from '../lib/modelConfig';

export type WorkerRequest =
  | {
      type: 'init';
      model: ArrayBuffer;
      preferWebGPU: boolean;
      /** Optional explicit backend override (used after GPU failures). */
      force?: 'webgpu' | 'wasm';
    }
  | {
      type: 'run';
      id: number;
      rgba: ArrayBuffer; // Uint8ClampedArray underlying buffer, MODEL_TILE^2 * 4 bytes
    };

export type WorkerResponse =
  | {
      type: 'ready';
      backend: string;
      threads: number;
      sessionMs: number;
    }
  | {
      type: 'result';
      id: number;
      sketch: Float32Array;
      side: number;
      backend: string;
      runMs: number;
    }
  | {
      type: 'error';
      message: string;
      fatal: boolean;
      /** Classified GPU failure — the client should restart with WASM. */
      gpuDied?: boolean;
      runId?: number;
    };

let session: OrtNs.InferenceSession | null = null;
let activeBackend = '';
let ort: typeof OrtNs | null = null;

const w = self as unknown as {
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
  addEventListener: (t: 'message', fn: (ev: MessageEvent<WorkerRequest>) => void) => void;
  crossOriginIsolated: boolean;
};

function threads(): number {
  // ORT's emscripten pthread path deadlocks at session creation for any
  // numThreads >= 2 (the blob-URL re-entry of the shared proxy worker never
  // completes its handshake). Single-threaded WASM works reliably, and the
  // WebGPU execution provider doesn't schedule on CPU threads at all — so
  // threads=1 until the runtime's threaded loading is proven to work.
  // Cross-origin isolation is still enabled via COOP/COEP headers so WebGPU
  // and SharedArrayBuffer remain available for a future implementation --
  return 1;
}

function toChwFloat32(rgba: Uint8ClampedArray): Float32Array {
  const n = MODEL_TILE * MODEL_TILE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // RGB [0,1], channel-first (3,H,W) — matches the model card.
    out[i] = rgba[o] / 255;
    out[n + i] = rgba[o + 1] / 255;
    out[2 * n + i] = rgba[o + 2] / 255;
  }
  return out;
}

function report(
  message: string,
  fatal: boolean,
  ev: unknown,
  runId?: number,
  gpuDied = false,
) {
  const detail = ev instanceof Error ? ev.message : typeof ev === 'string' ? ev : '';
  w.postMessage({
    type: 'error',
    message: detail ? `${message}: ${detail}` : message,
    fatal,
    ...(gpuDied ? { gpuDied: true } : {}),
    ...(runId !== undefined ? { runId } : {}),
  });
}

/**
 * Classifies the runtime failures that indicate the GPU execution provider is
 * no longer usable (WebGPU device lost / process killed mid-run). Those must
 * route back to the CPU backend instead of bricking the engine.
 */
function isGpuDeath(err: unknown): boolean {
  const m = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err);
  // `-webgpu-|ERR` in the original pattern was an escaped literal pipe, not an
  // alternation — it never matched. Also catch the allocation failures that
  // precede a real device loss on memory-constrained GPUs.
  return /mapAsync|device (?:was )?lost|device destroyed|GPUBuffer|-webgpu-|out of memory|failed to allocate/i.test(m);
}

/** Monotonic init counter: a superseded init must not publish its session. */
let initGeneration = 0;

async function init(req: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  const gen = ++initGeneration;
  const t0 = performance.now();
  try {
    if (ort == null) {
      // Load ORT's prebuilt bundle straight from the static runtime directory
      // instead of importing it through the bundler pipeline. ORT loads its
      // internals with runtime-composed dynamic import()s and blob-URL
      // workers that must never be rewritten (dev tools append `?import`
      // queries which break both the static and the threaded loading paths).
      // The static /ort/ copy behaves identically in dev and production.
      ort = (await import(/* @vite-ignore */ `${RUNTIME_PATH}ort.all.bundle.min.mjs`)) as typeof OrtNs;
    }
    const runtime = ort; // narrowed non-null for the closures below
    runtime.env.wasm.wasmPaths = RUNTIME_PATH;
    runtime.env.wasm.numThreads = threads();
    runtime.env.logLevel = 'warning';
    if (gen !== initGeneration) return; // a newer init arrived while importing

    // Backend selection: explicit force override wins, then prefer flag.
    const requested: 'webgpu' | 'wasm' = req.force ?? (req.preferWebGPU ? 'webgpu' : 'wasm');
    const wantWebGPU = requested === 'webgpu' && typeof (navigator as { gpu?: unknown }).gpu !== 'undefined';

    const trySession = async (eps: string[]) =>
      await runtime.InferenceSession.create(req.model, {
        executionProviders: eps,
        graphOptimizationLevel: 'all',
      });

    let created: OrtNs.InferenceSession | null = null;
    let backend = 'wasm';
    if (wantWebGPU) {
      try {
        created = await trySession(['webgpu']);
        backend = 'webgpu';
      } catch (err) {
        report('WebGPU session failed — falling back to WASM', false, err);
        created = null;
      }
    }
    if (created == null) {
      created = await trySession(['wasm']);
      backend = 'wasm';
    }

    if (gen !== initGeneration) {
      // Superseded meanwhile: release the session we just built and stay quiet.
      try {
        await created.release();
      } catch {
        /* already gone */
      }
      return;
    }
    // Never keep two sessions resident — each one pins ~60 MB (more on GPU).
    if (session != null) {
      try {
        await session.release();
      } catch {
        /* best-effort */
      }
    }
    session = created;
    activeBackend = backend;
    w.postMessage({
      type: 'ready',
      backend: activeBackend,
      threads: threads(),
      sessionMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    if (gen === initGeneration) report('Could not create the inference session', true, err);
  }
}

async function run(req: Extract<WorkerRequest, { type: 'run' }>): Promise<void> {
  if (session == null || ort == null) {
    w.postMessage({ type: 'error', message: 'Engine not initialised — reload the page.', fatal: true });
    return;
  }
  try {
    const rgba = new Uint8ClampedArray(req.rgba);
    const input = new ort.Tensor('float32', toChwFloat32(rgba), [...MODEL_INPUT_DIMS]);
    const t0 = performance.now();
    let outputs: OrtNs.InferenceSession.ReturnType | null = null;
    try {
      outputs = await session.run({ [MODEL_INPUT]: input });
      const elapsed = Math.round(performance.now() - t0);
      const out = outputs[MODEL_OUTPUT];
      const data = out.data as Float32Array;
      const side = out.dims[2] ?? MODEL_TILE;
      // Always copy: the buffer is transferred to the main thread, and the
      // ORT tensor (possibly GPU-backed) must be releasable afterwards.
      const sketch = data.slice(0, side * side);
      w.postMessage(
        {
          type: 'result',
          id: req.id,
          sketch,
          side,
          backend: activeBackend,
          runMs: elapsed,
        },
        [sketch.buffer],
      );
    } finally {
      // Tensors returned by run() are owned by the caller. Without disposing
      // them every run leaks a GPU/WASM buffer — eventually the WebGPU device
      // is lost to memory pressure. This is what feeds the low-memory path.
      if (outputs != null) {
        for (const tensor of Object.values(outputs)) {
          try {
            tensor.dispose();
          } catch {
            /* already released */
          }
        }
      }
      try {
        input.dispose();
      } catch {
        /* already released */
      }
    }
  } catch (err) {
    // GPU failures are recoverable: mark them so the client restarts us on
    // the CPU backend. Everything else is a normal run error.
    if (activeBackend === 'webgpu' && isGpuDeath(err)) session = null;
    report('Inference failed', false, err, req.id, activeBackend === 'webgpu' && isGpuDeath(err));
  }
}

w.addEventListener('message', (ev) => {
  const req = ev.data as WorkerRequest;
  if (req.type === 'init') {
    void init(req);
  } else if (req.type === 'run') {
    void run(req);
  }
});

// If the GPU dies asynchronously (device-lost handlers firing outside an
// awaited session.run), tell the client before the module goes quiet —
// otherwise the only symptom is a hung or reload-crashed page.
self.addEventListener('unhandledrejection', (ev) => {
  const reason = (ev as PromiseRejectionEvent & { reason?: unknown }).reason;
  if (activeBackend === 'webgpu' && isGpuDeath(reason)) {
    report('WebGPU device was lost', false, reason, undefined, true);
    session = null;
  }
});
