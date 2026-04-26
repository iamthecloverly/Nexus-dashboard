import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sessionRouter } from '../session';
import { SESSION_SECRET } from '../../config';

const app = express();
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));
app.use('/api/session', sessionRouter);

describe('Session Routes', () => {
  describe('GET /api/session/status', () => {
    it('should return logged out status when no session cookie', async () => {
      const response = await request(app)
        .get('/api/session/status')
        .expect(200);

      expect(response.body).toEqual({
        loggedIn: false,
        googleEmail: null,
        allowlisted: false,
      });
    });
  });

  describe('POST /api/session/login', () => {
    it('should reject login without passcode', async () => {
      const response = await request(app)
        .post('/api/session/login')
        .send({})
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should reject login with invalid passcode', async () => {
      const response = await request(app)
        .post('/api/session/login')
        .send({ passcode: 'wrong_passcode' })
        .expect(401);

      expect(response.body.error).toBe('Invalid passcode');
    });

    it('should validate passcode format', async () => {
      const response = await request(app)
        .post('/api/session/login')
        .send({ passcode: '' })
        .expect(400);

      expect(response.body.error).toContain('required');
    });
  });

  describe('POST /api/session/logout', () => {
    it('should clear session cookies on logout', async () => {
      const response = await request(app)
        .post('/api/session/logout')
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify cookies are cleared
      const setCookies = response.headers['set-cookie'];
      expect(setCookies).toBeDefined();
    });
  });
});
