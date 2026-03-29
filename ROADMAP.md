# Nexus Dashboard — Roadmap & SaaS Quality Plan

## SaaS Quality Improvements

### Security & Infrastructure

| Gap | Fix |
|---|---|
| No CSRF protection | Add `csurf` middleware or double-submit cookie pattern on all `POST` routes |
| GitHub PAT stored as plaintext cookie | Encrypt with AES-256-GCM server-side before setting the cookie; decrypt in route handlers |
| No rate limiting | `express-rate-limit` on all API routes; tighter limits on `/api/gmail/send` and `/api/discord/send` |
| Token refresh only fires once | `once()` still expires after long sessions — add a background re-auth prompt or proactive refresh |
| No input validation on email `to:` field | Validate email format with regex or `zod` before building MIME |
| Secrets in `.env` | Use a secrets manager (Doppler, Infisicura, or a locked-down env service) in production |

### Architecture — Single-user to Multi-user

1. **Add a user model** — database row keyed by stable Google `sub` claim from the ID token
2. **Move localStorage → server DB** — tasks, checklist, profile name should live in Postgres/SQLite per user
3. **Session management** — replace raw token cookie with a signed session ID mapping to a server-side user record
4. **Email mutations sync to Gmail** — archive/read/delete currently only change local state; call the Gmail API

### Observability & Reliability

- **Structured logging** — replace `console.error` with `pino` or `winston` (JSON lines, log levels)
- **Error tracking** — Sentry SDK in both server and client; surface stack traces in production
- **API response caching** — cache calendar events for 5 min, inbox for 1 min; add server-side in-memory cache with `node-cache`
- **Health check** — expand `/api/health` to probe each integration and return connection status (used by load balancers / uptime monitors)

### Code Quality

- **Test suite** — Vitest + React Testing Library for components; Supertest for Express routes
- **API versioning** — prefix all routes with `/api/v1/` before the surface grows larger
- **Zod schemas** — validate all incoming `req.body` shapes instead of manual `if (!to || !subject)` guards
- **OpenAPI spec** — generate from schemas; enables client SDK generation and docs

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

1. Zod validation on all `req.body` inputs
2. Rate limiting (`express-rate-limit`)
3. Structured logging (`pino`)
4. Error tracking (Sentry)
5. Postgres user model + session management

These five changes move the project from personal tool to something shippable.
