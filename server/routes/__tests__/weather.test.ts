import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { weatherRouter } from '../weather';

function makeApp() {
  const app = express();
  app.use(weatherRouter);
  return app;
}

// Helper: create a minimal Open-Meteo-shaped response body
function meteoPayload(temp = 20, app = 18, hum = 55, wc = 1, unit = '°C') {
  return {
    current: {
      temperature_2m: temp,
      apparent_temperature: app,
      relative_humidity_2m: hum,
      weather_code: wc,
    },
    current_units: {
      temperature_2m: unit,
    },
  };
}

describe('Weather Route', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('GET /weather — successful upstream response', () => {
    it('proxies weather data with valid lat/lon', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meteoPayload(),
      }));

      const res = await request(makeApp()).get('/weather?lat=40.71&lon=-74.00');
      expect(res.status).toBe(200);
      expect(res.body.temperatureC).toBe(20);
      expect(res.body.apparentC).toBe(18);
      expect(res.body.humidity).toBe(55);
      expect(res.body.weatherCode).toBe(1);
      expect(res.body.unit).toBe('°C');
      expect(res.body.lat).toBeCloseTo(40.71);
      expect(res.body.lon).toBeCloseTo(-74.0);
    });

    it('falls back to NYC defaults when lat/lon are omitted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meteoPayload(),
      }));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(200);
      expect(res.body.lat).toBeCloseTo(40.7128);
      expect(res.body.lon).toBeCloseTo(-74.006);
    });

    it('returns null humidity when field is missing from upstream', async () => {
      const payload = meteoPayload();
      delete (payload.current as Record<string, unknown>).relative_humidity_2m;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(200);
      expect(res.body.humidity).toBeNull();
    });

    it('uses temperature as apparentC fallback when apparent_temperature is absent', async () => {
      const payload = meteoPayload();
      delete (payload.current as Record<string, unknown>).apparent_temperature;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(200);
      expect(res.body.apparentC).toBe(res.body.temperatureC);
    });
  });

  describe('GET /weather — upstream errors', () => {
    it('returns 502 when upstream responds with non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(502);
      expect(res.body.error).toBeDefined();
    });

    it('returns 502 when upstream returns invalid payload (no current)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ not_current: {} }),
      }));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(502);
    });

    it('returns 504 when fetch throws (timeout / network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));

      const res = await request(makeApp()).get('/weather');
      expect(res.status).toBe(504);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /weather — coordinate validation', () => {
    it('rejects out-of-range latitude', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meteoPayload(),
      }));

      // lat > 90 — parseCoord returns null, falls back to NYC default (fetch still called)
      const res = await request(makeApp()).get('/weather?lat=91&lon=0');
      expect(res.status).toBe(200);
      // falls back to default NYC lat
      expect(res.body.lat).toBeCloseTo(40.7128);
    });

    it('rejects out-of-range longitude', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meteoPayload(),
      }));

      const res = await request(makeApp()).get('/weather?lat=0&lon=181');
      expect(res.status).toBe(200);
      expect(res.body.lon).toBeCloseTo(-74.006);
    });

    it('rejects non-numeric coordinates', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => meteoPayload(),
      }));

      const res = await request(makeApp()).get('/weather?lat=abc&lon=xyz');
      expect(res.status).toBe(200);
      // falls back to defaults
      expect(res.body.lat).toBeCloseTo(40.7128);
      expect(res.body.lon).toBeCloseTo(-74.006);
    });
  });
});
