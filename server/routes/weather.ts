import express from 'express';

/** Fixed upstream — user input never becomes a fetch URL (SSRF-safe). */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export const weatherRouter = express.Router();

function parseCoord(q: unknown, min: number, max: number): number | null {
  if (q === undefined || q === null || q === '') return null;
  const n = typeof q === 'string' ? Number(q.trim()) : Number(q);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Proxy Open-Meteo forecast (no API key). Query: lat, lon (optional defaults: NYC). */
weatherRouter.get('/weather', async (req, res) => {
  const lat = parseCoord(req.query.lat, -90, 90) ?? 40.7128;
  const lon = parseCoord(req.query.lon, -180, 180) ?? -74.006;

  const url = new URL(OPEN_METEO);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code');
  url.searchParams.set('timezone', 'auto');

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await fetch(url.toString(), { signal: ac.signal });
    clearTimeout(timeoutId);
    if (!r.ok) return res.status(502).json({ error: 'Weather upstream error' });
    const raw = (await r.json()) as Record<string, unknown>;
    const cur = raw.current as Record<string, unknown> | undefined;
    const temp = cur?.temperature_2m;
    if (!cur || typeof temp !== 'number' || !Number.isFinite(temp)) {
      return res.status(502).json({ error: 'Invalid weather payload' });
    }
    const app = cur.apparent_temperature;
    const hum = cur.relative_humidity_2m;
    const wc = cur.weather_code;
    const units = raw.current_units as Record<string, unknown> | undefined;
    const unitStr = typeof units?.temperature_2m === 'string' ? units.temperature_2m : '°C';
    res.json({
      lat,
      lon,
      temperatureC: temp,
      apparentC: typeof app === 'number' && Number.isFinite(app) ? app : temp,
      humidity: typeof hum === 'number' && Number.isFinite(hum) ? hum : null,
      weatherCode: typeof wc === 'number' && Number.isFinite(wc) ? wc : null,
      unit: unitStr,
    });
  } catch {
    clearTimeout(timeoutId);
    return res.status(504).json({ error: 'Weather request timed out' });
  }
});
