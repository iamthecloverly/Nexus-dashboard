import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import os from 'os';

const app = express();
const PORT = 3000;
const isProduction = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

app.use(cookieParser());
app.use(express.json());

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
    'https://www.googleapis.com/auth/gmail.readonly',
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
    
    // Store tokens in an HTTP-only cookie
    res.cookie('google_tokens', JSON.stringify(tokens), COOKIE_OPTS);

    const appOrigin = (process.env.APP_URL || `https://${req.get('host')}`).replace(/\/$/, '');
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '${appOrigin}');
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
  const tokensCookie = req.cookies.google_tokens;
  res.json({ connected: !!tokensCookie });
});

app.post('/api/auth/disconnect', (req, res) => {
  const { maxAge: _, ...clearOpts } = COOKIE_OPTS;
  res.clearCookie('google_tokens', clearOpts);
  res.json({ success: true });
});

app.get('/api/calendar/events', async (req, res) => {
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    // Persist refreshed tokens back to the cookie automatically
    oauth2Client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      res.cookie('google_tokens', JSON.stringify(merged), COOKIE_OPTS);
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
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      res.cookie('google_tokens', JSON.stringify(merged), COOKIE_OPTS);
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

app.get('/api/gmail/message/:id', async (req, res) => {
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      res.cookie('google_tokens', JSON.stringify(merged), COOKIE_OPTS);
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
    res.status(500).json({ error: `Failed to fetch message: ${error?.message ?? 'unknown error'}` });
  }
});

app.post('/api/gmail/send', async (req, res) => {
  const tokensCookie = req.cookies.google_tokens;
  if (!tokensCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { to, subject, body } = req.body as { to: string; subject: string; body: string };
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to, subject, or body' });
  }

  try {
    const tokens = JSON.parse(tokensCookie);
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const raw = [
      `To: ${to}`,
      `Subject: ${subject}`,
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
  res.cookie('github_token', token.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.get('/api/github/status', (req, res) => {
  res.json({ connected: !!req.cookies.github_token });
});

app.post('/api/github/disconnect', (req, res) => {
  res.clearCookie('github_token', COOKIE_OPTS);
  res.json({ success: true });
});

app.get('/api/github/notifications', async (req, res) => {
  const token = req.cookies.github_token;
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

app.post('/api/discord/webhook', (req, res) => {
  const { url } = req.body as { url: string };
  if (!url?.trim()) return res.status(400).json({ error: 'Missing webhook URL' });
  res.cookie('discord_webhook', url.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.get('/api/discord/status', (req, res) => {
  res.json({ connected: !!req.cookies.discord_webhook });
});

app.post('/api/discord/disconnect', (req, res) => {
  res.clearCookie('discord_webhook', COOKIE_OPTS);
  res.json({ success: true });
});

app.post('/api/discord/send', async (req, res) => {
  const webhook = req.cookies.discord_webhook;
  if (!webhook) return res.status(401).json({ error: 'No webhook configured' });

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
