import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: Toast['kind'] = 'info') => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
