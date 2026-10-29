import type { Toast } from '../hooks/useToasts';

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast--${t.kind}`}
          onClick={() => onDismiss(t.id)}
          title="Dismiss"
        >
          <span className="toast__icon" aria-hidden>
            {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}
          </span>
          {t.message}
        </button>
      ))}
    </div>
  );
}
