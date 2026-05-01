import express from 'express';
import { google } from 'googleapis';
import rateLimit from 'express-rate-limit';

import { parseJsonCookie } from '../lib/cookies.ts';
import { cacheGet, cacheBust, tokenKey } from '../lib/apiCache.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie, parseAccountId, type GoogleAccountId } from '../lib/googleClient.ts';
import { extractEmailContent } from '../lib/gmailMime.ts';
import { logger } from '../lib/logger.ts';
import { gmailIdSchema, markReadSchema, sendEmailSchema } from '../lib/validation.ts';

// Cache the inbox list for 60 s.  Mutations (mark-read, archive, trash, send)
// call gmailCacheBust() so the next poll always sees fresh data.
const GMAIL_TTL_MS = 60_000;

// Rate limiter for thread-detail fetches — one full thread = N message bodies
const threadLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

// Rate limiter for email sending - 10 emails per hour to prevent spam
const emailSendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
export const gmailRouter = express.Router();

/** Narrow an unknown caught error to access common googleapis error fields. */
type GaxiosErrorLike = { response?: { status?: number }; code?: string; message?: string };
function asApiError(e: unknown): GaxiosErrorLike {
  return e as GaxiosErrorLike;
}

function getMessageReceivedAt(internalDate?: string | null, dateHeader?: string): string | null {
  const internalMs = Number(internalDate);
  if (Number.isFinite(internalMs) && internalMs > 0) {
    return new Date(internalMs).toISOString();
  }

  const headerMs = Date.parse(dateHeader ?? '');
  if (Number.isFinite(headerMs)) {
    return new Date(headerMs).toISOString();
  }

  return null;
}

function formatEmailTime(receivedAt: string | null): string {
  if (!receivedAt) return '';
  const msgDate = new Date(receivedAt);
  if (Number.isNaN(msgDate.getTime())) return '';

  const now = new Date();
  const isToday = msgDate.toDateString() === now.toDateString();
  return isToday
    ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Derive the cache key for a given google_tokens cookie value. */
function gmailKey(tokensCookie: string, accountId: GoogleAccountId) {
  const tokens = parseJsonCookie<{ refresh_token?: string }>(tokensCookie);
  return tokenKey(`${accountId}:${tokens?.refresh_token ?? tokensCookie}`, 'gmail:messages');
}

gmailRouter.get('/messages', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { tokensCookie, tokens } = auth;

    const cacheKey = gmailKey(tokensCookie, accountId);

    const result = await cacheGet(cacheKey, GMAIL_TTL_MS, async () => {
      const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Fetch inbox threads (one row per conversation)
      const threadsRes = await gmail.users.threads.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: 15,
      });

      const threadList = threadsRes.data.threads || [];

      const emails = (await Promise.all(threadList.map(async (t) => {
        const threadRes = await gmail.users.threads.get({
            userId: 'me',
            id: t.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          }).catch((err: unknown) => {
            logger.warn({ error: err instanceof Error ? err.message : String(err), threadId: t.id }, 'Failed to fetch gmail thread metadata');
            return null;
          });
          if (!threadRes) return null;

          const messages = threadRes.data.messages ?? [];
        const messageCount = messages.length;
        const latestMsg = messages[messages.length - 1];
        if (!latestMsg) return null;

        const headers = latestMsg.payload?.headers || [];
        const fromHeader = headers.find(h => h.name === 'From')?.value ?? '';
        const subject = headers.find(h => h.name === 'Subject')?.value ?? '(no subject)';
        const dateHeader = headers.find(h => h.name === 'Date')?.value ?? '';

        // Parse "Name <email>" or just "email"
        const nameMatch = fromHeader.match(/^"?([^"<]+?)"?\s*(?:<(.+?)>)?$/);
        const senderName = nameMatch?.[1]?.trim() ?? fromHeader;
        const senderEmail = nameMatch?.[2] ?? fromHeader;
        const initials = senderName.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

        const labelIds = latestMsg.labelIds ?? [];
        const isUnread = labelIds.includes('UNREAD');
        const isUrgent = labelIds.includes('STARRED');

        const receivedAt = getMessageReceivedAt(latestMsg.internalDate, dateHeader);

        return {
          accountId,
          id: latestMsg.id!,
          threadId: t.id!,
          messageCount,
          sender: senderName,
          senderEmail,
          initials,
          receivedAt,
          time: formatEmailTime(receivedAt),
          subject,
          preview: threadRes.data.snippet ?? latestMsg.snippet ?? '',
          unread: isUnread,
          urgent: isUrgent,
          archived: false,
          deleted: false,
        };
      }))).filter(Boolean);

      return { emails };
    });

    res.json(result);
  } catch (error: unknown) {
    const err = asApiError(error);
    logger.error({ error: err?.message }, 'Error fetching gmail messages');
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

gmailRouter.post('/messages/:id/mark-read', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
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
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: read
        ? { removeLabelIds: ['UNREAD'] }  // marking as read
        : { addLabelIds: ['UNREAD'] },     // marking as unread
    });

    cacheBust(gmailKey(tokensCookie, accountId));
    res.json({ success: true });
  } catch (error: unknown) {
    const err = asApiError(error);
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to update message' });
  }
});

