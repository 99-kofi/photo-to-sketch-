import { formatBytes, MODEL_REPO, MODEL_INPUT_DIMS, MODEL_FILE } from '../lib/modelConfig';
import type { DiagnosticsData } from '../lib/types';

interface Props {
  data: DiagnosticsData;
  offlineReady: boolean;
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="diag__row">
      <span className="muted">{label}</span>
      <span className={ok === false ? 'warn-text' : ''}>
        {ok === true ? '✓ ' : ok === false ? '⚠ ' : ''}
        {value}
      </span>
    </div>
  );
}

export function Diagnostics({ data, offlineReady }: Props) {
  return (
    <section className="card" id="diagnostics">
      <header className="card__head">
        <h2>
          Device diagnostics
        </h2>
        <span className={`badge ${offlineReady ? 'badge--ok' : ''}`}>
          {offlineReady ? 'Offline ready ✓' : 'Limited offline support'}
        </span>
      </header>
      <div className="card__body diag">
        <Row
          label="Processing"
          value="100% on-device — nothing is uploaded to any server"
          ok={true}
        />
        <Row label="Runtime" value={data.engine.info ? `ONNX Runtime Web · ${data.engine.info.backend.toUpperCase()}` : data.engine.error ? `session error: ${data.engine.error}` : 'not initialised yet'} />
        <Row label="Input tensor" value={`${MODEL_DIMS()} float32 · RGB · [0,1]`} />
        <Row
          label="Model"
          value={
            data.modelMeta
              ? `${MODEL_FILE} · ${formatBytes(data.modelMeta.size)}${data.modelMeta.sha256 ? ' · SHA-256 ✓' : ''}`
              : 'not installed'
          }
        />
        <Row label="Inference" value={data.lastRun ? `${data.lastRun.runMs} ms · ${data.lastRun.backend.toUpperCase()}` : 'no run yet'} />
        <Row label="Threads" value={data.engine.info ? `${data.engine.info.threads}${data.crossOriginIsolated ? '' : ' (no cross-origin isolation → single-threaded)'}` : '—'} />
        <Row label="Network" value={data.online ? 'online' : 'offline — cached assets & model still work'} ok={data.online} />
        <Row label="WebGPU" value={data.webgpuAvailable ? 'available — acceleration when compatible' : 'not available — WASM fallback in use'} ok={data.webgpuAvailable} />
        <Row label="Service worker" value={data.swActive ? 'active — app shell cached' : 'first load still in progress'} ok={data.swActive} />
        <Row
          label="Storage"
          value={
            data.storageQuota != null
              ? `${formatBytes(data.storageUsage)} / ${formatBytes(data.storageQuota)} · ${data.persisted ? 'persistent ✓' : 'best-effort'}`
              : 'estimate unavailable'
          }
        />
        <Row label="Model source" value={`huggingface.co/${MODEL_REPO} (downloaded once)`} />
      </div>
    </section>
  );
}

function MODEL_DIMS(): string {
  return MODEL_INPUT_DIMS.join('×');
}
