export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  completed: boolean;
  group: 'now' | 'next';
}

