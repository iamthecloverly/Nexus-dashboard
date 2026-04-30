import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_SECRET } from '../../config';
import { attachCsrf, normalizeLoopbackOrigin } from '../csrf';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  attachCsrf(app);
  // A simple test POST endpoint
  app.post('/api/test', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/test', (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('normalizeLoopbackOrigin', () => {
  it('maps 127.0.0.1 to localhost preserving port', () => {
    expect(normalizeLoopbackOrigin('http://127.0.0.1:3001')).toBe('http://localhost:3001');
  });

  it('leaves localhost unchanged', () => {
    expect(normalizeLoopbackOrigin('http://localhost:3001')).toBe('http://localhost:3001');
  });
});

describe('CSRF middleware', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'http://localhost:3001');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows POST when Origin is 127.0.0.1 but APP_URL uses localhost', async () => {
    const app = makeApp();
    const token = 'loopback-token';
    const res = await request(app)
      .post('/api/test')
      .set('Cookie', `csrf_token=${token}`)
      .set('x-csrf-token', token)
      .set('Origin', 'http://127.0.0.1:3001')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows GET requests without CSRF token', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
  });

  it('rejects POST without CSRF header', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/test').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF validation failed');
  });

  it('rejects POST with mismatched CSRF token', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/test')
      .set('Cookie', 'csrf_token=abc123')
      .set('x-csrf-token', 'wrong-token')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF validation failed');
  });

  it('rejects POST with matching token but wrong origin', async () => {
    const app = makeApp();
    const token = 'valid-token-123';
    const res = await request(app)
      .post('/api/test')
      .set('Cookie', `csrf_token=${token}`)
      .set('x-csrf-token', token)
      .set('Origin', 'https://evil.example.com')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF origin validation failed');
  });

  it('accepts POST with matching CSRF token and no origin header', async () => {
    const app = makeApp();
    const token = 'valid-token-abc';
    const res = await request(app)
      .post('/api/test')
      .set('Cookie', `csrf_token=${token}`)
      .set('x-csrf-token', token)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows OPTIONS requests without CSRF token', async () => {
    const app = makeApp();
    const res = await request(app).options('/api/test');
    // Express returns 404 for OPTIONS unless handled — just not 403
    expect(res.status).not.toBe(403);
  });
});
