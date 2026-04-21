import { createContext, useContext } from 'react';
import type React from 'react';
import type { Email } from '../types/email';

export interface EmailState {
  emails: Email[];
  gmailConnected: boolean;
  emailsLoading: boolean;
  /** true when a network/server error prevented the last fetch (distinct from "not authenticated") */
  serverError: boolean;
}

export interface EmailActions {
  /** e is optional so all actions can be called programmatically without a fake MouseEvent */
  toggleRead: (id: string, e?: React.MouseEvent) => void;
  archiveEmail: (id: string, e?: React.MouseEvent) => void;
  deleteEmail: (id: string, e?: React.MouseEvent) => void;
  refreshEmails: () => void;
}

export interface EmailContextValue {
  state: EmailState;
  actions: EmailActions;
}

export const EmailContext = createContext<EmailContextValue | null>(null);

export function useEmailContext() {
  const ctx = useContext(EmailContext);
  if (!ctx) throw new Error('useEmailContext must be used within EmailProvider');
  return ctx;
}

