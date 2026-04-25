import type { TaskPriority } from './task';

export interface TaskSuggestion {
  id: string;
  emailId: string;
  title: string;
  priority: 'Normal' | TaskPriority;
  group: 'now' | 'next';
  reason: string;
  accepted: boolean;
}
