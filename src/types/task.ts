export type TaskPriority = 'Priority' | 'Critical';

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string; // ISO date string, e.g. "2025-06-30"
  completed: boolean;
  group: 'now' | 'next';
}

