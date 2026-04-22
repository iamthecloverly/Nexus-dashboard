import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';

function parsePayload(data: unknown): { cpuLoad: number; memUsed: number } | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const cpuLoad = Number(o.cpuLoad);
  const memUsed = Number(o.memUsed);
  if (![cpuLoad, memUsed].every(Number.isFinite)) return null;
  return { cpuLoad, memUsed };
}

export interface SystemMetricsContextValue {
  cpuLoad: number;
  memUsed: number;
  refresh: () => Promise<void>;
}

const SystemMetricsContext = createContext<SystemMetricsContextValue | null>(null);

export function SystemMetricsProvider({
  children,
  pollMs = 5000,
}: {
  children: React.ReactNode;
  pollMs?: number;
}) {
  const [cpuLoad, setCpuLoad] = useState(0);
  const [memUsed, setMemUsed] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/system', { timeoutMs: 5000 });
      if (!res.ok) return;
      const next = parsePayload(await res.json());
      if (!next) return;
      setCpuLoad(next.cpuLoad);
      setMemUsed(next.memUsed);
    } catch {
      /* ignore */
    }
  }, []);

  usePollingWhenVisible({
    enabled: true,
    poll: refresh,
    intervalMs: pollMs,
  });

  const value = useMemo<SystemMetricsContextValue>(
    () => ({ cpuLoad, memUsed, refresh }),
    [cpuLoad, memUsed, refresh]
  );

  return <SystemMetricsContext.Provider value={value}>{children}</SystemMetricsContext.Provider>;
}

export function useSystemMetrics(): SystemMetricsContextValue {
  const ctx = useContext(SystemMetricsContext);
  if (!ctx) throw new Error('useSystemMetrics must be used within SystemMetricsProvider');
  return ctx;
}
