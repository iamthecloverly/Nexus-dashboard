import { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';

interface IntegrationStatus {
  google: boolean;
  github: boolean;
  discord: boolean;
}

export default function Integrations({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<IntegrationStatus>({ google: false, github: false, discord: false });
  const [isLoading, setIsLoading] = useState(true);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);

  // GitHub PAT input
  const [githubPat, setGithubPat] = useState('');
  const [githubSaving, setGithubSaving] = useState(false);
  const [githubError, setGithubError] = useState('');
  const [showGithubInput, setShowGithubInput] = useState(false);

  // Discord webhook input
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordError, setDiscordError] = useState('');
  const [discordTesting, setDiscordTesting] = useState(false);
  const [showDiscordInput, setShowDiscordInput] = useState(false);

  useEffect(() => {
    checkAllStatuses();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') checkAllStatuses();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAllStatuses = async () => {
    setIsLoading(true);
    const [googleRes, githubRes, discordRes] = await Promise.allSettled([
      fetch('/api/auth/status').then(r => r.json()),
      fetch('/api/github/status').then(r => r.json()),
      fetch('/api/discord/status').then(r => r.json()),
    ]);
    const googleConnected = googleRes.status === 'fulfilled' ? googleRes.value.connected : false;
    setStatus({
      google: googleConnected,
      github: githubRes.status === 'fulfilled' ? githubRes.value.connected : false,
      discord: discordRes.status === 'fulfilled' ? discordRes.value.connected : false,
    });
    if (googleConnected) {
      try {
        const profileRes = await fetch('/api/auth/profile');
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setGoogleEmail(profile.email ?? null);
        } else {
          setGoogleEmail(null);
        }
      } catch {
        setGoogleEmail(null);
      }
    } else {
      setGoogleEmail(null);
    }
    setIsLoading(false);
  };

  // Google Calendar
  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to get auth URL');
      }
      const { url } = await response.json();
      const popup = window.open(url, 'oauth_popup', 'width=600,height=700');
      if (!popup) showToast('Please allow popups to connect your account.', 'error');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showToast(`Failed to connect Google: ${message}`, 'error');
    }
  };

  const handleDisconnectGoogle = async () => {
    await fetch('/api/auth/disconnect', { method: 'POST', headers: csrfHeaders() });
    setStatus(s => ({ ...s, google: false }));
    setGoogleEmail(null);
    showToast('Google disconnected', 'info');
  };

  // GitHub
  const handleSaveGithub = async () => {
    if (!githubPat.trim()) return;
    setGithubSaving(true);
    setGithubError('');
    try {
      const res = await fetch('/api/github/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ token: githubPat }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      setStatus(s => ({ ...s, github: true }));
      setGithubPat('');
      setShowGithubInput(false);
      showToast('GitHub connected!', 'success');
    } catch (err: unknown) {
      setGithubError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGithubSaving(false);
    }
  };

  const handleDisconnectGithub = async () => {
    await fetch('/api/github/disconnect', { method: 'POST', headers: csrfHeaders() });
    setStatus(s => ({ ...s, github: false }));
    setShowGithubInput(false);
    showToast('GitHub disconnected', 'info');
  };

  // Discord
  const handleSaveDiscord = async () => {
    if (!discordUrl.trim()) return;
    setDiscordSaving(true);
    setDiscordError('');
    try {
      const res = await fetch('/api/discord/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ url: discordUrl }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      setStatus(s => ({ ...s, discord: true }));
      setDiscordUrl('');
      setShowDiscordInput(false);
      showToast('Discord connected!', 'success');
    } catch (err: unknown) {
      setDiscordError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleDisconnectDiscord = async () => {
    await fetch('/api/discord/disconnect', { method: 'POST', headers: csrfHeaders() });
    setStatus(s => ({ ...s, discord: false }));
    setShowDiscordInput(false);
    showToast('Discord disconnected', 'info');
  };

  const handleTestDiscord = async () => {
    setDiscordTesting(true);
    try {
      const res = await fetch('/api/discord/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ content: '✅ Personal Dashboard is connected!' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      showToast('Test message sent!', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Test failed', 'error');
    } finally {
      setDiscordTesting(false);
    }
  };

  const ConnectedBadge = () => (
    <div className="px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold uppercase tracking-wider">
      Connected
    </div>
  );

  const ConnectButton = ({ onClick, service }: { onClick: () => void; service: string }) => (
    <button
      onClick={onClick}
      aria-label={`Connect ${service}`}
      className="px-4 py-1.5 rounded-full bg-primary text-background-dark text-xs font-bold hover:bg-primary/90 transition-colors shadow-[0_0_14px_rgba(56,189,248,0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      Connect
    </button>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 p-8">
      <div className="glass-panel w-full max-w-[1000px] h-full mx-auto flex flex-col rounded-xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-background-elevated/55 shrink-0">
          <div>
            <h1 className="font-heading font-semibold text-2xl text-foreground">Integrations</h1>
            <p className="text-sm text-text-muted mt-1">Connect your external tools and services.</p>
          </div>
          <button
            onClick={() => setCurrentView('MainHub')}
            aria-label="Close integrations"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Google Calendar + Gmail */}
            <div className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-16 -mt-16 group-hover:bg-blue-500/20 transition-colors"></div>
              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center shadow-lg">
                  <span className="material-symbols-outlined text-blue-500 text-3xl" aria-hidden="true">calendar_today</span>
                </div>
                {isLoading ? (
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                ) : status.google ? <ConnectedBadge /> : <ConnectButton onClick={handleConnectGoogle} service="Google" />}
              </div>
              <h3 className="text-lg font-semibold text-white mb-1 relative z-10">Google</h3>
              <p className="text-sm text-text-muted mb-2 relative z-10">Sync your Calendar and Gmail inbox into the dashboard.</p>
              {status.google && googleEmail && (
                <p className="text-xs text-text-muted font-mono mb-4 relative z-10">
                  Connected as <span className="text-white/90">{googleEmail}</span>
                </p>
              )}
              {status.google && (
                <button
                  onClick={handleDisconnectGoogle}
                  className="w-full py-2 rounded-lg border border-red-500/30 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors relative z-10"
                >
                  Disconnect
                </button>
              )}
            </div>

            {/* GitHub */}
            <div className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gray-500/10 rounded-full blur-2xl -mr-16 -mt-16 group-hover:bg-gray-500/20 transition-colors"></div>
              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="w-12 h-12 rounded-lg bg-[#24292F] flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-xl">GH</span>
                </div>
                {isLoading ? (
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                ) : status.github ? (
                  <ConnectedBadge />
                ) : (
                  <ConnectButton onClick={() => setShowGithubInput(v => !v)} service="GitHub" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-white mb-1 relative z-10">GitHub</h3>
              <p className="text-sm text-text-muted mb-4 relative z-10">Monitor notifications, pull requests, and issues.</p>

              {showGithubInput && !status.github && (
                <div className="relative z-10 flex flex-col gap-2 mb-4">
                  <input
                    type="password"
                    aria-label="GitHub Personal Access Token"
                    autoComplete="off"
                    placeholder="Paste your Personal Access Token…"
                    value={githubPat}
                    onChange={e => setGithubPat(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveGithub()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
                  />
                  {githubError && <p className="text-xs text-red-400" aria-live="polite">{githubError}</p>}
                  <button
                    onClick={handleSaveGithub}
                    disabled={githubSaving || !githubPat.trim()}
                    className="w-full py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-medium text-primary hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {githubSaving ? 'Saving…' : 'Save Token'}
                  </button>
                  <p className="text-[10px] text-text-muted">
                    Create a token at github.com/settings/tokens with <code className="bg-white/10 px-1 rounded">notifications</code> scope.
                  </p>
                </div>
              )}

              {status.github && (
                <div className="relative z-10 flex gap-2">
                  <button
                    onClick={() => setShowGithubInput(v => !v)}
                    className="flex-1 py-2 rounded-lg border border-white/20 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    Update Token
                  </button>
                  <button
                    onClick={handleDisconnectGithub}
                    className="flex-1 py-2 rounded-lg border border-red-500/30 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {showGithubInput && status.github && (
                <div className="relative z-10 flex flex-col gap-2 mt-4">
                  <input
                    type="password"
                    aria-label="New Personal Access Token"
                    placeholder="New Personal Access Token…"
                    value={githubPat}
                    onChange={e => setGithubPat(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveGithub()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                  />
                  <button
                    onClick={handleSaveGithub}
                    disabled={githubSaving || !githubPat.trim()}
                    className="w-full py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-medium text-primary hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {githubSaving ? 'Saving…' : 'Update'}
                  </button>
                </div>
              )}
            </div>

            {/* Discord */}
            <div className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -mr-16 -mt-16 group-hover:bg-purple-500/20 transition-colors"></div>
              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="w-12 h-12 rounded-lg bg-[#5865F2] flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-xl">D</span>
                </div>
                {isLoading ? (
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                ) : status.discord ? (
                  <ConnectedBadge />
                ) : (
                  <ConnectButton onClick={() => setShowDiscordInput(v => !v)} service="Discord" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-white mb-1 relative z-10">Discord</h3>
              <p className="text-sm text-text-muted mb-4 relative z-10">Send alerts and notifications to a Discord channel via webhook.</p>

              {showDiscordInput && !status.discord && (
                <div className="relative z-10 flex flex-col gap-2 mb-4">
                  <input
                    type="url"
                    aria-label="Discord webhook URL"
                    autoComplete="off"
                    placeholder="https://discord.com/api/webhooks/…"
                    value={discordUrl}
                    onChange={e => setDiscordUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveDiscord()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
                  />
                  {discordError && <p className="text-xs text-red-400" aria-live="polite">{discordError}</p>}
                  <button
                    onClick={handleSaveDiscord}
                    disabled={discordSaving || !discordUrl.trim()}
                    className="w-full py-2 rounded-lg bg-primary/20 border border-primary/30 text-sm font-medium text-primary hover:bg-primary/30 transition-colors disabled:opacity-40"
                  >
                    {discordSaving ? 'Saving…' : 'Save Webhook'}
                  </button>
                  <p className="text-[10px] text-text-muted">
                    Create a webhook in Discord: Server Settings → Integrations → Webhooks.
                  </p>
                </div>
              )}

              {status.discord && (
                <div className="relative z-10 flex gap-2">
                  <button
                    onClick={handleTestDiscord}
                    disabled={discordTesting}
                    className="flex-1 py-2 rounded-lg border border-white/20 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                  >
                    {discordTesting ? 'Sending…' : 'Test'}
                  </button>
                  <button
                    onClick={handleDisconnectDiscord}
                    className="flex-1 py-2 rounded-lg border border-red-500/30 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
