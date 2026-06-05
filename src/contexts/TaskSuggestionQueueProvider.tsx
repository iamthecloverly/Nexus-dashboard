import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { TaskSuggestion } from '../types/taskSuggestion';
import { TaskSuggestionQueueContext } from './taskSuggestionQueueContext';

const MAX_STORED_SUGGESTIONS = 200;

function isValidSuggestion(value: unknown): value is TaskSuggestion {
  const suggestion = value as TaskSuggestion;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof suggestion.id === 'string' &&
    typeof suggestion.emailId === 'string' &&
    (suggestion.accountId === 'primary' || suggestion.accountId === 'secondary') &&
    typeof suggestion.title === 'string' &&
    (suggestion.priority === 'Normal' || suggestion.priority === 'Priority' || suggestion.priority === 'Critical') &&
    (suggestion.group === 'now' || suggestion.group === 'next') &&
    (suggestion.dueDate === undefined || typeof suggestion.dueDate === 'string') &&
    (suggestion.threadId === undefined || typeof suggestion.threadId === 'string') &&
    (suggestion.sender === undefined || typeof suggestion.sender === 'string') &&
    (suggestion.subject === undefined || typeof suggestion.subject === 'string') &&
    (suggestion.tags === undefined || (Array.isArray(suggestion.tags) && suggestion.tags.every(tag => typeof tag === 'string'))) &&
    (suggestion.confidence === undefined || suggestion.confidence === 'low' || suggestion.confidence === 'medium' || suggestion.confidence === 'high') &&
    typeof suggestion.reason === 'string' &&
    (suggestion.mode === 'manual' || suggestion.mode === 'auto' || suggestion.mode === 'starred') &&
    (suggestion.status === 'pending' || suggestion.status === 'accepted' || suggestion.status === 'dismissed') &&
    typeof suggestion.createdAt === 'string' &&
    typeof suggestion.accepted === 'boolean'
  );
}

function loadSuggestions(): TaskSuggestion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.aiTaskSuggestions);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidSuggestion) : [];
  } catch {
    return [];
  }
}

function suggestionKey(suggestion: Pick<TaskSuggestion, 'accountId' | 'emailId' | 'title'>): string {
  return [
    suggestion.accountId,
    suggestion.emailId,
    suggestion.title.toLowerCase().replace(/\s+/g, ' ').trim(),
  ].join(':');
}

function trimStoredSuggestions(suggestions: TaskSuggestion[]): TaskSuggestion[] {
  return suggestions
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-MAX_STORED_SUGGESTIONS);
}

export function TaskSuggestionQueueProvider({ children }: { children: ReactNode }) {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>(loadSuggestions);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.aiTaskSuggestions, JSON.stringify(trimStoredSuggestions(suggestions)));
    } catch {
      // quota exceeded
    }
  }, [suggestions]);

  const enqueueSuggestions = useCallback((incoming: TaskSuggestion[]) => {
    if (incoming.length === 0) return;
    setSuggestions(prev => {
      const seenIds = new Set(prev.map(s => s.id));
      const seenKeys = new Set(prev.map(suggestionKey));
      const next = [...prev];
      for (const suggestion of incoming) {
        const normalized: TaskSuggestion = {
          ...suggestion,
          status: suggestion.status ?? 'pending',
          accepted: suggestion.accepted ?? true,
          createdAt: suggestion.createdAt || new Date().toISOString(),
        };
        const key = suggestionKey(normalized);
        if (seenIds.has(normalized.id) || seenKeys.has(key)) continue;
        seenIds.add(normalized.id);
        seenKeys.add(key);
        next.push(normalized);
      }
      return trimStoredSuggestions(next);
    });
  }, []);

  const updateSuggestion = useCallback((id: string, changes: Partial<TaskSuggestion>) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, ...changes, id: s.id } : s));
  }, []);

  const markAccepted = useCallback((ids: string[]) => {
    const accepted = new Set(ids);
    if (accepted.size === 0) return;
    setSuggestions(prev => prev.map(s => accepted.has(s.id) ? { ...s, status: 'accepted', accepted: true } : s));
  }, []);

  const dismissSuggestions = useCallback((ids: string[]) => {
    const dismissed = new Set(ids);
    if (dismissed.size === 0) return;
    setSuggestions(prev => prev.map(s => dismissed.has(s.id) ? { ...s, status: 'dismissed', accepted: false } : s));
  }, []);

  const clearResolved = useCallback(() => {
    setSuggestions(prev => prev.filter(s => s.status === 'pending'));
  }, []);

  const pendingSuggestions = useMemo(
    () => suggestions.filter(s => s.status === 'pending'),
    [suggestions],
  );

  const value = useMemo(() => ({
    state: {
      suggestions,
      pendingSuggestions,
      pendingCount: pendingSuggestions.length,
    },
    actions: {
      enqueueSuggestions,
      updateSuggestion,
      markAccepted,
      dismissSuggestions,
      clearResolved,
    },
  }), [clearResolved, dismissSuggestions, enqueueSuggestions, markAccepted, pendingSuggestions, suggestions, updateSuggestion]);

  return (
    <TaskSuggestionQueueContext.Provider value={value}>
      {children}
    </TaskSuggestionQueueContext.Provider>
  );
}
