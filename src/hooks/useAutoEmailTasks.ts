import { useEffect, useRef } from 'react';
import { useEmailContext } from '../contexts/emailContext';
import { useTaskContext } from '../contexts/taskContext';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';

const MAX_STORED_IDS = 400; // cap to avoid localStorage bloat

function loadProcessedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.autoProcessedEmailIds);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveProcessedIds(ids: Set<string>) {
  // Keep only the most recent IDs to prevent unbounded growth
  const arr = [...ids].slice(-MAX_STORED_IDS);
  try { localStorage.setItem(STORAGE_KEYS.autoProcessedEmailIds, JSON.stringify(arr)); } catch { /* quota exceeded */ }
}

export function useAutoEmailTasks() {
  const { state: { emailsByAccount } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();

  // Persisted set of email IDs already processed by auto-extraction
  const processedRef = useRef<Set<string>>(loadProcessedIds());
  // Prevent concurrent runs
  const isProcessingRef = useRef(false);
  // First render flag — mark existing emails as seen without processing them
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    const allEmails = [...emailsByAccount.primary, ...emailsByAccount.secondary];
    if (allEmails.length === 0) return;

    // On first load, mark all currently visible emails as already seen
    // so we only process genuinely new emails arriving after this point
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      allEmails.forEach(e => processedRef.current.add(`${e.accountId}:${e.id}`));
      saveProcessedIds(processedRef.current);
      return;
    }

    if (isProcessingRef.current) return;

    const newEmails = allEmails.filter(e => {
      const key = `${e.accountId}:${e.id}`;
      return !e.archived && !e.deleted && e.unread && !processedRef.current.has(key);
    });

    if (newEmails.length === 0) return;

    // Mark as processed immediately — prevents re-processing on rapid re-renders
    newEmails.forEach(e => processedRef.current.add(`${e.accountId}:${e.id}`));
    saveProcessedIds(processedRef.current);

    isProcessingRef.current = true;

    (async () => {
      try {
        const byAccount = newEmails.reduce<Record<string, string[]>>((acc, e) => {
          (acc[e.accountId] ??= []).push(e.id);
          return acc;
        }, {});

        let totalAdded = 0;
        await Object.entries(byAccount).reduce(async (p, [accountId, emailIds]) => {
          await p;
          const res = await fetch(`/api/ai/extract-tasks-bulk?accountId=${encodeURIComponent(accountId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({ emailIds, mode: 'auto' }),
          });

          // Silently skip if AI key not configured or any server error
          if (!res.ok) return;

          const data = await res.json();
          if (!data.suggestions?.length) return;

          for (const s of data.suggestions) {
            addTask({
              id: s.id,
              title: s.title,
              priority: s.priority === 'Normal' ? undefined : s.priority,
              completed: false,
              group: s.group,
            });
          }
          totalAdded += data.suggestions.length;
        }, Promise.resolve());

        if (totalAdded > 0) {
          showToast(`${totalAdded} task${totalAdded !== 1 ? 's' : ''} added from new email${newEmails.length !== 1 ? 's' : ''}`, 'success');
        }
      } catch {
        // Auto mode fails silently — never interrupt the user
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [emailsByAccount, addTask, showToast]);
}
