import type { TaskPriority } from './task';

export interface TaskSuggestion {
  id: string;
  emailId: string;
  title: string;
  priority: 'Normal' | TaskPriority;
  group: 'now' | 'next';
  dueDate?: string;
  tags?: string[];
  confidence?: 'low' | 'medium' | 'high';
  reason: string;
  accepted: boolean;
}
