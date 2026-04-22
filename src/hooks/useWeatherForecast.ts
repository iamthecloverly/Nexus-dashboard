import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import {
  openMeteoForecastUrl,
  parseOpenMeteoPayload,
  type WeatherPayload,
} from '../lib/openMeteoWeather';

export type { WeatherPayload };

function loadCoords(): { lat: number; lon: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.weatherCoords);
    if (!raw) return { lat: 40.7128, lon: -74.006 };
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== 'object' || p === null) return { lat: 40.7128, lon: -74.006 };
    const o = p as Record<string, unknown>;
    const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
    const lon = typeof o.lon === 'number' ? o.lon : Number(o.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { lat: 40.7128, lon: -74.006 };
    }
    return { lat, lon };
  } catch {
    return { lat: 40.7128, lon: -74.006 };
  }
}

async function fetchWeatherDirect(lat: number, lon: number): Promise<WeatherPayload | null> {
  const url = openMeteoForecastUrl(lat, lon);
  const res = await fetchWithTimeout(url, { timeoutMs: 15_000 });
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  return parseOpenMeteoPayload(json, lat, lon);
}

/** Open-Meteo via `/api/weather`, then browser direct fallback (no API key). */
export function useWeatherForecast(enabled: boolean, intervalMs = 15 * 60 * 1000) {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    const { lat, lon } = loadCoords();
    setLoading(true);
    setError(null);
    try {
      let parsed: WeatherPayload | null = null;
      try {
        const res = await fetchWithTimeout(
          `/api/weather?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
          { timeoutMs: 15_000 },
        );
        if (res.ok) {
          const json = (await res.json()) as unknown;
          parsed = parseOpenMeteoPayload(json, lat, lon);
        }
      } catch {
        /* proxy unreachable */
      }
      if (!parsed) {
        try {
          parsed = await fetchWeatherDirect(lat, lon);
        } catch {
          parsed = null;
        }
      }
      if (parsed) {
        setData(parsed);
        setError(null);
      } else {
        setData(null);
        setError('Unavailable');
      }
    } catch {
      setData(null);
      setError('Unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchWeather();
    const id = window.setInterval(fetchWeather, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, fetchWeather]);

  return { data, loading, error, refresh: fetchWeather };
}
