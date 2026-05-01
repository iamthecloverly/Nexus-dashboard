import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createHmac } from 'crypto';

import { SESSION_SECRET } from '../../config';
import { authRouter } from '../auth';

function signedCookie(name: string, value: string): string {
  const sig = createHmac('sha256', SESSION_SECRET).update(value).digest('base64').replace(/=+$/, '');
  return `${name}=${encodeURIComponent(`s:${value}.${sig}`)}`;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.use('/api/auth', authRouter);
  return app;
}

describe('Auth Routes (Google multi-account)', () => {
  describe('GET /api/auth/google/accounts', () => {
    it('returns both accounts disconnected by default', async () => {
      const res = await request(makeApp()).get('/api/auth/google/accounts');
      expect(res.status).toBe(200);
      expect(res.body.accounts).toEqual([
        { accountId: 'primary', connected: false, email: null, name: null },
        { accountId: 'secondary', connected: false, email: null, name: null },
      ]);
    });

    it('surfaces emails from cookies for both accounts', async () => {
      const primaryProfileRaw = JSON.stringify({ email: 'a@example.com', name: 'A' });
      const secondaryProfileRaw = JSON.stringify({ email: 'b@example.com', name: 'B' });
      const res = await request(makeApp())
        .get('/api/auth/google/accounts')
        .set('Cookie', [
          signedCookie('google_tokens', '{"access_token":"x"}'),
          signedCookie('google_profile', primaryProfileRaw),
          signedCookie('google_tokens_secondary', '{"access_token":"y"}'),
          signedCookie('google_profile_secondary', secondaryProfileRaw),
        ]);
      expect(res.status).toBe(200);
      expect(res.body.accounts).toEqual([
        { accountId: 'primary', connected: true, email: 'a@example.com', name: 'A' },
        { accountId: 'secondary', connected: true, email: 'b@example.com', name: 'B' },
      ]);
    });
  });

  describe('POST /api/auth/google/disconnect?accountId=secondary', () => {
    it('clears only secondary cookies', async () => {
      const res = await request(makeApp())
        .post('/api/auth/google/disconnect?accountId=secondary')
        .set('Cookie', [
          signedCookie('google_tokens', '{"access_token":"x"}'),
          signedCookie('google_profile', JSON.stringify({ email: 'a@example.com', name: 'A' })),
          signedCookie('google_tokens_secondary', '{"access_token":"y"}'),
          signedCookie('google_profile_secondary', JSON.stringify({ email: 'b@example.com', name: 'B' })),
        ]);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const setCookie = res.headers['set-cookie'] ?? [];
      const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      expect(joined).toMatch(/google_tokens_secondary=/);
      expect(joined).toMatch(/google_profile_secondary=/);
      expect(joined).not.toMatch(/google_tokens=/);
      expect(joined).not.toMatch(/google_profile=/);
    });
  });
});
