import { useEffect, useRef } from 'react';
import { useEmailContext } from '../contexts/emailContext';
import { useTaskContext } from '../contexts/taskContext';
import { useTaskSuggestionQueue } from '../contexts/taskSuggestionQueueContext';
import { useToast } from '../components/Toast';
import { csrfHeaders } from '../lib/csrf';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { Email, GmailAccountId } from '../types/email';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import type { TaskSuggestion } from '../types/taskSuggestion';

const MAX_STORED_IDS = 400; // cap to avoid localStorage bloat
const ACCOUNTS: GmailAccountId[] = ['primary', 'secondary'];
type ExtractionMode = 'auto' | 'starred';
type ExtractionJob = { accountId: GmailAccountId; mode: ExtractionMode; emailIds: string[] };
type ProcessedEmail = { emailId: string; status: 'suggested' | 'no_action' | 'skipped' | 'error'; reason?: string };
type ExtractTasksResponse = {
  suggestions?: Partial<TaskSuggestion>[];
  processed?: ProcessedEmail[];
};

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

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSuggestion(
  raw: Partial<TaskSuggestion>,
  job: ExtractionJob,
  emailById: Map<string, Email>,
): TaskSuggestion | null {
  if (typeof raw.id !== 'string' || typeof raw.emailId !== 'string' || typeof raw.title !== 'string') return null;
  const sourceEmail = emailById.get(raw.emailId);
  const priority = raw.priority === 'Priority' || raw.priority === 'Critical' ? raw.priority : 'Normal';
  const group = raw.group === 'next' ? 'next' : 'now';
  const tags = taskTagsForMode(job.mode, raw.tags);
  return {
    id: raw.id,
    emailId: raw.emailId,
    accountId: raw.accountId === 'primary' || raw.accountId === 'secondary' ? raw.accountId : job.accountId,
    threadId: typeof raw.threadId === 'string' ? raw.threadId : sourceEmail?.threadId,
    sender: typeof raw.sender === 'string' ? raw.sender : sourceEmail?.sender,
    subject: typeof raw.subject === 'string' ? raw.subject : sourceEmail?.subject,
    title: raw.title,
    priority,
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : undefined,
    group,
    tags,
    confidence: raw.confidence === 'low' || raw.confidence === 'medium' || raw.confidence === 'high' ? raw.confidence : 'medium',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    mode: raw.mode === 'manual' || raw.mode === 'auto' || raw.mode === 'starred' ? raw.mode : job.mode,
    status: raw.status === 'accepted' || raw.status === 'dismissed' ? raw.status : 'pending',
    accepted: raw.accepted ?? true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

export function useAutoEmailTasks() {
  const { state: { emailsByAccount, connectedByAccount, emailsLoadingByAccount } } = useEmailContext();
  const { state: { tasks } } = useTaskContext();
  const { actions: { enqueueSuggestions } } = useTaskSuggestionQueue();
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

        let totalQueued = 0;
        await Array.from(jobsByKey.values()).reduce(async (p, job) => {
          await p;
          const emailById = new Map<string, Email>(
            emailsByAccount[job.accountId]
              .filter(e => job.emailIds.includes(e.id))
              .map(e => [e.id, e]),
          );
          const res = await fetchWithTimeout(`/api/ai/extract-tasks-bulk?accountId=${encodeURIComponent(job.accountId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({
              emailIds: job.emailIds,
              mode: job.mode,
              clientToday: localDateKey(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              existingTasks: tasks
                .filter(task => !task.completed)
                .slice(-40)
                .map(task => ({
                  title: task.title,
                  dueDate: task.dueDate,
                  sourceEmailId: task.source?.type === 'email' ? task.source.id : undefined,
                })),
            }),
            timeoutMs: 30_000,
          });

          // Silently skip if AI key not configured or any server error, but leave
          // these IDs retryable for the next successful poll.
          if (!res.ok) return;

          const data = await res.json() as ExtractTasksResponse;
          const retryableIds = new Set((data.processed ?? [])
            .filter(item => item.status === 'error')
            .map(item => item.emailId));
          const processedIds = job.emailIds.filter(id => !retryableIds.has(id));
          if (job.mode === 'starred') {
            processedIds.forEach(id => processedStarredRef.current.add(`${job.accountId}:${id}`));
            saveProcessedIds(STORAGE_KEYS.autoProcessedStarredEmailIds, processedStarredRef.current);
          } else {
            processedIds.forEach(id => processedUnreadRef.current.add(`${job.accountId}:${id}`));
            saveProcessedIds(STORAGE_KEYS.autoProcessedEmailIds, processedUnreadRef.current);
          }
          if (!data.suggestions?.length) return;

          const suggestions = data.suggestions
            .map(s => normalizeSuggestion(s, job, emailById))
            .filter((s): s is TaskSuggestion => !!s);
          enqueueSuggestions(suggestions);
          totalQueued += suggestions.length;
        }, Promise.resolve());

        if (totalQueued > 0) {
          showToast(`${totalQueued} AI task suggestion${totalQueued !== 1 ? 's' : ''} ready for review`, 'success');
        }
      } catch {
        // Auto mode fails silently — never interrupt the user
      } finally {
        newEmails.forEach(e => processingRef.current.delete(`${e.accountId}:${e.id}`));
        isProcessingRef.current = false;
      }
    })();
  }, [emailsByAccount, connectedByAccount, emailsLoadingByAccount, enqueueSuggestions, showToast, tasks]);
}
