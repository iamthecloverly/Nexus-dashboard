import { createContext, useContext } from 'react';
import type { TaskSuggestion } from '../types/taskSuggestion';

interface TaskSuggestionQueueState {
  suggestions: TaskSuggestion[];
  pendingSuggestions: TaskSuggestion[];
  pendingCount: number;
}

interface TaskSuggestionQueueActions {
  enqueueSuggestions: (suggestions: TaskSuggestion[]) => void;
  updateSuggestion: (id: string, changes: Partial<TaskSuggestion>) => void;
  markAccepted: (ids: string[]) => void;
  dismissSuggestions: (ids: string[]) => void;
  clearResolved: () => void;
}

export interface TaskSuggestionQueueContextValue {
  state: TaskSuggestionQueueState;
  actions: TaskSuggestionQueueActions;
}

export const TaskSuggestionQueueContext = createContext<TaskSuggestionQueueContextValue | null>(null);

export function useTaskSuggestionQueue() {
  const ctx = useContext(TaskSuggestionQueueContext);
  if (!ctx) throw new Error('useTaskSuggestionQueue must be used within TaskSuggestionQueueProvider');
  return ctx;
}
