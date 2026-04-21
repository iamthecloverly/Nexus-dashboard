import express from 'express';

import { COOKIE_OPTS } from '../config';
import { clearAppCookie, getCookie, setSignedCookie } from '../lib/cookies';

export const githubRouter = express.Router();

githubRouter.post('/token', (req, res) => {
  const { token } = req.body as { token: string };
  if (!token?.trim()) return res.status(400).json({ error: 'Missing token' });
  // Validate GitHub PAT format (classic: ghp_, fine-grained: github_pat_, OAuth: gho_)
  if (!/^(ghp_|github_pat_|gho_)[\w]+$/.test(token.trim())) {
    return res.status(400).json({ error: 'Invalid GitHub token format' });
  }
  setSignedCookie(res, 'github_token', token.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

githubRouter.get('/status', (req, res) => {
  res.json({ connected: !!getCookie(req, 'github_token') });
});

githubRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'github_token', true);
  res.json({ success: true });
});

githubRouter.get('/notifications', async (req, res) => {
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
