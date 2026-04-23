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

export const DASHBOARD_PASSCODE = process.env.DASHBOARD_PASSCODE ?? '';
export const ALLOWED_GOOGLE_EMAILS = (process.env.ALLOWED_GOOGLE_EMAILS ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

if (isProduction && !DASHBOARD_PASSCODE) {
  throw new Error('DASHBOARD_PASSCODE must be set in production');
}

if (isProduction && ALLOWED_GOOGLE_EMAILS.length === 0) {
  throw new Error('ALLOWED_GOOGLE_EMAILS must be set in production (comma-separated list)');
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

export const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
export const DASHBOARD_SESSION_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
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
  // Prefer explicit APP_URL for OAuth correctness and Host header hardening.
  // Otherwise, derive from the incoming request (supports http self-hosting and reverse proxies).
  const appUrl = process.env.APP_URL;
  if (appUrl) return appUrl;

  const host = req.get('host');
  if (!host) return '';
  const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0]?.trim() || 'http';
  return `${proto}://${host}`;
}

export const ENABLE_DEBUG_ENDPOINTS = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
