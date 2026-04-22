import express from 'express';
import { google } from 'googleapis';

import { COOKIE_OPTS } from '../config.ts';
import { getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies.ts';
import { getOAuth2Client } from '../lib/googleOAuth.ts';

export const gmailRouter = express.Router();

const GMAIL_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;

gmailRouter.get('/messages', async (req, res) => {
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

gmailRouter.post('/messages/:id/mark-read', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  const { read } = req.body as { read: boolean };
  if (typeof read !== 'boolean') return res.status(400).json({ error: 'Missing read flag' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
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

gmailRouter.post('/messages/:id/archive', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
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

gmailRouter.post('/messages/:id/trash', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
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

gmailRouter.get('/message/:id', async (req, res) => {
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

gmailRouter.post('/send', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  const { to, subject, body } = req.body as { to: string; subject: string; body: string };
  if (!to || !subject || !body) return res.status(400).json({ error: 'Missing to, subject, or body' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    return res.status(400).json({ error: 'Invalid recipient email address' });
  }

  // Sanitize headers to prevent CRLF injection
  const sanitize = (s: string) => s.replace(/[\r\n]/g, '');
  const safeTO = sanitize(to);
  const safeSubject = sanitize(subject);

  try {
    const tokens = parseJsonCookie(tokensCookie);
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
