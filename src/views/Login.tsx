import React, { useCallback, useEffect, useState } from 'react';
import { csrfHeaders } from '../lib/csrf';

type SessionStatus = {
  loggedIn: boolean;
  googleEmail: string | null;
  allowlisted: boolean;
};

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session/status');
      if (!res.ok) return;
      const json = (await res.json()) as SessionStatus;
      setStatus(json);
      if (json.loggedIn) onAuthed();
    } catch {
      // ignore
    }
  }, [onAuthed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') void refresh();
    };
    window.addEventListener('message', handleMessage);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'oauth_auth_success') void refresh();
    };
    window.addEventListener('storage', handleStorage);

    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel('oauth');
      bc.onmessage = (ev) => {
        if ((ev as MessageEvent).data?.type === 'OAUTH_AUTH_SUCCESS') void refresh();
      };
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      bc?.close();
    };
  }, [refresh]);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg: string | undefined;
        try {
          const j = JSON.parse(raw) as Record<string, unknown>;
          if (typeof j.error === 'string') msg = j.error;
        } catch {
          // non-JSON body (e.g. proxy HTML, rate-limit plaintext)
        }
        const trimmed = raw.trim();
        throw new Error(
          msg ?? (trimmed ? trimmed.slice(0, 160) : `Login failed (HTTP ${res.status})`),
        );
      }
      await refresh();
      onAuthed();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const connectGoogle = async () => {
    setError(null);
    setConnectingGoogle(true);
    try {
      const response = await fetch('/api/auth/google/url?accountId=primary');
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to get Google auth URL');
      }
      const { url } = await response.json();
      const popup = window.open(url, 'oauth_popup', 'width=600,height=700');
      if (!popup) throw new Error('Please allow popups to connect your Google account.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to connect Google');
    } finally {
      setConnectingGoogle(false);
    }
  };

  return (
    <div className="h-screen w-full bg-background-dark text-foreground overflow-hidden flex items-center justify-center px-6">
      <div className="glass-panel w-full max-w-md rounded-2xl p-7 border border-white/10 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/70 via-violet-400/30 to-transparent pointer-events-none" />

        <h1 className="font-heading text-2xl text-foreground">Locked</h1>
        <p className="text-sm text-text-muted mt-1">
          Enter your dashboard passcode to continue.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <input
            type="password"
            name="passcode"
            autoComplete="current-password"
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && passcode.trim() && submit()}
            placeholder="Passcode"
            aria-label="Dashboard passcode"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
          />

          {error && <p className="text-xs text-red-400" aria-live="polite">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !passcode.trim()}
            className="w-full py-2.5 rounded-lg bg-primary text-background-dark text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>

        {status?.loggedIn && !status.googleEmail && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-text-muted">
              Passcode accepted. Connect your allowlisted Google account to finish unlocking the dashboard.
            </p>
            <button
              type="button"
              onClick={connectGoogle}
              disabled={connectingGoogle}
              className="mt-3 w-full py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/15 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {connectingGoogle ? 'Opening Google…' : 'Connect Google'}
            </button>
          </div>
        )}

        {status?.loggedIn && status.googleEmail && !status.allowlisted && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-text-muted">
              You’re unlocked, but this Google account doesn’t have access to the dashboard.
            </p>
            <p className="text-xs text-text-muted font-mono mt-1">
              Connected as <span className="text-foreground/90">{status.googleEmail}</span>
            </p>
            <button
              type="button"
              onClick={connectGoogle}
              disabled={connectingGoogle}
              className="mt-3 w-full py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/15 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {connectingGoogle ? 'Opening Google…' : 'Connect a different Google account'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
