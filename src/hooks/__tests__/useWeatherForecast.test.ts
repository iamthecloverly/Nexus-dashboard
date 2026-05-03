import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { useWeatherForecast } from '../useWeatherForecast';

vi.mock('../../lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

const mockedFetchWithTimeout = vi.mocked(fetchWithTimeout);

function weatherResponse(temperatureC: number): Response {
  return new Response(JSON.stringify({
    temperatureC,
    apparentC: temperatureC,
    humidity: 50,
    weatherCode: 0,
    unit: 'C',
  }), { status: 200 });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWeatherForecast', () => {
  beforeEach(() => {
    mockedFetchWithTimeout.mockReset();
    localStorage.clear();
  });

  it('starts idle when disabled', () => {
    const { result } = renderHook(() => useWeatherForecast(false));

    expect(result.current.loading).toBe(false);
    expect(mockedFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('does not let an older refresh overwrite a newer result', async () => {
    let resolveFirst: ((value: Response) => void) | null = null;
    let resolveSecond: ((value: Response) => void) | null = null;
    mockedFetchWithTimeout
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSecond = resolve; }));

    const { result } = renderHook(() => useWeatherForecast(true));
    await flushPromises();

    await act(async () => {
      void result.current.refresh();
      await Promise.resolve();
    });

    await act(async () => {
      resolveSecond?.(weatherResponse(72));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data?.temperatureC).toBe(72);

    await act(async () => {
      resolveFirst?.(weatherResponse(41));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data?.temperatureC).toBe(72);
  });
});
