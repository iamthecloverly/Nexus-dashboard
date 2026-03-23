<div align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="Nexus Logo" />
  <h1>Nexus Dashboard</h1>
  <p>A personal productivity dashboard — calendar, tasks, email, GitHub, and more in one place.</p>
</div>

## Features

- **Main Hub** — clock, upcoming calendar events, tasks, triage inbox, GitHub activity, and daily checklist
- **Communications** — Gmail inbox with full message view and compose
- **Focus Mode** — distraction-free view of the current calendar event
- **Audio Player** — YouTube audio-only player with seek bar, skip, and volume controls
- **Integrations** — connect Google (Calendar + Gmail), GitHub, and Discord
- **Settings** — manage profile name and connected accounts

## Tech Stack

- React 19 + TypeScript 5.8 (Vite)
- Express.js backend (served via `tsx`)
- Tailwind CSS v4
- Google APIs (Calendar, Gmail, OAuth2)
- GitHub REST API
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

   Required env vars:
   | Variable | Description |
   |----------|-------------|
   | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
   | `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |
   | `GITHUB_TOKEN` | GitHub personal access token |
   | `APP_URL` | Base URL for OAuth callbacks (e.g. `http://localhost:5173`) |
   | `SESSION_SECRET` | Random string for session signing |

3. Start the dev server:
   ```bash
   npm run dev
   ```

   The app runs at `http://localhost:5173`.

## OAuth Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Calendar API** and **Gmail API**
3. Create OAuth 2.0 credentials (Web Application)
4. Add `http://localhost:5173/api/auth/callback` as an authorized redirect URI
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Production build |
| `npm run lint` | Type-check with `tsc --noEmit` |
