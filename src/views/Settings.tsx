import { useState, useEffect, useRef } from 'react';
import { SystemMetricsDisplay } from '../components/layout/SystemMetricsDisplay';
import { useToast } from '../components/Toast';
import { useSystemMetrics } from '../contexts/SystemMetricsProvider';
import { useMusicContext } from '../contexts/musicContext';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { SetViewFn } from '../config/navigation';
import {
  DEFAULT_DASHBOARD_PANEL_VISIBILITY,
  readDashboardPanelVisibility,
  readNotificationLog,
  readSyncHealth,
  writeDashboardPanelVisibility,
  type DashboardPanelId,
  type SyncService,
} from '../lib/dashboardFeatures';

interface ConnectionStatus {
  google: boolean;
  github: boolean;
  discord: boolean;
}

const PANEL_LABELS: Record<DashboardPanelId, string> = {
  digest: 'At a glance',
  todayTimeline: 'Today Timeline',
  alerts: 'Attention',
  schedule: 'Schedule',
  system: 'System',
  tasks: 'Tasks',
  triage: 'Triage',
  github: 'GitHub',
};

const SYNC_LABELS: Record<SyncService, string> = {
  calendar: 'Calendar',
  gmailPrimary: 'Gmail 1',
  gmailSecondary: 'Gmail 2',
  system: 'System',
};

