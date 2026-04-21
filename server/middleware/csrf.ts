import type express from 'express';

import { CSRF_COOKIE, CSRF_HEADER, ensureCsrfCookie } from '../config';

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
    const cookieToken = (req as any).cookies?.[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);
    if (!cookieToken || !headerToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: 'CSRF validation failed' });
    }
    next();
  });
}
