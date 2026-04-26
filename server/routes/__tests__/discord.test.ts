import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_SECRET } from '../../config';
import { discordRouter } from '../discord';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.use('/api/discord', discordRouter);
  return app;
}

describe('Discord Routes', () => {
  describe('POST /api/discord/webhook', () => {
    it('rejects request with no body', async () => {
      const res = await request(makeApp()).post('/api/discord/webhook').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects invalid webhook URL', async () => {
      const res = await request(makeApp())
        .post('/api/discord/webhook')
        .send({ url: 'https://evil.example.com/webhook' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid Discord webhook URL/i);
    });

    it('rejects partial discord webhook URL', async () => {
      const res = await request(makeApp())
        .post('/api/discord/webhook')
        .send({ url: 'https://discord.com/api/webhooks/' });
      expect(res.status).toBe(400);
    });

    it('accepts valid Discord webhook URL', async () => {
      const res = await request(makeApp())
        .post('/api/discord/webhook')
        .send({ url: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_0123456789' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/discord/status', () => {
    it('returns not connected when no cookie', async () => {
      const res = await request(makeApp()).get('/api/discord/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });
  });

  describe('POST /api/discord/disconnect', () => {
    it('returns success', async () => {
      const res = await request(makeApp()).post('/api/discord/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/discord/send', () => {
    it('returns 401 when no webhook configured', async () => {
      const res = await request(makeApp())
        .post('/api/discord/send')
        .send({ content: 'Hello' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No webhook configured');
    });

    it('returns 401 without webhook even with empty content', async () => {
      const res = await request(makeApp())
        .post('/api/discord/send')
        .send({ content: '' });
      // Webhook check fires before body validation
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('returns 401 without webhook even with oversized content', async () => {
      const res = await request(makeApp())
        .post('/api/discord/send')
        .send({ content: 'a'.repeat(2001) });
      // Webhook check fires before body validation
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });
});
