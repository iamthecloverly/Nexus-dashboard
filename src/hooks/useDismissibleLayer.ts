import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useDismissibleLayer(opts: {
  open: boolean;
  onDismiss: () => void;
  refs: Array<RefObject<HTMLElement>>;
  closeOnEscape?: boolean;
}) {
  const { open, onDismiss, refs, closeOnEscape = true } = opts;

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      for (const r of refs) {
        const el = r.current;
        if (el && el.contains(target)) return;
      }
      onDismiss();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!closeOnEscape) return;
      if (e.key === 'Escape') onDismiss();
    };

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss, refs, closeOnEscape]);
}

