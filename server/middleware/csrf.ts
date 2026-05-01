import type express from 'express';

import { CSRF_COOKIE, CSRF_HEADER, ensureCsrfCookie, getBaseUrl } from '../config.ts';
import { getUnsignedCookie } from '../lib/cookies.ts';

function originFromUrlish(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Treat 127.0.0.1 and localhost as the same origin so CSRF passes when APP_URL and the browser disagree. */
export function normalizeLoopbackOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.hostname !== '127.0.0.1') return u.origin;
    const portPart = u.port ? `:${u.port}` : '';
    return `${u.protocol}//localhost${portPart}`;
  } catch {
    return origin;
  }
}

export function attachCsrf(app: express.Express) {
  // Ensure a CSRF token exists for the SPA before any POSTs happen.
  app.use((req, res, next) => {
    ensureCsrfCookie(req, res);
    next();
  });

  // Enforce CSRF on state-changing API requests that rely on cookies
  app.use('/api', (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    // Defense-in-depth: ensure browser-initiated requests come from our own origin.
    // Allow requests without Origin/Referer (e.g. curl, some tooling) and still rely on token check.
    const allowedOrigin = originFromUrlish(getBaseUrl(req));
    const reqOrigin = req.get('origin') ?? undefined;
    const reqOriginParsed = originFromUrlish(reqOrigin);
    const refererOriginParsed = originFromUrlish(req.get('referer') ?? undefined);
    const presentedOrigin = reqOriginParsed ?? refererOriginParsed;
    if (
      allowedOrigin &&
      presentedOrigin &&
      normalizeLoopbackOrigin(presentedOrigin) !== normalizeLoopbackOrigin(allowedOrigin)
    ) {
      return res.status(403).json({ error: 'CSRF origin validation failed' });
    }

    const cookieToken = getUnsignedCookie(req, CSRF_COOKIE);
    const headerToken = req.get(CSRF_HEADER);
    if (!cookieToken || !headerToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }
    next();
  });
}
