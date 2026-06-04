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
  const { state: { emailsByAccount, connectedByAccount, emailsLoadingByAccount } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();

  // Persisted set of email IDs already processed by auto-extraction
  const processedRef = useRef<Set<string>>(loadProcessedIds());
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

      emailsByAccount[accountId].forEach(e => processedRef.current.add(`${e.accountId}:${e.id}`));
      initializedAccountsRef.current.add(accountId);
      initializedThisPass = true;
    }

    if (initializedThisPass) {
      saveProcessedIds(processedRef.current);
    }

    if (isProcessingRef.current) return;

    const newEmails = ACCOUNTS
      .filter(accountId => initializedAccountsRef.current.has(accountId))
      .flatMap(accountId => emailsByAccount[accountId])
      .filter(e => {
        const key = `${e.accountId}:${e.id}`;
        return !e.archived && !e.deleted && e.unread && !processedRef.current.has(key) && !processingRef.current.has(key);
      });

    if (newEmails.length === 0) return;

    newEmails.forEach(e => processingRef.current.add(`${e.accountId}:${e.id}`));

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
          const res = await fetchWithTimeout(`/api/ai/extract-tasks-bulk?accountId=${encodeURIComponent(accountId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({ emailIds, mode: 'auto' }),
            timeoutMs: 30_000,
          });

          // Silently skip if AI key not configured or any server error, but leave
          // these IDs retryable for the next successful poll.
          if (!res.ok) return;

          const data = await res.json();
          emailIds.forEach(id => processedRef.current.add(`${accountId}:${id}`));
          saveProcessedIds(processedRef.current);
          if (!data.suggestions?.length) return;

          for (const s of data.suggestions) {
            addTask({
              id: s.id,
              title: s.title,
              priority: s.priority === 'Normal' ? undefined : s.priority,
              completed: false,
              group: s.group,
              source: { type: 'email', id: s.emailId, label: 'AI auto extraction' },
              createdAt: new Date().toISOString(),
              tags: ['email'],
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
