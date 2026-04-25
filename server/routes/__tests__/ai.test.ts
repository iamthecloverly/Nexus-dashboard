import { describe, it, expect } from 'vitest';
import { parseAiTasksJson } from '../ai';

describe('AI Routes helpers', () => {
  describe('parseAiTasksJson', () => {
    it('returns empty tasks for non-string content', () => {
      expect(parseAiTasksJson(null)).toEqual({ tasks: [] });
      expect(parseAiTasksJson(undefined)).toEqual({ tasks: [] });
      expect(parseAiTasksJson(123)).toEqual({ tasks: [] });
    });

    it('returns empty tasks for invalid JSON', () => {
      expect(parseAiTasksJson('{not json')).toEqual({ tasks: [] });
    });

    it('returns empty tasks when JSON has no tasks array', () => {
      expect(parseAiTasksJson('{"ok":true}')).toEqual({ tasks: [] });
      expect(parseAiTasksJson('{"tasks":{}}')).toEqual({ tasks: [] });
    });

    it('returns tasks array when present', () => {
      const parsed = parseAiTasksJson('{"tasks":[{"title":"Do thing","priority":"Normal"}]}');
      expect(Array.isArray(parsed.tasks)).toBe(true);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.tasks[0]?.title).toBe('Do thing');
    });
  });
});

