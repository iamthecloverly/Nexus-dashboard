import type express from 'express';
import { COOKIE_OPTS } from '../config.ts';
import { getCookie, parseJsonCookie, setSignedCookie } from './cookies.ts';
import { getOAuth2Client } from './googleOAuth.ts';

export type GoogleTokens = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
};

export function getGoogleTokensFromCookie(req: express.Request): { tokensCookie: string; tokens: GoogleTokens } | null {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return null;
  const tokens = parseJsonCookie<GoogleTokens>(tokensCookie);
  if (!tokens) return null;
  return { tokensCookie, tokens };
}

export function createAuthedGoogleClient(req: express.Request, res: express.Response, tokens: GoogleTokens) {
  const oauth2Client = getOAuth2Client(req);
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => {
    setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
  });
  return oauth2Client;
}

