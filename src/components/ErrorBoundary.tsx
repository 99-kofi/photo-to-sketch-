import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A render error anywhere in the app currently unmounts the whole tree and
 * leaves a blank page — indistinguishable from "the tab does nothing". This
 * keeps the shell alive, shows what went wrong, and offers recovery that
 * clears the service worker + caches (which fixes stale-shell states too).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sketch Studio crashed:', error, info.componentStack);
  }

  private hardRefresh = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
      const keys = await caches.keys().catch(() => [] as string[]);
      await Promise.all(keys.map((k) => caches.delete(k)));
    } finally {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="card crash-card" role="alert">
          <div className="card__body">
            <h2>Something went wrong</h2>
            <p className="muted">
              The interface hit an unexpected error. Reloading fixes it; the
              downloaded engine stays on your device.
            </p>
            <pre className="crash-card__detail">{String(this.state.error.message || this.state.error)}</pre>
            <button className="btn btn--primary" onClick={() => void this.hardRefresh()}>
              Fix and reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
