import express from 'express';

import { COOKIE_OPTS } from '../config.ts';
import { clearAppCookie, getSignedCookie, setSignedCookie } from '../lib/cookies.ts';
import { cacheGet, tokenKey } from '../lib/apiCache.ts';
import { logger } from '../lib/logger.ts';
import { encrypt, safeDecrypt } from '../lib/encryption.ts';
import { githubTokenSchema } from '../lib/validation.ts';

// Cache GitHub notifications for 90 s — client already polls every 5 min,
// this just prevents duplicate calls on page load / tab focus.
const GITHUB_TTL_MS = 90_000;

export const githubRouter = express.Router();

function getConfiguredGithubToken(req: express.Request): string | null {
  const cookieToken = getSignedCookie(req, 'github_token');
  const decrypted = cookieToken ? safeDecrypt(cookieToken) : null;
  const envToken = process.env.GITHUB_TOKEN?.trim() || null;
  return decrypted ?? envToken;
}

githubRouter.post('/token', (req, res) => {
  const validation = githubTokenSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { token } = validation.data;
  const encrypted = encrypt(token);
  setSignedCookie(res, 'github_token', encrypted, { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  logger.info('GitHub token configured');
  res.json({ success: true });
});

githubRouter.get('/status', (req, res) => {
  res.json({ connected: !!getConfiguredGithubToken(req) });
});

githubRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'github_token', true);
  res.json({ success: true });
});

githubRouter.get('/notifications', async (req, res) => {
  const token = getConfiguredGithubToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const cacheKey = tokenKey(token, 'github:notifications');

    const result = await cacheGet(cacheKey, GITHUB_TTL_MS, async () => {
      const response = await fetch('https://api.github.com/notifications?per_page=15&all=false', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'NexusDashboard/1.0',
        },
      });
      if (response.status === 401) throw Object.assign(new Error('Invalid GitHub token'), { status: 401 });
      if (!response.ok) throw Object.assign(new Error('GitHub API error'), { status: response.status });

      const raw = await response.json() as Record<string, unknown>[];
      return {
        notifications: raw.map(n => {
          const subject = n.subject as Record<string, unknown> | undefined;
          const repo = n.repository as Record<string, unknown> | undefined;
          return {
            id: n.id as string,
            title: subject?.title as string,
            type: subject?.type as string,
            repo: repo?.full_name as string,
            reason: n.reason as string,
            updatedAt: n.updated_at as string,
            url: (subject?.url as string | undefined)
              ?.replace('https://api.github.com/repos/', 'https://github.com/')
              .replace('/pulls/', '/pull/'),
          };
        }),
      };
    });

    res.json(result);
  } catch (error) {
    const err = error as { status?: number; message?: string };
    if (err?.status === 401) return res.status(401).json({ error: 'Invalid GitHub token' });
    if (err?.status) return res.status(err.status).json({ error: 'GitHub API error' });
    logger.error({ error: err?.message }, 'GitHub API error');
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});
