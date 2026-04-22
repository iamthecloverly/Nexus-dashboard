import type express from 'express';
import { google } from 'googleapis';

import { getBaseUrl } from '../config.ts';

export function getOAuth2Client(req: express.Request) {
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}
