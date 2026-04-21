import { createContext, useContext } from 'react';
import type { Task } from '../types/task';

export interface TaskState {
  tasks: Task[];
}

export interface TaskActions {
  toggleTask: (id: string) => void;
  addTask: (task: Task) => void;
  deleteTask: (id: string) => void;
  updateTask: (id: string, changes: Partial<Task>) => void;
  clearCompletedTasks: () => void;
}

export interface TaskContextValue {
  state: TaskState;
  actions: TaskActions;
}

export const TaskContext = createContext<TaskContextValue | null>(null);

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}

