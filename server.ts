import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import type { CookieOptions } from 'express';

// Fail fast in production if APP_URL is missing (prevents Host header spoofing in OAuth callback)
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.APP_URL) {
  throw new Error('APP_URL must be set in production');
}
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set');
}

const app = express();
const PORT = 3000;
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — Vite injects inline scripts in dev
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json({ limit: '50kb' }));

// CSRF: double-submit token (cookie + header). Cookie is readable by JS; header must match.
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: isProduction,
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Ensure a CSRF token exists for the SPA before any POSTs happen.
app.use((req, res, next) => {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (!existing) {
    res.cookie(CSRF_COOKIE, randomUUID(), CSRF_COOKIE_OPTS);
  }
  next();
});

// Enforce CSRF on state-changing API requests that rely on cookies
app.use('/api', (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  next();
});

function getCookie(req: express.Request, name: string): string | undefined {
  return (req.signedCookies?.[name] as string | undefined) ?? (req.cookies?.[name] as string | undefined);
}

function setSignedCookie(res: express.Response, name: string, value: string, opts?: CookieOptions) {
  res.cookie(name, value, { ...(opts ?? {}), signed: true });
}

function clearAppCookie(res: express.Response, name: string, httpOnly: boolean) {
  const { maxAge: _maxAge, ...base } = COOKIE_OPTS;
  // Signed cookies share the same name; clearing with the same options clears either variant.
  res.clearCookie(name, { ...(base as CookieOptions), httpOnly });
}

// Safely parse the google_tokens cookie; returns null on bad JSON
const parseTokensCookie = (cookie: string) => {
  try { return JSON.parse(cookie); } catch { return null; }
};

// OAuth2 Client Setup
const getOAuth2Client = (req: express.Request) => {
  const baseUrl = process.env.APP_URL || `https://${req.get('host')}`;
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

// Rate limiter for AI endpoints (max 20 req/min — each call loops up to 10 OpenAI requests)
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/auth/google/url', (req, res) => {
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
    prompt: 'consent'
  });

  res.json({ url });
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing code');
  }

  try {
    const oauth2Client = getOAuth2Client(req);
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in an HTTP-only cookie (signed)
    setSignedCookie(res, 'google_tokens', JSON.stringify(tokens), COOKIE_OPTS);

    const appOrigin = (process.env.APP_URL || `https://${req.get('host')}`).replace(/\/$/, '');
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

app.get('/api/auth/status', (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  res.json({ connected: !!tokensCookie });
});

app.post('/api/auth/disconnect', (req, res) => {
  clearAppCookie(res, 'google_tokens', true);
  res.json({ success: true });
});

app.get('/api/calendar/events', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    // Persist refreshed tokens back to the cookie automatically
    oauth2Client.once('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      setSignedCookie(res, 'google_tokens', JSON.stringify(merged), COOKIE_OPTS);
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get events for today (timezone-aware RFC3339 range)
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const offsetSign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const tzSuffix = `${offsetSign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`;
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const timeMin = `${y}-${mo}-${d}T00:00:00${tzSuffix}`;
    const timeMax = `${y}-${mo}-${d}T23:59:59${tzSuffix}`;

    // Fetch all accessible calendars, then query each in parallel
    const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
    const calendarIds = (calListRes.data.items ?? []).map(c => c.id!).filter(Boolean);
    if (!calendarIds.length) calendarIds.push('primary');

    const eventArrays = await Promise.all(
      calendarIds.map(calId =>
        calendar.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        }).then(r => r.data.items ?? []).catch(() => [])
      )
    );

    // Flatten, deduplicate by iCalUID, sort by start time
    const seen = new Set<string>();
    const allEvents = eventArrays.flat()
      .filter(e => {
        const key = e.iCalUID ?? e.id;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.start?.dateTime ?? a.start?.date ?? '';
        const bTime = b.start?.dateTime ?? b.start?.date ?? '';
        return aTime.localeCompare(bTime);
      });

    res.json({ events: allEvents });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    const causeMsg: string = error?.cause?.message ?? error?.message ?? '';
    if (causeMsg.includes('disabled') || causeMsg.includes('has not been used')) {
      // Known state — don't spam logs
      return res.status(503).json({ error: 'Google Calendar API is not enabled in your Cloud project', code: 'API_DISABLED' });
    }
    if (status === 401 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.get('/api/gmail/messages', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      setSignedCookie(res, 'google_tokens', JSON.stringify(merged), COOKIE_OPTS);
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];

    const emails = await Promise.all(messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const fromHeader = headers.find(h => h.name === 'From')?.value ?? '';
      const subject = headers.find(h => h.name === 'Subject')?.value ?? '(no subject)';
      const dateHeader = headers.find(h => h.name === 'Date')?.value ?? '';

      // Parse "Name <email>" or just "email"
      const nameMatch = fromHeader.match(/^"?([^"<]+?)"?\s*(?:<(.+?)>)?$/);
      const senderName = nameMatch?.[1]?.trim() ?? fromHeader;
      const senderEmail = nameMatch?.[2] ?? fromHeader;
      const initials = senderName.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

      const labelIds = detail.data.labelIds ?? [];
      const isUnread = labelIds.includes('UNREAD');
      const isUrgent = labelIds.includes('STARRED');

      const msgDate = new Date(dateHeader);
      const now = new Date();
      const isToday = msgDate.toDateString() === now.toDateString();
      const timeDisplay = isNaN(msgDate.getTime())
        ? ''
        : isToday
          ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

      return {
        id: msg.id!,
        sender: senderName,
        senderEmail,
        initials,
        time: timeDisplay,
        subject,
        preview: detail.data.snippet ?? '',
        unread: isUnread,
        urgent: isUrgent,
        archived: false,
        deleted: false,
      };
    }));

    res.json({ emails });
  } catch (error: any) {
    console.error('Error fetching gmail messages:', error);
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

app.post('/api/gmail/messages/:id/mark-read', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  const { read } = req.body as { read: boolean };
  if (typeof read !== 'boolean') return res.status(400).json({ error: 'Missing read flag' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: read
        ? { removeLabelIds: ['UNREAD'] }  // marking as read
        : { addLabelIds: ['UNREAD'] },     // marking as unread
    });

    res.json({ success: true });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to update message' });
  }
});

