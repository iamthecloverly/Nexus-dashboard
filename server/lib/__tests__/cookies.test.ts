import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { getSignedCookie, getUnsignedCookie, parseJsonCookie } from '../cookies';
import { SESSION_SECRET } from '../../config';

// ── parseJsonCookie ────────────────────────────────────────────────────────

describe('parseJsonCookie', () => {
  it('parses valid JSON', () => {
    expect(parseJsonCookie<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(parseJsonCookie('{not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseJsonCookie('')).toBeNull();
  });

  it('parses JSON arrays', () => {
    expect(parseJsonCookie('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON primitives', () => {
    expect(parseJsonCookie('"hello"')).toBe('hello');
    expect(parseJsonCookie('42')).toBe(42);
    expect(parseJsonCookie('true')).toBe(true);
  });
});

// ── cookie helpers via a minimal Express app ───────────────────────────────

describe('cookie helpers', () => {
  afterEach(() => vi.restoreAllMocks());

  function makeApp(handler: express.RequestHandler) {
    const app = express();
    app.use(cookieParser(SESSION_SECRET));
    app.get('/set-signed', (_req, res) => {
      res.cookie('my_cookie', 'signed-value', { signed: true });
      res.json({ ok: true });
    });
    app.get('/test', handler);
    return app;
  }

  it('returns plain cookie value from getUnsignedCookie', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getUnsignedCookie(req, 'my_cookie') });
    });

    const res = await request(app)
      .get('/test')
      .set('Cookie', 'my_cookie=hello');

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('hello');
  });

  it('returns signed cookie value from getSignedCookie', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getSignedCookie(req, 'my_cookie') });
    });

    const agent = request.agent(app);
    await agent.get('/set-signed').expect(200);
    const res = await agent.get('/test');

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('signed-value');
  });

  it('returns undefined when signed cookie is absent', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getSignedCookie(req, 'missing_cookie') ?? null });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.value).toBeNull();
  });

  it('does not treat an unsigned cookie as signed', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getSignedCookie(req, 'my_cookie') ?? null });
    });

    const res = await request(app)
      .get('/test')
      .set('Cookie', 'my_cookie=plainvalue');

    expect(res.status).toBe(200);
    expect(res.body.value).toBeNull();
  });
});
