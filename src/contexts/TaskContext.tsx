import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Task } from '../App';

interface TaskState {
  tasks: Task[];
}

interface TaskActions {
  toggleTask: (id: string) => void;
  addTask: (task: Task) => void;
  deleteTask: (id: string) => void;
  updateTask: (id: string, changes: Partial<Task>) => void;
  clearCompletedTasks: () => void;
}

interface TaskContextValue {
  state: TaskState;
  actions: TaskActions;
}

const TaskContext = createContext<TaskContextValue | null>(null);

const DEFAULT_TASKS: Task[] = [];

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem('dashboard_tasks');
      return saved ? JSON.parse(saved) : DEFAULT_TASKS;
    } catch {
      return DEFAULT_TASKS;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('dashboard_tasks', JSON.stringify(tasks)); } catch { /* quota exceeded */ }
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
    <TaskContext value={{
      state: { tasks },
      actions: { toggleTask, addTask, deleteTask, updateTask, clearCompletedTasks },
    }}>
      {children}
    </TaskContext>
  );
}

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}
