import { describe, it, expect, afterEach } from 'vitest';
import { csrfHeaders } from '../csrf';

afterEach(() => {
  // Reset document.cookie after each test
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
});

describe('csrfHeaders', () => {
  it('returns an empty object when csrf_token cookie is absent', () => {
    expect(csrfHeaders()).toEqual({});
  });

  it('returns { x-csrf-token: <value> } when csrf_token cookie is present', () => {
    document.cookie = 'csrf_token=my-test-token';
    expect(csrfHeaders()).toEqual({ 'x-csrf-token': 'my-test-token' });
  });

  it('handles a csrf_token cookie mixed with other cookies', () => {
    document.cookie = 'some_other=value';
    document.cookie = 'csrf_token=abc123';
    document.cookie = 'another=thing';

    const headers = csrfHeaders();
    expect(headers['x-csrf-token']).toBe('abc123');
  });

  it('decodes URI-encoded cookie values', () => {
    document.cookie = `csrf_token=${encodeURIComponent('token with spaces')}`;
    expect(csrfHeaders()['x-csrf-token']).toBe('token with spaces');
  });

  it('returns empty object when only unrelated cookies are present', () => {
    document.cookie = 'unrelated=something';
    expect(csrfHeaders()).toEqual({});
  });
});
