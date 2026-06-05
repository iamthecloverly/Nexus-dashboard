import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '../../constants/storageKeys';
import { TaskSuggestionQueueProvider } from '../TaskSuggestionQueueProvider';
import { useTaskSuggestionQueue } from '../taskSuggestionQueueContext';
import type { TaskSuggestion } from '../../types/taskSuggestion';

function suggestion(overrides: Partial<TaskSuggestion> = {}): TaskSuggestion {
  return {
    id: 'suggestion-1',
    emailId: 'email-1',
    accountId: 'primary',
    title: 'Reply to Alex',
    priority: 'Normal',
    group: 'next',
    tags: ['email', 'reply'],
    confidence: 'high',
    reason: 'The sender asked for a response.',
    mode: 'auto',
    status: 'pending',
    accepted: true,
    createdAt: '2026-06-05T12:00:00.000Z',
    ...overrides,
  };
}

function Consumer({ onRender }: { onRender: (ctx: ReturnType<typeof useTaskSuggestionQueue>) => void }) {
  const ctx = useTaskSuggestionQueue();
  onRender(ctx);
  return null;
}

function renderWithProvider(onRender: (ctx: ReturnType<typeof useTaskSuggestionQueue>) => void) {
  return render(
    <TaskSuggestionQueueProvider>
      <Consumer onRender={onRender} />
    </TaskSuggestionQueueProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('TaskSuggestionQueueProvider', () => {
  it('starts empty when there is no saved queue', () => {
    let ctx!: ReturnType<typeof useTaskSuggestionQueue>;
    renderWithProvider(c => { ctx = c; });

    expect(ctx.state.pendingCount).toBe(0);
    expect(ctx.state.pendingSuggestions).toEqual([]);
  });

  it('enqueues pending suggestions and persists them', async () => {
    let ctx!: ReturnType<typeof useTaskSuggestionQueue>;
    renderWithProvider(c => { ctx = c; });

    act(() => ctx.actions.enqueueSuggestions([suggestion()]));

    await waitFor(() => expect(ctx.state.pendingCount).toBe(1));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiTaskSuggestions) ?? '[]') as TaskSuggestion[];
    expect(stored[0]?.title).toBe('Reply to Alex');
  });

  it('marks accepted suggestions as resolved', async () => {
    let ctx!: ReturnType<typeof useTaskSuggestionQueue>;
    renderWithProvider(c => { ctx = c; });

    act(() => ctx.actions.enqueueSuggestions([suggestion()]));
    await waitFor(() => expect(ctx.state.pendingCount).toBe(1));

    act(() => ctx.actions.markAccepted(['suggestion-1']));

    await waitFor(() => expect(ctx.state.pendingCount).toBe(0));
    expect(ctx.state.suggestions[0]?.status).toBe('accepted');
  });

  it('keeps dismissed suggestions from being re-enqueued', async () => {
    let ctx!: ReturnType<typeof useTaskSuggestionQueue>;
    renderWithProvider(c => { ctx = c; });

    act(() => ctx.actions.enqueueSuggestions([suggestion()]));
    await waitFor(() => expect(ctx.state.pendingCount).toBe(1));

    act(() => ctx.actions.dismissSuggestions(['suggestion-1']));
    await waitFor(() => expect(ctx.state.pendingCount).toBe(0));

    act(() => ctx.actions.enqueueSuggestions([suggestion({ id: 'suggestion-2' })]));

    await waitFor(() => expect(ctx.state.pendingCount).toBe(0));
    expect(ctx.state.suggestions).toHaveLength(1);
    expect(ctx.state.suggestions[0]?.status).toBe('dismissed');
  });

  it('hydrates valid saved suggestions and ignores corrupted entries', () => {
    localStorage.setItem(STORAGE_KEYS.aiTaskSuggestions, JSON.stringify([
      suggestion(),
      { id: 'bad', emailId: 'email-2', title: 'Missing fields' },
    ]));

    let ctx!: ReturnType<typeof useTaskSuggestionQueue>;
    renderWithProvider(c => { ctx = c; });

    expect(ctx.state.pendingCount).toBe(1);
    expect(ctx.state.pendingSuggestions[0]?.id).toBe('suggestion-1');
  });
});
