import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Email } from '../App';

interface EmailState {
  emails: Email[];
  gmailConnected: boolean;
  emailsLoading: boolean;
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

  const refreshEmails = useCallback(async () => {
    setEmailsLoading(true);
    try {
      const res = await fetch('/api/gmail/messages');
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails ?? []);
        setGmailConnected(true);
      } else {
        setGmailConnected(false);
      }
    } catch {
      setGmailConnected(false);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => { refreshEmails(); }, [refreshEmails]);

  const toggleRead = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmails(prev => prev.map(email => email.id === id ? { ...email, unread: !email.unread } : email));
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
      state: { emails, gmailConnected, emailsLoading },
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
