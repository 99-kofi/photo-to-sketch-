import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelSetup } from './components/ModelSetup';
import { Workspace } from './components/Workspace';
import { ResultsStudio } from './components/ResultsStudio';
import { Diagnostics } from './components/Diagnostics';
import { Toasts } from './components/Toasts';
import { useToasts } from './hooks/useToasts';
import { EngineClient, type EngineReady } from './lib/engineClient';
import { prepareImage, detectOrientation, type RenderOptions } from './lib/imageTools';
import {
  downloadModel,
  getModelBuffer,
  getModelMeta,
  deleteModel,
} from './lib/modelStore';
import type { DiagnosticsData, ModelState, SketchResult, SourceImageState } from './lib/types';
import { MODEL_SIZE } from './lib/modelConfig';
import { initInstallCapture, onInstallable, promptInstall } from './lib/installPrompt';

const DEFAULT_RENDER: RenderOptions = { flip: true, strength: 100, mode: 'paper' };

/** Persisted backend override (native CryptoKeys-free LocalStorage contract). */
const BACKEND_KEY = 'sketch.backend';
/** Written when a generation starts, removed when it completes. */
const LAST_GEN_KEY = 'sketch.lastGen';

/** Sections reachable from the sticky menu. Each tab renders only its card. */
type MenuTab = 'workspace' | 'setup' | 'results' | 'diag';

