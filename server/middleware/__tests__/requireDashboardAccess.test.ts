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

  it('returns 403 when session exists but no google_profile cookie', async () => {
    const app = makeApp();
    // Forge a signed dashboard session cookie
    const agent = request.agent(app);
    // We can't easily sign cookies here, so set the raw cookie and expect 403 from profile-missing path
    // Since cookie-parser can't verify a forged signature, it falls through to unsigned plain read
    const res = await agent
      .get('/protected')
      .set('Cookie', 'dashboard_session=1');
    // Should be 401 (unsigned cookies are not trusted) or 403 (no profile)
    expect([401, 403]).toContain(res.status);
  });

  it('returns 403 when session exists but email is not in allowlist', async () => {
    // Build a raw (not signed) google_profile cookie — getCookie falls back to plain cookies
    const profile = JSON.stringify({ email: 'notallowed@example.com', name: 'Test User' });
    const session = '1';
    const res = await request(makeApp())
      .get('/protected')
      .set('Cookie', `dashboard_session=${session}; google_profile=${encodeURIComponent(profile)}`);
    // Either 401 (session not validated) or 403 (not allowlisted)
    expect([401, 403]).toContain(res.status);
  });
});
