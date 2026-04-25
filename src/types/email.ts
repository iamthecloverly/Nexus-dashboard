export interface Email {
  id: string;
  /** Gmail thread ID this message belongs to */
  threadId?: string;
  /** Total number of messages in the thread (≥ 1) */
  messageCount?: number;
  sender: string;
  senderEmail?: string;
  initials: string;
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
  id: string;
  sender: string;
  senderEmail: string;
  initials: string;
  time: string;
  body: string;
  unread: boolean;
}

