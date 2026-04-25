import React, { useCallback, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';
import type { Email, ThreadMessage } from '../types/email';
import { EmailContext } from './emailContext';

export function EmailProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [emails, setEmails] = useState<Email[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [serverError, setServerError] = useState(false);

  const refreshEmails = useCallback(async () => {
    setEmailsLoading(true);
    try {
      const res = await fetchWithTimeout('/api/gmail/messages', { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails ?? []);
        setGmailConnected(true);
        setServerError(false);
      } else if (res.status === 401 || res.status === 403) {
        // When dashboard gate blocks (session expired / allowlist / missing profile), treat as disconnected.
        setGmailConnected(false);
        setServerError(false);
      } else {
        // 5xx or unexpected — server is up but erroring; keep connected state, flag error
        setServerError(true);
      }
    } catch {
      // AbortError = our 15s timeout fired; treat same as network error
      setGmailConnected(false);
      setServerError(true);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  usePollingWhenVisible({
    enabled: true,
    poll: refreshEmails,
    intervalMs: 2 * 60 * 1000,
  });

  // Tracks message IDs with an in-flight mark-read request — prevents racing toggles
  const pendingToggleRef = useRef<Set<string>>(new Set());

  const toggleRead = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Drop rapid double-clicks while a request is already in flight for this ID
    if (pendingToggleRef.current.has(id)) return;

    // Optimistic update — flip local state immediately for instant feedback
    let wasUnread: boolean | undefined;
    setEmails(prev => prev.map(email => {
      if (email.id !== id) return email;
      wasUnread = email.unread;
      return { ...email, unread: !email.unread };
    }));

    if (wasUnread === undefined) return;
    // Capture in a const so the async callbacks below always have the right value
    const originalUnread = wasUnread;
    pendingToggleRef.current.add(id);

    const revert = () =>
      setEmails(prev => prev.map(email =>
        email.id === id ? { ...email, unread: originalUnread } : email,
      ));

    fetch(`/api/gmail/messages/${id}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ read: originalUnread }),
    })
      .then(res => {
        if (res.ok) return; // success — optimistic state is correct
        revert();
        if (res.status === 401) {
          showToast('Gmail access needs reconnect — open Integrations', 'error');
        } else {
          showToast('Failed to update email — try again', 'error');
        }
      })
      .catch(() => {
        revert();
        showToast('Failed to update email — check your connection', 'error');
      })
      .finally(() => { pendingToggleRef.current.delete(id); });
  }, [showToast]);

  const archiveEmail = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Optimistic update
    let existed = false;
    setEmails(prev => prev.map(email => {
      if (email.id !== id) return email;
      existed = true;
      return { ...email, archived: true };
    }));
    if (!existed) return;

    const revert = () =>
      setEmails(prev => prev.map(email => email.id === id ? { ...email, archived: false } : email));

    fetch(`/api/gmail/messages/${id}/archive`, {
      method: 'POST',
      headers: csrfHeaders(),
    })
      .then(res => {
        if (res.ok) return;
        revert();
        if (res.status === 401) showToast('Gmail access needs reconnect — open Integrations', 'error');
        else showToast('Failed to archive email — try again', 'error');
      })
      .catch(() => {
        revert();
        showToast('Failed to archive email — check your connection', 'error');
      });
  }, [showToast]);

  const deleteEmail = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Optimistic update
    let existed = false;
    setEmails(prev => prev.map(email => {
      if (email.id !== id) return email;
      existed = true;
      return { ...email, deleted: true };
    }));
    if (!existed) return;

    const revert = () =>
      setEmails(prev => prev.map(email => email.id === id ? { ...email, deleted: false } : email));

    fetch(`/api/gmail/messages/${id}/trash`, {
      method: 'POST',
      headers: csrfHeaders(),
    })
      .then(res => {
        if (res.ok) return;
        revert();
        if (res.status === 401) showToast('Gmail access needs reconnect — open Integrations', 'error');
        else showToast('Failed to delete email — try again', 'error');
      })
      .catch(() => {
        revert();
        showToast('Failed to delete email — check your connection', 'error');
      });
  }, [showToast]);

  const markAllRead = useCallback(() => {
    // Compute the IDs to mark from current state first, then update state
    const unreadIds = emails.filter(e => e.unread && !e.archived && !e.deleted).map(e => e.id);
    if (unreadIds.length === 0) return;

    // Optimistic update
    setEmails(prev => prev.map(e => unreadIds.includes(e.id) ? { ...e, unread: false } : e));

    // Fire-and-forget each mark-read request; revert all on failure
    const revert = () =>
      setEmails(prev => prev.map(e => unreadIds.includes(e.id) ? { ...e, unread: true } : e));

    Promise.all(
      unreadIds.map(id =>
        fetch(`/api/gmail/messages/${id}/mark-read`, {
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
  }, [emails, showToast]);

  const fetchThread = useCallback(async (threadId: string): Promise<ThreadMessage[]> => {
    try {
      const res = await fetchWithTimeout(`/api/gmail/thread/${encodeURIComponent(threadId)}`, { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        return data.messages ?? [];
      }
    } catch {
      // fall through
    }
    return [];
  }, []);

  return (
    <EmailContext.Provider value={{
      state: { emails, gmailConnected, emailsLoading, serverError },
      actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails, markAllRead, fetchThread },
    }}>
      {children}
    </EmailContext.Provider>
  );
}

