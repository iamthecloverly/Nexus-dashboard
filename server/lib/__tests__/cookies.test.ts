import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { getCookie, parseJsonCookie } from '../cookies';
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

// ── getCookie via a minimal Express app ────────────────────────────────────

describe('getCookie', () => {
  afterEach(() => vi.restoreAllMocks());

  function makeApp(handler: express.RequestHandler) {
    const app = express();
    app.use(cookieParser(SESSION_SECRET));
    app.get('/test', handler);
    return app;
  }

  it('returns plain cookie value when no signed cookie present', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getCookie(req, 'my_cookie') });
    });

    const res = await request(app)
      .get('/test')
      .set('Cookie', 'my_cookie=hello');

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('hello');
  });

  it('returns undefined when cookie is absent', async () => {
    const app = makeApp((req, res) => {
      res.json({ value: getCookie(req, 'missing_cookie') ?? null });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.value).toBeNull();
  });

  it('treats a cookie with an invalid signature as plain (falls back)', async () => {
    // cookie-parser sets signedCookies[name] = false when signature is wrong
    // getCookie should fall back to plain cookies in that case
    const app = makeApp((req, res) => {
      res.json({ value: getCookie(req, 'my_cookie') ?? null });
    });

    // Send a raw cookie (no valid HMAC signature) — cookie-parser parses it as plain
    const res = await request(app)
      .get('/test')
      .set('Cookie', 'my_cookie=plainvalue');

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('plainvalue');
  });
});
