import type express from 'express';

import { ALLOWED_GOOGLE_EMAILS, DASHBOARD_SESSION_COOKIE } from '../config.ts';
import { getCookie, parseJsonCookie } from '../lib/cookies.ts';

type GoogleProfileCookie = { email?: string | null; name?: string | null };

export function requireDashboardAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const hasSession = !!getCookie(req, DASHBOARD_SESSION_COOKIE);
  if (!hasSession) return res.status(401).json({ error: 'Login required', code: 'LOGIN_REQUIRED' });

  const profileCookie = getCookie(req, 'google_profile');
  const profile = profileCookie ? parseJsonCookie<GoogleProfileCookie>(profileCookie) : null;
  const email = (profile?.email ?? null);
  const emailLc = email ? String(email).toLowerCase() : null;
  if (!emailLc) return res.status(403).json({ error: 'Google account not connected', code: 'GOOGLE_PROFILE_MISSING' });
  if (!ALLOWED_GOOGLE_EMAILS.includes(emailLc)) return res.status(403).json({ error: 'Google account not allowed', code: 'GOOGLE_NOT_ALLOWLISTED' });

  next();
}