gmailRouter.post('/messages/:id/archive', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (!gmailIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
    cacheBust(gmailKey(tokensCookie, accountId));
    res.json({ success: true });
  } catch (error: unknown) {
    const err = asApiError(error);
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to archive message' });
  }
});

gmailRouter.post('/messages/:id/trash', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (!gmailIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const { tokensCookie, tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmail.users.messages.trash({
      userId: 'me',
      id: req.params.id,
    });
    cacheBust(gmailKey(tokensCookie, accountId));
    res.json({ success: true });
  } catch (error: unknown) {
    const err = asApiError(error);
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
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
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  if (!gmailIdSchema.safeParse(req.params.threadId).success) {
    return res.status(400).json({ error: 'Invalid thread id' });
  }

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.threadId,
      format: 'full',
    });

    const messages = await Promise.all((thread.data.messages ?? []).map(async (msg) => {
      const headers = msg.payload?.headers ?? [];
      const fromHeader = headers.find(h => h.name === 'From')?.value ?? '';
      const dateHeader = headers.find(h => h.name === 'Date')?.value ?? '';

      const nameMatch = fromHeader.match(/^"?([^"<]+?)"?\s*(?:<(.+?)>)?$/);
      const senderName = nameMatch?.[1]?.trim() ?? fromHeader;
      const senderEmail = nameMatch?.[2] ?? fromHeader;
      const initials = senderName.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

      const receivedAt = getMessageReceivedAt(msg.internalDate, dateHeader);

      const labelIds = msg.labelIds ?? [];
      const isUnread = labelIds.includes('UNREAD');

      const { plain, html } = await extractEmailContent(gmail, msg.id!, msg.payload);

      return {
        accountId,
        id: msg.id!,
        sender: senderName,
        senderEmail,
        initials,
        receivedAt,
        time: formatEmailTime(receivedAt),
        body: plain,
        bodyHtml: html,
        unread: isUnread,
      };
    }));

    res.json({ messages });
  } catch (error: unknown) {
    const err = asApiError(error);
    logger.error({ error: err?.message }, 'Error fetching gmail thread');
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

gmailRouter.get('/message/:id', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });
  if (!gmailIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid message id' });

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
    });

    const { plain, html } = await extractEmailContent(gmail, req.params.id, detail.data.payload);
    res.json({ body: plain, bodyHtml: html });
  } catch (error: unknown) {
    const err = asApiError(error);
    logger.error({ error: err?.message }, 'Error fetching gmail message');
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || status === 403 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

gmailRouter.post('/send', emailSendLimiter, async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
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
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

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

    cacheBust(gmailKey(tokensCookie, accountId));
    logger.info({ to: safeTO }, 'Email sent successfully');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error sending email');
    res.status(500).json({ error: 'Failed to send email' });
  }
});
