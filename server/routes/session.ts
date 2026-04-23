import express from 'express';
import { timingSafeEqual } from 'crypto';

import {
  ALLOWED_GOOGLE_EMAILS,
  DASHBOARD_PASSCODE,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_COOKIE_OPTS,
} from '../config.ts';
import { clearAppCookie, getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies.ts';

type GoogleProfileCookie = { email?: string | null; name?: string | null };

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export const sessionRouter = express.Router();

sessionRouter.get('/status', (req, res) => {
  const hasSession = !!getCookie(req, DASHBOARD_SESSION_COOKIE);
  const profileCookie = getCookie(req, 'google_profile');
  const profile = profileCookie ? parseJsonCookie<GoogleProfileCookie>(profileCookie) : null;
  const email = (profile?.email ?? null);
  const emailLc = email ? String(email).toLowerCase() : null;
  const allowlisted = emailLc ? ALLOWED_GOOGLE_EMAILS.includes(emailLc) : false;
  res.json({
    loggedIn: hasSession,
    googleEmail: emailLc,
    allowlisted,
  });
});

sessionRouter.post('/login', (req, res) => {
  const { passcode } = (req.body ?? {}) as { passcode?: unknown };
  if (typeof passcode !== 'string' || !passcode) {
    return res.status(400).json({ error: 'Missing passcode' });
  }
  if (!DASHBOARD_PASSCODE || !safeEqual(passcode, DASHBOARD_PASSCODE)) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  setSignedCookie(res, DASHBOARD_SESSION_COOKIE, '1', DASHBOARD_SESSION_COOKIE_OPTS);
  res.json({ success: true });
});

sessionRouter.post('/logout', (_req, res) => {
  clearAppCookie(res, DASHBOARD_SESSION_COOKIE, true);
  clearAppCookie(res, 'google_tokens', true);
  clearAppCookie(res, 'google_profile', true);
  res.json({ success: true });
});

