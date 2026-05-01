import type express from 'express';
import { COOKIE_OPTS } from '../config.ts';
import { getSignedCookie, parseJsonCookie, setSignedCookie } from './cookies.ts';
import { getOAuth2Client } from './googleOAuth.ts';

export type GoogleAccountId = 'primary' | 'secondary';

export function parseAccountId(value: unknown): GoogleAccountId {
  return value === 'secondary' ? 'secondary' : 'primary';
}

export type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
};

function tokensCookieName(accountId: GoogleAccountId) {
  return accountId === 'primary' ? 'google_tokens' : 'google_tokens_secondary';
}

function profileCookieName(accountId: GoogleAccountId) {
  return accountId === 'primary' ? 'google_profile' : 'google_profile_secondary';
}

export function getGoogleTokensFromCookie(
  req: express.Request,
  accountId: GoogleAccountId = 'primary',
): { tokensCookie: string; tokens: GoogleTokens } | null {
  const tokensCookie = getSignedCookie(req, tokensCookieName(accountId));
  if (!tokensCookie) return null;
  const tokens = parseJsonCookie<GoogleTokens>(tokensCookie);
  if (!tokens) return null;
  return { tokensCookie, tokens };
}

export function setGoogleTokensCookie(res: express.Response, tokens: GoogleTokens, accountId: GoogleAccountId = 'primary') {
  setSignedCookie(res, tokensCookieName(accountId), JSON.stringify(tokens), COOKIE_OPTS);
}

export function setGoogleProfileCookie(
  res: express.Response,
  profile: { email: string | null; name: string | null },
  accountId: GoogleAccountId = 'primary',
) {
  setSignedCookie(res, profileCookieName(accountId), JSON.stringify(profile), COOKIE_OPTS);
}

export function createAuthedGoogleClient(
  req: express.Request,
  res: express.Response,
  tokens: GoogleTokens,
  accountId: GoogleAccountId = 'primary',
) {
  const oauth2Client = getOAuth2Client(req);
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => {
    const merged: GoogleTokens = { ...tokens };
    if (newTokens.access_token != null) merged.access_token = newTokens.access_token;
    if (newTokens.expiry_date != null) merged.expiry_date = newTokens.expiry_date;
    if (newTokens.token_type != null) merged.token_type = newTokens.token_type;
    if (newTokens.scope != null) merged.scope = newTokens.scope;
    if (newTokens.refresh_token != null) merged.refresh_token = newTokens.refresh_token;
    setGoogleTokensCookie(res, merged, accountId);
  });
  return oauth2Client;
}

