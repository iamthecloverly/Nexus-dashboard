import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { TaskProvider } from '../TaskProvider';
import { useTaskContext } from '../taskContext';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import type { Task } from '../../types/task';

// Helper component that exposes the context to assertions
function Consumer({ onRender }: { onRender: (ctx: ReturnType<typeof useTaskContext>) => void }) {
  const ctx = useTaskContext();
  onRender(ctx);
  return null;
}

function renderWithProvider(onRender: (ctx: ReturnType<typeof useTaskContext>) => void) {
  return render(
    <TaskProvider>
      <Consumer onRender={onRender} />
    </TaskProvider>,
  );
}

const SAMPLE_TASK: Task = {
  id: 'task-1',
  title: 'Write tests',
  completed: false,
  group: 'now',
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('TaskProvider', () => {
  describe('initial state', () => {
    it('starts with an empty task list when localStorage is empty', () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });
      expect(ctx.state.tasks).toEqual([]);
    });

    it('hydrates tasks from localStorage on mount', () => {
      const saved: Task[] = [SAMPLE_TASK];
      localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(saved));

      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });
      expect(ctx.state.tasks).toHaveLength(1);
      expect(ctx.state.tasks[0]?.title).toBe('Write tests');
    });

    it('ignores corrupted localStorage data and starts empty', () => {
      localStorage.setItem(STORAGE_KEYS.tasks, '{not valid json}');
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });
      expect(ctx.state.tasks).toEqual([]);
    });

    it('filters out invalid task entries from localStorage', () => {
      const mixed = [
        SAMPLE_TASK,
        { id: '', title: 'bad id', completed: false, group: 'now' }, // empty id
        { id: 'x', title: 123, completed: false, group: 'now' }, // title not string
        { id: 'y', title: 'bad group', completed: false, group: 'sometime' }, // invalid group
      ];
      localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(mixed));

      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });
      expect(ctx.state.tasks).toHaveLength(1);
      expect(ctx.state.tasks[0]?.id).toBe('task-1');
    });

    it('starts empty when localStorage contains non-array JSON', () => {
      localStorage.setItem(STORAGE_KEYS.tasks, '"just a string"');
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });
      expect(ctx.state.tasks).toEqual([]);
    });
  });

  describe('addTask', () => {
    it('adds a task to the list', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));
      expect(ctx.state.tasks[0]?.title).toBe('Write tests');
    });

    it('persists the new task to localStorage', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) ?? '[]') as Task[];
        expect(stored).toHaveLength(1);
      });
    });

    it('appends tasks without removing existing ones', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      const taskA: Task = { id: 'a', title: 'A', completed: false, group: 'now' };
      const taskB: Task = { id: 'b', title: 'B', completed: false, group: 'next' };

      act(() => { ctx.actions.addTask(taskA); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.addTask(taskB); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(2));
    });
  });

  describe('toggleTask', () => {
    it('flips the completed state of a task', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.toggleTask('task-1'); });
      await waitFor(() => expect(ctx.state.tasks[0]?.completed).toBe(true));

      act(() => { ctx.actions.toggleTask('task-1'); });
      await waitFor(() => expect(ctx.state.tasks[0]?.completed).toBe(false));
    });

    it('does nothing for an unknown id', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.toggleTask('nonexistent'); });
      await waitFor(() => expect(ctx.state.tasks[0]?.completed).toBe(false));
    });
  });

  describe('deleteTask', () => {
    it('removes the task with the given id', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.deleteTask('task-1'); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(0));
    });

    it('does nothing for an unknown id', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.deleteTask('no-such-task'); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));
    });
  });

  describe('updateTask', () => {
    it('applies partial changes to a task', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.updateTask('task-1', { title: 'Updated title', completed: true }); });
      await waitFor(() => {
        expect(ctx.state.tasks[0]?.title).toBe('Updated title');
        expect(ctx.state.tasks[0]?.completed).toBe(true);
      });
    });

    it('preserves unmodified fields', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask({ ...SAMPLE_TASK, group: 'next' }); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.updateTask('task-1', { title: 'New title' }); });
      await waitFor(() => {
        expect(ctx.state.tasks[0]?.group).toBe('next');
        expect(ctx.state.tasks[0]?.completed).toBe(false);
      });
    });
  });

  describe('clearCompletedTasks', () => {
    it('removes all completed tasks', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      const tasks: Task[] = [
        { id: 'a', title: 'Done', completed: true, group: 'now' },
        { id: 'b', title: 'Not done', completed: false, group: 'next' },
        { id: 'c', title: 'Also done', completed: true, group: 'now' },
      ];
      for (const t of tasks) {
        act(() => { ctx.actions.addTask(t); });
      }
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(3));

      act(() => { ctx.actions.clearCompletedTasks(); });
      await waitFor(() => {
        expect(ctx.state.tasks).toHaveLength(1);
        expect(ctx.state.tasks[0]?.id).toBe('b');
      });
    });

    it('does nothing when no tasks are completed', async () => {
      let ctx!: ReturnType<typeof useTaskContext>;
      renderWithProvider(c => { ctx = c; });

      act(() => { ctx.actions.addTask(SAMPLE_TASK); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));

      act(() => { ctx.actions.clearCompletedTasks(); });
      await waitFor(() => expect(ctx.state.tasks).toHaveLength(1));
    });
  });

  describe('useTaskContext guard', () => {
    it('throws when used outside TaskProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() =>
        render(React.createElement(() => { useTaskContext(); return null; })),
      ).toThrow('useTaskContext must be used within TaskProvider');
      spy.mockRestore();
    });
  });
});
