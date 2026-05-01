import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_SECRET } from '../../config';
import { requireDashboardAccess } from '../requireDashboardAccess';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.get('/protected', requireDashboardAccess, (_req, res) => { res.json({ secret: true }); });
  return app;
}

describe('requireDashboardAccess middleware', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('LOGIN_REQUIRED');
  });

  it('rejects an unsigned session cookie', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Cookie', 'dashboard_session=1');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('LOGIN_REQUIRED');
  });

  it('rejects unsigned session/profile cookies instead of trusting forged values', async () => {
    const profile = JSON.stringify({ email: 'notallowed@example.com', name: 'Test User' });
    const session = '1';
    const res = await request(makeApp())
      .get('/protected')
      .set('Cookie', `dashboard_session=${session}; google_profile=${encodeURIComponent(profile)}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('LOGIN_REQUIRED');
  });
});
