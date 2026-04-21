import type express from 'express';
import type { CookieOptions } from 'express';
import { randomUUID } from 'crypto';

export const isProduction = process.env.NODE_ENV === 'production';

export const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  (isProduction ? '' : 'nexus_dashboard_dev_session_secret');

if (isProduction && !SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// Fail fast in production if APP_URL is missing (prevents Host header spoofing in OAuth callback)
if (isProduction && !process.env.APP_URL) {
  throw new Error('APP_URL must be set in production');
}

export const COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// CSRF: double-submit token (cookie + header). Cookie is readable by JS; header must match.
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE_OPTS: CookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export function ensureCsrfCookie(req: express.Request, res: express.Response) {
  const existing = (req as any).cookies?.[CSRF_COOKIE];
  if (!existing) {
    res.cookie(CSRF_COOKIE, randomUUID(), CSRF_COOKIE_OPTS);
  }
}

export function getBaseUrl(req: express.Request): string {
  return (
    process.env.APP_URL ||
    `${isProduction ? 'https' : 'http'}://${req.get('host')}`
  );
}

export const ENABLE_DEBUG_ENDPOINTS = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
