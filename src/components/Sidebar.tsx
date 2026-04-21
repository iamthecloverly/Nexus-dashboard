import { useState, useCallback } from 'react';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  onOpenMusic: () => void;
  onPreloadMusic?: () => void;
  musicActive: boolean;
}

export default function Sidebar({ currentView, setCurrentView, onOpenMusic, onPreloadMusic, musicActive }: SidebarProps) {
  const [cpuLoad, setCpuLoad] = useState(0);
  const [memUsed, setMemUsed] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/system', { timeoutMs: 5_000 });
      if (res.ok) {
        const data = await res.json();
        setCpuLoad(data.cpuLoad);
        setMemUsed(data.memUsed);
      }
    } catch { /* ignore */ }
  }, []);

  usePollingWhenVisible({
    enabled: true,
    poll: fetchMetrics,
    intervalMs: 5000,
  });

  const navItems = [
    { id: 'MainHub', icon: 'dashboard', label: 'Main Hub' },
    { id: 'FocusMode', icon: 'target', label: 'Focus Mode' },
    { id: 'Communications', icon: 'chat_bubble', label: 'Communications' },
    { id: 'Integrations', icon: 'extension', label: 'Integrations' },
  ];

  return (
    <aside className="w-64 flex-none !rounded-none border-r border-border-glass bg-gradient-to-b from-surface via-background-dark to-background-dark flex flex-col z-50 shadow-[6px_0_36px_rgba(0,0,0,0.38)]">
      {/* Logo */}
      <div className="p-6 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent-secondary/90 ring-1 ring-white/10">
            <span className="material-symbols-outlined font-bold text-[20px] relative z-10 text-background-dark" aria-hidden="true">hub</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-[16px] tracking-widest text-foreground leading-none">NEXUS</span>
            <span className="text-[9px] tracking-[0.25em] uppercase font-medium text-primary/55">Dashboard</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 flex flex-col gap-1">
        <p className="px-3 text-[10px] uppercase tracking-[0.2em] font-bold mb-2 text-white/20">Workspace</p>

        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className={`nav-link w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
              currentView === item.id
                ? 'text-primary bg-primary/10 font-semibold shadow-[inset_0_0_0_1px_rgba(56,189,248,0.18)]'
                : hoveredId === item.id
                  ? 'text-foreground bg-white/[0.05]'
                  : 'text-text-muted'
            }`}
            onMouseEnter={() => { if (currentView !== item.id) setHoveredId(item.id); }}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{item.icon}</span>
            <span className="text-[13px]">{item.label}</span>
            {currentView === item.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-r-full bg-primary shadow-glow" />}
          </button>
        ))}

        {/* System section */}
        <div className="mt-6">
          <p className="px-3 text-[10px] uppercase tracking-[0.2em] font-bold mb-2 text-white/20">System</p>
          <div className="px-3 py-1 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]"></span>
              <span>Online</span>
            </div>
            <div className="flex flex-col gap-1 mt-0.5">
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
        </div>
      </nav>

      {/* Bottom: Music + Settings */}
      <div className="p-3 flex flex-col gap-2">
        <button
          onClick={onOpenMusic}
          onMouseEnter={() => onPreloadMusic?.()}
          onFocus={() => onPreloadMusic?.()}
          aria-label={musicActive ? 'Now playing — YouTube Music' : 'Open YouTube Music'}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
            musicActive
              ? 'text-primary bg-primary/10 border border-primary/20 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]'
              : 'text-text-muted border border-white/[0.06] hover:bg-white/[0.04] hover:text-foreground'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">music_note</span>
          <span className="text-[13px] font-medium">{musicActive ? 'Now Playing' : 'Music'}</span>
          {musicActive && (
            <div className="ml-auto flex items-end gap-[2px] h-3" aria-hidden="true">
              {[50, 80, 35].map((h, i) => (
                <div
                  key={i}
                  className="eq-bar eq-bar-playing w-[2px] rounded-full bg-primary"
                  style={{ height: `${h}%`, ['--eq-dur' as string]: `0.${7 + i}s` }}
                />
              ))}
            </div>
          )}
        </button>

        <button
          onClick={() => setCurrentView('Settings')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
            currentView === 'Settings'
              ? 'text-primary bg-primary/10 font-medium'
              : 'text-text-muted hover:text-foreground hover:bg-white/[0.04]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">settings</span>
          <span className="text-[13px] font-medium">Settings</span>
        </button>
      </div>
    </aside>
  );
}
