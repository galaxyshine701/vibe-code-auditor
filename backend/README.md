# Vibe Code Auditor: backend

NestJS + TypeScript backend. Tests AI-built Supabase apps (test projects only).

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (never commit `.env`).

## Run
- `npm run start:dev` starts the server on port 4000 (set `PORT` to change it; the Next.js frontend uses 3000).
- Check: `curl http://localhost:4000/health` should print `{"status":"ok"}`.

## Test
- `npm test` (unit) and `npm run test:e2e` (end to end).

## Data Access Prover (`npm run prove`)
Tests a Supabase **test** project and prints JSON findings (LEAKED, BLOCKED or INCONCLUSIVE).
1. Fill `backend/.env` (see `.env.example`). Set `CONFIRM_TEST_PROJECT=yes` only for a test project.
2. Run `npm run prove`. Progress goes to stderr, JSON to stdout.
3. It creates two temporary users and canary rows, then always removes them. The JSON has `cleanup: "ok"` or `"failed"`.
4. It refuses if any table has more than 100 rows.

## Audits API (`/api/v1`)
- `POST /api/v1/audits` starts an audit and answers `202` at once with `{ "id": "...", "status": "running" }`. The Prover runs in the background.
- `GET /api/v1/audits/:id` shows status, summary, progress. Poll it every 2 seconds.
- `GET /api/v1/audits/:id/findings` returns the findings (empty until the audit has finished).
- Body of POST: `label`, `projectUrl` (only `https://<project-ref>.supabase.co`), `anonKey`, `serviceKey`, and `confirmTestProject: true` (must be exactly `true`; the server's own `CONFIRM_TEST_PROJECT` setting is not used here).
- Keys are write-only: they are never stored on the audit, returned, or logged. Error text is cleaned of keys.
- Only one audit runs at a time. A second one gets `409 AUDIT_IN_PROGRESS`.
- **Audits live in memory only (no database). When the server restarts, all audits are gone.** The last 50 are kept.
- CORS: only the origin in `FRONTEND_ORIGIN` (default `http://localhost:3000`) may call the API from a browser.
- `POST /api/v1/audits/:id/findings/:findingId/fix/approve` records a human decision (`200`, the finding with `fix.status` `approved`). It does not change your database.
- `POST /api/v1/audits/:id/retest` runs the same checks again on the same audit (`202`). Send `anonKey`, `serviceKey` and `confirmTestProject: true` again; `projectUrl` is refused (`400`). The old findings stay visible until the new ones replace them in one step. A failed re-test keeps the old findings and shows `lastRetest.status` `failed`.
- `GET /api/v1/audits/:id/certificate` answers `200` only when the audit is completed, has no LEAKED finding, at least one BLOCKED finding, and cleanup did not fail. Otherwise `409 NOT_ELIGIBLE`. The result is "no leak found by these checks", not a guarantee. `recordHash` is an integrity fingerprint, not a signature.

## Timeouts and cleanup
- Every request to Supabase has its own 20 second timeout (one constant, `REQUEST_TIMEOUT_MS`). A stalled call gives the plain error "Supabase did not answer in time." Cleanup calls have their own timeouts too, so a slow request cannot stop the cleanup.
- If a "create user" call never answers, the user may exist without us knowing its id. Cleanup then looks for that exact email (made in this run, no wildcard) and deletes it. If it cannot, the result is `cleanup: "failed"` with a note to delete `vca-*@example.com` users by hand in Supabase Auth.

## Access code (`/api/v1/audits`)
- Every `/api/v1/audits` route needs the header `X-Access-Code`. `/health` stays open.
- Set `AUDIT_ACCESS_CODE` in `backend/.env` (and in Railway Variables): a secret of **at least 24 characters**. Never put it in code, logs or chat.
- **Fail-closed:** with no `AUDIT_ACCESS_CODE` the server does not start. For local testing only you can set `ALLOW_OPEN_API=yes` (no code at all). A code that is too short never falls back to open.
- Wrong or missing code: `401 ACCESS_DENIED`. Only a code that was sent and is wrong is counted; a missing header and CORS `OPTIONS` checks are not. After 10 wrong tries from one client IP within 15 minutes: `429 RATE_LIMITED` (with `Retry-After`), also for the right code until the time is up. The counter is in memory, so a restart resets it.
- **Behind Railway set only `CLIENT_IP_HEADER=x-real-ip`.** Railway sends the client address in `X-Real-IP`; `TRUST_PROXY_HOPS` does not give a stable client IP there, so the wrong-code limit would never trigger. The guard then counts each address in that header (the first value only; an IPv6 /64 counts as one client).
  - **Unusable header = `request.ip`:** if the header is missing, empty, or not a valid IP address, the guard uses `request.ip` for that request. This is on purpose, so a request is never let through uncounted. On Railway `request.ip` is the proxy, so such requests share one counter.
  - **Only set it behind a proxy that writes that header itself.** Otherwise anybody can send a fake `X-Real-IP` with every request and dodge the limit. For local testing leave it unset: the guard then uses `request.ip` and cannot be tricked.
  - These names are refused at start-up (the server does not start): `x-access-code`, `authorization`, `cookie`, `set-cookie`, `host`, `content-type`, `content-length`, `x-forwarded-for`, `forwarded`, and anything that is not a plain header name.
  - At start-up one line says which source is used: `Client IP source: header x-real-ip` or `Client IP source: request.ip`. It never shows an address or a secret.
- `TRUST_PROXY_HOPS` (0 to 5, default 0) only changes what `request.ip` is. Set it only if you do not use `CLIENT_IP_HEADER` and exactly that many proxies stand in front. Never set it when there is no proxy (anyone could fake `X-Forwarded-For`).
- The smoke script (`scripts/http-smoke.mjs`) reads `AUDIT_ACCESS_CODE` from `.env` and sends it; it never prints it.
