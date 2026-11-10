# Vibe Code Auditor

A multi-agent system that tests AI-built apps on Supabase. It creates two temporary users in a **test** Supabase project, plants a canary row owned by user A, tries to read or change it as user B, and reports LEAKED, BLOCKED or INCONCLUSIVE with evidence. Capstone due 15 Nov 2026.

## Working with the owner
The owner (Anam) is a beginner and does not write code. Reply in simple Roman Urdu/Hindi mixed with English, address her as "aap", keep messages short, and give one small step at a time. Explain what you changed and how she can check it.

## Structure
- `backend/`: NestJS + TypeScript. Owned by Anam. Work only here.
- `frontend/`: Next.js, owned by Alishba. Do not touch.
- `docs/`: shared. `docs/api-contract.md` is the agreed API shape; do not change it without asking. `docs/prover-spec.md` is the spec for the Prover.

## Rules
- Secrets live only in `backend/.env` (local) and Railway Variables. Never put a key in code, commits, logs, tests or chat. Redact keys in output.
- `.gitignore` must include `.env`, `.env.*`, `node_modules/`, `dist/`. Check `git status` before every commit.
- Env vars: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CONFIRM_TEST_PROJECT`. Keep `backend/.env.example` with empty values.
- Run only against a test project. Refuse unless `CONFIRM_TEST_PROJECT=yes`. Refuse if any table has more than 100 rows. Always clean up (users and canary rows) in a `finally` block.
- Data goes through `@supabase/supabase-js`. No Prisma, no separate database.
- Work on a branch `anam/<task-name>`, never on `main`. Commit messages start with the task id (`VCA-1: ...`). Open a Pull Request per task.
- Do one task at a time, then stop and tell Anam how to verify it (a command and its expected output). Ask before changing the plan.

## Tasks
1. Skeleton: root `.gitignore`, NestJS app in `backend/`, `GET /health` returning `{"status":"ok"}`, `.env.example`, short `backend/README.md`.
2. Prover CLI: `npm run prove` runs the Data Access Prover (see `docs/prover-spec.md`) and prints JSON findings.
3. Endpoint: wrap the Prover as `POST /api/v1/audits` and the other routes in `docs/api-contract.md`. Keys are write-only and never returned.
4. Deploy to Railway, only when Anam says so.

## Scope
- Build only what is in the Tasks list above, one task at a time.
- After Task 4, the next modules (in this order, only when Anam says): Report agent and Fix agent, Orchestrator, Jira ticket, Secrets Scanner, Package Checker. See `docs/roadmap.md`.
- Everything else (Deploy Config Checker, Code Quality Reviewer, GitHub Action, scheduled audits, dashboards, Sanity, Prompt Planner) is future work. Do not build it.

## Wording
Never call a result a "certificate of security". Use "no leak found by these checks".