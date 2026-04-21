import type express from 'express';

import { CSRF_COOKIE, CSRF_HEADER, ensureCsrfCookie, getBaseUrl } from '../config';

function originFromUrlish(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
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
    if (allowedOrigin && presentedOrigin && presentedOrigin !== allowedOrigin) {
      return res.status(403).json({ error: 'CSRF origin validation failed' });
    }

    const cookieToken = (req as any).cookies?.[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);
    if (!cookieToken || !headerToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }
    next();
  });
}
