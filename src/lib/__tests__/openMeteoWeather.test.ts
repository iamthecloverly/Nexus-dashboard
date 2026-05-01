import { describe, it, expect } from 'vitest';
import { parseOpenMeteoPayload, openMeteoForecastUrl } from '../openMeteoWeather';

describe('parseOpenMeteoPayload', () => {
  const lat = 40.71;
  const lon = -74.0;

  const validPayload = {
    current: {
      temperature_2m: 22.5,
      apparent_temperature: 20.0,
      relative_humidity_2m: 60,
      weather_code: 3,
    },
    current_units: {
      temperature_2m: '°C',
    },
  };

  it('parses a complete valid payload', () => {
    const result = parseOpenMeteoPayload(validPayload, lat, lon);
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(lat);
    expect(result!.lon).toBe(lon);
    expect(result!.temperatureC).toBe(22.5);
    expect(result!.apparentC).toBe(20.0);
    expect(result!.humidity).toBe(60);
    expect(result!.weatherCode).toBe(3);
    expect(result!.unit).toBe('°C');
  });

  it('parses the normalized /api/weather proxy payload', () => {
    const result = parseOpenMeteoPayload({
      temperatureC: 21,
      apparentC: 19,
      humidity: 52,
      weatherCode: 2,
      unit: '°C',
    }, lat, lon);

    expect(result).toEqual({
      lat,
      lon,
      temperatureC: 21,
      apparentC: 19,
      humidity: 52,
      weatherCode: 2,
      unit: '°C',
    });
  });

  it('returns null for null input', () => {
    expect(parseOpenMeteoPayload(null, lat, lon)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseOpenMeteoPayload('string', lat, lon)).toBeNull();
    expect(parseOpenMeteoPayload(42, lat, lon)).toBeNull();
    expect(parseOpenMeteoPayload([], lat, lon)).toBeNull();
  });

  it('returns null when current is missing', () => {
    expect(parseOpenMeteoPayload({ no_current: {} }, lat, lon)).toBeNull();
  });

  it('returns null when temperature_2m is not a number', () => {
    const payload = { current: { temperature_2m: 'warm' } };
    expect(parseOpenMeteoPayload(payload, lat, lon)).toBeNull();
  });

  it('returns null when temperature_2m is Infinity', () => {
    const payload = { current: { temperature_2m: Infinity } };
    expect(parseOpenMeteoPayload(payload, lat, lon)).toBeNull();
  });

  it('uses temperature as apparentC fallback when apparent_temperature is absent', () => {
    const payload = { current: { temperature_2m: 15 } };
    const result = parseOpenMeteoPayload(payload, lat, lon);
    expect(result).not.toBeNull();
    expect(result!.apparentC).toBe(15);
  });

  it('returns null humidity when relative_humidity_2m is absent', () => {
    const payload = {
      current: { temperature_2m: 15, apparent_temperature: 13 },
    };
    const result = parseOpenMeteoPayload(payload, lat, lon);
    expect(result!.humidity).toBeNull();
  });

  it('returns null weatherCode when weather_code is absent', () => {
    const payload = {
      current: { temperature_2m: 15, apparent_temperature: 13, relative_humidity_2m: 50 },
    };
    const result = parseOpenMeteoPayload(payload, lat, lon);
    expect(result!.weatherCode).toBeNull();
  });

  it('uses default unit °C when current_units is absent', () => {
    const payload = { current: { temperature_2m: 15 } };
    const result = parseOpenMeteoPayload(payload, lat, lon);
    expect(result!.unit).toBe('°C');
  });

  it('reads unit from current_units.temperature_2m', () => {
    const payload = {
      current: { temperature_2m: 59 },
      current_units: { temperature_2m: '°F' },
    };
    const result = parseOpenMeteoPayload(payload, lat, lon);
    expect(result!.unit).toBe('°F');
  });
});

describe('openMeteoForecastUrl', () => {
  it('builds a URL with latitude and longitude', () => {
    const url = openMeteoForecastUrl(40.71, -74.0);
    expect(url).toContain('latitude=40.71');
    expect(url).toContain('longitude=-74');
    expect(url).toContain('api.open-meteo.com');
  });

  it('includes current weather fields in the URL', () => {
    const url = openMeteoForecastUrl(51.5, -0.12);
    expect(url).toContain('temperature_2m');
    expect(url).toContain('apparent_temperature');
    expect(url).toContain('relative_humidity_2m');
    expect(url).toContain('weather_code');
  });

  it('sets timezone=auto', () => {
    const url = openMeteoForecastUrl(0, 0);
    expect(url).toContain('timezone=auto');
  });

  it('produces a valid URL string', () => {
    const url = openMeteoForecastUrl(48.85, 2.35);
    expect(() => new URL(url)).not.toThrow();
  });
});