export default function App() {
  const { toasts, push, dismiss } = useToasts();

  /* ---------------- model setup state ---------------- */

  const [modelState, setModelState] = useState<ModelState>({ stage: 'checking' });
  const [persisted, setPersisted] = useState(false);
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);

  /* ---------------- install-as-app (add to home screen) ---------------- */

  const [installable, setInstallable] = useState(false);
  const install = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === 'unavailable') {
      push('Your browser does not expose an install prompt — use the browser menu → “Install app”.', 'info');
    }
  }, [push]);
  useEffect(() => {
    const stopCapture = initInstallCapture();
    const stopSubscribe = onInstallable(setInstallable);
    return () => {
      stopCapture();
      stopSubscribe();
    };
  }, []);

  /* ---------------- workspace state ---------------- */

  const [image, setImage] = useState<SourceImageState | null>(null);
  const [result, setResult] = useState<SketchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER);

  /* ---------------- section menu ---------------- */

  const [tab, setTab] = useState<MenuTab>('setup');
  // One-time routing once the model cache check settles: land on the
  // workspace if the model is usable, on setup if it still needs a download.
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || modelState.stage === 'checking') return;
    routed.current = true;
    setTab(modelState.stage === 'ready' ? 'workspace' : 'setup');
  }, [modelState.stage]);
  // Results become unreachable without a photo + sketch — fall back to the
  // workspace where a new one can be created.
  useEffect(() => {
    if (tab === 'results' && !(result && image)) setTab('workspace');
  }, [tab, result, image]);

  /* ---------------- crash recovery ---------------- */

  // If a previous page life crashed during generation, the tab died before it
  // could clean up: `sketch.lastGen` survives the reload, a completed run
  // erases it. On boot we treat a fresh marker as a renderer crash (the GPU
  // engine exceeding this device's memory) and pin the safe CPU engine.
  useEffect(() => {
    const last = Number(localStorage.getItem(LAST_GEN_KEY));
    localStorage.removeItem(LAST_GEN_KEY);
    if (last && Date.now() - last < 120_000) {
      localStorage.setItem(BACKEND_KEY, 'wasm');
      push('Recovered after a memory crash — switching to the low-memory CPU engine.', 'info');
    }
  }, [push]);

  /* ---------------- environment state ---------------- */

  const [swActive, setSwActive] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);
  const [crossOriginIsolated, setCrossOriginIsolated] = useState(false);
  const [engineReady, setEngineReady] = useState<EngineReady | null>(null);
  const engineRef = useRef<EngineClient | null>(null);

  /* ---------------- environment probes ---------------- */

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready
        .then(() => setSwActive(true))
        .catch(() => undefined);
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    type NavWithGpu = Navigator & { gpu?: unknown };
    const nav = navigator as NavWithGpu;
    setWebgpuAvailable(typeof nav.gpu !== 'undefined');
    setCrossOriginIsolated(typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated);
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      if (navigator.storage?.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        setStorageUsage(usage ?? null);
        setStorageQuota(quota ?? null);
      }
      if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
    } catch {
      /* estimates unavailable — diagnostics simply show dashes */
    }
  }, []);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage, modelState.stage]);

  /* ---------------- model lifecycle ---------------- */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const meta = await getModelMeta();
      const buffer = meta ? await getModelBuffer() : null;
      if (!alive) return;
      if (meta && buffer) {
        setModelState({ stage: 'ready', meta });
      } else {
        setModelState({ stage: 'missing' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const runDownload = useCallback(async () => {
    if (!('indexedDB' in window)) {
      setModelState({ stage: 'error', message: 'This browser has no IndexedDB — the model cannot be cached.' });
      return;
    }
    setModelState({ stage: 'downloading', received: 0, total: MODEL_SIZE, error: null });
    try {
      await downloadModel((p) => {
        setModelState({ stage: 'downloading', received: p.received, total: p.total, error: null });
      });
      const meta = await getModelMeta();
      if (meta) setModelState({ stage: 'ready', meta });
      push('Model downloaded — ready for offline use ✓', 'success');
      void refreshStorage();
    } catch (err) {
      const message = (err as Error).message;
      // An older fully-valid model may still be cached — keep it usable.
      const kept = await getModelMeta();
      const buffer = kept ? await getModelBuffer() : null;
      if (kept && buffer) {
        setModelState({ stage: 'ready', meta: kept });
        push(`Download failed (${message}) — a cached model stays in use.`, 'info');
      } else {
        setModelState({ stage: 'error', message });
      }
    }
  }, [push, refreshStorage]);

  const removeModel = useCallback(async () => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setEngineReady(null);
    await deleteModel();
    setModelState({ stage: 'missing' });
    push('Model removed from this device.', 'info');
    void refreshStorage();
  }, [push, refreshStorage]);

  /* ---------------- engine + inference ---------------- */

  /** Boots (or re-targets) the inference worker for the chosen backend. */
  const ensureEngine = useCallback(
    async (preferWebGPU: boolean, force?: 'webgpu' | 'wasm'): Promise<EngineClient> => {
      const buffer = await getModelBuffer();
      if (!buffer) throw new Error('The sketch model is not installed yet — download it under “Model setup” first.');

      // Backend selection: explicit force > persisted pin (after GPU crashes)
      // > runtime preference.
      const wantBackend: 'webgpu' | 'wasm' =
        force ?? (localStorage.getItem(BACKEND_KEY) === 'wasm' ? 'wasm' : preferWebGPU && webgpuAvailable ? 'webgpu' : 'wasm');

      // Replace the worker when the loaded backend no longer matches.
      const current = engineRef.current;
      if (current && current.ready && current.ready.backend !== wantBackend) {
        current.dispose();
        engineRef.current = null;
      }
      const client = engineRef.current ?? (engineRef.current = new EngineClient());

      if (client.ready && client.ready.backend === wantBackend) return client;
      const info = await client.init(buffer, wantBackend === 'webgpu', wantBackend);
      setEngineReady(info);
      return client;
    },
    [webgpuAvailable],
  );

  const revokePreview = useCallback((state: SourceImageState | null) => {
    if (state && state.previewUrl.startsWith('blob:')) URL.revokeObjectURL(state.previewUrl);
  }, []);

  const clearImage = useCallback(() => {
    setImage((prev) => {
      revokePreview(prev);
      return null;
    });
    setResult(null);
  }, [revokePreview]);

  const handlePick = useCallback(
    async (source: Blob | ImageBitmap, name: string) => {
      try {
        const prepared = await prepareImage(source, name);
        let previewUrl: string;
        if (source instanceof Blob) {
          previewUrl = URL.createObjectURL(source);
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          canvas.getContext('2d')!.drawImage(source, 0, 0);
          previewUrl = canvas.toDataURL('image/png');
        }
        setImage((prev) => {
          revokePreview(prev);
          return { prepared, previewUrl, name };
        });
        setResult(null);
      } catch (err) {
        push(`Could not load that image: ${(err as Error).message}`, 'error');
      }
    },
    [push, revokePreview],
  );

  const generate = useCallback(async () => {
    if (!image || running) return;
    setRunning(true);
    setElapsedMs(0);
    const started = performance.now();
    const timer = window.setInterval(() => setElapsedMs(Math.round(performance.now() - started)), 100);
    // Marker for the crash-recovery effect: a page death during this window
    // (renderer OOM under the GPU engine) is detected and pinned to WASM on
    // next launch. Cleared on success and on failure below.
    localStorage.setItem(LAST_GEN_KEY, String(Date.now()));
    try {
      const engine = await ensureEngine(true);
      const res = await engine.run(image.prepared.cropRgba);
      const flipAuto = detectOrientation(res.sketch, res.side);
      setRenderOptions((o) => ({ ...o, flip: flipAuto }));
      setResult({ sketch: res.sketch, side: res.side, run: { backend: res.backend, runMs: res.runMs, at: Date.now() } });
      localStorage.removeItem(LAST_GEN_KEY);
      setTab('results'); // jump straight to the fresh sketch
    } catch (err) {
      const message = (err as Error).message;
      // A dead/failing GPU engine downgrades permanently to the CPU engine —
      // once per session it silently retries there.
      if (engineRef.current?.ready?.backend === 'webgpu') {
        engineRef.current.dispose();
        engineRef.current = null;
        localStorage.setItem(BACKEND_KEY, 'wasm');
        push('The GPU engine hit a memory limit — retrying on the CPU engine.', 'info');
        try {
          const cpuEngine = await ensureEngine(false, 'wasm');
          const res = await cpuEngine.run(image.prepared.cropRgba);
          const flipAuto = detectOrientation(res.sketch, res.side);
          setRenderOptions((o) => ({ ...o, flip: flipAuto }));
          setResult({ sketch: res.sketch, side: res.side, run: { backend: res.backend, runMs: res.runMs, at: Date.now() } });
          localStorage.removeItem(LAST_GEN_KEY);
          setTab('results');
        } catch (err2) {
          localStorage.removeItem(LAST_GEN_KEY);
          push(`Generation failed: ${(err2 as Error).message}`, 'error');
        }
      } else {
        localStorage.removeItem(LAST_GEN_KEY);
        push(`Generation failed: ${message}`, 'error');
      }
    } finally {
      window.clearInterval(timer);
      setRunning(false);
    }
  }, [image, running, ensureEngine, push]);

  /* ---------------- derived diagnostics ---------------- */

  const diagnostics: DiagnosticsData = {
    online,
    swActive,
    storageQuota,
    storageUsage,
    persisted,
    modelMeta: modelState.stage === 'ready' ? modelState.meta : null,
    engine: {
      status: engineReady ? 'ready' : 'idle',
      info: engineReady,
      error: null,
    },
    lastRun: result?.run ?? null,
    webgpuAvailable,
    crossOriginIsolated,
  };
  const offlineReady = swActive && modelState.stage === 'ready';

  return (
    <div className="app">
      <Toasts toasts={toasts} onDismiss={dismiss} />
      <header className="hero">
        <h1>
          Sketch<span className="hero__accent"> Studio</span>
        </h1>
        <p className="hero__sub">
          Sketch any photo — runs on your device: nothing uploaded, works offline.
        </p>
        <div className="hero__badges">
          <span className="badge">{online ? '● online' : '○ offline'}</span>
          <span className={`badge ${swActive ? 'badge--ok' : ''}`}>{swActive ? 'PWA cached ✓' : 'caching…'}</span>
          {engineReady && <span className="badge badge--ok">{engineReady.backend.toUpperCase()}</span>}
        </div>
      </header>

      <nav className="menu" aria-label="Sections">
        <button
          type="button"
          className={`menu__btn${tab === 'workspace' ? ' menu__btn--on' : ''}`}
          onClick={() => setTab('workspace')}
        >
          Image workspace
        </button>
        <button
          type="button"
          className={`menu__btn${tab === 'setup' ? ' menu__btn--on' : ''}`}
          onClick={() => setTab('setup')}
        >
          <span
            className={
              'menu__dot' +
              (modelState.stage === 'ready'
                ? ' menu__dot--ok'
                : modelState.stage === 'error'
                  ? ' menu__dot--err'
                  : '')
            }
          />
          Setup
        </button>
        <button
          type="button"
          className={`menu__btn${tab === 'results' ? ' menu__btn--on' : ''}`}
          disabled={!result || !image}
          onClick={() => setTab('results')}
        >
          <span className={`menu__dot${result ? ' menu__dot--ok' : ''}`} />
          Results
        </button>
        <button
          type="button"
          className={`menu__btn${tab === 'diag' ? ' menu__btn--on' : ''}`}
          onClick={() => setTab('diag')}
        >
          <span className={`menu__dot${offlineReady ? ' menu__dot--ok' : ''}`} />
          Diagnostics
        </button>
      </nav>

      <main className="main">
        {tab === 'setup' && (
          <ModelSetup
            state={modelState}
            onDownload={() => void runDownload()}
            onDelete={() => void removeModel()}
            busy={modelState.stage === 'downloading'}
            installable={installable}
            onInstall={() => void install()}
          />
        )}

        {tab === 'workspace' && (
          <Workspace
            image={image}
            onPicked={(src, name) => void handlePick(src, name)}
            onError={(message) => push(message, 'error')}
            onGenerate={() => void generate()}
            onReset={() => {
              setResult(null);
            }}
            onClear={clearImage}
            canGenerate={modelState.stage === 'ready' && image != null && !running}
            running={running}
            elapsedMs={elapsedMs}
            note={
              modelState.stage !== 'ready'
                ? 'Download the model first (Setup tab) — then pick a photo and generate.'
                : null
            }
          />
        )}

        {tab === 'results' && result && image && (
          <ResultsStudio
            image={image}
            result={result}
            renderOptions={renderOptions}
            onRenderOptionsChange={setRenderOptions}
            notify={(message, kind) => push(message, kind)}
            onNextPhoto={clearImage}
            onRegenerate={() => void generate()}
            busy={running}
          />
        )}

        {tab === 'diag' && <Diagnostics data={diagnostics} offlineReady={offlineReady} />}
      </main>

      <footer className="footer muted">
        <p>From WAIT Technologies</p>
      </footer>
    </div>
  );
}
