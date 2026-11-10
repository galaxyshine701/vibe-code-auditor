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
