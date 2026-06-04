import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEmailContext, type EmailContextValue, type EmailState } from '../../contexts/emailContext';
import { useTaskContext, type TaskContextValue } from '../../contexts/taskContext';
import { useToast } from '../../components/Toast';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import type { Email, GmailAccountId } from '../../types/email';
import { useAutoEmailTasks } from '../useAutoEmailTasks';

vi.mock('../../contexts/emailContext', () => ({
  useEmailContext: vi.fn(),
}));

vi.mock('../../contexts/taskContext', () => ({
  useTaskContext: vi.fn(),
}));

vi.mock('../../components/Toast', () => ({
  useToast: vi.fn(),
}));

const mockedUseEmailContext = vi.mocked(useEmailContext);
const mockedUseTaskContext = vi.mocked(useTaskContext);
const mockedUseToast = vi.mocked(useToast);

let emailState: EmailState;
const addTask = vi.fn();
const showToast = vi.fn();

function email(accountId: GmailAccountId, id: string, overrides: Partial<Email> = {}): Email {
  return {
    accountId,
    id,
    sender: 'sender',
    initials: 'S',
    time: 'Now',
    subject: id,
    preview: id,
    unread: true,
    urgent: false,
    archived: false,
    deleted: false,
    ...overrides,
  };
}

function state(overrides: Partial<EmailState> = {}): EmailState {
  return {
    emailsByAccount: { primary: [], secondary: [] },
    connectedByAccount: { primary: false, secondary: false },
    emailsLoadingByAccount: { primary: false, secondary: false },
    serverErrorByAccount: { primary: false, secondary: false },
    ...overrides,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAutoEmailTasks', () => {
  beforeEach(() => {
    addTask.mockReset();
    showToast.mockReset();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      suggestions: [{
        id: 'task-from-email',
        title: 'Follow up',
        priority: 'Normal',
        group: 'next',
        emailId: 's-new',
        dueDate: '2026-06-08',
        tags: ['reply', 'school'],
      }],
    }), { status: 200 })));

    emailState = state();
    mockedUseEmailContext.mockImplementation((): EmailContextValue => ({
      state: emailState,
      actions: {
        toggleRead: vi.fn(),
        archiveEmail: vi.fn(),
        deleteEmail: vi.fn(),
        refreshEmails: vi.fn(),
        markAllRead: vi.fn(),
        fetchThread: vi.fn(async () => []),
      },
    }));
    mockedUseTaskContext.mockImplementation((): TaskContextValue => ({
      state: { tasks: [] },
      actions: {
        toggleTask: vi.fn(),
        addTask,
        deleteTask: vi.fn(),
        updateTask: vi.fn(),
        clearCompletedTasks: vi.fn(),
      },
    }));
    mockedUseToast.mockImplementation(() => ({ showToast }));
  });

  it('does not process a secondary inbox first seen after primary initial sync', async () => {
    const primaryOld = email('primary', 'p-old');
    const secondaryOld = email('secondary', 's-old');
    const secondaryNew = email('secondary', 's-new');
    emailState = state({
      emailsByAccount: { primary: [primaryOld], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
      emailsLoadingByAccount: { primary: false, secondary: true },
    });

    const { rerender } = renderHook(() => useAutoEmailTasks());
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();

    emailState = state({
      emailsByAccount: { primary: [primaryOld], secondary: [secondaryOld] },
      connectedByAccount: { primary: true, secondary: true },
      emailsLoadingByAccount: { primary: false, secondary: false },
    });
    rerender();
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();

    emailState = state({
      emailsByAccount: { primary: [primaryOld], secondary: [secondaryOld, secondaryNew] },
      connectedByAccount: { primary: true, secondary: true },
      emailsLoadingByAccount: { primary: false, secondary: false },
    });
    rerender();
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('accountId=secondary');
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-from-email',
      dueDate: '2026-06-08',
      tags: ['email', 'reply', 'school'],
      source: { type: 'email', id: 's-new', label: 'AI auto extraction' },
    }));
    expect(showToast).toHaveBeenCalledWith('1 task added from new email', 'success');
  });

  it('leaves failed auto-extraction emails retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'OpenAI API key not configured',
      code: 'NO_AI_KEY',
    }), { status: 503 })));

    const oldEmail = email('primary', 'p-old');
    const newEmail = email('primary', 'p-new');
    emailState = state({
      emailsByAccount: { primary: [oldEmail], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });

    const { rerender } = renderHook(() => useAutoEmailTasks());
    await flushPromises();

    emailState = state({
      emailsByAccount: { primary: [oldEmail, newEmail], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });
    rerender();
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    const processed = JSON.parse(localStorage.getItem(STORAGE_KEYS.autoProcessedEmailIds) ?? '[]') as string[];
    expect(processed).toContain('primary:p-old');
    expect(processed).not.toContain('primary:p-new');
    expect(addTask).not.toHaveBeenCalled();
  });

  it('does not process already-starred emails on initial sync', async () => {
    const oldStarred = email('primary', 'p-star-old', { urgent: true });
    emailState = state({
      emailsByAccount: { primary: [oldStarred], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });

    renderHook(() => useAutoEmailTasks());
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
    const processedStarred = JSON.parse(localStorage.getItem(STORAGE_KEYS.autoProcessedStarredEmailIds) ?? '[]') as string[];
    expect(processedStarred).toContain('primary:p-star-old');
  });

  it('processes newly starred primary and secondary emails in starred mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { emailIds?: string[]; mode?: string };
      const accountId = String(input).includes('secondary') ? 'secondary' : 'primary';
      return new Response(JSON.stringify({
        suggestions: (body.emailIds ?? []).map(id => ({
          id: `task-${id}`,
          title: `Review ${id}`,
          priority: 'Priority',
          group: 'next',
          emailId: id,
          tags: ['review'],
        })),
        accountId,
      }), { status: 200 });
    }));

    const primaryBase = email('primary', 'p-old');
    const secondaryBase = email('secondary', 's-old');
    emailState = state({
      emailsByAccount: { primary: [primaryBase], secondary: [secondaryBase] },
      connectedByAccount: { primary: true, secondary: true },
    });

    const { rerender } = renderHook(() => useAutoEmailTasks());
    await flushPromises();

    const primaryStarred = email('primary', 'p-star-new', { urgent: true });
    const secondaryStarred = email('secondary', 's-star-new', { urgent: true });
    emailState = state({
      emailsByAccount: { primary: [primaryBase, primaryStarred], secondary: [secondaryBase, secondaryStarred] },
      connectedByAccount: { primary: true, secondary: true },
    });
    rerender();
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(2);
    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body ?? '{}')));
    expect(bodies).toEqual(expect.arrayContaining([
      { emailIds: ['p-star-new'], mode: 'starred' },
      { emailIds: ['s-star-new'], mode: 'starred' },
    ]));
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-p-star-new',
      source: { type: 'email', id: 'p-star-new', label: 'AI starred email' },
      tags: ['email', 'starred', 'review'],
    }));
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-s-star-new',
      source: { type: 'email', id: 's-star-new', label: 'AI starred email' },
      tags: ['email', 'starred', 'review'],
    }));
  });

  it('does not duplicate a newly starred unread email through auto mode', async () => {
    const oldEmail = email('primary', 'p-old');
    emailState = state({
      emailsByAccount: { primary: [oldEmail], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });

    const { rerender } = renderHook(() => useAutoEmailTasks());
    await flushPromises();

    emailState = state({
      emailsByAccount: { primary: [oldEmail, email('primary', 'p-star-unread', { urgent: true, unread: true })], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });
    rerender();
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? '{}'));
    expect(body).toEqual({ emailIds: ['p-star-unread'], mode: 'starred' });
    expect(addTask).toHaveBeenCalledTimes(1);
  });

  it('leaves failed starred extraction emails retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'OpenAI API key not configured',
      code: 'NO_AI_KEY',
    }), { status: 503 })));

    const oldEmail = email('primary', 'p-old');
    emailState = state({
      emailsByAccount: { primary: [oldEmail], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });

    const { rerender } = renderHook(() => useAutoEmailTasks());
    await flushPromises();

    emailState = state({
      emailsByAccount: { primary: [oldEmail, email('primary', 'p-star-new', { urgent: true })], secondary: [] },
      connectedByAccount: { primary: true, secondary: false },
    });
    rerender();
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    const processedStarred = JSON.parse(localStorage.getItem(STORAGE_KEYS.autoProcessedStarredEmailIds) ?? '[]') as string[];
    expect(processedStarred).not.toContain('primary:p-star-new');
    expect(addTask).not.toHaveBeenCalled();
  });
});
