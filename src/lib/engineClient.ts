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

interface InitWaiter {
  resolve: (r: EngineReady) => void;
  reject: (e: Error) => void;
}

export class EngineClient {
  private worker: Worker | null = null;
  private runId = 0;
  private initWaiters: InitWaiter[] = [];
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
        p?.resolve({ sketch: msg.sketch, side: Number(msg.sha), backend: msg.backend, runMs: msg.runMs });
      } else if (msg.type === 'error') {
        const err = new Error(msg.message);
        if (msg.runId != null) {
          const p = this.pendingRuns.get(msg.runId);
          this.pendingRuns.delete(msg.runId);
          p?.reject(err);
        } else {
          // Initialisation failure (fatal) — wake everyone waiting on init.
          for (const w of this.initWaiters) w.reject(err);
          this.initWaiters = [];
        }
      }
    });
    worker.addEventListener('error', (ev) => {
      const err = new Error(ev.message || 'Inference worker crashed');
      for (const w of this.initWaiters) w.reject(err);
      this.initWaiters = [];
      for (const p of this.pendingRuns.values()) p.reject(err);
      this.pendingRuns.clear();
      this.worker = null;
      this.ready = null;
    });
    this.worker = worker;
    return worker;
  }

  /**
   * Creates (or replaces) the session in the worker. Resolves with backend
   * info. Always resolves with the backend that the worker actually loaded.
   */
  init(model: ArrayBuffer, preferWebGPU: boolean): Promise<EngineReady> {
    const worker = this.ensureWorker();
    this.ready = null;
    const promise = new Promise<EngineReady>((resolve, reject) => {
      this.initWaiters.push({ resolve, reject });
    });
    const req: WorkerRequest = { type: 'init', model, preferWebGPU };
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
