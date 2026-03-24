import { useState, useEffect } from 'react';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  onOpenMusic: () => void;
  musicActive: boolean;
}

export default function Sidebar({ currentView, setCurrentView, onOpenMusic, musicActive }: SidebarProps) {
  const [cpuLoad, setCpuLoad] = useState(0);
  const [memUsed, setMemUsed] = useState(0);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/system');
        if (res.ok) {
          const data = await res.json();
          setCpuLoad(data.cpuLoad);
          setMemUsed(data.memUsed);
        }
      } catch {}
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { id: 'MainHub', icon: 'dashboard', label: 'Main Hub' },
    { id: 'FocusMode', icon: 'target', label: 'Focus Mode' },
    { id: 'Communications', icon: 'chat_bubble', label: 'Communications' },
    { id: 'Integrations', icon: 'extension', label: 'Integrations' },
  ];

  return (
    <aside className="w-64 flex-none !rounded-none border-r flex flex-col z-50" style={{ background: '#0E0E12', borderColor: 'rgba(255,255,255,0.05)' }}>
      {/* Logo */}
      <div className="p-6 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #06E8F9, #06E8F940)' }}>
            <span className="material-symbols-outlined font-bold text-[20px] relative z-10" style={{ color: '#0B0C10' }} aria-hidden="true">hub</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-[16px] tracking-widest text-white leading-none">NEXUS</span>
            <span className="text-[9px] tracking-[0.25em] uppercase font-medium" style={{ color: 'rgba(6,232,249,0.5)' }}>Dashboard</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 flex flex-col gap-1">
        <p className="px-3 text-[10px] uppercase tracking-[0.2em] font-bold mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>Workspace</p>

        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className="nav-link w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
            style={currentView === item.id
              ? { color: '#06E8F9', background: 'rgba(6,232,249,0.08)', fontWeight: 600 }
              : { color: '#71717A' }
            }
            onMouseEnter={e => { if (currentView !== item.id) (e.currentTarget as HTMLElement).style.cssText += ';color:#fff;background:rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { if (currentView !== item.id) { (e.currentTarget as HTMLElement).style.color = '#71717A'; (e.currentTarget as HTMLElement).style.background = ''; } }}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{item.icon}</span>
            <span className="text-[13px]">{item.label}</span>
            {currentView === item.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-r-full" style={{ background: '#06E8F9' }} />}
          </button>
        ))}

        {/* System section */}
        <div className="mt-6">
          <p className="px-3 text-[10px] uppercase tracking-[0.2em] font-bold mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>System</p>
          <div className="px-3 py-1 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs" style={{ color: '#52525B' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"></span>
              <span>Online</span>
            </div>
            <div className="flex flex-col gap-1 mt-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#52525B' }}>CPU</span>
                <span className="font-mono" style={{ color: '#71717A' }}>{cpuLoad}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${cpuLoad}%`, background: 'rgba(6,232,249,0.5)' }} />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#52525B' }}>Memory</span>
                <span className="font-mono" style={{ color: '#71717A' }}>{memUsed}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${memUsed}%`, background: 'rgba(6,232,249,0.35)' }} />
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Bottom: Music + Settings */}
      <div className="p-3 flex flex-col gap-2">
        {/* Music button */}
        <button
          onClick={onOpenMusic}
          aria-label={musicActive ? 'Now playing — YouTube Music' : 'Open YouTube Music'}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left"
          style={musicActive
            ? { color: '#06E8F9', background: 'rgba(6,232,249,0.08)', border: '1px solid rgba(6,232,249,0.15)' }
            : { color: '#52525B', border: '1px solid rgba(255,255,255,0.04)' }
          }
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">music_note</span>
          <span className="text-[13px] font-medium">{musicActive ? 'Now Playing' : 'Music'}</span>
          {musicActive && (
            <div className="ml-auto flex items-end gap-[2px] h-3" aria-hidden="true">
              {[50, 80, 35].map((h, i) => (
                <div
                  key={i}
                  className="eq-bar eq-bar-playing w-[2px] rounded-full"
                  style={{ height: `${h}%`, background: '#06E8F9', ['--eq-dur' as string]: `0.${7+i}s` }}
                />
              ))}
            </div>
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => setCurrentView('Settings')}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left"
          style={currentView === 'Settings'
            ? { color: '#06E8F9', background: 'rgba(6,232,249,0.08)' }
            : { color: '#52525B' }
          }
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">settings</span>
          <span className="text-[13px] font-medium">Settings</span>
        </button>
      </div>
    </aside>
  );
}
