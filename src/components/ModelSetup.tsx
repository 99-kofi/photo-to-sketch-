import { formatBytes, MODEL_SIZE } from '../lib/modelConfig';
import { isAppleMobile, isStandalone } from '../lib/installPrompt';
import type { ModelState } from '../lib/types';

interface Props {
  state: ModelState;
  onDownload: () => void;
  onDelete: () => void;
  busy: boolean;
  /** The browser has offered its native install prompt (captured ready). */
  installable: boolean;
  onInstall: () => void;
}

/**
 * The setup card is where every user is forced through. It deliberately shows
 * only plain-language, one-time-install information — file names, digests,
 * sizes and storage details live in the Diagnostics tab instead.
 */
function pct(received: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

export function ModelSetup({ state, onDownload, onDelete, busy, installable, onInstall }: Props) {
  const standalone = isStandalone();
  const apple = isAppleMobile();

  /**
   * The "install as an app" row. Hidden once the app already runs from a
   * home-screen icon; on iOS it becomes 1-2-3 instructions since Safari does
   * not expose a programmatic install prompt.
   */
  let installRow: React.ReactNode = null;
  if (!standalone) {
    installRow =
      apple ? (
        <div className="setup-install">
          <p className="muted">
            Want it like a regular app? In <strong>Safari</strong>, tap the <strong>Share</strong> button,
            then <strong>Add to Home Screen</strong> — it opens full-screen and works offline.
          </p>
        </div>
      ) : (
        <div className="setup-install">
          {installable ? (
            <button className="btn btn--ghost" onClick={onInstall} disabled={busy}>
              Add to home screen — installs as an app
            </button>
          ) : (
            <p className="muted">
              Tip: use your browser menu → “Install app” / “Add to Home screen” to keep Sketch Studio on
              your home screen, opening like a normal app and working offline.
            </p>
          )}
        </div>
      );
  }

  let body: React.ReactNode;
  let statusLabel = '';

  switch (state.stage) {
    case 'checking':
      statusLabel = 'Preparing…';
      body = <p className="muted">Getting things ready…</p>;
      break;
    case 'missing':
      statusLabel = 'One-time setup';
      body = (
        <>
          <p className="muted">
            The sketch engine is downloaded once and saved on your device. After that the app
            works on its own — even fully offline, and nothing is ever uploaded.
          </p>
          <button className="btn btn--primary" onClick={onDownload} disabled={busy}>
            Get set up · downloads {formatBytes(MODEL_SIZE)}, once
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
            {pct(state.received, state.total)}% — your photos stay untouched; the app is just
            installing its sketch engine.
          </p>
        </>
      );
      break;
    case 'error':
      statusLabel = 'Download failed';
      body = (
        <>
          <p className="error-text">Something interrupted the download. Tap retry to continue where it left off.</p>
          <button className="btn btn--primary" onClick={onDownload} disabled={busy}>
            Retry
          </button>
        </>
      );
      break;
    case 'ready':
      statusLabel = 'Ready ✓';
      body = (
        <>
          <p className="muted">
            All set. You can sketch photos anytime — no internet needed, and no image ever
            leaves your device.
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
      {installRow && <div className="card__body setup-install">{installRow}</div>}
    </section>
  );
}
