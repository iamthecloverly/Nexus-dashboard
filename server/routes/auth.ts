import express from 'express';
import { google } from 'googleapis';

import { COOKIE_OPTS, ENABLE_DEBUG_ENDPOINTS, getBaseUrl, isProduction } from '../config';
import { clearAppCookie, getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies';
import { getOAuth2Client } from '../lib/googleOAuth';

export const authRouter = express.Router();

authRouter.get('/google/url', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  }

  const oauth2Client = getOAuth2Client(req);
  const scopes = [
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

    const appOrigin = getBaseUrl(req).replace(/\/$/, '');
    const safeOrigin = JSON.stringify(appOrigin);
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, ${safeOrigin});
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
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
  res.json({ connected: !!tokensCookie });
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
    res.json({ email: me.data.email ?? null, name: me.data.name ?? null });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to fetch profile' });
  }
});

authRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'google_tokens', true);
  res.json({ success: true });
});

// For completeness: in dev, let clients check expected protocol quickly.
authRouter.get('/_debug/base-url', (req, res) => {
  if (isProduction || !ENABLE_DEBUG_ENDPOINTS) return res.status(404).json({ error: 'Not found' });
  res.json({ baseUrl: getBaseUrl(req) });
});
