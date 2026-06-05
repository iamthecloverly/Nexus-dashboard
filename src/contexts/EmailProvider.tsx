import React, { useCallback, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';
import type { Email, GmailAccountId, ThreadMessage } from '../types/email';
import { EmailContext } from './emailContext';
import { formatEmailTime } from '../lib/emailTime';
import { markSyncStatus } from '../lib/dashboardFeatures';
import { STORAGE_KEYS } from '../constants/storageKeys';

const ACCOUNTS: GmailAccountId[] = ['primary', 'secondary'];

function accountParam(accountId: GmailAccountId) {
  return `accountId=${encodeURIComponent(accountId)}`;
}

function loadGmailHistoryIds(): Partial<Record<GmailAccountId, string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.gmailHistoryIds);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<GmailAccountId, unknown>>;
    return {
      ...(typeof parsed.primary === 'string' ? { primary: parsed.primary } : {}),
      ...(typeof parsed.secondary === 'string' ? { secondary: parsed.secondary } : {}),
    };
  } catch {
    return {};
  }
}

function saveGmailHistoryIds(historyIds: Partial<Record<GmailAccountId, string>>) {
  try {
    localStorage.setItem(STORAGE_KEYS.gmailHistoryIds, JSON.stringify(historyIds));
  } catch {
    // quota exceeded
  }
}

type GmailMessagesResponse = {
  emails?: Email[];
  historyId?: string | null;
  partial?: boolean;
  removedIds?: string[];
  needsFullSync?: boolean;
};

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
  const gmailHistoryIdsRef = useRef<Partial<Record<GmailAccountId, string>>>(loadGmailHistoryIds());

  const refreshEmails = useCallback(async (accountId: GmailAccountId, forceFull = false) => {
    setEmailsLoadingByAccount(prev => ({ ...prev, [accountId]: true }));
    try {
      const historyId = forceFull ? null : gmailHistoryIdsRef.current[accountId];
      const params = new URLSearchParams({ accountId });
      if (historyId) params.set('historyId', historyId);
      const res = await fetchWithTimeout(`/api/gmail/messages?${params.toString()}`, { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json() as GmailMessagesResponse;
        if (data.needsFullSync && !forceFull) {
          delete gmailHistoryIdsRef.current[accountId];
          saveGmailHistoryIds(gmailHistoryIdsRef.current);
          await refreshEmails(accountId, true);
          return;
        }
        const emails: Email[] = (data.emails ?? []).map((e: Email) => ({
          ...e,
          accountId,
          time: formatEmailTime(e.receivedAt, e.time),
        }));
        setEmailsByAccount(prev => {
          if (!data.partial) return { ...prev, [accountId]: emails };
          const removedIds = new Set(data.removedIds ?? []);
          const upsertIds = new Set(emails.map(email => email.id));
          const upsertThreadIds = new Set(emails.map(email => email.threadId).filter((id): id is string => !!id));
          const merged = [
            ...emails,
            ...prev[accountId].filter(email => {
              if (removedIds.has(email.id) || upsertIds.has(email.id)) return false;
              if (email.threadId && upsertThreadIds.has(email.threadId)) return false;
              return true;
            }),
          ];
          return { ...prev, [accountId]: merged };
        });
        if (data.historyId) {
          gmailHistoryIdsRef.current = { ...gmailHistoryIdsRef.current, [accountId]: data.historyId };
          saveGmailHistoryIds(gmailHistoryIdsRef.current);
        }
        setConnectedByAccount(prev => ({ ...prev, [accountId]: true }));
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: false }));
        markSyncStatus(accountId === 'primary' ? 'gmailPrimary' : 'gmailSecondary', 'ok');
      } else if (res.status === 401 || res.status === 403) {
        // When dashboard gate blocks (session expired / allowlist / missing profile), treat as disconnected.
        setConnectedByAccount(prev => ({ ...prev, [accountId]: false }));
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: false }));
        markSyncStatus(accountId === 'primary' ? 'gmailPrimary' : 'gmailSecondary', 'error', `HTTP ${res.status}`);
      } else {
        // 5xx or unexpected — server is up but erroring; keep connected state, flag error
        setServerErrorByAccount(prev => ({ ...prev, [accountId]: true }));
        markSyncStatus(accountId === 'primary' ? 'gmailPrimary' : 'gmailSecondary', 'error', `HTTP ${res.status}`);
      }
    } catch {
      // AbortError = our 15s timeout fired; treat same as network error
      setConnectedByAccount(prev => ({ ...prev, [accountId]: false }));
      setServerErrorByAccount(prev => ({ ...prev, [accountId]: true }));
      markSyncStatus(accountId === 'primary' ? 'gmailPrimary' : 'gmailSecondary', 'error', 'Network error');
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
        const res = await fetchWithTimeout(`/api/gmail/messages/${id}/mark-read?${accountParam(accountId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ read: originalUnread }),
          timeoutMs: 15_000,
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
        const res = await fetchWithTimeout(`/api/gmail/messages/${id}/archive?${accountParam(accountId)}`, {
          method: 'POST',
          headers: csrfHeaders(),
          timeoutMs: 15_000,
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
        const res = await fetchWithTimeout(`/api/gmail/messages/${id}/trash?${accountParam(accountId)}`, {
          method: 'POST',
          headers: csrfHeaders(),
          timeoutMs: 15_000,
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
        fetchWithTimeout(`/api/gmail/messages/${id}/mark-read?${accountParam(accountId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ read: true }),
          timeoutMs: 15_000,
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
