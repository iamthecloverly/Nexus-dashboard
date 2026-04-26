import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SESSION_SECRET } from '../../config';
import { githubRouter } from '../github';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.use('/api/github', githubRouter);
  return app;
}

describe('GitHub Routes', () => {
  describe('POST /api/github/token', () => {
    it('rejects request with no body', async () => {
      const res = await request(makeApp())
        .post('/api/github/token')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects token with invalid format', async () => {
      const res = await request(makeApp())
        .post('/api/github/token')
        .send({ token: 'bad-token-format' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid GitHub token/i);
    });

    it('accepts a valid ghp_ token format and sets cookie', async () => {
      const res = await request(makeApp())
        .post('/api/github/token')
        .send({ token: 'ghp_validtokenABCDEF1234567890abcdef12' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const cookie = res.headers['set-cookie'];
      expect(cookie).toBeDefined();
    });

    it('accepts a valid github_pat_ token format', async () => {
      const res = await request(makeApp())
        .post('/api/github/token')
        .send({ token: 'github_pat_validABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/github/status', () => {
    it('returns not connected when no cookie set', async () => {
      const res = await request(makeApp()).get('/api/github/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });
  });

  describe('POST /api/github/disconnect', () => {
    it('returns success', async () => {
      const res = await request(makeApp()).post('/api/github/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/github/notifications', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(makeApp()).get('/api/github/notifications');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Not authenticated');
    });
  });
});
