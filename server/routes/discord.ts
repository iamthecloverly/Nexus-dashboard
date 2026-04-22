import express from 'express';

import { COOKIE_OPTS } from '../config.ts';
import { clearAppCookie, getCookie, setSignedCookie } from '../lib/cookies.ts';

export const discordRouter = express.Router();

// Strict allowlist: only official Discord webhook URLs (prevents SSRF)
const DISCORD_WEBHOOK_RE = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

discordRouter.post('/webhook', (req, res) => {
  const { url } = req.body as { url: string };
  if (!url?.trim()) return res.status(400).json({ error: 'Missing webhook URL' });
  if (!DISCORD_WEBHOOK_RE.test(url.trim())) {
    return res.status(400).json({ error: 'Invalid Discord webhook URL' });
  }
  setSignedCookie(res, 'discord_webhook', url.trim(), { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

discordRouter.get('/status', (req, res) => {
  res.json({ connected: !!getCookie(req, 'discord_webhook') });
});

discordRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'discord_webhook', true);
  res.json({ success: true });
});

discordRouter.post('/send', async (req, res) => {
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
