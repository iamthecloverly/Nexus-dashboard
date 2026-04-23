import express from 'express';
import { google } from 'googleapis';

import { ALLOWED_GOOGLE_EMAILS, COOKIE_OPTS, ENABLE_DEBUG_ENDPOINTS, getBaseUrl, isProduction } from '../config.ts';
import { clearAppCookie, getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies.ts';
import { getOAuth2Client } from '../lib/googleOAuth.ts';

export const authRouter = express.Router();

authRouter.get('/google/url', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  }

  const oauth2Client = getOAuth2Client(req);
  const scopes = [
    // Needed to fetch/set google_profile (email/name) for allowlist checks.
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    // gmail.modify is a superset of gmail.readonly and also allows label changes
    // (mark read/unread, archive). gmail.send is required for sending.
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  res.json({ url });
});

authRouter.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') return res.status(400).send('Missing code');

  try {
    const oauth2Client = getOAuth2Client(req);
    const { tokens } = await oauth2Client.getToken(code);

    // Store tokens in an HTTP-only cookie (signed)
    setSignedCookie(res, 'google_tokens', JSON.stringify(tokens), COOKIE_OPTS);

    // Also store the user profile (email/name) once for allowlist checks.
    try {
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const me = await oauth2.userinfo.get();
      setSignedCookie(
        res,
        'google_profile',
        JSON.stringify({ email: me.data.email ?? null, name: me.data.name ?? null }),
        COOKIE_OPTS,
      );
    } catch {
      // If profile fetch fails, token cookie is still set; client can retry via /api/auth/profile.
    }

    const appOrigin = getBaseUrl(req).replace(/\/$/, '');
    const safeOrigin = JSON.stringify(appOrigin);
    res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta charset="utf-8" />
          <title>Connected</title>
        </head>
        <body>
          <script>
            (function () {
              var origin = ${safeOrigin};
              try {
                // 1) Best-case: notify the opener directly.
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, origin);
                }
              } catch {}

              try {
                // 2) Fallback: BroadcastChannel (survives cases where opener becomes null).
                if (typeof BroadcastChannel !== 'undefined') {
                  var bc = new BroadcastChannel('oauth');
                  bc.postMessage({ type: 'OAUTH_AUTH_SUCCESS', at: Date.now() });
                  bc.close();
                }
              } catch {}

              try {
                // 3) Fallback: storage event.
                localStorage.setItem('oauth_auth_success', String(Date.now()));
              } catch {}

              // Always attempt to close (if this window was opened by script, this should work).
              try { window.close(); } catch {}

              // If closing is blocked, show a button and auto-redirect shortly.
              setTimeout(function () {
                try { window.location.href = '/'; } catch {}
              }, 1200);
            })();
          </script>
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; line-height: 1.4;">
            <h2 style="margin: 0 0 8px 0; font-size: 18px;">Authentication successful</h2>
            <p style="margin: 0 0 16px 0; color: #555;">You can close this tab and return to the dashboard.</p>
            <button onclick="window.close()" style="padding: 10px 14px; border-radius: 10px; border: 1px solid #ddd; background: #111; color: #fff; cursor: pointer;">
              Close this window
            </button>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    res.status(500).send('Authentication failed');
  }
});

authRouter.get('/status', (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  const profileCookie = getCookie(req, 'google_profile');
  const profile = profileCookie ? parseJsonCookie<{ email?: string | null; name?: string | null }>(profileCookie) : null;
  const email = (profile?.email ?? null);
  const emailLc = email ? String(email).toLowerCase() : null;

  // Note: allowlist is enforced server-side by requireDashboardAccess; this is just
  // a convenience status for UI to avoid showing "Connected" when access will be blocked.
  const allowlisted = emailLc ? ALLOWED_GOOGLE_EMAILS.includes(emailLc) : false;

  res.json({
    connected: !!tokensCookie,
    tokensConnected: !!tokensCookie,
    profileConnected: !!emailLc,
    email: emailLc,
    allowlisted,
  });
});

authRouter.get('/profile', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    // Heal sessions where the OAuth callback couldn't fetch/set google_profile.
    // requireDashboardAccess depends on this cookie for allowlist checks.
    setSignedCookie(
      res,
      'google_profile',
      JSON.stringify({ email: me.data.email ?? null, name: me.data.name ?? null }),
      COOKIE_OPTS,
    );
    res.json({ email: me.data.email ?? null, name: me.data.name ?? null });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to fetch profile' });
  }
});

authRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'google_tokens', true);
  clearAppCookie(res, 'google_profile', true);
  res.json({ success: true });
});

// For completeness: in dev, let clients check expected protocol quickly.
authRouter.get('/_debug/base-url', (req, res) => {
  if (isProduction || !ENABLE_DEBUG_ENDPOINTS) return res.status(404).json({ error: 'Not found' });
  res.json({ baseUrl: getBaseUrl(req) });
});
