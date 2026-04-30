import express from 'express';
import { timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';

import {
  ALLOWED_GOOGLE_EMAILS,
  DASHBOARD_PASSCODE,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_COOKIE_OPTS,
} from '../config.ts';
import { clearAppCookie, getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies.ts';
import { logger } from '../lib/logger.ts';
import { loginSchema } from '../lib/validation.ts';

type GoogleProfileCookie = { email?: string | null; name?: string | null };

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export const sessionRouter = express.Router();

/** Only POST /login; failed attempts count so typos are fine after a success. */
const loginPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed login attempts, please try again in a few minutes.' },
});

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

sessionRouter.post('/login', loginPostLimiter, (req, res) => {
  const validation = loginSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { passcode } = validation.data;
  if (!DASHBOARD_PASSCODE || !safeEqual(passcode, DASHBOARD_PASSCODE)) {
    logger.warn('Failed login attempt');
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  setSignedCookie(res, DASHBOARD_SESSION_COOKIE, '1', DASHBOARD_SESSION_COOKIE_OPTS);
  logger.info('User logged in successfully');
  res.json({ success: true });
});

sessionRouter.post('/logout', (_req, res) => {
  clearAppCookie(res, DASHBOARD_SESSION_COOKIE, true);
  clearAppCookie(res, 'google_tokens', true);
  clearAppCookie(res, 'google_profile', true);
  logger.info('User logged out');
  res.json({ success: true });
});

