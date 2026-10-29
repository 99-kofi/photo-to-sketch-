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
      sha: string;
      backend: string;
      runMs: number;
    }
  | {
      type: 'error';
      message: string;
      fatal: boolean;
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

function report(message: string, fatal: boolean, ev: unknown, runId?: number) {
  const detail = ev instanceof Error ? ev.message : typeof ev === 'string' ? ev : '';
  w.postMessage({ type: 'error', message: detail ? `${message}: ${detail}` : message, fatal, ...(runId !== undefined ? { runId } : {}) });
}

async function init(req: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
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

    const wantWebGPU = req.preferWebGPU && typeof (navigator as { gpu?: unknown }).gpu !== 'undefined';

    const trySession = async (eps: string[]) =>
      await runtime.InferenceSession.create(req.model, {
        executionProviders: eps,
        graphOptimizationLevel: 'all',
      });

    if (wantWebGPU) {
      try {
        session = await trySession(['webgpu']);
        activeBackend = 'webgpu';
      } catch (err) {
        report('WebGPU session failed — falling back to WASM', false, err);
        session = null;
      }
    }
    if (session == null) {
      session = await trySession(['wasm']);
      activeBackend = 'wasm';
    }
    w.postMessage({
      type: 'ready',
      backend: activeBackend,
      threads: threads(),
      sessionMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    report('Could not create the inference session', true, err);
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
    const outputs = await session.run({ [MODEL_INPUT]: input });
    const elapsed = Math.round(performance.now() - t0);
    const out = outputs[MODEL_OUTPUT];
    const data = out.data as Float32Array;
    const side = out.dims[2] ?? MODEL_TILE;
    // Trim to a single channel if the model ever returns batch 1 dims [1,1,N,N].
    const sketch = data.length === side * side ? data : data.slice(0, side * side);
    w.postMessage(
      {
        type: 'result',
        id: req.id,
        sketch,
        sha: `${side}`,
        backend: activeBackend,
        runMs: elapsed,
      },
      [sketch.buffer],
    );
  } catch (err) {
    report('Inference failed', false, err, req.id);
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
