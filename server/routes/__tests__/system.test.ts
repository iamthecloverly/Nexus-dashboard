import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { systemRouter } from '../system';

function makeApp() {
  const app = express();
  app.use(systemRouter);
  return app;
}

describe('System Route', () => {
  describe('GET /system', () => {
    it('returns cpuLoad and memUsed as numbers', async () => {
      const res = await request(makeApp()).get('/system');
      expect(res.status).toBe(200);
      expect(typeof res.body.cpuLoad).toBe('number');
      expect(typeof res.body.memUsed).toBe('number');
    });

    it('cpuLoad is between 0 and 100', async () => {
      const res = await request(makeApp()).get('/system');
      expect(res.body.cpuLoad).toBeGreaterThanOrEqual(0);
      expect(res.body.cpuLoad).toBeLessThanOrEqual(100);
    });

    it('memUsed is between 0 and 100', async () => {
      const res = await request(makeApp()).get('/system');
      expect(res.body.memUsed).toBeGreaterThanOrEqual(0);
      expect(res.body.memUsed).toBeLessThanOrEqual(100);
    });

    it('cpuLoad has at most one decimal place', async () => {
      const res = await request(makeApp()).get('/system');
      const str = String(res.body.cpuLoad);
      const decimalPart = str.split('.')[1] ?? '';
      expect(decimalPart.length).toBeLessThanOrEqual(1);
    });
  });
});
