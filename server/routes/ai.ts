import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { google, type gmail_v1 } from 'googleapis';
import OpenAI from 'openai';

import { COOKIE_OPTS } from '../config.ts';
import { clearAppCookie, getSignedCookie, setSignedCookie } from '../lib/cookies.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie, parseAccountId } from '../lib/googleClient.ts';
import { logger } from '../lib/logger.ts';
import { encrypt, safeDecrypt } from '../lib/encryption.ts';
import { aiKeySchema, extractTasksSchema, extractTasksBulkSchema, dailyBriefSchema } from '../lib/validation.ts';

export const aiRouter = express.Router();

// Rate limiter for AI endpoints (max 20 req/min — each call loops up to 10 OpenAI requests)
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const DEFAULT_TASK_MODEL = 'gpt-5.4-nano';
const FALLBACK_TASK_MODEL = 'gpt-4o-mini';

/** Recursively extract plain-text body from a Gmail MIME payload */
function extractGmailBody(payload: gmail_v1.Schema$MessagePart | null | undefined): string {
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
Rules:
- Each suggestion must include the exact emailId supplied for its source email.
- title: concise, starts with a verb (e.g. "Review proposal", "Reply to John", "Schedule meeting")
- priority: "Critical" = hard deadline or blocker; "Priority" = important but flexible; "Normal" = nice to have
- group: "now" = due today or very urgent; "next" = can be done later
- dueDate: ISO local date if an explicit or strongly implied deadline exists; otherwise null
- tags: 1-4 short lowercase labels such as reply, review, schedule, finance, docs, school, work
- confidence: high only when the task is directly supported by the email
- reason: one short sentence explaining why this task was extracted
- max 5 tasks per email
- if no actionable tasks exist for an email, include no suggestions for it and mark it no_action in processed`;

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
Each suggestion must include the exact emailId supplied for its source email.
Max 3 tasks per email. Mark emails with nothing clearly actionable as no_action in processed.`;

/** Starred mode: the user explicitly signaled that this email should become a task. */
const AI_PROMPT_STARRED = `You are a task extraction assistant. The user starred this email, so treat it as explicit intent to create a task.
Rules:
- Each suggestion must include the exact emailId supplied for its source email.
- Prefer specific actionable tasks directly requested in the email.
- If there is no explicit ask, create one useful follow-up or review task from the subject and sender.
- title: concise, starts with a verb, and does not include "starred email".
- priority: "Critical" only for a hard deadline/blocker; "Priority" for important starred follow-up; otherwise "Normal".
- group: "now" for urgent/today/deadline work; otherwise "next".
- dueDate: ISO local date if an explicit or strongly implied deadline exists; otherwise null.
- tags: include 1-4 short lowercase labels; include "starred" when appropriate.
- confidence can be low for fallback follow-up/review tasks, but explain why in reason.
- Return 1-3 tasks.`;

type AiTask = {
  id: string;
  emailId: string;
  accountId: 'primary' | 'secondary';
  threadId?: string;
  sender?: string;
  subject?: string;
  title: string;
  priority: 'Normal' | 'Priority' | 'Critical';
  group: 'now' | 'next';
  dueDate?: string;
  tags?: string[];
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  mode: AiTaskMode;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
  accepted: boolean;
};

type RawAiTask = {
  emailId?: unknown;
  title?: unknown;
  priority?: unknown;
  group?: unknown;
  dueDate?: unknown;
  tags?: unknown;
  confidence?: unknown;
  reason?: unknown;
};
type AiTaskMode = 'manual' | 'auto' | 'starred';
type ProcessedStatus = 'suggested' | 'no_action' | 'skipped' | 'error';
type ProcessedEmail = { emailId: string; status: ProcessedStatus; reason?: string };
type ExistingTaskSummary = { title: string; dueDate?: string; sourceEmailId?: string };
type EmailForAi = {
  emailId: string;
  threadId?: string;
  sender: string;
  subject: string;
  snippet: string;
  body: string;
};

const PRIORITIES = ['Normal', 'Priority', 'Critical'] as const;
type Priority = (typeof PRIORITIES)[number];
const CONFIDENCE = ['low', 'medium', 'high'] as const;
type Confidence = (typeof CONFIDENCE)[number];

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function cleanEmailBodyForAi(body: string): string {
  let cleaned = body
    .replace(/\r\n/g, '\n')
    .replace(/\n>.*(?:\n>.*)*/g, '\n');
  for (const marker of [
    /\nOn .+ wrote:\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nFrom:\s.+\nSent:\s.+\n/i,
  ]) {
    cleaned = cleaned.split(marker)[0] ?? cleaned;
  }
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim()
    .slice(0, 140);
}

function normalizeDueDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = Array.from(new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.toLowerCase().replace(/[^a-z0-9- ]/g, '').replace(/\s+/g, '-').trim())
    .filter(tag => tag.length >= 2 && tag.length <= 24)
    .slice(0, 4)));
  return tags.length ? tags : undefined;
}

