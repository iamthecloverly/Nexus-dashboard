import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Task } from '../types/task';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { TaskContext } from './taskContext';

const DEFAULT_TASKS: Task[] = [];

function isValidTask(t: unknown): t is Task {
  const task = t as Task;
  return (
    typeof t === 'object' && t !== null &&
    typeof task.id === 'string' && task.id.length > 0 &&
    typeof task.title === 'string' &&
    typeof task.completed === 'boolean' &&
    (task.group === 'now' || task.group === 'next') &&
    (task.tags === undefined || (Array.isArray(task.tags) && task.tags.every(tag => typeof tag === 'string')))
  );
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.tasks);
      if (!saved) return DEFAULT_TASKS;
      const parsed = JSON.parse(saved);
      // Discard any entries that don't match the Task shape — guards against corrupted storage
      return Array.isArray(parsed) ? parsed.filter(isValidTask) : DEFAULT_TASKS;
    } catch {
      return DEFAULT_TASKS;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks)); } catch { /* quota exceeded */ }
  }, [tasks]);

  const toggleTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  }, []);

  const addTask = useCallback((task: Task) => {
    setTasks(prev => [...prev, task]);
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTask = useCallback((id: string, changes: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t));
  }, []);

  const clearCompletedTasks = useCallback(() => {
    setTasks(prev => prev.filter(t => !t.completed));
  }, []);

  return (
    <TaskContext.Provider value={{
      state: { tasks },
      actions: { toggleTask, addTask, deleteTask, updateTask, clearCompletedTasks },
    }}>
      {children}
    </TaskContext.Provider>
  );
}

