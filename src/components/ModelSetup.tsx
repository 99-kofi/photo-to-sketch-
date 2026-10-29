import { formatBytes, MODEL_REPO, MODEL_SIZE } from '../lib/modelConfig';
import type { ModelState } from '../lib/types';

interface Props {
  state: ModelState;
  persisted: boolean;
  storageUsage: number | null;
  storageQuota: number | null;
  onDownload: () => void;
  onDelete: () => void;
  busy: boolean;
}

function pct(received: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

export function ModelSetup({ state, persisted, storageUsage, storageQuota, onDownload, onDelete, busy }: Props) {
  let body: React.ReactNode;
  let statusLabel = '';

  switch (state.stage) {
    case 'checking':
      statusLabel = 'Checking cache…';
      body = <p className="muted">Looking for a previously downloaded model…</p>;
      break;
    case 'missing':
      statusLabel = 'Not installed';
      body = (
        <>
          <p className="muted">
            One-time download of the U-Net sketch model from{' '}
            <a href={`https://huggingface.co/${MODEL_REPO}`} target="_blank" rel="noreferrer">
              {MODEL_REPO}
            </a>
            . After this, everything runs on your device — even offline.
          </p>
          <button className="btn btn--primary" onClick={onDownload} disabled={busy}>
            Download model · {formatBytes(MODEL_SIZE)}
          </button>
        </>
      );
      break;
    case 'downloading':
      statusLabel = 'Downloading…';
      body = (
        <>
          <progress max={100} value={pct(state.received, state.total)} />
          <p className="muted">
            {formatBytes(state.received)} / {formatBytes(state.total)} ({pct(state.received, state.total)}%)
            {persisted ? ' · storage persistent' : ''}
          </p>
        </>
      );
      break;
    case 'error':
      statusLabel = 'Download failed';
      body = (
        <>
          <p className="error-text">{state.message}</p>
          <button className="btn btn--primary" onClick={onDownload} disabled={busy}>
            Retry download
          </button>
        </>
      );
      break;
    case 'ready':
      statusLabel = 'Ready for offline use ✓';
      body = (
        <>
          <p className="muted">
            Model cached locally ({formatBytes(state.meta.size)}
            {state.meta.sha256 == null ? ', size-verified only' : ', SHA-256 verified'} ·{' '}
            {new Date(state.meta.downloadedAt).toLocaleDateString()}).
          </p>
          <button className="btn btn--ghost" onClick={onDelete} disabled={busy}>
            Remove from device
          </button>
        </>
      );
      break;
  }

  return (
    <section className="card" id="setup">
      <header className="card__head">
        <h2>
          Model setup
        </h2>
        <span className={`badge ${state.stage === 'ready' ? 'badge--ok' : state.stage === 'error' ? 'badge--err' : ''}`}>
          {statusLabel}
        </span>
      </header>
      <div className="card__body">{body}</div>
      <footer className="card__foot muted">
        {storageQuota != null && (
          <>
            Device storage: {formatBytes(storageUsage)} used of {formatBytes(storageQuota)} available
            {persisted ? ' · persistent' : ' · best-effort'}
          </>
        )}
      </footer>
    </section>
  );
}
