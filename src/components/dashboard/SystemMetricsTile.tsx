import { SystemMetricsDisplay } from '../layout/SystemMetricsDisplay';
import { useSystemMetrics } from '../../contexts/SystemMetricsProvider';

/** Main Hub tile — CPU and memory only (shared `/api/system` poll). */
export function SystemMetricsTile() {
  const { cpuLoad, memUsed } = useSystemMetrics();

  return (
    <section
      className="glass-panel col-span-1 md:col-span-1 xl:col-span-2 row-span-1 flex flex-col overflow-hidden p-5 relative min-h-[190px]"
      aria-labelledby="system-tile-heading"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400/45 via-primary/18 to-transparent" />

      <div className="mb-5 flex shrink-0 items-center justify-between gap-2">
        <h2 id="system-tile-heading" className="font-heading text-lg text-foreground flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">
            monitoring
          </span>
          System Stats
        </h2>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="min-w-0 shrink-0">
        <SystemMetricsDisplay cpuLoad={cpuLoad} memUsed={memUsed} />
      </div>
    </section>
  );
}