function normalizeAiTasks(rawTasks: RawAiTask[], emailId: string, mode: AiTaskMode): AiTask[] {
  const email: EmailForAi = {
    emailId,
    sender: '',
    subject: '',
    snippet: '',
    body: '',
  };
  return normalizeAiTasksForEmails(rawTasks, new Map([[emailId, email]]), mode, 'primary', []);
}

function normalizeAiTasksForEmails(
  rawTasks: RawAiTask[],
  emailById: Map<string, EmailForAi>,
  mode: AiTaskMode,
  accountId: 'primary' | 'secondary',
  existingTasks: ExistingTaskSummary[],
): AiTask[] {
  const seen = new Set<string>();
  const existingTitleKeys = new Set(existingTasks.map(t => normalizeTitle(t.title).toLowerCase()).filter(Boolean));
  const existingSourceKeys = new Set(existingTasks
    .filter(t => t.sourceEmailId)
    .map(t => `${t.sourceEmailId}:${normalizeTitle(t.title).toLowerCase()}`));
  const out: AiTask[] = [];
  for (const raw of rawTasks) {
    if (typeof raw.title !== 'string') continue;
    const rawEmailId = typeof raw.emailId === 'string' ? raw.emailId : emailById.size === 1 ? [...emailById.keys()][0] : null;
    if (!rawEmailId) continue;
    const sourceEmail = emailById.get(rawEmailId);
    if (!sourceEmail) continue;

    const title = normalizeTitle(raw.title);
    if (!title) continue;
    const key = `${rawEmailId}:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (existingTitleKeys.has(title.toLowerCase()) || existingSourceKeys.has(key)) continue;

    const priority: Priority = PRIORITIES.includes(raw.priority as Priority) ? (raw.priority as Priority) : 'Normal';
    const confidence: Confidence = CONFIDENCE.includes(raw.confidence as Confidence) ? (raw.confidence as Confidence) : 'medium';
    if (mode === 'auto' && confidence === 'low') continue;

    const dueDate = normalizeDueDate(raw.dueDate);
    const tags = normalizeTags(raw.tags);
    out.push({
      id: randomUUID(),
      emailId: rawEmailId,
      accountId,
      ...(sourceEmail.threadId ? { threadId: sourceEmail.threadId } : {}),
      ...(sourceEmail.sender ? { sender: sourceEmail.sender } : {}),
      ...(sourceEmail.subject ? { subject: sourceEmail.subject } : {}),
      title,
      priority,
      group: raw.group === 'next' ? 'next' : 'now',
      ...(dueDate ? { dueDate } : {}),
      ...(tags ? { tags } : {}),
      confidence,
      reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 240) : '',
      mode,
      status: 'pending',
      createdAt: new Date().toISOString(),
      accepted: true,
    });
  }
  return out;
}

const TASK_EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          emailId: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string', enum: ['Normal', 'Priority', 'Critical'] },
          group: { type: 'string', enum: ['now', 'next'] },
          dueDate: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          reason: { type: 'string' },
        },
        required: ['emailId', 'title', 'priority', 'group', 'dueDate', 'tags', 'confidence', 'reason'],
      },
    },
    processed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          emailId: { type: 'string' },
          status: { type: 'string', enum: ['suggested', 'no_action', 'skipped', 'error'] },
          reason: { type: ['string', 'null'] },
        },
        required: ['emailId', 'status', 'reason'],
      },
    },
  },
  required: ['suggestions', 'processed'],
} as const;

function getTaskModel(): string {
  return process.env.OPENAI_TASK_MODEL?.trim() || DEFAULT_TASK_MODEL;
}

function modelUnavailable(error: unknown): boolean {
  const err = error as { status?: number; response?: { status?: number }; message?: string };
  const status = err.status ?? err.response?.status;
  if (status === 404) return true;
  if (status !== 400) return false;
  return /model|unsupported|does not exist|not found|invalid/i.test(err.message ?? '');
}

async function createTaskExtractionCompletion(
  openai: OpenAI,
  model: string,
  mode: AiTaskMode,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
): Promise<{ content: unknown; model: string }> {
  const request = {
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_task_extraction',
        strict: true,
        schema: TASK_EXTRACTION_RESPONSE_SCHEMA,
      },
    },
    temperature: mode === 'auto' ? 0 : 0.15,
    messages,
  } as const;

  try {
    const completion = await openai.chat.completions.create(request);
    return { content: completion.choices?.[0]?.message?.content, model };
  } catch (error) {
    if (model !== FALLBACK_TASK_MODEL && modelUnavailable(error)) {
      logger.warn({ model, fallback: FALLBACK_TASK_MODEL }, 'Task extraction model unavailable; using fallback');
      const completion = await openai.chat.completions.create({ ...request, model: FALLBACK_TASK_MODEL });
      return { content: completion.choices?.[0]?.message?.content, model: FALLBACK_TASK_MODEL };
    }
    throw error;
  }
}

function asOpenAiPromptEmail(email: EmailForAi) {
  return {
    emailId: email.emailId,
    from: email.sender,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body,
  };
}

function extractionPromptForMode(mode: AiTaskMode): string {
  if (mode === 'starred') return AI_PROMPT_STARRED;
  if (mode === 'auto') return AI_PROMPT_AUTO;
  return AI_PROMPT_MANUAL;
}

async function fetchEmailForAi(
  gmail: ReturnType<typeof google.gmail>,
  emailId: string,
): Promise<EmailForAi> {
  const full = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
  const headers = full.data.payload?.headers ?? [];
  const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value ?? '(no subject)';
  const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value ?? '';
  const body = cleanEmailBodyForAi(extractGmailBody(full.data.payload)).slice(0, 3500);
  return {
    emailId,
    ...(full.data.threadId ? { threadId: full.data.threadId } : {}),
    sender: from,
    subject,
    snippet: full.data.snippet ?? '',
    body,
  };
}

function authAffectsWholeBatch(error: unknown): boolean {
  const err = error as { status?: number; response?: { status?: number }; message?: string };
  const status = err.status ?? err.response?.status;
  return status === 401 || err?.message?.includes('invalid_grant');
}

async function extractTasksFromEmails(
  gmail: ReturnType<typeof google.gmail>,
  openai: OpenAI,
  emailIds: string[],
  mode: AiTaskMode = 'manual',
  accountId: 'primary' | 'secondary' = 'primary',
  options: {
    clientToday?: string;
    timezone?: string;
    existingTasks?: ExistingTaskSummary[];
  } = {},
): Promise<{ suggestions: AiTask[]; processed: ProcessedEmail[]; model: string }> {
  const fetched = await mapWithConcurrency(emailIds, 4, async (emailId): Promise<{ email?: EmailForAi; processed?: ProcessedEmail }> => {
    try {
      return { email: await fetchEmailForAi(gmail, emailId) };
    } catch (error) {
      if (authAffectsWholeBatch(error)) throw error;
      const err = error as { message?: string };
      return { processed: { emailId, status: 'error', reason: err.message?.slice(0, 160) || 'Failed to fetch email' } };
    }
  });

  const emails = fetched.map(item => item.email).filter((email): email is EmailForAi => !!email);
  const processed = fetched.map(item => item.processed).filter((item): item is ProcessedEmail => !!item);
  if (emails.length === 0) {
    return { suggestions: [], processed, model: getTaskModel() };
  }

  const prompt = [
    `Today: ${options.clientToday ?? todayKey()}`,
    `Timezone: ${options.timezone ?? 'unknown'}`,
    `Existing active tasks for dedupe: ${JSON.stringify((options.existingTasks ?? []).slice(0, 50))}`,
    `Emails: ${JSON.stringify(emails.map(asOpenAiPromptEmail))}`,
  ].join('\n');

  const completion = await createTaskExtractionCompletion(openai, getTaskModel(), mode, [
    { role: 'system', content: extractionPromptForMode(mode) },
    { role: 'user', content: prompt },
  ]);

  const raw = parseAiExtractionJson(completion.content);
  const emailById = new Map(emails.map(email => [email.emailId, email]));
  const suggestions = normalizeAiTasksForEmails(raw.tasks, emailById, mode, accountId, options.existingTasks ?? []);
  const suggestedIds = new Set(suggestions.map(s => s.emailId));
  const knownIds = new Set(emailById.keys());

  for (const item of raw.processed) {
    if (!knownIds.has(item.emailId)) continue;
    if (processed.some(p => p.emailId === item.emailId)) continue;
    processed.push({
      emailId: item.emailId,
      status: suggestedIds.has(item.emailId) ? 'suggested' : item.status,
      ...(item.reason ? { reason: item.reason } : {}),
    });
  }

  for (const email of emails) {
    if (processed.some(item => item.emailId === email.emailId)) continue;
    processed.push({
      emailId: email.emailId,
      status: suggestedIds.has(email.emailId) ? 'suggested' : 'no_action',
    });
  }

  return { suggestions, processed, model: completion.model };
}

/** Shared legacy wrapper: fetch one email body, call the bulk extractor, return suggestions */
async function extractTasksFromEmail(
  gmail: ReturnType<typeof google.gmail>,
  openai: OpenAI,
  emailId: string,
  mode: AiTaskMode = 'manual',
  accountId: 'primary' | 'secondary' = 'primary',
): Promise<{ suggestions: AiTask[]; processed: ProcessedEmail[]; model: string }> {
  return extractTasksFromEmails(gmail, openai, [emailId], mode, accountId);
}

type RawProcessedEmail = { emailId?: unknown; status?: unknown; reason?: unknown };

export function parseAiExtractionJson(content: unknown): { tasks: RawAiTask[]; processed: ProcessedEmail[] } {
  if (typeof content !== 'string' || !content.trim()) return { tasks: [], processed: [] };
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown> | RawAiTask[];
    if (Array.isArray(parsed)) return { tasks: parsed as RawAiTask[], processed: [] };
    if (!parsed || typeof parsed !== 'object') return { tasks: [], processed: [] };
    const tasks = Array.isArray(parsed.tasks)
      ? (parsed.tasks as RawAiTask[])
      : Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as RawAiTask[])
        : [];
    const processed = Array.isArray(parsed.processed)
      ? (parsed.processed as RawProcessedEmail[]).flatMap(item => {
        if (typeof item.emailId !== 'string') return [];
        const status: ProcessedStatus =
          item.status === 'suggested' || item.status === 'no_action' || item.status === 'skipped' || item.status === 'error'
            ? item.status
            : 'no_action';
        return [{
          emailId: item.emailId,
          status,
          ...(typeof item.reason === 'string' && item.reason.trim() ? { reason: item.reason.trim().slice(0, 180) } : {}),
        }];
      })
      : [];
    return { tasks, processed };
  } catch {
    return { tasks: [], processed: [] };
  }
}

export function parseAiTasksJson(content: unknown): { tasks: RawAiTask[] } {
  return { tasks: parseAiExtractionJson(content).tasks };
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
  const cookieKey = getSignedCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const envKey = process.env.OPENAI_API_KEY;
  const source = decryptedKey ? 'cookie' : (envKey ? 'env' : null);
  res.json({ configured: !!(decryptedKey ?? envKey), source });
});

aiRouter.post('/disconnect', (_req, res) => {
  clearAppCookie(res, 'openai_key', true);
  res.json({ success: true });
});

aiRouter.post('/extract-tasks', aiLimiter, async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated with Google' });

  const validation = extractTasksSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getSignedCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const openAIKey = decryptedKey ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailId } = validation.data;

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const result = await extractTasksFromEmail(gmail, openai, emailId, 'manual', accountId);
    logger.info({ emailId, count: result.suggestions.length, model: result.model }, 'Extracted tasks from email');
    res.json(result);
  } catch (error) {
    const err = error as { status?: number; message?: string };
    logger.error({ error: err?.message, emailId }, 'AI extract-tasks error');
    if (err?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (err?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});

aiRouter.post('/daily-brief', aiLimiter, async (req, res) => {
  const validation = dailyBriefSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getSignedCookie(req, 'openai_key');
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
  } catch (error) {
    const err = error as { status?: number; message?: string };
    logger.error({ error: err?.message }, 'AI daily-brief error');
    if (err?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key', code: 'INVALID_KEY' });
    res.status(500).json({ error: 'Failed to generate daily brief' });
  }
});

aiRouter.post('/extract-tasks-bulk', aiLimiter, async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated with Google' });

  const validation = extractTasksBulkSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const cookieKey = getSignedCookie(req, 'openai_key');
  const decryptedKey = cookieKey ? safeDecrypt(cookieKey) : null;
  const openAIKey = decryptedKey ?? process.env.OPENAI_API_KEY;
  if (!openAIKey) return res.status(503).json({ error: 'OpenAI API key not configured', code: 'NO_AI_KEY' });

  const { emailIds, mode = 'manual', clientToday, timezone, existingTasks = [] } = validation.data;

  try {
    const { tokens } = auth;
    const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

    const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
    const openai = new OpenAI({ apiKey: openAIKey });

    const result = await extractTasksFromEmails(gmail, openai, emailIds, mode, accountId, {
      clientToday,
      timezone,
      existingTasks,
    });

    logger.info({ emailCount: emailIds.length, taskCount: result.suggestions.length, model: result.model }, 'Bulk extracted tasks');
    res.json(result);
  } catch (error) {
    const err = error as { status?: number; message?: string };
    logger.error({ error: err?.message }, 'AI extract-tasks-bulk error');
    if (err?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (err?.message?.includes('invalid_grant')) return res.status(401).json({ error: 'Google session expired, please reconnect' });
    res.status(500).json({ error: 'Failed to extract tasks' });
  }
});

export const __testOnly = { cleanEmailBodyForAi, extractGmailBody, normalizeAiTasks, normalizeAiTasksForEmails, extractTasksFromEmails };
