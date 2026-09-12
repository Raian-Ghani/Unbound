# OutreachAutomator

OutreachAutomator is a portfolio-ready outreach pipeline dashboard. It demonstrates account creation and login, target criteria, message templates, human review, approval-gated queueing, account deletion, and a compliant discovery-provider boundary.

The included backend uses SQLite and is intentionally a local demo API with seeded consent-safe profiles. It does not scrape or send messages to social platforms. For production, connect the `linkedin` and `instagram` provider adapters to approved official APIs with explicit consent, provider rate limits, audit logs, encrypted secrets, and a reviewable queue.

## Stack

- Frontend: React, Vite, Lucide icons
- Backend: Node.js built-in HTTP server, SQLite via `better-sqlite3`
- Auth: HttpOnly cookie sessions and Node `scrypt` password hashes
- Tests: Node.js built-in test runner
- Scraping backend recommendation: do not use raw scraping for production. Use official APIs; if a permitted internal data source is required, isolate it as a worker service with provider-specific compliance review.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:8787.

The local database is created at `data/outreach.sqlite`. The app contains separate views for Command center, Get users, Preferences, and Account settings. Account deletion cascades through sessions, pipelines, targets, and activity records.

### API surface

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/overview`, `POST /api/pipeline`, `POST /api/discover`, `POST /api/deploy`
- `DELETE /api/account`

Discovery providers are explicit: `demo` works locally with seeded records; `linkedin` and `instagram` return a clear integration-required response until official credentials and platform approval are provided.

## Checks

```bash
npm test
npm run build
```

Security basics included: bounded request bodies, input length limits, removal of angle brackets, strict CORS allowlist, no-store responses, and defensive browser headers. Authentication is a UI prototype only and must be connected to a real identity provider before deployment.
