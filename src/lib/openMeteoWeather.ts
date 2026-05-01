/**
 * Parses Open-Meteo forecast JSON (same shape from `/api/weather` proxy or direct GET).
 */
export interface WeatherPayload {
  lat: number;
  lon: number;
  temperatureC: number;
  apparentC: number;
  humidity: number | null;
  weatherCode: number | null;
  unit: string;
}

export function parseOpenMeteoPayload(
  data: unknown,
  lat: number,
  lon: number,
): WeatherPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  const normalizedTemp = d.temperatureC;
  if (typeof normalizedTemp === 'number' && Number.isFinite(normalizedTemp)) {
    const apparent = d.apparentC;
    const humidity = d.humidity;
    const weatherCode = d.weatherCode;
    const unit = d.unit;
    return {
      lat,
      lon,
      temperatureC: normalizedTemp,
      apparentC: typeof apparent === 'number' && Number.isFinite(apparent) ? apparent : normalizedTemp,
      humidity: typeof humidity === 'number' && Number.isFinite(humidity) ? humidity : null,
      weatherCode: typeof weatherCode === 'number' && Number.isFinite(weatherCode) ? weatherCode : null,
      unit: typeof unit === 'string' && unit.trim() ? unit : '°C',
    };
  }

  const cur = d.current;
  if (typeof cur !== 'object' || cur === null) return null;
  const c = cur as Record<string, unknown>;
  const t = c.temperature_2m;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  const app = c.apparent_temperature;
  const hum = c.relative_humidity_2m;
  const wc = c.weather_code;
  const units = d.current_units;
  let unit = '°C';
  if (typeof units === 'object' && units !== null) {
    const u = (units as Record<string, unknown>).temperature_2m;
    if (typeof u === 'string') unit = u;
  }
  return {
    lat,
    lon,
    temperatureC: t,
    apparentC: typeof app === 'number' && Number.isFinite(app) ? app : t,
    humidity: typeof hum === 'number' && Number.isFinite(hum) ? hum : null,
    weatherCode: typeof wc === 'number' && Number.isFinite(wc) ? wc : null,
    unit,
  };
}

export function openMeteoForecastUrl(lat: number, lon: number): string {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code');
  u.searchParams.set('timezone', 'auto');
  return u.toString();
}
