/**
 * Typed client for the inference worker.
 */
import type { WorkerRequest, WorkerResponse } from '../worker/engineWorker';

export interface EngineReady {
  backend: string;
  threads: number;
  sessionMs: number;
}

export interface EngineResult {
  sketch: Float32Array;
  side: number;
  backend: string;
  runMs: number;
}

/** Engine failure; `gpuDied` marks a lost/destroyed WebGPU device. */
export interface EngineFailure extends Error {
  gpuDied?: boolean;
}

interface InitWaiter {
  resolve: (r: EngineReady) => void;
  reject: (e: Error) => void;
}

type Backend = 'webgpu' | 'wasm';

function backendOf(preferWebGPU: boolean, force?: Backend): Backend {
  return force ?? (preferWebGPU ? 'webgpu' : 'wasm');
}

export class EngineClient {
  private worker: Worker | null = null;
  private runId = 0;
  private initWaiters: InitWaiter[] = [];
  private initPromise: Promise<EngineReady> | null = null;
  private initBackend: Backend | null = null;
  private pendingRuns = new Map<number, { resolve: (r: EngineResult) => void; reject: (e: Error) => void }>();

  ready: EngineReady | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../worker/engineWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        this.ready = { backend: msg.backend, threads: msg.threads, sessionMs: msg.sessionMs };
        for (const w of this.initWaiters) w.resolve(this.ready);
        this.initWaiters = [];
      } else if (msg.type === 'result') {
        const p = this.pendingRuns.get(msg.id);
        this.pendingRuns.delete(msg.id);
        p?.resolve({ sketch: msg.sketch, side: msg.side, backend: msg.backend, runMs: msg.runMs });
      } else if (msg.type === 'error') {
        const err: EngineFailure = new Error(msg.message);
        if (msg.gpuDied) err.gpuDied = true;
        if (msg.runId != null) {
          const p = this.pendingRuns.get(msg.runId);
          this.pendingRuns.delete(msg.runId);
          p?.reject(err);
        } else {
          // Initialisation failure (fatal) — wake everyone waiting on init.
          for (const w of this.initWaiters) w.reject(err);
          this.initWaiters = [];
        }
        // GPU died mid-life: the session is toast. Recreate the worker so the
        // next use (or the fallback re-init) starts with a clean runtime.
        if (msg.gpuDied) this.reset();
      }
    });
    worker.addEventListener('error', (ev) => {
      const err = new Error(ev.message || 'Inference worker crashed');
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.ready = null;
      for (const w of this.initWaiters) w.reject(err);
      this.initWaiters = [];
      for (const p of this.pendingRuns.values()) p.reject(err);
      this.pendingRuns.clear();
    });
    this.worker = worker;
    return worker;
  }

  /**
   * Creates (or replaces) the session in the worker. Resolves with the
   * backend the worker actually loaded. Concurrent calls are coalesced per
   * backend so a double request cannot create two sessions (or transfer two
   * 62 MB model copies) at once. `force` overrides the automatic WebGPU
   * preference (used when a previous run proved the GPU too heavy).
   */
  init(model: ArrayBuffer, preferWebGPU: boolean, force?: Backend): Promise<EngineReady> {
    const want = backendOf(preferWebGPU, force);
    if (this.ready?.backend === want) return Promise.resolve(this.ready);
    if (this.initPromise) {
      if (this.initBackend === want) return this.initPromise;
      // Queue the different-backend boot behind the one already running.
      return this.initPromise.catch(() => undefined).then(() => this.boot(model, preferWebGPU, force));
    }
    return this.boot(model, preferWebGPU, force);
  }

  private boot(model: ArrayBuffer, preferWebGPU: boolean, force?: Backend): Promise<EngineReady> {
    const want = backendOf(preferWebGPU, force);
    const worker = this.ensureWorker();
    this.ready = null;
    const promise = new Promise<EngineReady>((resolve, reject) => {
      this.initWaiters.push({ resolve, reject });
    });
    this.initPromise = promise;
    this.initBackend = want;
    void promise
      .finally(() => {
        if (this.initPromise === promise) {
          this.initPromise = null;
          this.initBackend = null;
        }
      })
      .catch(() => undefined);
    const req: WorkerRequest = { type: 'init', model, preferWebGPU, ...(force ? { force } : {}) };
    worker.postMessage(req, [model]);
    return promise;
  }

  /** Runs the model on a RGBA buffer copied into the worker. */
  run(rgba: Uint8ClampedArray): Promise<EngineResult> {
    const worker = this.ensureWorker();
    const id = ++this.runId;
    const buf = rgba.slice().buffer; // private copy — the caller keeps its crop
    const promise = new Promise<EngineResult>((resolve, reject) => {
      this.pendingRuns.set(id, { resolve, reject });
    });
    const req: WorkerRequest = { type: 'run', id, rgba: buf };
    worker.postMessage(req, [buf]);
    return promise;
  }

  /**
   * Tears the worker down after a GPU death and rejects anything still in
   * flight. Without this, a concurrent run/init promise would never settle
   * and the UI would stay stuck in "generating".
   */
  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    const err: EngineFailure = Object.assign(
      new Error('The inference engine restarted after a GPU failure.'),
      { gpuDied: true },
    );
    for (const w of this.initWaiters) w.reject(err);
    this.initWaiters = [];
    for (const p of this.pendingRuns.values()) p.reject(err);
    this.pendingRuns.clear();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const w of this.initWaiters) w.reject(new Error('Engine disposed'));
    this.initWaiters = [];
    for (const p of this.pendingRuns.values()) p.reject(new Error('Engine disposed'));
    this.pendingRuns.clear();
  }
}
