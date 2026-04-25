import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import OpenAI from 'openai';

import { COOKIE_OPTS } from '../config.ts';
import { clearAppCookie, getCookie, setSignedCookie } from '../lib/cookies.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie } from '../lib/googleClient.ts';
import { logger } from '../lib/logger.ts';
import { encrypt, safeDecrypt } from '../lib/encryption.ts';
import { aiKeySchema, extractTasksSchema, extractTasksBulkSchema, dailyBriefSchema } from '../lib/validation.ts';

export const aiRouter = express.Router();

// Rate limiter for AI endpoints (max 20 req/min — each call loops up to 10 OpenAI requests)
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

const GMAIL_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;

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

  const raw = parseAiTasksJson(completion.choices?.[0]?.message?.content);
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

export function parseAiTasksJson(content: unknown): { tasks: any[] } {
  if (typeof content !== 'string' || !content.trim()) return { tasks: [] };
  try {
    const parsed = JSON.parse(content) as any;
    if (!parsed || typeof parsed !== 'object') return { tasks: [] };
    const tasks = Array.isArray((parsed as any).tasks) ? (parsed as any).tasks : [];
    return { tasks };
  } catch {
    return { tasks: [] };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) break;
      out[my] = await fn(items[my]!);
    }
  });
  await Promise.all(workers);
  return out;
}

aiRouter.post('/key', (req, res) => {
  const validation = aiKeySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { key } = validation.data;
  const encrypted = encrypt(key);
  setSignedCookie(res, 'openai_key', encrypted, { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  logger.info('OpenAI API key configured');
  res.json({ success: true });
});

aiRouter.get('/status', (req, res) => {
  const cookieKey = getCookie(req, 'openai_key');
  const envKey = process.env.OPENAI_API_KEY;
  const source = cookieKey ? 'cookie' : (envKey ? 'env' : null);
  res.json({ configured: !!(cookieKey ?? envKey), source });
});

aiRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'openai_key', true);
  res.json({ success: true });
});

aiRouter.post('/extract-tasks', aiLimiter, async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated with Google' });

  const validation = extractTasksSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const openAIKey = decryptedKey ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailId } = validation.data;

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const suggestions = await extractTasksFromEmail(gmail, openai, emailId);
    logger.info({ emailId, count: suggestions.length }, 'Extracted tasks from email');
    res.json({ suggestions });
  } catch (error: any) {
    logger.error({ error: error?.message, emailId }, 'AI extract-tasks error');
    if (error?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (error?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});

aiRouter.post('/daily-brief', aiLimiter, async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated with Google' });

  const validation = dailyBriefSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const openAIKey = decryptedKey ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const {
    calendarEvents = [],
    unreadEmailCount = 0,
    activeTaskCount = 0,
  } = validation.data;

  // Validate input sizes to prevent prompt injection / abuse (already validated by Zod)
  const safeEvents = calendarEvents.map(e => ({
    summary: e.summary ?? '',
    start: e.start ?? '',
    end: e.end ?? '',
  }));

  const eventsText = safeEvents.length
    ? safeEvents.map(e => `- ${e.summary || 'Event'} (${e.start}–${e.end})`).join('\n')
    : 'No events today';

  const prompt = [
    `Today's schedule: ${eventsText}`,
    `Unread emails: ${Number(unreadEmailCount) || 0}`,
    `Active tasks remaining: ${Number(activeTaskCount) || 0}`,
  ].join('\n');

  try {
    const openai = new OpenAI({ apiKey: openAIKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 160,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise personal assistant. Given a user\'s agenda, write exactly 2–3 short, motivating sentences as a daily brief. ' +
            'Mention the busiest part of the day, any inbox urgency, and a quick encouragement about their task list. ' +
            'Plain text only — no markdown, no bullets, no lists.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const brief = (completion.choices[0].message.content ?? '').trim();
    logger.info('Generated daily brief');
    res.json({ brief });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'AI daily-brief error');
    if (error?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    res.status(500).json({ error: 'Failed to generate daily brief' });
  }
});

aiRouter.post('/extract-tasks-bulk', aiLimiter, async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated with Google' });

  const validation = extractTasksBulkSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const openAIKey = decryptedKey ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailIds, mode = 'manual' } = validation.data;

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens);

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const batches = emailIds;
    const perEmail = await mapWithConcurrency(batches, 3, async (emailId) => {
      try {
        return await extractTasksFromEmail(gmail, openai, emailId, mode);
      } catch {
        return [];
      }
    });
    const allSuggestions = perEmail.flat();

    logger.info({ emailCount: emailIds.length, taskCount: allSuggestions.length }, 'Bulk extracted tasks');
    res.json({ suggestions: allSuggestions });
  } catch (error: any) {
    logger.error({ error: error?.message }, 'AI extract-tasks-bulk error');
    if (error?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (error?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});
