<div align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="Nexus Logo" />
  <h1>Nexus Dashboard</h1>
  <p>A personal productivity dashboard — calendar, tasks, email, GitHub, and more in one place.</p>
</div>

## Features

- **Main Hub** — clock, today's calendar events, tasks (now/next), triage inbox, GitHub notifications, and daily checklist
- **Communications** — Gmail inbox with full message view, compose, mark read/unread, archive, and delete
- **Focus Mode** — distraction-free view of the current calendar event with a Pomodoro timer
- **Audio Player** — YouTube audio-only player with seek bar, skip, and volume controls
- **AI Task Extraction** — automatically extracts actionable tasks from new unread emails in the background (OpenAI `gpt-4o-mini`)
- **Integrations** — connect Google (Calendar + Gmail), GitHub, and Discord
- **Settings** — manage profile name and clear all local data

## Tech Stack

- React 19 + TypeScript 5.8 (Vite 6)
- Express.js backend served via `tsx` (single-binary dev server)
- Tailwind CSS v4
- Google APIs: Calendar, Gmail, OAuth2
- GitHub REST API
- OpenAI API (`gpt-4o-mini` for task extraction)
- YouTube IFrame Player API

## Getting Started

**Prerequisites:** Node.js 20+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the env example and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
   | `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
   | `SESSION_SECRET` | Yes | Random string for cookie signing |
  | `DASHBOARD_PASSCODE` | Yes (prod) | Passcode required to unlock the dashboard |
  | `ALLOWED_GOOGLE_EMAILS` | Yes (prod) | Comma-separated allowlist of Google account emails |
   | `APP_URL` | Production only | Base URL for OAuth callbacks (e.g. `https://yourdomain.com`) |
   | `GITHUB_TOKEN` | Optional | GitHub personal access token for notifications |
   | `OPENAI_API_KEY` | Optional | Enables AI task extraction from emails |
   | `GEMINI_API_KEY` | Optional | Gemini API key (injected into client bundle) |

3. Start the dev server:
   ```bash
   npm run dev
   ```

   The app runs at `http://localhost:5173`.

## OAuth Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Calendar API** and **Gmail API**
3. Create OAuth 2.0 credentials (Web Application)
4. Add `http://localhost:5173/api/auth/google/callback` as an authorized redirect URI
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

## Self-hosting notes (reverse proxy / APP_URL)

- If you run behind a reverse proxy (nginx/Caddy/Traefik), ensure it sends `X-Forwarded-Proto` and that the app’s `APP_URL` matches the external URL (scheme + host).
- CSRF protection validates `Origin/Referer` against `APP_URL` (or request-derived origin), so mismatched `APP_URL` commonly causes `CSRF origin validation failed`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Production Vite build |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm run preview` | Serve the production build locally |

## Architecture

The app is a single Express process. In development, Vite runs as middleware inside Express (no separate frontend server). In production, Express serves the `dist/` build.

```
Browser → Express
         ├── /api/*  → route handlers (Google APIs, GitHub, AI, Discord)
         └── /*      → Vite middleware (dev) / static dist/ (prod)
```

Google OAuth tokens are stored in an HTTP-only cookie. All API calls to Google are made server-side — no tokens are exposed to the browser.

## Security (important for self-hosting)

This app is designed for single-user self-hosting. In production you must configure the access gates:

- Set `DASHBOARD_PASSCODE` to a strong passcode.
- Set `ALLOWED_GOOGLE_EMAILS` to your email (or emails) as a comma-separated list.

If you ever shared the dashboard URL publicly, you should:

- Rotate `SESSION_SECRET` and redeploy.
- Revoke the app’s Google OAuth refresh token from your Google account security page, then reconnect Google in Integrations.
