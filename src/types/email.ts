export type GmailAccountId = 'primary' | 'secondary';

export interface Email {
  accountId: GmailAccountId;
  id: string;
  /** Gmail thread ID this message belongs to */
  threadId?: string;
  /** Total number of messages in the thread (≥ 1) */
  messageCount?: number;
  sender: string;
  senderEmail?: string;
  initials: string;
  /** Absolute Gmail receive timestamp; formatted in the browser's local timezone. */
  receivedAt?: string | null;
  time: string;
  subject: string;
  preview: string;
  unread: boolean;
  urgent: boolean;
  archived: boolean;
  deleted: boolean;
}

/** A single message within a thread, returned by GET /api/gmail/thread/:threadId */
export interface ThreadMessage {
  accountId: GmailAccountId;
  id: string;
  sender: string;
  senderEmail: string;
  initials: string;
  /** Absolute Gmail receive timestamp; formatted in the browser's local timezone. */
  receivedAt?: string | null;
  time: string;
  body: string;
  /** Server-sanitized HTML when the MIME tree included text/html (safe for `dangerouslySetInnerHTML`). */
  bodyHtml?: string | null;
  unread: boolean;
}
