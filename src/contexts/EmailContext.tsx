import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Email } from '../App';

interface EmailState {
  emails: Email[];
  gmailConnected: boolean;
  emailsLoading: boolean;
  /** true when a network/server error prevented the last fetch (distinct from "not authenticated") */
  serverError: boolean;
}

interface EmailActions {
  toggleRead: (id: string, e: React.MouseEvent) => void;
  archiveEmail: (id: string, e: React.MouseEvent) => void;
  deleteEmail: (id: string, e: React.MouseEvent) => void;
  refreshEmails: () => void;
}

interface EmailContextValue {
  state: EmailState;
  actions: EmailActions;
}

const EmailContext = createContext<EmailContextValue | null>(null);

export function EmailProvider({ children }: { children: React.ReactNode }) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [serverError, setServerError] = useState(false);

  const refreshEmails = useCallback(async () => {
    setEmailsLoading(true);
    try {
      const res = await fetch('/api/gmail/messages');
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
    } catch {
      // Network error — server unreachable
      setGmailConnected(false);
      setServerError(true);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => { refreshEmails(); }, [refreshEmails]);

  const toggleRead = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Optimistic update — flip local state immediately for instant feedback
    let currentlyUnread: boolean | undefined;
    setEmails(prev => prev.map(email => {
      if (email.id !== id) return email;
      currentlyUnread = email.unread;
      return { ...email, unread: !email.unread };
    }));
    // Sync to Gmail — fire-and-forget; local state stays optimistic on failure
    if (currentlyUnread !== undefined) {
      fetch(`/api/gmail/messages/${id}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: currentlyUnread }), // read:true = was unread, now marking as read
      }).catch(() => { /* optimistic — local change persists even on error */ });
    }
  }, []);

  const archiveEmail = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmails(prev => prev.map(email => email.id === id ? { ...email, archived: true } : email));
  }, []);

  const deleteEmail = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmails(prev => prev.map(email => email.id === id ? { ...email, deleted: true } : email));
  }, []);

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
