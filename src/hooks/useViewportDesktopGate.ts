import { useEffect, useState } from 'react';
import { SESSION_KEYS } from '../constants/storageKeys';

const QUERY = '(max-width: 1279px)';
const GATE_EVENT = 'nexus-viewport-gate';

function blocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (sessionStorage.getItem(SESSION_KEYS.viewportDesktopOverride) === '1') return false;
    return window.matchMedia(QUERY).matches;
  } catch {
    return window.innerWidth <= 1279;
  }
}

export function acknowledgeDesktopViewportOverride(): void {
  try {
    sessionStorage.setItem(SESSION_KEYS.viewportDesktopOverride, '1');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(GATE_EVENT));
}

/** True when showing the desktop-only splash (narrow viewport, until user overrides). */
export function useViewportDesktopGate(): boolean {
  const [needsDesktop, setNeedsDesktop] = useState(blocked);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setNeedsDesktop(blocked());
    mq.addEventListener('change', sync);
    window.addEventListener(GATE_EVENT, sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener(GATE_EVENT, sync);
    };
  }, []);

  return needsDesktop;
}
