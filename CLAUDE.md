# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Express + Vite HMR) — runs on http://localhost:5173
npm run build    # Production Vite build → dist/
npm run lint     # Type-check only (tsc --noEmit) — no ESLint configured
npm run preview  # Serve the production build locally
```

No test suite exists yet (Vitest is a planned addition).

## Architecture

This is a **single-binary full-stack app**: `server.ts` is one Express file that, in dev mode, creates a Vite dev server programmatically and mounts it as middleware. In production it serves `dist/`. There is no separate frontend dev server — `npm run dev` starts everything.

### Request flow
```
Browser → Express (port 3000 in code, proxied to 5173 by Vite)
         ├── /api/*          → Express route handlers (Google APIs, GitHub, AI, Discord)
         └── everything else → Vite middleware (dev) / static dist/ (prod)
```

### Key files

| File | Role |
|------|------|
| `server.ts` | All Express routes — OAuth, Calendar, Gmail, GitHub, Discord, AI extraction |
| `src/App.tsx` | Root component: provider tree, YouTube audio player, view routing via `activeView` state |
| `src/views/MainHub.tsx` | Primary view: clock, calendar, tasks, triage inbox, GitHub notifications, checklist |
| `src/views/Communications.tsx` | Gmail inbox list + compose + message detail |
| `src/views/FocusMode.tsx` | Distraction-free current-event view |
| `src/views/Integrations.tsx` | OAuth connect/disconnect UI for Google, GitHub, Discord |
| `src/views/Settings.tsx` | Profile, clear data (wipes all localStorage keys + reloads) |
| `src/contexts/EmailContext.tsx` | Email state + Gmail API sync (auto-polls every 2 min) |
| `src/contexts/TaskContext.tsx` | Task CRUD persisted to localStorage with `isValidTask` guard |
| `src/hooks/useCalendarEvents.ts` | Calendar fetch with 15s AbortController timeout |
| `src/hooks/useAutoEmailTasks.ts` | Background hook: extracts tasks from new unread emails via AI |
| `src/components/Sidebar.tsx` | Nav sidebar + system metrics (polls local `/api/system`) |
| `src/types/calendar.ts` | `CalendarEvent` interface |

### Auth model

Google tokens are stored server-side in an **HTTP-only cookie** (`google_tokens`). Every `/api/calendar/*` and `/api/gmail/*` route reads this cookie, builds an `OAuth2Client`, and calls Google APIs. The `oauth2Client.once('tokens', ...)` handler auto-refreshes tokens on first expiry and merges them back into the cookie — but only fires once per request, so long sessions may require re-auth via Integrations view.

### State management

No external state library. Two React Contexts:
- `EmailContext` — emails, connected status, serverError flag, toggleRead/archive/delete actions. All three action callbacks accept an optional `e?: React.MouseEvent` so they can be called without a synthetic event.
- `TaskContext` — task list persisted to `localStorage`. Hydrated through an `isValidTask` type guard to reject corrupted entries.

`ToastProvider` (in `src/components/Toast.tsx`) is a separate context for toast notifications; it wraps the entire app in `App.tsx`.

### AI features

- `/api/ai/extract-tasks` — POST, rate-limited to 20 req/min. Sends email bodies to OpenAI `gpt-4o-mini` to extract actionable tasks. Called by `useAutoEmailTasks` for new unread emails (tracks processed IDs in `localStorage` under key `auto_processed_email_ids`).
- `GEMINI_API_KEY` is baked into the Vite client bundle via `vite.config.ts` `define`. This is intentional — it powers a client-side AI feature.

### Concurrency / reliability patterns

- `AbortController` + 15s timeout on all fetch calls (5s for local system metrics).
- `pendingToggleRef: useRef<Set<string>>` in EmailContext prevents duplicate in-flight `mark-read` requests for the same email ID.
- `ClockDisplay` is extracted into its own component with its own 1s interval so the MainHub tree only re-renders every 10s.
- GitHub notifications poll every 5 minutes; email auto-polls every 2 minutes with a `visibilitychange` listener to skip hidden tabs.

### localStorage keys

`tasks`, `checklistItems`, `checklistTitle`, `profileName`, `ytVideoId`, `auto_processed_email_ids`. All are wiped by Settings → Clear All Data.

### Security notes (server.ts)

- `helmet` enabled (CSP disabled — Vite injects inline scripts).
- Input validation regexes: `GMAIL_ID_RE`, `DISCORD_WEBHOOK_RE`, GitHub PAT format, OpenAI key format.
- Discord webhook URL allowlist enforced before any outbound HTTP call (SSRF prevention).
- `express.json({ limit: '50kb' })` on all routes.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `APP_URL` | Prod only | Base URL for OAuth redirect (e.g. `https://yourdomain.com`) |
| `SESSION_SECRET` | Yes | Cookie signing secret |
| `GITHUB_TOKEN` | Optional | GitHub PAT for notifications API |
| `GEMINI_API_KEY` | Optional | Gemini API key (injected into client bundle) |
| `OPENAI_API_KEY` | Optional | OpenAI key for AI task extraction |

OAuth redirect URI must be `{APP_URL}/api/auth/google/callback`. Register this in Google Cloud Console.
