import type { TaskPriority } from './task';
import type { GmailAccountId } from './email';

export interface TaskSuggestion {
  id: string;
  emailId: string;
  accountId: GmailAccountId;
  threadId?: string;
  sender?: string;
  subject?: string;
  title: string;
  priority: 'Normal' | TaskPriority;
  group: 'now' | 'next';
  dueDate?: string;
  tags?: string[];
  confidence?: 'low' | 'medium' | 'high';
  reason: string;
  mode: 'manual' | 'auto' | 'starred';
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
  accepted: boolean;
}
