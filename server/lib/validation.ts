import { z } from 'zod';

// Gmail validation schemas
export const gmailIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{6,32}$/, 'Invalid Gmail message ID');

export const markReadSchema = z.object({
  read: z.boolean(),
});

export const sendEmailSchema = z.object({
  to: z.string().email('Invalid recipient email address').trim(),
  subject: z.string().min(1, 'Subject is required').max(200, 'Subject too long'),
  body: z.string().min(1, 'Email body is required').max(50000, 'Email body too long'),
});

// AI validation schemas
// Accepts all current OpenAI key formats:
//   Legacy secret keys:        sk-<48 alphanumeric chars>
//   Project API keys:          sk-proj-<variable length>
//   Service-account keys:      sk-svcacct-<variable length>
// The character set is deliberately broad (printable ASCII minus whitespace) so
// that future key formats introduced by OpenAI continue to work.
export const aiKeySchema = z.object({
  key: z.string().regex(/^sk-[A-Za-z0-9_-]{10,}$/, 'Invalid OpenAI API key format'),
});

export const extractTasksSchema = z.object({
  emailId: gmailIdSchema,
});

export const extractTasksBulkSchema = z.object({
  emailIds: z.array(gmailIdSchema).min(1, 'At least one email ID required').max(10, 'Maximum 10 emails at once'),
  mode: z.enum(['manual', 'auto']).optional(),
});

export const dailyBriefSchema = z.object({
  calendarEvents: z.array(
    z.object({
      summary: z.string().max(120).optional(),
      start: z.string().max(30).optional(),
      end: z.string().max(30).optional(),
    })
  ).max(20).optional(),
  unreadEmailCount: z.number().int().min(0).max(10000).optional(),
  activeTaskCount: z.number().int().min(0).max(10000).optional(),
});

// GitHub validation schemas
export const githubTokenSchema = z.object({
  token: z.string().regex(/^(ghp_|github_pat_|gho_)[\w]+$/, 'Invalid GitHub token format'),
});

// Discord validation schemas
export const discordWebhookSchema = z.object({
  url: z.string().regex(/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/, 'Invalid Discord webhook URL'),
});

export const discordSendSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(2000, 'Message too long'),
});

// Session validation schemas
export const loginSchema = z.object({
  passcode: z.string().min(1, 'Passcode is required'),
});
