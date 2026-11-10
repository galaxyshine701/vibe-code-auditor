# Vibe Code Auditor: backend

NestJS + TypeScript backend. Tests AI-built Supabase apps (test projects only).

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (never commit `.env`).

## Run
- `npm run start:dev` starts the server on port 3000.
- Check: `curl http://localhost:3000/health` should print `{"status":"ok"}`.

## Test
- `npm test` (unit) and `npm run test:e2e` (end to end).

## Data Access Prover (`npm run prove`)
Tests a Supabase **test** project and prints JSON findings (LEAKED, BLOCKED or INCONCLUSIVE).
1. Fill `backend/.env` (see `.env.example`). Set `CONFIRM_TEST_PROJECT=yes` only for a test project.
2. Run `npm run prove`. Progress goes to stderr, JSON to stdout.
3. It creates two temporary users and canary rows, then always removes them. The JSON has `cleanup: "ok"` or `"failed"`.
4. It refuses if any table has more than 100 rows.
