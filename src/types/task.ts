export type TaskPriority = 'Priority' | 'Critical';
export type TaskSourceType = 'manual' | 'email' | 'calendar';

export interface TaskSource {
  type: TaskSourceType;
  id?: string;
  label?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string; // ISO date string, e.g. "2025-06-30"
  tags?: string[]; // Task tags/labels
  deferredUntil?: string; // ISO date string; hidden from active lists until this local day
  source?: TaskSource;
  createdAt?: string;
  completed: boolean;
  group: 'now' | 'next';
}
