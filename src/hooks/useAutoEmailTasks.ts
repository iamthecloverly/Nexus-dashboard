import { useEffect, useRef } from 'react';
import { useEmailContext } from '../contexts/emailContext';
import { useTaskContext } from '../contexts/taskContext';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { GmailAccountId } from '../types/email';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';

const MAX_STORED_IDS = 400; // cap to avoid localStorage bloat
const ACCOUNTS: GmailAccountId[] = ['primary', 'secondary'];
type ExtractionMode = 'auto' | 'starred';
type ExtractionJob = { accountId: GmailAccountId; mode: ExtractionMode; emailIds: string[] };

function loadProcessedIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveProcessedIds(key: string, ids: Set<string>) {
  // Keep only the most recent IDs to prevent unbounded growth
  const arr = [...ids].slice(-MAX_STORED_IDS);
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* quota exceeded */ }
}

function taskTagsForMode(mode: ExtractionMode, tags: unknown): string[] {
  const base = mode === 'starred' ? ['email', 'starred'] : ['email'];
  const aiTags = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return Array.from(new Set([...base, ...aiTags])).slice(0, 5);
}

export function useAutoEmailTasks() {
  const { state: { emailsByAccount, connectedByAccount, emailsLoadingByAccount } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();

  // Persisted sets of email IDs already processed by auto-extraction
  const processedUnreadRef = useRef<Set<string>>(loadProcessedIds(STORAGE_KEYS.autoProcessedEmailIds));
  const processedStarredRef = useRef<Set<string>>(loadProcessedIds(STORAGE_KEYS.autoProcessedStarredEmailIds));
  // Runtime-only guard so failed requests stay retryable while in-flight requests don't duplicate work.
  const processingRef = useRef<Set<string>>(new Set());
  // Each account has its own initial sync; existing unread mail should not be auto-converted.
  const initializedAccountsRef = useRef<Set<GmailAccountId>>(new Set());
  // Prevent concurrent runs
  const isProcessingRef = useRef(false);

  useEffect(() => {
    let initializedThisPass = false;
    for (const accountId of ACCOUNTS) {
      if (initializedAccountsRef.current.has(accountId)) continue;
      if (emailsLoadingByAccount[accountId]) continue;
      if (!connectedByAccount[accountId] && emailsByAccount[accountId].length === 0) continue;

      emailsByAccount[accountId].forEach(e => {
        const key = `${e.accountId}:${e.id}`;
        processedUnreadRef.current.add(key);
        if (e.urgent) processedStarredRef.current.add(key);
      });
      initializedAccountsRef.current.add(accountId);
      initializedThisPass = true;
    }

    if (initializedThisPass) {
      saveProcessedIds(STORAGE_KEYS.autoProcessedEmailIds, processedUnreadRef.current);
      saveProcessedIds(STORAGE_KEYS.autoProcessedStarredEmailIds, processedStarredRef.current);
    }

    if (isProcessingRef.current) return;

    const candidateEmails = ACCOUNTS
      .filter(accountId => initializedAccountsRef.current.has(accountId))
      .flatMap(accountId => emailsByAccount[accountId])
      .filter(e => !e.archived && !e.deleted);

    const newStarredEmails = candidateEmails
      .filter(e => {
        const key = `${e.accountId}:${e.id}`;
        return e.urgent && !processedStarredRef.current.has(key) && !processingRef.current.has(key);
      });

    const starredKeys = new Set(newStarredEmails.map(e => `${e.accountId}:${e.id}`));
    const newUnreadEmails = candidateEmails
      .filter(e => {
        const key = `${e.accountId}:${e.id}`;
        return e.unread && !starredKeys.has(key) && !processedUnreadRef.current.has(key) && !processingRef.current.has(key);
      });

    const newEmails = [...newStarredEmails, ...newUnreadEmails];
    if (newEmails.length === 0) return;

    newEmails.forEach(e => processingRef.current.add(`${e.accountId}:${e.id}`));

    isProcessingRef.current = true;

    (async () => {
      try {
        const jobsByKey = new Map<string, ExtractionJob>();
        for (const e of newStarredEmails) {
          const key = `${e.accountId}:starred`;
          const job = jobsByKey.get(key) ?? { accountId: e.accountId, mode: 'starred', emailIds: [] };
          job.emailIds.push(e.id);
          jobsByKey.set(key, job);
        }
        for (const e of newUnreadEmails) {
          const key = `${e.accountId}:auto`;
          const job = jobsByKey.get(key) ?? { accountId: e.accountId, mode: 'auto', emailIds: [] };
          job.emailIds.push(e.id);
          jobsByKey.set(key, job);
        }

        let totalAdded = 0;
        await Array.from(jobsByKey.values()).reduce(async (p, job) => {
          await p;
          const res = await fetchWithTimeout(`/api/ai/extract-tasks-bulk?accountId=${encodeURIComponent(job.accountId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({ emailIds: job.emailIds, mode: job.mode }),
            timeoutMs: 30_000,
          });

          // Silently skip if AI key not configured or any server error, but leave
          // these IDs retryable for the next successful poll.
          if (!res.ok) return;

          const data = await res.json();
          if (job.mode === 'starred') {
            job.emailIds.forEach(id => processedStarredRef.current.add(`${job.accountId}:${id}`));
            saveProcessedIds(STORAGE_KEYS.autoProcessedStarredEmailIds, processedStarredRef.current);
          } else {
            job.emailIds.forEach(id => processedUnreadRef.current.add(`${job.accountId}:${id}`));
            saveProcessedIds(STORAGE_KEYS.autoProcessedEmailIds, processedUnreadRef.current);
          }
          if (!data.suggestions?.length) return;

          for (const s of data.suggestions) {
            const tags = taskTagsForMode(job.mode, s.tags);
            addTask({
              id: s.id,
              title: s.title,
              priority: s.priority === 'Normal' ? undefined : s.priority,
              dueDate: typeof s.dueDate === 'string' ? s.dueDate : undefined,
              completed: false,
              group: s.group,
              source: { type: 'email', id: s.emailId, label: job.mode === 'starred' ? 'AI starred email' : 'AI auto extraction' },
              createdAt: new Date().toISOString(),
              tags,
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
        newEmails.forEach(e => processingRef.current.delete(`${e.accountId}:${e.id}`));
        isProcessingRef.current = false;
      }
    })();
  }, [emailsByAccount, connectedByAccount, emailsLoadingByAccount, addTask, showToast]);
}
