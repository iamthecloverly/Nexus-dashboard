# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start dev server (Express + Vite HMR) — app at http://localhost:3001
npm run build         # Production Vite build → dist/
npm run lint          # Type-check (tsc --noEmit) + ESLint (max 50 warnings)
npm run preview       # Serve the production build locally
npm run start         # Production server start (node --import tsx server.ts)
npm test              # Run Vitest in watch mode
npx vitest --run      # Single test run (CI / one-shot)
npx vitest --run path/to/file  # Run a single test file
npm run test:ui       # Vitest interactive browser UI
npm run test:coverage # Generate coverage report in coverage/
npm run clean         # Remove dist/
npm run clean:vite    # Remove .vite-cache
```

## Testing

The project uses [Vitest](https://vitest.dev/) with [React Testing Library](https://testing-library.com/) and [Supertest](https://github.com/ladjs/supertest).

### Test file locations

Each source directory has a co-located `__tests__/` sub-directory:

| Location | What is tested |
|---|---|
| `server/lib/__tests__/` | Utility helpers: `apiCache`, `cookies`, `encryption`, `validation` |
| `server/middleware/__tests__/` | CSRF middleware, `requireDashboardAccess` |
| `server/routes/__tests__/` | Express route handlers: `ai`, `discord`, `github`, `session`, `system`, `weather` |
| `src/lib/__tests__/` | Client-side utilities: `apiFetch`, `csrf`, `fetchWithTimeout`, `openMeteoWeather` |
| `src/hooks/__tests__/` | React hooks: `useMediaQuery`, `usePollingWhenVisible` |
| `src/contexts/__tests__/` | React context providers: `TaskProvider` |
| `src/config/__tests__/` | Navigation config |

### Conventions

- Server route tests use Supertest + a minimal `makeApp()` factory (no CSRF middleware unless the test targets CSRF itself).
- Client-side component/hook tests use `@testing-library/react` with the `happy-dom` environment.
- Fake timers (`vi.useFakeTimers()`) are used for any code that relies on `setTimeout`/`setInterval`.
- Async hooks that use `Promise.resolve().then(...)` internally need `await act(async () => { await Promise.resolve(); })` to flush microtasks in tests.
- Functions that are internal helpers but need unit testing are exposed via an `export const __testOnly = { ... }` object (see `apiCache.ts`, `ai.ts`).

## Architecture

This is a **single-binary full-stack app**: `server.ts` is one Express file that, in dev mode, creates a Vite dev server programmatically and mounts it as middleware. In production it serves `dist/`. There is no separate frontend dev server — `npm run dev` starts everything.

### Request flow
```
Browser → Express (port 3001 in code, with Vite mounted as middleware)
         ├── /api/*          → Express route handlers (Google APIs, GitHub, AI, Discord)
         └── everything else → Vite middleware (dev) / static dist/ (prod)
```

### Key files

| File | Role |
|------|------|
| `server.ts` | Express app bootstrap — mounts middleware (helmet, pino-http, CSRF, rate-limiting) and all route modules; Vite dev server in dev mode |
| `server/config.ts` | Central env/config — `isProduction`, `SESSION_SECRET`, `DASHBOARD_PASSCODE`, `ALLOWED_GOOGLE_EMAILS` |
| `server/routes/` | Route modules: `auth`, `calendar`, `gmail`, `github`, `discord`, `ai`, `session`, `system`, `weather` |
| `server/lib/` | Shared helpers: `apiCache`, `cookies`, `encryption`, `googleClient`, `googleOAuth`, `logger`, `validation` |
| `src/App.tsx` | Root component: `ToastProvider` → `SystemMetricsProvider` → viewport gate → YouTube audio player, view routing via `currentView` (`ViewId`), `AppShell` |
| `src/views/MainHub.tsx` | Primary view: clock, calendar, tasks, triage inbox, GitHub notifications, checklist |
| `src/views/Communications.tsx` | Gmail inbox list + compose + message detail |
| `src/views/FocusMode.tsx` | Distraction-free current-event view with Pomodoro timer |
| `src/views/Login.tsx` | Passcode login gate (production only) |
| `src/views/Integrations.tsx` | OAuth connect/disconnect UI for Google, GitHub, Discord |
| `src/views/Settings.tsx` | Profile, CPU/memory snapshot, clear data (wipes all localStorage keys + reloads) |
| `src/contexts/emailContext.ts` + `EmailProvider.tsx` | Email types/exports + Gmail API sync (auto-polls every 2 min) |
| `src/contexts/taskContext.ts` + `TaskProvider.tsx` | Task types/exports + CRUD persisted to localStorage with `isValidTask` guard |
| `src/contexts/musicContext.ts` + `MusicProvider.tsx` | Music/YouTube player state |
| `src/hooks/useCalendarEvents.ts` | Calendar fetch with 15s AbortController timeout |
| `src/hooks/useCalendarNotifications.ts` | Schedules browser notifications 5 min before events; `firedRef` persists across remounts to prevent duplicates |
| `src/hooks/useTaskNotifications.ts` | Fires a notification once per session for tasks due today |
| `src/hooks/useAutoEmailTasks.ts` | Background hook: extracts tasks from new unread emails via AI |
| `src/components/CommandPalette.tsx` | Global `⌘K` command palette |
| `src/components/layout/AppShell.tsx` | App shell: `--app-nav-width` / `--app-bottom-nav-height` from `desktopNav` prop (`useMediaQuery` lg in parent); scrollable main, bottom nav |
| `src/components/layout/NavigationRail.tsx` | lg+ icon rail: workspace routes, music, settings (no system metrics — see Main Hub tile) |
| `src/components/dashboard/SystemMetricsTile.tsx` | Main Hub tile: CPU/memory from `useSystemMetrics()` |
| `src/components/layout/MobileBottomNav.tsx` | Bottom tab bar + More overflow on small screens |
| `src/config/navigation.ts` | Shared nav items (`WORKSPACE_NAV`, mobile tabs), `ViewId`, rail/bottom-nav pixel constants |
| `src/contexts/SystemMetricsProvider.tsx` | Single `/api/system` poll; exports `useSystemMetrics()` → `{ cpuLoad, memUsed, refresh }` |
| `src/types/calendar.ts` | `CalendarEvent` interface |

### Auth model

Google tokens are stored server-side in an **HTTP-only cookie** (`google_tokens`). Every `/api/calendar/*` and `/api/gmail/*` route reads this cookie, builds an `OAuth2Client`, and calls Google APIs. The `oauth2Client.once('tokens', ...)` handler auto-refreshes tokens on first expiry and merges them back into the cookie — but only fires once per request, so long sessions may require re-auth via Integrations view.

### Dashboard access gate (self-hosting security)

In production the app is protected by **two gates**:

- A signed HTTP-only **passcode session cookie** (`dashboard_session`) set via `POST /api/session/login` (env: `DASHBOARD_PASSCODE`)
- A **Google email allowlist** check based on a signed cookie (`google_profile`) set during OAuth callback (env: `ALLOWED_GOOGLE_EMAILS`)

Sensitive routers (`/api/gmail`, `/api/calendar`, `/api/github`, `/api/discord`, `/api/ai`) are protected by `server/middleware/requireDashboardAccess.ts`.

### CSRF + reverse proxy notes

CSRF middleware enforces:

- same-origin via `Origin/Referer` compared to `APP_URL` (or request-derived origin)
- double-submit token match (`csrf_token` cookie + `x-csrf-token` header)

If self-hosting behind a reverse proxy, ensure `X-Forwarded-Proto` is set and `APP_URL` matches the external URL, otherwise POSTs can fail with `CSRF origin validation failed`.

### State management

No external state library. Core React Contexts:
- `EmailContext` — emails, connected status, serverError flag, toggleRead/archive/delete actions. All three action callbacks accept an optional `e?: React.MouseEvent` so they can be called without a synthetic event.
- `TaskContext` — task list persisted to `localStorage`. Hydrated through an `isValidTask` type guard to reject corrupted entries.
- `SystemMetricsProvider` — single shared `/api/system` poll (~5s when tab visible); `useSystemMetrics()` supplies Main Hub system tile and Settings.

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

`tasks`, `profileName`, `ytVideoId`, `auto_processed_email_ids`, `dashboard_daily_brief` (today's AI brief, JSON `{ date, text }` — auto-expires next day), `dashboard_weather_coords`. All are wiped by Settings → Clear All Data. Full list in `src/constants/storageKeys.ts`.

### Security notes (server.ts)

- `helmet` enabled (CSP disabled — Vite injects inline scripts).
- Input validation regexes: `GMAIL_ID_RE`, `DISCORD_WEBHOOK_RE`, GitHub PAT format, OpenAI key format.
- Discord webhook URL allowlist enforced before any outbound HTTP call (SSRF prevention).
- `express.json({ limit: '50kb' })` on all routes.
- Global rate limit: 100 req / 5 min per IP on all `/api/*`; tighter limits on `/api/ai` (20/min) and `/api/discord/send`.

### Logging

`pino` + `pino-http` write structured JSON logs. The `logger` singleton is in `server/lib/logger.ts`. In dev mode `pino-pretty` formats output for readability.

## Docker

```bash
npm run build              # build dist/ first
docker-compose up -d       # start container on port 3001
docker logs nexus-dashboard
```

The `Dockerfile` expects a pre-built `dist/`. The container runs as non-root (`nodejs:nodejs`); health checks hit `/api/system`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `SESSION_SECRET` | Yes | Cookie signing secret |
| `DASHBOARD_PASSCODE` | Prod only | Passcode required to unlock the dashboard |
| `ALLOWED_GOOGLE_EMAILS` | Prod only | Comma-separated allowlist of Google account emails |
| `APP_URL` | Prod only | Base URL for OAuth redirect (e.g. `https://yourdomain.com`) |
| `GITHUB_TOKEN` | Optional | GitHub PAT for notifications API |
| `GEMINI_API_KEY` | Optional | Gemini API key (injected into client bundle) |
| `OPENAI_API_KEY` | Optional | OpenAI key for AI task extraction |

OAuth redirect URI must be `{APP_URL}/api/auth/google/callback`. Register this in Google Cloud Console.
