import { describe, expect, it } from 'vitest';

import { __testOnly } from '../DashboardDigestCard';

const { briefErrorFromResponse } = __testOnly;

describe('DashboardDigestCard brief errors', () => {
  it('only reports an invalid key when the API returns INVALID_KEY', () => {
    expect(briefErrorFromResponse(401, { code: 'INVALID_KEY', error: 'Invalid OpenAI API key' })).toBe('key_invalid');
  });

  it('does not treat every 401 as an invalid OpenAI key', () => {
    expect(briefErrorFromResponse(401, { code: 'LOGIN_REQUIRED', error: 'Login required' })).toBe(
      'Session expired. Log in again to generate your brief.',
    );
  });
});
