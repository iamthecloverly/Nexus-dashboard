import { afterEach, describe, it, expect, vi } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /api/auth/google/url', () => {
    it('sets a signed OAuth state cookie and embeds a nonce in the auth URL state', async () => {
      vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');

      const res = await request(makeApp()).get('/api/auth/google/url?accountId=secondary');

      expect(res.status).toBe(200);
      const setCookie = res.headers['set-cookie'] ?? [];
      const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      expect(joined).toContain('oauth_state_secondary=');

      const authUrl = new URL(res.body.url);
      const state = JSON.parse(authUrl.searchParams.get('state') ?? '{}') as { accountId?: string; nonce?: string };
      expect(state.accountId).toBe('secondary');
      expect(typeof state.nonce).toBe('string');
      expect(state.nonce?.length).toBeGreaterThan(20);
    });
  });

  describe('GET /api/auth/google/callback', () => {
    it('rejects callbacks without a matching OAuth state cookie', async () => {
      const state = encodeURIComponent(JSON.stringify({ accountId: 'primary', nonce: 'nonce-from-attacker' }));
      const res = await request(makeApp()).get(`/api/auth/google/callback?code=abc&state=${state}`);

      expect(res.status).toBe(400);
      expect(res.text).toBe('Invalid OAuth state');
    });
  });

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