app.post('/api/gmail/messages/:id/archive', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to archive message' });
  }
});

app.post('/api/gmail/messages/:id/trash', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.trash({
      userId: 'me',
      id: req.params.id,
    });
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to trash message' });
  }
});

app.get('/api/gmail/message/:id', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      setSignedCookie(res, 'google_tokens', JSON.stringify(merged), COOKIE_OPTS);
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
    });

    // Recursively extract plain-text body from MIME tree
    const extractBody = (payload: any): string => {
      if (!payload) return '';
      // Prefer plain text
      if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }
      // Recurse into multipart children first
      if (payload.parts) {
        for (const part of payload.parts) {
          const result = extractBody(part);
          if (result) return result;
        }
      }
      // HTML fallback: strip tags
      if (payload.mimeType === 'text/html' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }
      return '';
    };

    res.json({ body: extractBody(detail.data.payload) });
  } catch (error: any) {
    console.error('Error fetching gmail message:', error?.message ?? error);
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

app.post('/api/gmail/send', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { to, subject, body } = req.body as { to: string; subject: string; body: string };
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to, subject, or body' });
  }
  // Basic email format check — catches obvious typos before the Gmail API does
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    return res.status(400).json({ error: 'Invalid recipient email address' });
  }

  // Sanitize headers to prevent CRLF injection
  const sanitize = (s: string) => s.replace(/[\r\n]/g, '');
  const safeTO = sanitize(to);
  const safeSubject = sanitize(subject);

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const raw = [
      `To: ${safeTO}`,
      `Subject: ${safeSubject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ── GitHub ────────────────────────────────────────────────────────────────────

app.post('/api/github/token', (req, res) => {
  const { token } = req.body as { token: string };
  if (!token?.trim()) return res.status(400).json({ error: 'Missing token' });
  // Validate GitHub PAT format (classic: ghp_, fine-grained: github_pat_, OAuth: gho_)
  if (!/^(ghp_|github_pat_|gho_)[\w]+$/.test(token.trim())) {
    return res.status(400).json({ error: 'Invalid GitHub token format' });
  }
  setSignedCookie(res, 'github_token', token.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.get('/api/github/status', (req, res) => {
  res.json({ connected: !!getCookie(req, 'github_token') });
});

app.post('/api/github/disconnect', (req, res) => {
  clearAppCookie(res, 'github_token', true);
  res.json({ success: true });
});

app.get('/api/github/notifications', async (req, res) => {
  const token = getCookie(req, 'github_token');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const response = await fetch('https://api.github.com/notifications?per_page=15&all=false', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PersonalDashboard/1.0',
      },
    });
    if (response.status === 401) return res.status(401).json({ error: 'Invalid GitHub token' });
    if (!response.ok) return res.status(response.status).json({ error: 'GitHub API error' });

    const raw = await response.json() as any[];
    res.json({
      notifications: raw.map(n => ({
        id: n.id as string,
        title: n.subject?.title as string,
        type: n.subject?.type as string,
        repo: n.repository?.full_name as string,
        reason: n.reason as string,
        updatedAt: n.updated_at as string,
        url: (n.subject?.url as string | undefined)
          ?.replace('https://api.github.com/repos/', 'https://github.com/')
          .replace('/pulls/', '/pull/'),
      })),
    });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ── Discord ───────────────────────────────────────────────────────────────────

// Strict allowlist: only official Discord webhook URLs (prevents SSRF)
const DISCORD_WEBHOOK_RE = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

app.post('/api/discord/webhook', (req, res) => {
  const { url } = req.body as { url: string };
  if (!url?.trim()) return res.status(400).json({ error: 'Missing webhook URL' });
  if (!DISCORD_WEBHOOK_RE.test(url.trim())) {
    return res.status(400).json({ error: 'Invalid Discord webhook URL' });
  }
  setSignedCookie(res, 'discord_webhook', url.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.get('/api/discord/status', (req, res) => {
  res.json({ connected: !!getCookie(req, 'discord_webhook') });
});

app.post('/api/discord/disconnect', (req, res) => {
  clearAppCookie(res, 'discord_webhook', true);
  res.json({ success: true });
});

app.post('/api/discord/send', async (req, res) => {
  const webhook = getCookie(req, 'discord_webhook');
  if (!webhook) return res.status(401).json({ error: 'No webhook configured' });
  // Re-validate on use to guard against tampered cookies
  if (!DISCORD_WEBHOOK_RE.test(webhook)) return res.status(400).json({ error: 'Invalid webhook URL' });

  const { content } = req.body as { content: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Missing content' });

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Discord webhook error' });
    res.json({ success: true });
  } catch (error) {
    console.error('Discord webhook error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── AI / OpenAI ───────────────────────────────────────────────────────────────

/** Recursively extract plain-text body from a Gmail MIME payload */
function extractGmailBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractGmailBody(part);
      if (result) return result;
    }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return '';
}

/** Manual mode: thorough extraction shown in review modal before adding */
const AI_PROMPT_MANUAL = `You are a productivity assistant. Read the email and extract every actionable task the recipient needs to do.
Return ONLY valid JSON: {"tasks": [{"title": "...", "priority": "Normal|Priority|Critical", "group": "now|next", "reason": "..."}]}
Rules:
- title: concise, starts with a verb (e.g. "Review proposal", "Reply to John", "Schedule meeting")
- priority: "Critical" = hard deadline or blocker; "Priority" = important but flexible; "Normal" = nice to have
- group: "now" = due today or very urgent; "next" = can be done later
- reason: one short sentence explaining why this task was extracted
- max 5 tasks per email
- if no actionable tasks exist, return {"tasks": []}`;

/** Auto mode: very conservative — only clear, high-value actions. Tasks added silently. */
const AI_PROMPT_AUTO = `You are a strict task extraction assistant. Only extract tasks when a direct action is clearly required from the recipient.

INCLUDE only when the email:
- Explicitly requests a reply or response from the recipient
- Has a deadline or time-sensitive ask directed at the recipient
- Requests the recipient's approval, decision, or specific input
- Contains a clear follow-up action the recipient must take

EXCLUDE entirely:
- Newsletters, promotional, or marketing emails
- Automated notifications (receipts, shipping updates, OTP codes, alerts)
- FYI / informational emails with no action needed
- Meeting invites (handled by calendar)
- Social media or app notifications
- Anything where taking action is optional

Be very conservative. When in doubt, return no tasks.
Return ONLY valid JSON: {"tasks": [{"title": "...", "priority": "Normal|Priority|Critical", "group": "now|next", "reason": "..."}]}
Max 3 tasks. Return {"tasks": []} if nothing is clearly actionable.`;

/** Shared logic: fetch one email's metadata + body, call GPT-4o-mini, return suggestions */
async function extractTasksFromEmail(
  gmail: ReturnType<typeof google.gmail>,
  openai: OpenAI,
  emailId: string,
  mode: 'manual' | 'auto' = 'manual',
): Promise<any[]> {
  const [meta, full] = await Promise.all([
    gmail.users.messages.get({ userId: 'me', id: emailId, format: 'metadata', metadataHeaders: ['From', 'Subject'] }),
    gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' }),
  ]);

  const headers = meta.data.payload?.headers ?? [];
  const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '(no subject)';
  const from    = headers.find((h: any) => h.name === 'From')?.value ?? '';
  const body    = extractGmailBody(full.data.payload).slice(0, 3000);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      { role: 'system', content: mode === 'auto' ? AI_PROMPT_AUTO : AI_PROMPT_MANUAL },
      { role: 'user', content: `From: ${from}\nSubject: ${subject}\n\n${body}` },
    ],
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? '{"tasks":[]}');
  return (raw.tasks ?? [])
    .filter((t: any) => t.title?.trim())
    .map((t: any) => ({
      id: randomUUID(),
      emailId,
      title: (t.title as string).trim(),
      priority: (['Normal', 'Priority', 'Critical'] as const).includes(t.priority) ? t.priority : 'Normal',
      group: t.group === 'next' ? 'next' : 'now',
      reason: (t.reason as string | undefined)?.trim() ?? '',
      accepted: true,
    }));
}

app.post('/api/ai/key', (req, res) => {
  const { key } = req.body as { key: string };
  if (!key?.trim()) return res.status(400).json({ error: 'Missing key' });
  // Validate OpenAI key format
  if (!/^sk-[\w-]{20,}$/.test(key.trim())) {
    return res.status(400).json({ error: 'Invalid OpenAI API key format' });
  }
  setSignedCookie(res, 'openai_key', key.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.get('/api/ai/status', (req, res) => {
  const key = getCookie(req, 'openai_key') ?? process.env.OPENAI_API_KEY;
  res.json({ configured: !!key });
});

app.post('/api/ai/disconnect', (req, res) => {
  clearAppCookie(res, 'openai_key', true);
  res.json({ success: true });
});

const GMAIL_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;

app.post('/api/ai/extract-tasks', aiLimiter, async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated with Google' });

  const openAIKey = getCookie(req, 'openai_key') ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailId } = req.body as { emailId: string };
  if (!emailId?.trim()) return res.status(400).json({ error: 'Missing emailId' });
  if (!GMAIL_ID_RE.test(emailId.trim())) return res.status(400).json({ error: 'Invalid emailId' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const suggestions = await extractTasksFromEmail(gmail, openai, emailId);
    res.json({ suggestions });
  } catch (error: any) {
    console.error('AI extract-tasks error:', error?.message ?? error);
    if (error?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (error?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});

app.post('/api/ai/extract-tasks-bulk', aiLimiter, async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated with Google' });

  const openAIKey = getCookie(req, 'openai_key') ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailIds, mode = 'manual' } = req.body as { emailIds: string[]; mode?: 'manual' | 'auto' };
  if (!Array.isArray(emailIds) || emailIds.length === 0) return res.status(400).json({ error: 'Missing emailIds' });
  const safeIds = emailIds.filter(id => typeof id === 'string' && GMAIL_ID_RE.test(id));
  if (safeIds.length === 0) return res.status(400).json({ error: 'No valid emailIds provided' });

  try {
    const tokens = parseTokensCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', (newTokens) => {
      setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
    });

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const allSuggestions: any[] = [];
    for (const emailId of safeIds.slice(0, 10)) {
      try {
        const suggestions = await extractTasksFromEmail(gmail, openai, emailId, mode);
        allSuggestions.push(...suggestions);
      } catch {
        // Skip failed emails, continue processing the rest
      }
    }

    res.json({ suggestions: allSuggestions });
  } catch (error: any) {
    console.error('AI extract-tasks-bulk error:', error?.message ?? error);
    if (error?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (error?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});

// ── System metrics ────────────────────────────────────────────────────────────

app.get('/api/system', (_req, res) => {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    cpuLoad: parseFloat(Math.min((loadAvg[0] / cpuCount) * 100, 100).toFixed(1)),
    memUsed: parseFloat(((1 - freeMem / totalMem) * 100).toFixed(1)),
    uptime: Math.floor(os.uptime()),
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to localhost in dev (prevents LAN exposure); 0.0.0.0 in production for container/deploy
  const host = isProduction ? '0.0.0.0' : '127.0.0.1';
  app.listen(PORT, host, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
