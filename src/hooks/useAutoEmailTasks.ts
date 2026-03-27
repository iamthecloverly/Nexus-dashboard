import { useEffect, useRef } from 'react';
import { useEmailContext } from '../contexts/EmailContext';
import { useTaskContext } from '../contexts/TaskContext';
import { useToast } from '../components/Toast';

const STORAGE_KEY = 'auto_processed_email_ids';
const MAX_STORED_IDS = 400; // cap to avoid localStorage bloat

function loadProcessedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveProcessedIds(ids: Set<string>) {
  // Keep only the most recent IDs to prevent unbounded growth
  const arr = [...ids].slice(-MAX_STORED_IDS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* quota exceeded */ }
}

export function useAutoEmailTasks() {
  const { state: { emails } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();

  // Persisted set of email IDs already processed by auto-extraction
  const processedRef = useRef<Set<string>>(loadProcessedIds());
  // Prevent concurrent runs
  const isProcessingRef = useRef(false);
  // First render flag — mark existing emails as seen without processing them
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (emails.length === 0) return;

    // On first load, mark all currently visible emails as already seen
    // so we only process genuinely new emails arriving after this point
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      emails.forEach(e => processedRef.current.add(e.id));
      saveProcessedIds(processedRef.current);
      return;
    }

    if (isProcessingRef.current) return;

    const newIds = emails
      .filter(e => !e.archived && !e.deleted && e.unread && !processedRef.current.has(e.id))
      .map(e => e.id);

    if (newIds.length === 0) return;

    // Mark as processed immediately — prevents re-processing on rapid re-renders
    newIds.forEach(id => processedRef.current.add(id));
    saveProcessedIds(processedRef.current);

    isProcessingRef.current = true;

    (async () => {
      try {
        const res = await fetch('/api/ai/extract-tasks-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailIds: newIds, mode: 'auto' }),
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

        const n = data.suggestions.length;
        showToast(`${n} task${n !== 1 ? 's' : ''} added from new email${newIds.length !== 1 ? 's' : ''}`, 'success');
      } catch {
        // Auto mode fails silently — never interrupt the user
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [emails, addTask, showToast]);
}
