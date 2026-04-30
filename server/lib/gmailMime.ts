import type { gmail_v1 } from 'googleapis';
import sanitizeHtml from 'sanitize-html';

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

/** Strip tags/styles like the legacy plain-text extractor — used when only HTML exists. */
export function htmlToPlainText(html: string): string {
  let h = html;
  let prev: string;
  do {
    prev = h;
    h = h.replace(/<style[\s\S]*?<\/style>/gi, '');
  } while (h !== prev);
  return h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function headerVal(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
  const h = headers?.find(x => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? undefined;
}

/**
 * Pull best-effort text/plain and raw text/html from a Gmail MIME tree.
 */
export function extractBodiesFromPayload(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): { plain: string; htmlRaw: string | null } {
  if (!payload) return { plain: '', htmlRaw: null };

  const mime = payload.mimeType ?? '';

  if (mime === 'text/plain' && payload.body?.data) {
    return { plain: decodeBase64Url(payload.body.data), htmlRaw: null };
  }
  if (mime === 'text/html' && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return { plain: htmlToPlainText(html), htmlRaw: html };
  }

  const parts = payload.parts;
  if (!parts?.length) return { plain: '', htmlRaw: null };

  if (mime === 'multipart/alternative') {
    let plain = '';
    let html: string | null = null;
    for (const p of parts) {
      const sub = extractBodiesFromPayload(p);
      if (sub.htmlRaw) html = sub.htmlRaw;
      if (sub.plain.trim()) plain = sub.plain;
    }
    return {
      plain: plain || (html ? htmlToPlainText(html) : ''),
      htmlRaw: html,
    };
  }

  // multipart/mixed, multipart/related, multipart/signed, etc.
  let plain = '';
  let html: string | null = null;
  for (const p of parts) {
    const sub = extractBodiesFromPayload(p);
    if (sub.htmlRaw) html = sub.htmlRaw;
    if (sub.plain.trim()) plain = sub.plain;
  }
  return {
    plain: plain || (html ? htmlToPlainText(html) : ''),
    htmlRaw: html,
  };
}

type CidPart = {
  cid: string;
  mimeType: string;
  attachmentId?: string;
  bodyDataBase64Url?: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function collectCidParts(
  part: gmail_v1.Schema$MessagePart | null | undefined,
  acc: CidPart[] = [],
): CidPart[] {
  if (!part) return acc;

  const cidRaw = headerVal(part.headers, 'Content-ID');
  const cid = cidRaw ? cidRaw.replace(/[<>]/g, '').trim() : null;
  const mimeType = part.mimeType ?? 'application/octet-stream';

  if (cid) {
    if (part.body?.attachmentId) {
      acc.push({ cid, mimeType, attachmentId: part.body.attachmentId });
    } else if (part.body?.data && mimeType.startsWith('image/')) {
      acc.push({ cid, mimeType, bodyDataBase64Url: part.body.data });
    }
  }

  part.parts?.forEach(p => collectCidParts(p, acc));
  return acc;
}

/**
 * Replace cid: references in HTML with data URLs (embedded images).
 */
export async function inlineCidImages(
  gmail: gmail_v1.Gmail,
  messageId: string,
  html: string,
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): Promise<string> {
  const parts = collectCidParts(payload, []);
  if (parts.length === 0) return html;

  let out = html;
  for (const p of parts) {
    let dataUrl: string | null = null;
    if (p.bodyDataBase64Url) {
      const buf = Buffer.from(p.bodyDataBase64Url, 'base64url');
      dataUrl = `data:${p.mimeType};base64,${buf.toString('base64')}`;
    } else if (p.attachmentId) {
      try {
        const att = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: p.attachmentId,
        });
        const raw = att.data.data?.replace(/-/g, '+').replace(/_/g, '/');
        if (!raw) continue;
        const buf = Buffer.from(raw, 'base64');
        dataUrl = `data:${p.mimeType};base64,${buf.toString('base64')}`;
      } catch {
        continue;
      }
    }
    if (!dataUrl) continue;

    const cidPattern = new RegExp(`cid:${escapeRegExp(p.cid)}`, 'gi');
    out = out.replace(cidPattern, dataUrl);
    const enc = encodeURIComponent(p.cid);
    if (enc !== p.cid) {
      out = out.replace(new RegExp(`cid:${escapeRegExp(enc)}`, 'gi'), dataUrl);
    }
  }
  return out;
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'hr',
    'span', 'div', 'center',
    'font',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel', 'style'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style'],
    table: ['border', 'cellpadding', 'cellspacing', 'width', 'height', 'align', 'style'],
    td: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'style'],
    th: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'style'],
    tr: ['align', 'valign', 'style'],
    tbody: ['align', 'style'],
    thead: ['align', 'style'],
    font: ['color', 'face', 'size', 'style'],
    '*': ['style', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
  },
};

export function sanitizeEmailHtml(html: string): string | null {
  const cleaned = sanitizeHtml(html, SANITIZE_OPTS).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export async function extractEmailContent(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): Promise<{ plain: string; html: string | null }> {
  const { plain, htmlRaw } = extractBodiesFromPayload(payload);
  if (!htmlRaw) {
    return { plain, html: null };
  }
  const withCid = await inlineCidImages(gmail, messageId, htmlRaw, payload);
  const html = sanitizeEmailHtml(withCid);
  return {
    plain: plain.trim() ? plain : htmlToPlainText(htmlRaw),
    html,
  };
}

export const __testOnly = {
  extractBodiesFromPayload,
  htmlToPlainText,
  sanitizeEmailHtml,
};
