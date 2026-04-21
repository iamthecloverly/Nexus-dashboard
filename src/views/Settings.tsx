import { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';

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
  setCurrentView: (view: string) => void;
  resumeEnabled: boolean;
  onResumeEnabledChange: (next: boolean) => void;
  onClearMusicSession: () => void;
}) {
  const { showToast } = useToast();
  const [profileName, setProfileName] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem(STORAGE_KEYS.profileName) ?? '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [connections, setConnections] = useState<ConnectionStatus>({ google: false, github: false, discord: false });
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // AI / OpenAI key
  const [aiConfigured, setAiConfigured] = useState(false);
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
      setAiConfigured(aiRes.status === 'fulfilled' ? aiRes.value.configured : false);
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
    setAiConfigured(false);
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
      STORAGE_KEYS.checklist,
      STORAGE_KEYS.checklistTitle,
      STORAGE_KEYS.profileName,
      STORAGE_KEYS.onboardingDismissed,
      STORAGE_KEYS.ytVideoId,
      STORAGE_KEYS.ytVolume,
      STORAGE_KEYS.ytRecent,
      STORAGE_KEYS.ytPositions,
      STORAGE_KEYS.ytResumeEnabled,
      STORAGE_KEYS.autoProcessedEmailIds, // reset auto-task extraction state so new emails are processed fresh
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
    <div className="flex-1 flex flex-col min-w-0 p-8">
      <div className="glass-panel w-full max-w-[600px] mx-auto flex flex-col rounded-xl overflow-hidden">
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
              {aiConfigured ? (
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
                Used to extract tasks from emails. Key is stored in an HTTP-only cookie, never sent to any third party. Get yours at <span className="text-primary">platform.openai.com</span>
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
            <p className="text-[10px] text-text-muted mt-2">Resets tasks, checklist, and profile name stored in this browser. OAuth tokens are unaffected.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
