import React, { useCallback, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';
import type { Email, GmailAccountId, ThreadMessage } from '../types/email';
import { EmailContext } from './emailContext';
import { formatEmailTime } from '../lib/emailTime';

const ACCOUNTS: GmailAccountId[] = ['primary', 'secondary'];

function accountParam(accountId: GmailAccountId) {
  return `accountId=${encodeURIComponent(accountId)}`;
}

async function readApiErrorMessage(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (typeof j.error === 'string' && j.error.trim()) return j.error;
    } catch {
      // non-JSON body
    }
    const t = raw.trim();
    return t ? t.slice(0, 160) : `Request failed (HTTP ${res.status})`;
  } catch {
    return `Request failed (HTTP ${res.status})`;
  }
}

export function EmailProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [emailsByAccount, setEmailsByAccount] = useState<Record<GmailAccountId, Email[]>>({
    primary: [],
    secondary: [],
  });
  const [connectedByAccount, setConnectedByAccount] = useState<Record<GmailAccountId, boolean>>({
    primary: false,
    secondary: false,
  });
  const [emailsLoadingByAccount, setEmailsLoadingByAccount] = useState<Record<GmailAccountId, boolean>>({
    primary: false,
    secondary: false,
  });
  const [serverErrorByAccount, setServerErrorByAccount] = useState<Record<GmailAccountId, boolean>>({
    primary: false,
    secondary: false,
  });

  const refreshEmails = useCallback(async (accountId: GmailAccountId) => {
    setEmailsLoadingByAccount(prev => ({ ...prev, [accountId]: true }));
    try {
      const res = await fetchWithTimeout(`/api/gmail/messages?${accountParam(accountId)}`, { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        const emails: Email[] = (data.emails ?? []).map((e: Email) => ({
          ...e,
          accountId,
          time: formatEmailTime(e.receivedAt, e.time),
        }));
        setEmailsByAccount(prev => ({ ...prev, [accountId]: emails }));
        setConnectedByAccount(prev => ({ ...prev, [accountId]: true }));
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: false }));
      } else if (res.status === 401 || res.status === 403) {
        // When dashboard gate blocks (session expired / allowlist / missing profile), treat as disconnected.
        setConnectedByAccount(prev => ({ ...prev, [accountId]: false }));
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: false }));
      } else {
        // 5xx or unexpected — server is up but erroring; keep connected state, flag error
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: true }));
      }
    } catch {
      // AbortError = our 15s timeout fired; treat same as network error
      setConnectedByAccount(prev => ({ ...prev, [accountId]: false }));
      setServerErrorByAccount(prev => ({ ...prev, [accountId]: true }));
    } finally {
      setEmailsLoadingByAccount(prev => ({ ...prev, [accountId]: false }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    // Sequential by design: keeps request bursts down and makes server logs easier to read.
    await ACCOUNTS.reduce(
      (p, accountId) => p.then(() => refreshEmails(accountId)),
      Promise.resolve(),
    );
  }, [refreshEmails]);

  usePollingWhenVisible({
    enabled: true,
    poll: refreshAll,
    intervalMs: 2 * 60 * 1000,
  });

  // Tracks message IDs with an in-flight mark-read request — prevents racing toggles
  const pendingToggleRef = useRef<Set<string>>(new Set());

  const toggleRead = useCallback((accountId: GmailAccountId, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const key = `${accountId}:${id}`;
    // Drop rapid double-clicks while a request is already in flight for this ID
    if (pendingToggleRef.current.has(key)) return;

    // Optimistic update — flip local state immediately for instant feedback
    let wasUnread: boolean | undefined;
    setEmailsByAccount(prev => ({
      ...prev,
      [accountId]: prev[accountId].map(email => {
        if (email.id !== id) return email;
        wasUnread = email.unread;
        return { ...email, unread: !email.unread };
      }),
    }));

    if (wasUnread === undefined) return;
    // Capture in a const so the async callbacks below always have the right value
    const originalUnread = wasUnread;
    pendingToggleRef.current.add(key);

    const revert = () =>
      setEmailsByAccount(prev => ({
        ...prev,
        [accountId]: prev[accountId].map(email =>
          email.id === id ? { ...email, unread: originalUnread } : email,
        ),
      }));

    (async () => {
      try {
        const res = await fetch(`/api/gmail/messages/${id}/mark-read?${accountParam(accountId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ read: originalUnread }),
        });
        if (res.ok) return; // success — optimistic state is correct
        const msg = await readApiErrorMessage(res);
        revert();
        if (res.status === 401) {
          showToast('Gmail access needs reconnect — open Integrations', 'error');
        } else if (res.status === 403) {
          if (msg.toLowerCase().includes('csrf')) showToast('Session/security token mismatch — refresh the page and try again', 'error');
          else showToast('Dashboard access blocked — re-login or reconnect Google', 'error');
        } else if (res.status === 429) {
          showToast(msg, 'error');
        } else {
          showToast(msg || 'Failed to update email — try again', 'error');
        }
      } catch {
        revert();
        showToast('Failed to update email — check your connection', 'error');
      } finally {
        pendingToggleRef.current.delete(key);
      }
    })();
  }, [showToast]);

  const archiveEmail = useCallback((accountId: GmailAccountId, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Optimistic update
    let existed = false;
    setEmailsByAccount(prev => ({
      ...prev,
      [accountId]: prev[accountId].map(email => {
        if (email.id !== id) return email;
        existed = true;
        return { ...email, archived: true };
      }),
    }));
    if (!existed) return;

    const revert = () =>
      setEmailsByAccount(prev => ({
        ...prev,
        [accountId]: prev[accountId].map(email => (email.id === id ? { ...email, archived: false } : email)),
      }));

    (async () => {
      try {
        const res = await fetch(`/api/gmail/messages/${id}/archive?${accountParam(accountId)}`, {
          method: 'POST',
          headers: csrfHeaders(),
        });
        if (res.ok) return;
        const msg = await readApiErrorMessage(res);
        revert();
        if (res.status === 401) showToast('Gmail access needs reconnect — open Integrations', 'error');
        else if (res.status === 403) showToast('Dashboard access blocked — re-login or reconnect Google', 'error');
        else if (res.status === 429) showToast(msg, 'error');
        else showToast(msg || 'Failed to archive email — try again', 'error');
      } catch {
        revert();
        showToast('Failed to archive email — check your connection', 'error');
      }
    })();
  }, [showToast]);

  const deleteEmail = useCallback((accountId: GmailAccountId, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Optimistic update
    let existed = false;
    setEmailsByAccount(prev => ({
      ...prev,
      [accountId]: prev[accountId].map(email => {
        if (email.id !== id) return email;
        existed = true;
        return { ...email, deleted: true };
      }),
    }));
    if (!existed) return;

    const revert = () =>
      setEmailsByAccount(prev => ({
        ...prev,
        [accountId]: prev[accountId].map(email => (email.id === id ? { ...email, deleted: false } : email)),
      }));

    (async () => {
      try {
        const res = await fetch(`/api/gmail/messages/${id}/trash?${accountParam(accountId)}`, {
          method: 'POST',
          headers: csrfHeaders(),
        });
        if (res.ok) return;
        const msg = await readApiErrorMessage(res);
        revert();
        if (res.status === 401) showToast('Gmail access needs reconnect — open Integrations', 'error');
        else if (res.status === 403) showToast('Dashboard access blocked — re-login or reconnect Google', 'error');
        else if (res.status === 429) showToast(msg, 'error');
        else showToast(msg || 'Failed to delete email — try again', 'error');
      } catch {
        revert();
        showToast('Failed to delete email — check your connection', 'error');
      }
    })();
  }, [showToast]);

  const markAllRead = useCallback((accountId: GmailAccountId) => {
    // Compute from a single snapshot (prevents races with refreshEmails) and use Set membership.
    let unreadIds: string[] = [];
    let unreadSet: Set<string> | null = null;

    setEmailsByAccount(prev => {
      unreadIds = prev[accountId].filter(e => e.unread && !e.archived && !e.deleted).map(e => e.id);
      if (unreadIds.length === 0) return prev;
      unreadSet = new Set(unreadIds);
      return {
        ...prev,
        [accountId]: prev[accountId].map(e => (unreadSet!.has(e.id) ? { ...e, unread: false } : e)),
      };
    });

    if (unreadIds.length === 0 || !unreadSet) return;

    const revert = () =>
      setEmailsByAccount(prev => ({
        ...prev,
        [accountId]: prev[accountId].map(e => (unreadSet!.has(e.id) ? { ...e, unread: true } : e)),
      }));

    Promise.all(
      unreadIds.map(id =>
        fetch(`/api/gmail/messages/${id}/mark-read?${accountParam(accountId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ read: true }),
        }),
      ),
    )
      .then(results => {
        const anyFailed = results.some(r => !r.ok);
        if (anyFailed) {
          revert();
          showToast('Some emails could not be marked read — try again', 'error');
        } else {
          showToast(`${unreadIds.length} email${unreadIds.length !== 1 ? 's' : ''} marked as read`, 'success');
        }
      })
      .catch(() => {
        revert();
        showToast('Failed to mark emails as read — check your connection', 'error');
      });
  }, [showToast]);

  const fetchThread = useCallback(async (accountId: GmailAccountId, threadId: string): Promise<ThreadMessage[]> => {
    try {
      const res = await fetchWithTimeout(`/api/gmail/thread/${encodeURIComponent(threadId)}?${accountParam(accountId)}`, { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        const messages: ThreadMessage[] = (data.messages ?? []).map((m: ThreadMessage) => ({
          ...m,
          accountId,
          time: formatEmailTime(m.receivedAt, m.time),
        }));
        return messages;
      }
    } catch {
      // fall through
    }
    return [];
  }, []);

  return (
    <EmailContext.Provider value={{
      state: { emailsByAccount, connectedByAccount, emailsLoadingByAccount, serverErrorByAccount },
      actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails, markAllRead, fetchThread },
    }}>
      {children}
    </EmailContext.Provider>
  );
}
