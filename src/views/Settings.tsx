import { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';

interface ConnectionStatus {
  google: boolean;
  github: boolean;
  discord: boolean;
}

export default function Settings({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { showToast } = useToast();
  const [profileName, setProfileName] = useState(() => localStorage.getItem('dashboard_profile_name') ?? '');
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem('dashboard_profile_name') ?? '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [connections, setConnections] = useState<ConnectionStatus>({ google: false, github: false, discord: false });
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const fetchStatuses = async () => {
      const [googleRes, githubRes, discordRes] = await Promise.allSettled([
        fetch('/api/auth/status').then(r => r.json()),
        fetch('/api/github/status').then(r => r.json()),
        fetch('/api/discord/status').then(r => r.json()),
      ]);
      setConnections({
        google: googleRes.status === 'fulfilled' ? googleRes.value.connected : false,
        github: githubRes.status === 'fulfilled' ? githubRes.value.connected : false,
        discord: discordRes.status === 'fulfilled' ? discordRes.value.connected : false,
      });
    };
    fetchStatuses();
  }, []);

  const saveName = () => {
    const name = nameDraft.trim();
    if (!name) { showToast('Name cannot be empty', 'error'); return; }
    setProfileName(name);
    localStorage.setItem('dashboard_profile_name', name);
    setIsEditingName(false);
    showToast('Name saved', 'success');
  };

  const clearAllData = () => {
    if (!confirm('Clear all local data (tasks, checklist, profile, onboarding)? This cannot be undone.')) return;
    [
      'dashboard_tasks', 'dashboard_checklist', 'dashboard_checklist_title',
      'dashboard_profile_name', 'dashboard_onboarding_dismissed', 'dashboard_yt_video',
    ].forEach(k => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => window.location.reload(), 600);
  };

  const connectedServices = [
    { label: 'Google (Calendar + Gmail)', connected: connections.google, icon: 'calendar_today' },
    { label: 'GitHub', connected: connections.github, icon: 'code' },
    { label: 'Discord', connected: connections.discord, icon: 'chat' },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 p-8">
      <div className="glass-panel w-full max-w-[600px] mx-auto flex flex-col rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-[#0B0C10]/40 shrink-0">
          <h1 className="font-heading font-semibold text-2xl text-[#F4F4F5]">Settings</h1>
          <button
            onClick={() => setCurrentView('MainHub')}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-all text-[#A1A1AA] hover:text-[#F4F4F5]"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-8 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
          {/* Profile */}
          <section>
            <h2 className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-4">Profile</h2>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-heading font-bold text-xl flex-shrink-0">
                {profileName ? profileName.charAt(0).toUpperCase() : '?'}
              </div>
              {isEditingName ? (
                <div className="flex-1 flex gap-2">
                  <input
                    autoFocus
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                    placeholder="Your name…"
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { e.stopPropagation(); setIsEditingName(false); } }}
                  />
                  <button onClick={saveName} className="px-3 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm text-primary hover:bg-primary/30 transition-colors">Save</button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-white">{profileName || <span className="text-[#A1A1AA] italic">Not set</span>}</span>
                  <button
                    onClick={() => { setNameDraft(profileName); setIsEditingName(true); }}
                    className="text-xs text-[#A1A1AA] hover:text-primary transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined !text-sm">edit</span>
                    Edit
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Connected accounts */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest">Connected Accounts</h2>
              <button onClick={() => setCurrentView('Integrations')} className="text-xs text-primary hover:underline">Manage</button>
            </div>
            <div className="flex flex-col gap-3">
              {connectedServices.map(svc => (
                <div key={svc.label} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="material-symbols-outlined text-text-muted !text-[20px]">{svc.icon}</span>
                  <span className="flex-1 text-sm text-white">{svc.label}</span>
                  <span className={`text-xs font-bold uppercase tracking-wider ${svc.connected ? 'text-green-400' : 'text-[#A1A1AA]'}`}>
                    {svc.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Danger zone */}
          <section>
            <h2 className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-4">Data</h2>
            <button
              onClick={clearAllData}
              disabled={cleared}
              className="w-full py-2.5 rounded-lg border border-red-500/30 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {cleared ? 'Cleared — reloading…' : 'Clear all local data'}
            </button>
            <p className="text-[10px] text-[#A1A1AA] mt-2">Resets tasks, checklist, and profile name stored in this browser. OAuth tokens are unaffected.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
