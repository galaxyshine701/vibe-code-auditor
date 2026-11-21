# Vibe Code Auditor (draft)

> Draft only. It does not replace `README.md`.

## The problem

Apps built quickly with AI tools on Supabase often ship with data that other users can read or change, or with a secret key left in the code. Nobody notices until someone else does. Vibe Code Auditor runs a few safe, repeatable checks and reports what it found, with evidence.

## The three inputs

Each input is optional, but at least one must be complete. You can give one, two or all three.

1. **Website**: a public `https` address, plus a box confirming you may test the site. Only the front page is looked at, as any visitor sees it. No login is used.
2. **Supabase project**: the project URL, the publishable key, the secret key, plus a box confirming it is a disposable **test** project. The auditor creates two temporary users and a canary row, tries to reach the row as the other user and as a visitor, then removes everything.
3. **Public GitHub repository**: an `https://github.com/<owner>/<repo>` address, plus a box confirming the repository is public and you may scan it. Only the default branch, as it is now, is read.

## What it checks

- **Website**: the response headers and the scripts of the front page.
- **Supabase data access**: whether another user, or a visitor with no login, can read, change or delete a canary row owned by someone else. Each table is reported as `LEAKED`, `BLOCKED` or `INCONCLUSIVE`, with evidence.
- **Repository**: whether the text files of a public repository contain a Supabase secret key.
- A report with a fix roadmap, and a re-test to see whether a fix worked.

## What it does NOT check

- Private repositories, and old commits (only the current default branch is read).
- Any page of the website other than the front page.
- Backends other than Supabase, or anything outside the three inputs.
- Code quality, dependencies, deployment settings, or business logic.
- It is not a full security test. A clean result means **"no leak found by these checks"**. It is not a statement that an app is secure.

## Run locally in mock mode

Mock mode uses built-in example data. It needs no backend, no Supabase project and no keys.

1. Open a terminal in `frontend/`.
2. Install: `npm install`.
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_USE_MOCK=true`.
4. Start: `npm run dev`, then open `http://localhost:3000`.

To run the backend tests: in `backend/`, run `npm install` and then `npm test`.

## Environment variable names

Values are never committed. Set them in `backend/.env` (local). `backend/.env.example` lists every name with an empty value.

Backend:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CONFIRM_TEST_PROJECT`
- `PLATFORM_SUPABASE_URL`, `PLATFORM_SUPABASE_SERVICE_KEY`
- `FRONTEND_ORIGIN`, `AUDIT_ACCESS_CODE`, `ALLOW_OPEN_API`, `TRUST_PROXY_HOPS`, `CLIENT_IP_HEADER`
- `REPORT_AGENT`, `GROQ_API_KEY`, `GROQ_MODEL`
- `GITHUB_TOKEN`
- `LOCK_C_AGENTS`, `AUDIT_WATCHDOG_MS`, `AGENT_PROVER_DEADLINE_MS`, `AGENT_PROVER_GRACE_MS`, `AGENT_REPORT_DEADLINE_MS`, `AGENT_ORPHAN_HOLD_MS`, `AGENT_FINALIZER_DEADLINE_MS`, `AGENT_INSPECTOR_DEADLINE_MS`

Frontend (`frontend/.env.local`):

- `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_USE_MOCK`
