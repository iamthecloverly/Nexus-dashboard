import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

import { SESSION_SECRET } from '../../config';
import { gmailRouter } from '../gmail';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  app.use('/api/gmail', gmailRouter);
  return app;
}

describe('Gmail routes', () => {
  describe('GET /api/gmail/message/:id', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await request(makeApp()).get('/api/gmail/message/abc123def456');
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid message id', async () => {
      const fakeTokens = JSON.stringify({ access_token: 'fake', refresh_token: 'fake' });
      // Use an ID with invalid characters (spaces, dots) that fail the gmailIdSchema regex
      const res = await request(makeApp())
        .get('/api/gmail/message/invalid..id')
        .set('Cookie', `google_tokens=${fakeTokens}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid message id');
    });

    it('returns 400 for empty-ish id that fails regex', async () => {
      const fakeTokens = JSON.stringify({ access_token: 'fake', refresh_token: 'fake' });
      const res = await request(makeApp())
        .get('/api/gmail/message/!!invalid!!')
        .set('Cookie', `google_tokens=${fakeTokens}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid message id');
    });
  });
});
