import type express from 'express';
import type { CookieOptions } from 'express';

import { COOKIE_OPTS } from '../config.ts';

export function getCookie(req: express.Request, name: string): string | undefined {
  const signed = req.signedCookies[name];
  if (typeof signed === 'string') return signed;
  // cookie-parser sets invalid signatures to boolean false; treat that as missing.
  const plain = req.cookies[name];
  if (typeof plain === 'string') return plain;
  return undefined;
}

export function setSignedCookie(res: express.Response, name: string, value: string, opts?: CookieOptions) {
  res.cookie(name, value, { ...(opts ?? {}), signed: true });
}

export function clearAppCookie(res: express.Response, name: string, httpOnly: boolean) {
  const { maxAge: _maxAge, ...base } = COOKIE_OPTS;
  // Signed cookies share the same name; clearing with the same options clears either variant.
  res.clearCookie(name, { ...(base as CookieOptions), httpOnly });
}

// Safely parse a JSON cookie; returns null on bad JSON
export function parseJsonCookie<T = unknown>(cookie: string): T | null {
  try { return JSON.parse(cookie) as T; } catch { return null; }
}
