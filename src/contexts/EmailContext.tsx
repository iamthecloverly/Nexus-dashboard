import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Email } from '../types/email';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';

interface EmailState {
  emails: Email[];
  gmailConnected: boolean;
  emailsLoading: boolean;
  /** true when a network/server error prevented the last fetch (distinct from "not authenticated") */
  serverError: boolean;
}

interface EmailActions {
  /** e is optional so all actions can be called programmatically without a fake MouseEvent */
  toggleRead: (id: string, e?: React.MouseEvent) => void;
  archiveEmail: (id: string, e?: React.MouseEvent) => void;
  deleteEmail: (id: string, e?: React.MouseEvent) => void;
  refreshEmails: () => void;
}

interface EmailContextValue {
  state: EmailState;
  actions: EmailActions;
}

const EmailContext = createContext<EmailContextValue | null>(null);

export function EmailProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [emails, setEmails] = useState<Email[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [serverError, setServerError] = useState(false);

  const refreshEmails = useCallback(async () => {
    setEmailsLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('/api/gmail/messages', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails ?? []);
        setGmailConnected(true);
        setServerError(false);
      } else if (res.status === 401 || res.status === 403) {
        setGmailConnected(false);
        setServerError(false);
      } else {
        // 5xx or unexpected — server is up but erroring; keep connected state, flag error
        setServerError(true);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      // AbortError = our 15s timeout fired; treat same as network error
      setGmailConnected(false);
      setServerError(true);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshEmails();
    // Auto-refresh every 2 minutes; skip when tab is hidden (mirrors Sidebar system-metrics pattern)
    const poll = () => { if (!document.hidden) refreshEmails(); };
    const interval = setInterval(poll, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refreshEmails]);

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
          showToast('Gmail session expired — reconnect in Integrations', 'error');
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
        if (res.status === 401) showToast('Gmail session expired — reconnect in Integrations', 'error');
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
        if (res.status === 401) showToast('Gmail session expired — reconnect in Integrations', 'error');
        else showToast('Failed to delete email — try again', 'error');
      })
      .catch(() => {
        revert();
        showToast('Failed to delete email — check your connection', 'error');
      });
  }, [showToast]);

  return (
    <EmailContext value={{
      state: { emails, gmailConnected, emailsLoading, serverError },
      actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails },
    }}>
      {children}
    </EmailContext>
  );
}

export function useEmailContext() {
  const ctx = useContext(EmailContext);
  if (!ctx) throw new Error('useEmailContext must be used within EmailProvider');
  return ctx;
}
