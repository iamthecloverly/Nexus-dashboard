import { useState, useEffect } from 'react';
import { SystemMetricsDisplay } from '../components/layout/SystemMetricsDisplay';
import { useToast } from '../components/Toast';
import { useSystemMetrics } from '../contexts/SystemMetricsProvider';
import { useTheme, type AccentColor } from '../contexts/ThemeProvider';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { SetViewFn } from '../config/navigation';

interface ConnectionStatus {
  google: boolean;
  github: boolean;
  discord: boolean;
}

export default function Settings({
  setCurrentView,
  resumeEnabled,
  onResumeEnabledChange,
  onClearMusicSession,
}: {
  setCurrentView: SetViewFn;
  resumeEnabled: boolean;
  onResumeEnabledChange: (next: boolean) => void;
  onClearMusicSession: () => void;
}) {
  const { showToast } = useToast();
  const { cpuLoad, memUsed } = useSystemMetrics();
  const { state: { mode: themeMode, accentColor }, actions: { toggleMode, setAccentColor } } = useTheme();
  const { permission: notificationPermission, isSupported: notificationsSupported, isGranted: notificationsGranted, requestPermission } = useNotificationPermission();
  const [profileName, setProfileName] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [connections, setConnections] = useState<ConnectionStatus>({ google: false, github: false, discord: false });
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // AI / OpenAI key
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiSource, setAiSource] = useState<'cookie' | 'env' | null>(null);
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiKeySaving, setAiKeySaving] = useState(false);

  // Music
  useEffect(() => {
    const fetchStatuses = async () => {
      const [googleRes, githubRes, discordRes, aiRes] = await Promise.allSettled([
        fetch('/api/auth/status').then(r => r.json()),
        fetch('/api/github/status').then(r => r.json()),
        fetch('/api/discord/status').then(r => r.json()),
        fetch('/api/ai/status').then(r => r.json()),
      ]);
      setConnections({
        google: googleRes.status === 'fulfilled' ? googleRes.value.connected : false,
        github: githubRes.status === 'fulfilled' ? githubRes.value.connected : false,
        discord: discordRes.status === 'fulfilled' ? discordRes.value.connected : false,
      });
      setAiConfigured(aiRes.status === 'fulfilled' ? !!aiRes.value.configured : false);
      setAiSource(aiRes.status === 'fulfilled' ? (aiRes.value.source ?? null) : null);
    };
    fetchStatuses();
  }, []);

  const saveAiKey = async () => {
    if (!aiKeyDraft.trim()) { showToast('Please enter an API key', 'error'); return; }
    setAiKeySaving(true);
    try {
      const res = await fetch('/api/ai/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ key: aiKeyDraft.trim() }),
      });
      if (res.ok) { setAiConfigured(true); setAiKeyDraft(''); showToast('OpenAI key saved', 'success'); }
      else showToast('Failed to save key', 'error');
    } catch { showToast('Failed to save key', 'error'); }
    finally { setAiKeySaving(false); }
  };

  const disconnectAi = async () => {
    await fetch('/api/ai/disconnect', { method: 'POST', headers: csrfHeaders() });
    // If OPENAI_API_KEY is set server-side, removing the cookie won't disable AI.
    if (aiSource === 'env') {
      showToast('AI is configured via server environment and cannot be removed here', 'info');
      return;
    }
    setAiConfigured(false);
    setAiSource(null);
    showToast('OpenAI key removed', 'info');
  };

  const saveName = () => {
    const name = nameDraft.trim();
    if (!name) { showToast('Name cannot be empty', 'error'); return; }
    setProfileName(name);
    localStorage.setItem(STORAGE_KEYS.profileName, name);
    setIsEditingName(false);
    showToast('Name saved', 'success');
  };

  const clearAllData = () => {
    [
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.profileName,
      STORAGE_KEYS.onboardingDismissed,
      STORAGE_KEYS.ytVideoId,
      STORAGE_KEYS.ytVolume,
      STORAGE_KEYS.ytRecent,
      STORAGE_KEYS.ytPositions,
      STORAGE_KEYS.ytResumeEnabled,
      STORAGE_KEYS.autoProcessedEmailIds, // reset auto-task extraction state so new emails are processed fresh
      STORAGE_KEYS.weatherCoords,
      STORAGE_KEYS.themeMode,
      STORAGE_KEYS.themeAccent,
      STORAGE_KEYS.notificationsEnabled,
    ].forEach(k => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => window.location.reload(), 600);
  };

  const toggleResume = () => {
    const next = !resumeEnabled;
    try { localStorage.setItem(STORAGE_KEYS.ytResumeEnabled, next ? '1' : '0'); } catch { /* quota */ }
    onResumeEnabledChange(next);
    showToast(next ? 'Music resume enabled' : 'Music resume disabled', 'info');
  };

  const clearMusicData = () => {
    [STORAGE_KEYS.ytVideoId, STORAGE_KEYS.ytVolume, STORAGE_KEYS.ytRecent, STORAGE_KEYS.ytPositions].forEach(k => localStorage.removeItem(k));
    onClearMusicSession();
    showToast('Music data cleared', 'info');
  };

  const connectedServices = [
    { label: 'Google (Calendar + Gmail)', connected: connections.google, icon: 'calendar_today' },
    { label: 'GitHub', connected: connections.github, icon: 'code' },
    { label: 'Discord', connected: connections.discord, icon: 'chat' },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 p-8">
      <div className="glass-panel w-full max-w-[600px] flex-1 min-h-0 mx-auto flex flex-col rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-background-elevated/55 shrink-0">
          <h1 className="font-heading font-semibold text-2xl text-foreground">Settings</h1>
          <button
            onClick={() => setCurrentView('MainHub')}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="p-8 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
          {/* Profile */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">Profile</h2>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-heading font-bold text-xl flex-shrink-0" aria-hidden="true">
                {profileName ? profileName.charAt(0).toUpperCase() : '?'}
              </div>
              {isEditingName ? (
                <div className="flex-1 flex gap-2">
                  <input
                    aria-label="Profile name"
                    name="profile-name"
                    autoComplete="name"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
                    placeholder="Your name…"
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { e.stopPropagation(); setIsEditingName(false); } }}
                  />
                  <button onClick={saveName} className="px-3 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm text-primary hover:bg-primary/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Save</button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-foreground">{profileName || <span className="text-text-muted italic">Not set</span>}</span>
                  <button
                    onClick={() => { setNameDraft(profileName); setIsEditingName(true); }}
                    className="text-xs text-text-muted hover:text-primary transition-colors flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">edit</span>
                    Edit
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Theme */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">Appearance</h2>
            <div className="flex flex-col gap-3">
              {/* Theme Mode Toggle */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">
                  {themeMode === 'dark' ? 'dark_mode' : 'light_mode'}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-foreground font-medium">Theme mode</p>
                  <p className="text-[10px] text-text-muted mt-0.5">Switch between light and dark modes</p>
                </div>
                <button
                  onClick={() => { toggleMode(); showToast(`Switched to ${themeMode === 'dark' ? 'light' : 'dark'} mode`, 'info'); }}
                  aria-label="Toggle theme mode"
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                    themeMode === 'dark'
                      ? 'bg-white/10 border-white/20 text-foreground'
                      : 'bg-primary/20 border-primary/30 text-primary'
                  }`}
                >
                  {themeMode === 'dark' ? 'Dark' : 'Light'}
                </button>
              </div>

              {/* Accent Color Picker */}
              <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                <p className="text-sm text-foreground font-medium mb-3">Accent color</p>
                <div className="grid grid-cols-6 gap-2">
                  {(['sky', 'purple', 'rose', 'emerald', 'amber', 'indigo'] as AccentColor[]).map(color => {
                    const colors: Record<AccentColor, string> = {
                      sky: '#38bdf8',
                      purple: '#a78bfa',
                      rose: '#fb7185',
                      emerald: '#34d399',
                      amber: '#fbbf24',
                      indigo: '#818cf8',
                    };
                    const isSelected = accentColor === color;
                    return (
                      <button
                        key={color}
                        onClick={() => { setAccentColor(color); showToast(`Accent color: ${color}`, 'info'); }}
                        aria-label={`Set accent color to ${color}`}
                        className={`w-full aspect-square rounded-lg transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                          isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-background-dark scale-110' : 'hover:scale-105'
                        }`}
                        style={{ backgroundColor: colors[color] }}
                        title={color.charAt(0).toUpperCase() + color.slice(1)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">Notifications</h2>
            {!notificationsSupported ? (
              <div className="p-4 rounded-lg bg-white/5 border border-white/5">
                <p className="text-sm text-text-muted">Desktop notifications are not supported in this browser.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">notifications</span>
                  <div className="flex-1">
                    <p className="text-sm text-foreground font-medium">Desktop notifications</p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {notificationPermission === 'granted' && 'Notifications are enabled'}
                      {notificationPermission === 'denied' && 'Notifications are blocked. Check browser settings.'}
                      {notificationPermission === 'default' && 'Grant permission to receive notifications'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {notificationsGranted ? (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-green-400/20 border border-green-400/30 text-green-400">
                        Enabled
                      </span>
                    ) : notificationPermission === 'denied' ? (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-red-400/20 border border-red-400/30 text-red-400">
                        Blocked
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          const result = await requestPermission();
                          if (result === 'granted') {
                            showToast('Notifications enabled', 'success');
                            // Test notification
                            try {
                              const n = new Notification('Nexus Dashboard', {
                                body: 'Notifications are now enabled!',
                                icon: '/favicon.ico',
                              });
                              setTimeout(() => n.close(), 4000);
                            } catch {
                              // Ignore if notification fails
                            }
                          } else if (result === 'denied') {
                            showToast('Notifications blocked. Check browser settings.', 'error');
                          }
                        }}
                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        Enable
                      </button>
                    )}
                  </div>
                </div>
                {notificationsGranted && (
                  <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-xs text-foreground font-medium mb-2">Notification types:</p>
                    <ul className="text-[11px] text-text-muted space-y-1 ml-4">
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Calendar events (5 minutes before)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary">•</span>
                        <span>Task reminders (when due date arrives)</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Local system snapshot (same `/api/system` poll as Main Hub tile) */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">System</h2>
            <div className="p-4 rounded-lg bg-white/5 border border-white/5">
              <SystemMetricsDisplay cpuLoad={cpuLoad} memUsed={memUsed} />
            </div>
            <p className="text-[10px] text-text-muted mt-2">Live stats from this machine via the app server (one shared poll).</p>
          </section>

          {/* Connected accounts */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest">Connected Accounts</h2>
              <button onClick={() => setCurrentView('Integrations')} className="text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">Manage</button>
            </div>
            <div className="flex flex-col gap-3">
              {connectedServices.map(svc => (
                <div key={svc.label} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">{svc.icon}</span>
                  <span className="flex-1 text-sm text-foreground">{svc.label}</span>
                  <span className={`text-xs font-bold uppercase tracking-wider ${svc.connected ? 'text-green-400' : 'text-text-muted'}`}>
                    {svc.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* AI */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">AI — Task Extraction</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">auto_awesome</span>
                <span className="flex-1 text-sm text-foreground">OpenAI (gpt-4o-mini)</span>
                <span className={`text-xs font-bold uppercase tracking-wider ${aiConfigured ? 'text-green-400' : 'text-text-muted'}`}>
                  {aiConfigured ? 'Configured' : 'Not configured'}
                </span>
              </div>
              {aiConfigured && aiSource === 'env' ? (
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <p className="text-sm text-foreground">Configured by the server.</p>
                  <p className="text-[10px] text-text-muted mt-1">To change this, update <span className="font-mono">OPENAI_API_KEY</span> and restart the server.</p>
                </div>
              ) : aiConfigured ? (
                <button
                  onClick={disconnectAi}
                  className="w-full py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Remove API key
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    aria-label="OpenAI API key"
                    name="openai-api-key"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20 font-mono"
                    placeholder="sk-..."
                    value={aiKeyDraft}
                    onChange={e => setAiKeyDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveAiKey(); }}
                  />
                  <button
                    onClick={saveAiKey}
                    disabled={aiKeySaving || !aiKeyDraft.trim()}
                    className="px-4 py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-semibold text-primary hover:bg-primary/30 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary flex-shrink-0"
                  >
                    {aiKeySaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
              <p className="text-[10px] text-text-muted">
                Used to extract tasks from emails. If you add a key here, it’s stored in an HTTP-only cookie. Email content is sent only to OpenAI for task extraction. Get a key at <span className="text-primary">platform.openai.com</span>.
              </p>
            </div>
          </section>

          {/* Music */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">Music</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">music_note</span>
                <div className="flex-1">
                  <p className="text-sm text-foreground font-medium">Resume playback position</p>
                  <p className="text-[10px] text-text-muted mt-0.5">When enabled, tracks resume from your last position.</p>
                </div>
                <button
                  onClick={toggleResume}
                  aria-label="Toggle resume playback position"
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                    resumeEnabled
                      ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
                      : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10'
                  }`}
                >
                  {resumeEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <button
                onClick={clearMusicData}
                className="w-full py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Clear music history &amp; positions
              </button>
            </div>
          </section>

          {/* Danger zone */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">Data</h2>
            {confirmClear ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 flex flex-col gap-3">
                <p className="text-sm text-red-300 font-medium">This will erase all tasks, checklist items, and your profile name. Are you sure?</p>
                <div className="flex gap-2">
                  <button
                    onClick={clearAllData}
                    disabled={cleared}
                    className="flex-1 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-sm font-semibold text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
                  >
                    {cleared ? 'Clearing…' : 'Yes, clear everything'}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="flex-1 py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full py-2.5 rounded-lg border border-red-500/30 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
              >
                Clear all local data
              </button>
            )}
            <p className="text-[10px] text-text-muted mt-2">Clears browser-stored data (tasks, profile, music, etc). Doesn’t disconnect your integrations.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
