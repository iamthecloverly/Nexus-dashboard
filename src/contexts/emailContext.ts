import { createContext, useContext } from 'react';
import type React from 'react';
import type { Email, GmailAccountId, ThreadMessage } from '../types/email';

export interface EmailState {
  emailsByAccount: Record<GmailAccountId, Email[]>;
  connectedByAccount: Record<GmailAccountId, boolean>;
  emailsLoadingByAccount: Record<GmailAccountId, boolean>;
  /** true when a network/server error prevented the last fetch (distinct from "not authenticated") */
  serverErrorByAccount: Record<GmailAccountId, boolean>;
}

export interface EmailActions {
  /** e is optional so all actions can be called programmatically without a fake MouseEvent */
  toggleRead: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  archiveEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  deleteEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  refreshEmails: (accountId: GmailAccountId) => void;
  markAllRead: (accountId: GmailAccountId) => void;
  /** Fetches all messages in a thread by threadId. Returns empty array on error. */
  fetchThread: (accountId: GmailAccountId, threadId: string) => Promise<ThreadMessage[]>;
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

