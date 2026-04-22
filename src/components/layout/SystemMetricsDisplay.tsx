/** CPU + memory bars — shared by Main Hub tile and Settings. */
export function SystemMetricsDisplay({ cpuLoad, memUsed }: { cpuLoad: number; memUsed: number }) {
  return (
    <div className="flex flex-col gap-3 min-w-[200px]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-muted/90">CPU</span>
          <span className="font-mono text-text-muted">{cpuLoad}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-white/[0.06]">
          <div className="h-full rounded-full transition-[width] duration-500 bg-gradient-to-r from-primary/70 to-primary/35" style={{ width: `${cpuLoad}%` }} />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-muted/90">Memory</span>
          <span className="font-mono text-text-muted">{memUsed}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-white/[0.06]">
          <div className="h-full rounded-full transition-[width] duration-500 bg-gradient-to-r from-primary/45 to-accent-secondary/35" style={{ width: `${memUsed}%` }} />
        </div>
      </div>
    </div>
  );
}
