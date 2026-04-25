import express from 'express';
import { google } from 'googleapis';
import rateLimit from 'express-rate-limit';

import { getCookie, parseJsonCookie } from '../lib/cookies.ts';
import { cacheGet, cacheBust, tokenKey } from '../lib/apiCache.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie } from '../lib/googleClient.ts';
import { logger } from '../lib/logger.ts';
import { gmailIdSchema, markReadSchema, sendEmailSchema } from '../lib/validation.ts';

// Cache the inbox list for 60 s.  Mutations (mark-read, archive, trash, send)
// call gmailCacheBust() so the next poll always sees fresh data.
const GMAIL_TTL_MS = 60_000;

// Rate limiter for thread-detail fetches — one full thread = N message bodies
const threadLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

export const gmailRouter = express.Router();

const GMAIL_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;

/** Derive the cache key for a given google_tokens cookie value. */
function gmailKey(tokensCookie: string) {
  const tokens = parseJsonCookie(tokensCookie);
  return tokenKey(tokens?.refresh_token ?? tokensCookie, 'gmail:messages');
}

gmailRouter.get('/messages', async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { tokensCookie, tokens } = auth;

    const cacheKey = gmailKey(tokensCookie);

    const result = await cacheGet(cacheKey, GMAIL_TTL_MS, async () => {
      const oauth2Client = createAuthedGoogleClient(req, res, tokens);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Fetch inbox threads (one row per conversation)
      const threadsRes = await gmail.users.threads.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: 15,
      });

      const threadList = threadsRes.data.threads || [];

      const emails = (await Promise.all(threadList.map(async (t) => {
        const thread = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const messages = thread.data.messages ?? [];
        const messageCount = messages.length;
        const latestMsg = messages[messages.length - 1];
        if (!latestMsg) return null;

        const headers = latestMsg.payload?.headers || [];
        const fromHeader = headers.find((h: any) => h.name === 'From')?.value ?? '';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '(no subject)';
        const dateHeader = headers.find((h: any) => h.name === 'Date')?.value ?? '';

        // Parse "Name <email>" or just "email"
        const nameMatch = fromHeader.match(/^"?([^"<]+?)"?\s*(?:<(.+?)>)?$/);
        const senderName = nameMatch?.[1]?.trim() ?? fromHeader;
        const senderEmail = nameMatch?.[2] ?? fromHeader;
        const initials = senderName.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

        const labelIds = latestMsg.labelIds ?? [];
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
          id: latestMsg.id!,
          threadId: t.id!,
          messageCount,
          sender: senderName,
          senderEmail,
          initials,
          time: timeDisplay,
          subject,
          preview: thread.data.snippet ?? latestMsg.snippet ?? '',
          unread: isUnread,
          urgent: isUrgent,
          archived: false,
          deleted: false,
        };
      }))).filter(Boolean);

      return { emails };
    });

    res.json(result);
  } catch (error: any) {
    logger.error({ error: error?.message }, 'Error fetching gmail messages');
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

gmailRouter.post('/messages/:id/mark-read', async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const idValidation = gmailIdSchema.safeParse(req.params.id);
  if (!idValidation.success) return res.status(400).json({ error: 'Invalid message id' });

  const bodyValidation = markReadSchema.safeParse(req.body);
  if (!bodyValidation.success) {
    return res.status(400).json({ error: bodyValidation.error.issues[0]?.message || 'Invalid input' });
  }

  const { read } = bodyValidation.data;

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: read
        ? { removeLabelIds: ['UNREAD'] }  // marking as read
        : { addLabelIds: ['UNREAD'] },     // marking as unread
    });

    cacheBust(gmailKey(tokensCookie));
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
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
    cacheBust(gmailKey(tokensCookie));
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
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (!GMAIL_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.trash({
      userId: 'me',
      id: req.params.id,
    });
    cacheBust(gmailKey(tokensCookie));
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to trash message' });
  }
});

/**
 * GET /api/gmail/thread/:threadId
 * Returns all messages in a Gmail thread, each with its decoded plain-text body.
 * Used by the thread detail view to show the full conversation.
 */
gmailRouter.get('/thread/:threadId', threadLimiter, async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  if (!GMAIL_ID_RE.test(req.params.threadId)) {
    return res.status(400).json({ error: 'Invalid thread id' });
  }

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.threadId,
      format: 'full',
    });

    // Recursively extract plain-text body from MIME tree (same logic as /message/:id)
    const extractBody = (payload: any): string => {
      if (!payload) return '';
      if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }
      if (payload.parts) {
        for (const part of payload.parts) {
          const result = extractBody(part);
          if (result) return result;
        }
      }
      if (payload.mimeType === 'text/html' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }
      return '';
    };

    const messages = (thread.data.messages ?? []).map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const fromHeader = headers.find((h: any) => h.name === 'From')?.value ?? '';
      const dateHeader = headers.find((h: any) => h.name === 'Date')?.value ?? '';

      const nameMatch = fromHeader.match(/^"?([^"<]+?)"?\s*(?:<(.+?)>)?$/);
      const senderName = nameMatch?.[1]?.trim() ?? fromHeader;
      const senderEmail = nameMatch?.[2] ?? fromHeader;
      const initials = senderName.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

      const msgDate = new Date(dateHeader);
      const now = new Date();
      const isToday = msgDate.toDateString() === now.toDateString();
      const timeDisplay = isNaN(msgDate.getTime())
        ? ''
        : isToday
          ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

      const labelIds = msg.labelIds ?? [];
      const isUnread = labelIds.includes('UNREAD');

      return {
        id: msg.id!,
        sender: senderName,
        senderEmail,
        initials,
        time: timeDisplay,
        body: extractBody(msg.payload),
        unread: isUnread,
      };
    });

    res.json({ messages });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'Error fetching gmail thread');
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

gmailRouter.get('/message/:id', async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

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
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\s{2,}/g, ' ')
          .trim();
      }
      return '';
    };

    res.json({ body: extractBody(detail.data.payload) });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'Error fetching gmail message');
    const status = error?.response?.status ?? error?.code;
    if (status === 401 || status === 403 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

gmailRouter.post('/send', async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const validation = sendEmailSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { to, subject, body } = validation.data;

  // Sanitize headers to prevent CRLF injection
  const sanitize = (s: string) => s.replace(/[\r\n]/g, '');
  const safeTO = sanitize(to);
  const safeSubject = sanitize(subject);

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

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

    cacheBust(gmailKey(tokensCookie));
    logger.info({ to: safeTO }, 'Email sent successfully');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error sending email');
    res.status(500).json({ error: 'Failed to send email' });
  }
});
