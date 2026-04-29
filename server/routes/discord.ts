import express from 'express';
import rateLimit from 'express-rate-limit';

import { COOKIE_OPTS } from '../config.ts';
import { clearAppCookie, getCookie, setSignedCookie } from '../lib/cookies.ts';
import { logger } from '../lib/logger.ts';
import { encrypt, safeDecrypt } from '../lib/encryption.ts';
import { discordWebhookSchema, discordSendSchema } from '../lib/validation.ts';

export const discordRouter = express.Router();

// Strict allowlist: only official Discord webhook URLs (prevents SSRF)
// Rate limiter for Discord sending - 20 messages per hour
const discordSendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const DISCORD_WEBHOOK_RE = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

discordRouter.post('/webhook', (req, res) => {
  const validation = discordWebhookSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { url } = validation.data;
  const encrypted = encrypt(url);
  setSignedCookie(res, 'discord_webhook', encrypted, { ...COOKIE_OPTS, maxAge: 365 * 24 * 60 * 60 * 1000 });
  logger.info('Discord webhook configured');
  res.json({ success: true });
});

discordRouter.get('/status', (req, res) => {
  res.json({ connected: !!getCookie(req, 'discord_webhook') });
});

discordRouter.post('/disconnect', (req, res) => {
  clearAppCookie(res, 'discord_webhook', true);
  res.json({ success: true });
});

discordRouter.post('/send', discordSendLimiter, async (req, res) => {
  const cookieWebhook = getCookie(req, 'discord_webhook');
  const webhook = cookieWebhook ? safeDecrypt(cookieWebhook) : null;
  if (!webhook) return res.status(401).json({ error: 'No webhook configured' });

  // Re-validate on use to guard against tampered cookies
  if (!DISCORD_WEBHOOK_RE.test(webhook)) return res.status(400).json({ error: 'Invalid webhook URL' });

  const validation = discordSendSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues[0]?.message || 'Invalid input' });
  }

  const { content } = validation.data;

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) return res.status(response.status).json({ error: 'Discord webhook error' });
    logger.info('Discord message sent');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Discord webhook error');
    res.status(500).json({ error: 'Failed to send message' });
  }
});
