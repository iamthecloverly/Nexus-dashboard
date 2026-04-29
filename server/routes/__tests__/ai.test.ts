import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_SECRET } from '../../config';
import { aiRouter, parseAiTasksJson, __testOnly } from '../ai';

const { extractGmailBody } = __testOnly;

// Note: this test app intentionally omits CSRF middleware — it tests the AI route handler in isolation.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.use('/api/ai', aiRouter);
  return app;
}

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

    it('returns empty tasks for whitespace-only string', () => {
      expect(parseAiTasksJson('   ')).toEqual({ tasks: [] });
    });

    it('returns empty tasks array for {"tasks":[]}', () => {
      expect(parseAiTasksJson('{"tasks":[]}')).toEqual({ tasks: [] });
    });

    it('preserves multiple tasks', () => {
      const json = '{"tasks":[{"title":"A"},{"title":"B"},{"title":"C"}]}';
      const result = parseAiTasksJson(json);
      expect(result.tasks).toHaveLength(3);
    });
  });

  describe('extractGmailBody', () => {
    it('returns empty string for null/undefined payload', () => {
      expect(extractGmailBody(null)).toBe('');
      expect(extractGmailBody(undefined)).toBe('');
    });

    it('extracts plain text body directly', () => {
      const text = 'Hello, please review the proposal.';
      const encoded = Buffer.from(text).toString('base64url');
      expect(extractGmailBody({ mimeType: 'text/plain', body: { data: encoded } })).toBe(text);
    });

    it('prefers text/plain over text/html in multipart', () => {
      const plainText = 'Plain version';
      const htmlText = '<p>HTML version</p>';
      const plainEncoded = Buffer.from(plainText).toString('base64url');
      const htmlEncoded = Buffer.from(htmlText).toString('base64url');

      const result = extractGmailBody({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: plainEncoded } },
          { mimeType: 'text/html', body: { data: htmlEncoded } },
        ],
      });
      expect(result).toBe(plainText);
    });

    it('falls back to HTML and strips tags', () => {
      const html = '<p>Hello <b>world</b></p>';
      const encoded = Buffer.from(html).toString('base64url');

      const result = extractGmailBody({ mimeType: 'text/html', body: { data: encoded } });
      expect(result).toContain('Hello');
      expect(result).toContain('world');
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('<b>');
    });

    it('strips style blocks from HTML', () => {
      const html = '<style>body { color: red; }</style><p>Clean text</p>';
      const encoded = Buffer.from(html).toString('base64url');

      const result = extractGmailBody({ mimeType: 'text/html', body: { data: encoded } });
      expect(result).not.toContain('color: red');
      expect(result).toContain('Clean text');
    });

    it('decodes HTML entities', () => {
      const html = '<p>Rock &amp; Roll &lt;band&gt; &quot;quote&quot; &nbsp;</p>';
      const encoded = Buffer.from(html).toString('base64url');

      const result = extractGmailBody({ mimeType: 'text/html', body: { data: encoded } });
      expect(result).toContain('Rock & Roll');
      expect(result).toContain('<band>');
      expect(result).toContain('"quote"');
    });

    it('returns empty string for unknown mimeType with no parts', () => {
      expect(extractGmailBody({ mimeType: 'application/pdf' })).toBe('');
    });

    it('recurses into nested multipart parts', () => {
      const text = 'Nested plain text';
      const encoded = Buffer.from(text).toString('base64url');

      const result = extractGmailBody({
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: encoded } },
            ],
          },
        ],
      });
      expect(result).toBe(text);
    });
  });
});

describe('AI Routes — HTTP endpoints', () => {
  describe('GET /api/ai/status', () => {
    it('returns configured:false when no key is set', async () => {
      const res = await request(makeApp()).get('/api/ai/status');
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
      expect(res.body.source).toBeNull();
    });
  });

  describe('POST /api/ai/disconnect', () => {
    it('returns success', async () => {
      const res = await request(makeApp()).post('/api/ai/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/ai/key', () => {
    it('rejects invalid key format', async () => {
      const res = await request(makeApp())
        .post('/api/ai/key')
        .send({ key: 'not-valid-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('accepts valid sk- key and sets cookie', async () => {
      const res = await request(makeApp())
        .post('/api/ai/key')
        .send({ key: 'sk-' + 'A'.repeat(48) });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });
});