function formatSyncTime(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function Settings({
  setCurrentView,
}: {
  setCurrentView: SetViewFn;
}) {
  const { showToast } = useToast();
  const { cpuLoad, memUsed } = useSystemMetrics();
  const { resumeEnabled, setResumeEnabled, clearMusicSession } = useMusicContext();
  const { permission: notificationPermission, isSupported: notificationsSupported, isGranted: notificationsGranted, requestPermission } = useNotificationPermission();
  const [profileName, setProfileName] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [connections, setConnections] = useState<ConnectionStatus>({ google: false, github: false, discord: false });
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState(readDashboardPanelVisibility);
  const [syncHealth, setSyncHealth] = useState(readSyncHealth);
  const [notificationLog, setNotificationLog] = useState(readNotificationLog);
  const importInputRef = useRef<HTMLInputElement>(null);

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
      if (res.ok) { setAiConfigured(true); setAiSource('cookie'); setAiKeyDraft(''); showToast('OpenAI key saved', 'success'); }
      else showToast('Failed to save key', 'error');
    } catch { showToast('Failed to save key', 'error'); }
    finally { setAiKeySaving(false); }
  };

  const disconnectAi = async () => {
    await fetch('/api/ai/disconnect', { method: 'POST', headers: csrfHeaders() });
    // Re-fetch status: clearing the cookie may fall back to the env key.
    const statusData = await fetch('/api/ai/status').then(r => r.json()).catch(() => ({ configured: false, source: null }));
    setAiConfigured(!!statusData.configured);
    setAiSource(statusData.source ?? null);
    if (statusData.source === 'env') {
      showToast('Custom key removed — now using the OPENAI_API_KEY environment variable', 'info');
    } else {
      showToast('OpenAI key removed', 'info');
    }
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
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => window.location.reload(), 600);
  };

  const togglePanel = (id: DashboardPanelId) => {
    setPanelVisibility(prev => {
      const next = { ...prev, [id]: !prev[id] };
      writeDashboardPanelVisibility(next);
      window.dispatchEvent(new Event('dashboard:layout-updated'));
      return next;
    });
  };

  const resetPanelLayout = () => {
    writeDashboardPanelVisibility(DEFAULT_DASHBOARD_PANEL_VISIBILITY);
    setPanelVisibility(DEFAULT_DASHBOARD_PANEL_VISIBILITY);
    window.dispatchEvent(new Event('dashboard:layout-updated'));
    showToast('Dashboard layout reset', 'info');
  };

  const refreshLocalStatus = () => {
    setSyncHealth(readSyncHealth());
    setNotificationLog(readNotificationLog());
    showToast('Local status refreshed', 'info');
  };

  const exportLocalData = () => {
    const values = Object.fromEntries(
      Object.values(STORAGE_KEYS).map(key => [key, localStorage.getItem(key)]),
    );
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), values }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nexus-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Local dashboard data exported', 'success');
  };

  const importLocalData = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { values?: Record<string, string | null> };
      const allowedKeys = new Set<string>(Object.values(STORAGE_KEYS));
      if (!parsed.values || typeof parsed.values !== 'object') throw new Error('Invalid export');
      for (const [key, value] of Object.entries(parsed.values)) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value === 'string') localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      }
      setPanelVisibility(readDashboardPanelVisibility());
      setSyncHealth(readSyncHealth());
      setNotificationLog(readNotificationLog());
      window.dispatchEvent(new Event('dashboard:layout-updated'));
      showToast('Local data imported', 'success');
    } catch {
      showToast('Import failed. Choose a valid Nexus export.', 'error');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const clearNotificationLog = () => {
    localStorage.removeItem(STORAGE_KEYS.notificationLog);
    setNotificationLog([]);
    showToast('Notification history cleared', 'info');
  };

  const clearTaskData = () => {
    localStorage.removeItem(STORAGE_KEYS.tasks);
    showToast('Tasks cleared. Refresh to reload the empty list.', 'info');
  };

  const toggleResume = () => {
    const next = !resumeEnabled;
    setResumeEnabled(next);
    showToast(next ? 'Music resume enabled' : 'Music resume disabled', 'info');
  };

  const clearMusicData = () => {
    [STORAGE_KEYS.ytVideoId, STORAGE_KEYS.ytVolume, STORAGE_KEYS.ytRecent, STORAGE_KEYS.ytPositions].forEach(k => localStorage.removeItem(k));
    clearMusicSession();
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

          {/* Dashboard layout */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest">Dashboard Layout</h2>
              <button
                type="button"
                onClick={resetPanelLayout}
                className="text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
              >
                Reset
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(DEFAULT_DASHBOARD_PANEL_VISIBILITY) as DashboardPanelId[]).map(id => (
                <div key={id} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <span className="material-symbols-outlined text-text-muted !text-[20px]" aria-hidden="true">dashboard_customize</span>
                  <span className="flex-1 text-sm text-foreground">{PANEL_LABELS[id]}</span>
                  <button
                    type="button"
                    onClick={() => togglePanel(id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                      panelVisibility[id]
                        ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
                        : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10'
                    }`}
                    aria-pressed={panelVisibility[id]}
                  >
                    {panelVisibility[id] ? 'On' : 'Off'}
                  </button>
                </div>
              ))}
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
                <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-xs text-foreground font-medium">Recent notification history</p>
                    <button
                      type="button"
                      onClick={clearNotificationLog}
                      disabled={notificationLog.length === 0}
                      className="text-[11px] text-text-muted hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                    >
                      Clear
                    </button>
                  </div>
                  {notificationLog.length === 0 ? (
                    <p className="text-[11px] text-text-muted">No local notification history yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {notificationLog.slice(0, 5).map(entry => (
                        <div key={entry.id} className="flex items-start gap-2 rounded-md bg-white/[0.035] px-2 py-2">
                          <span className="material-symbols-outlined text-text-muted !text-[16px] mt-0.5" aria-hidden="true">notifications</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-foreground">{entry.title}</p>
                            <p className="truncate text-[10px] text-text-muted">{entry.body ?? entry.type}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Local system snapshot (same `/api/system` poll as Main Hub tile) */}
          <section>
            <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">System</h2>
            <div className="p-4 rounded-lg bg-white/5 border border-white/5">
              <SystemMetricsDisplay cpuLoad={cpuLoad} memUsed={memUsed} />
            </div>
          </section>

          {/* Sync health */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest">Sync Health</h2>
              <button
                type="button"
                onClick={refreshLocalStatus}
                className="text-xs text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
              >
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(SYNC_LABELS) as SyncService[]).map(service => {
                const record = syncHealth[service];
                const ok = record?.status === 'ok';
                return (
                  <div key={service} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                    <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-400' : record ? 'bg-red-400' : 'bg-white/20'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{SYNC_LABELS[service]}</p>
                      <p className="truncate text-[10px] text-text-muted">{formatSyncTime(record?.checkedAt)}</p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${ok ? 'text-green-400' : record ? 'text-red-400' : 'text-text-muted'}`}>
                      {record?.status ?? 'idle'}
                    </span>
                  </div>
                );
              })}
            </div>
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
              {aiConfigured && aiSource === 'env' && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-sm text-foreground font-medium">AI is active</p>
                  <p className="text-[10px] text-text-muted mt-1">
                    Key loaded from the <code className="font-mono">OPENAI_API_KEY</code> environment variable.
                    Enter a different key below to override it.
                  </p>
                </div>
              )}
              {aiConfigured && aiSource === 'cookie' && (
                <button
                  onClick={disconnectAi}
                  className="w-full py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Remove API key
                </button>
              )}
              {(!aiConfigured || aiSource === 'env') && (
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
                Powers AI task extraction from your emails. Your key is stored securely and only used to communicate with OpenAI on your behalf. Get a key at <span className="text-primary">platform.openai.com</span>.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <button
                type="button"
                onClick={exportLocalData}
                className="py-2 rounded-lg border border-white/10 text-sm font-medium text-foreground hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Export local data
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="py-2 rounded-lg border border-white/10 text-sm font-medium text-foreground hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Import local data
              </button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={e => { void importLocalData(e.target.files?.[0] ?? null); }}
              aria-label="Import local dashboard data"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <button
                type="button"
                onClick={clearTaskData}
                className="py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Clear tasks only
              </button>
              <button
                type="button"
                onClick={clearNotificationLog}
                className="py-2 rounded-lg border border-white/10 text-sm font-medium text-text-muted hover:bg-white/5 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Clear notification history
              </button>
            </div>
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
