import { describe, expect, it } from 'vitest';
import { __testOnly } from '../gmailMime';

const { sanitizeEmailHtml } = __testOnly;

describe('sanitizeEmailHtml', () => {
  it('strips remote image sources to avoid tracking pixels', () => {
    const html = sanitizeEmailHtml('<p>Hello</p><img src="https://tracker.example/pixel.gif" alt="pixel">');

    expect(html).toContain('<p>Hello</p>');
    expect(html).not.toContain('https://tracker.example');
  });

  it('keeps inline data images produced from cid attachments', () => {
    const html = sanitizeEmailHtml('<img src="data:image/png;base64,AAAA" alt="inline">');

    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('strips raw-text payloads that can smuggle executable markup', () => {
    const html = sanitizeEmailHtml('<p>Hi</p><xmp><img src=x onerror=alert(1)></xmp>');

    expect(html).toContain('<p>Hi</p>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<xmp>');
  });
});
