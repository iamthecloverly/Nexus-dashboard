export type TaskPriority = 'Priority' | 'Critical';

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string; // ISO date string, e.g. "2025-06-30"
  tags?: string[]; // Task tags/labels
  deferredUntil?: string; // ISO date string; hidden from active lists until this local day
  source?: {
    type: 'manual' | 'email' | 'calendar';
    id?: string;
    label?: string;
  };
  createdAt?: string;
  completed: boolean;
  group: 'now' | 'next';
}
