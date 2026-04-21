import { useEffect, useRef } from 'react';

type PollFn = () => void | Promise<void>;

export function usePollingWhenVisible(opts: {
  /** Whether polling is active at all. */
  enabled: boolean;
  /** Poll function (should be stable via useCallback). */
  poll: PollFn;
  /** Interval between polls. */
  intervalMs: number;
  /** Run immediately on mount/enable. Default: true. */
  runOnMount?: boolean;
  /** Run once when returning to a visible tab. Default: true. */
  runOnVisible?: boolean;
}) {
  const { enabled, poll, intervalMs, runOnMount = true, runOnVisible = true } = opts;
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      if (!enabled) return;
      if (document.hidden) return;
      if (runningRef.current) return;
      runningRef.current = true;
      Promise.resolve()
        .then(() => poll())
        .finally(() => { runningRef.current = false; });
    };

    if (runOnMount) run();
    const interval = window.setInterval(run, intervalMs);
    const onVisibilityChange = () => { if (runOnVisible) run(); };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, poll, intervalMs, runOnMount, runOnVisible]);
}

