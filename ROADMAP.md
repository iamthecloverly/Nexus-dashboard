# Nexus Dashboard — Roadmap & SaaS Quality Plan

## SaaS Quality Improvements

### Security & Infrastructure

| Gap | Status | Fix |
|---|---|---|
| No CSRF protection | ✅ Done | Double-submit cookie CSRF middleware (`attachCsrf`) on all POST routes |
| GitHub PAT stored as plaintext cookie | ✅ Done | AES-256-GCM encryption (`encrypt`/`decrypt`) applied to all PAT cookies |
| No rate limiting | ✅ Done | `express-rate-limit` on all API routes; tighter limits on `/api/ai` and `/api/discord/send` |
| Token refresh only fires once | Open | `once()` still expires after long sessions — add a background re-auth prompt or proactive refresh |
| No input validation on email `to:` field | ✅ Done | Zod `sendEmailSchema` validates email format before building MIME |
| Secrets in `.env` | Open | Use a secrets manager (Doppler, Infisicura, or a locked-down env service) in production |

### Code Quality

| Item | Status | Notes |
|---|---|---|
| Test suite | ✅ Done | Vitest + React Testing Library for contexts/hooks/lib; Supertest for Express routes (214 tests) |
| Zod schemas | ✅ Done | All `req.body` inputs validated via Zod schemas in `server/lib/validation.ts` |
| Structured logging | ✅ Done | `pino` + `pino-http` with JSON lines and log levels throughout server |
| API response caching | ✅ Done | In-memory TTL cache with request coalescing in `server/lib/apiCache.ts` |
| API versioning | Open | Prefix all routes with `/api/v1/` before the surface grows larger |
| OpenAPI spec | Open | Generate from Zod schemas; enables client SDK generation and docs |

### Architecture — Single-user to Multi-user

1. **Add a user model** — database row keyed by stable Google `sub` claim from the ID token
2. **Move localStorage → server DB** — tasks, checklist, profile name should live in Postgres/SQLite per user
3. **Session management** — replace raw token cookie with a signed session ID mapping to a server-side user record
4. **Email mutations sync to Gmail** — archive/read/delete currently only change local state; call the Gmail API

### Observability & Reliability

- **Error tracking** — Sentry SDK in both server and client; surface stack traces in production
- **Health check** — expand `/api/health` to probe each integration and return connection status (used by load balancers / uptime monitors)

---

## New Features

### High Impact — Core Product

| Feature | Why |
|---|---|
| Notion / Linear / Jira integration | Tasks are the core of the dashboard; syncing with where work actually lives is transformative |
| Multi-account Google support | Power users have work + personal Gmail; add an account picker in Communications |
| AI email drafting | "Reply with Claude" in the compose modal — send thread context to Claude API, get a draft |
| Smart daily brief | On load, generate a 3-sentence AI summary of today's calendar + unread count + top GitHub PR |
| Recurring tasks / due dates | Tasks currently have no metadata beyond title; add due date, recurrence, priority |
| Slack integration | Read DMs/mentions in a fourth Communications tab alongside Gmail |

### Focus Mode Enhancements

- **Custom timer presets** — 25 / 10 / 50 min options and long-break scheduling
- **Session history** — Pomodoros completed today, streak tracking
- **Ambient sound player** — white noise / lofi alongside or instead of YouTube

### Communications

- **Email labels / filters** — show Gmail labels; allow filtering inbox by label
- **Snooze** — hide an email until a chosen time, then resurface it
- **Send later** — schedule email delivery; store in DB, send from server cron
- **Thread view** — group related messages by `threadId` instead of flat list

### Data & Portability

- **Export all data** — download tasks + checklist as JSON or CSV
- **Import tasks** — paste from Markdown checkbox list or CSV
- **Webhook outbound** — trigger an HTTP call when a task is completed (Zapier-style)

### UX Polish

- **Command palette (`⌘K`)** — switch view, compose email, add task, toggle focus mode — hinted at in Communications, make it global
- **Themes** — add light mode and 2–3 accent color options persisted in localStorage
- **Desktop notifications** — use the `Notification` API for calendar event reminders and new emails
- **Drag-to-reorder tasks** — `@dnd-kit/core` for the task list
- **Offline support** — Service Worker + IndexedDB so the dashboard loads and shows cached data without a network

### Full SaaS Path

- **Stripe billing** — tiered plan (free: 1 integration, pro: all integrations + AI features)
- **Landing page + signup flow** — replace the onboarding banner with a real product page
- **Team workspaces** — share a checklist or task board with teammates; presence indicators
- **Mobile PWA** — layout is responsive already; add `manifest.json`, service worker, push notifications

---

## Priority Order

The fastest path to SaaS-quality without a full rewrite:

1. ~~Zod validation on all `req.body` inputs~~ ✅ Done
2. ~~Rate limiting (`express-rate-limit`)~~ ✅ Done
3. ~~Structured logging (`pino`)~~ ✅ Done
4. Error tracking (Sentry)
5. Postgres user model + session management

These remaining changes move the project from personal tool to something shippable.

