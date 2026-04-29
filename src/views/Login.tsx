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
        const msg = ((await res.json().catch(() => null)) as Record<string, unknown> | null)?.error;
        throw new Error(typeof msg === 'string' ? msg : 'Login failed');
      }
      await refresh();
      onAuthed();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setSubmitting(false);
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

        {status?.loggedIn && !status.allowlisted && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-text-muted">
              You’re unlocked, but this Google account doesn’t have access to the dashboard.
            </p>
            {status.googleEmail && (
              <p className="text-xs text-text-muted font-mono mt-1">
                Connected as <span className="text-foreground/90">{status.googleEmail}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

