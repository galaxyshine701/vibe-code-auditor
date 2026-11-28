# Gatecheck

Gatecheck runs launch readiness checks on an app, with three kinds of check. Give one of them, two, or all three; there is one gate result, by these checks, with the evidence.

- **GitHub repo** (public): looks for secret keys in its text files, committed `.env` files with secret-looking variable names, and database migrations that create a table without turning on row level security.
- **Website**: reads the security headers of the front page, and looks for secret keys in the front page and the scripts of the same site.
- **Supabase** (a **test project** only): creates two temporary users, plants one canary row owned by user A, and tries to reach it as user B and as a visitor with no login. Each table is reported `LEAKED`, `BLOCKED` or `INCONCLUSIVE`, with the evidence and a reproducer. For a leak it suggests fix SQL that a human approves and applies, and a Re-test shows whether the fix worked.

A clean result means "no leak found by these checks". It is not an approval of the app.

![Home page, dark theme](screenshots/01-home-dark.png)

## Live

- App (Vercel): https://vibe-code-auditor-five.vercel.app
- API (Railway): https://vibe-code-auditor-production.up.railway.app (`GET /health` answers `{"status":"ok"}`)

## Try a repo first (no Supabase needed)

1. Open the app and enter the access code at the top of the page (see "Access code" below).
2. Under **Paste your GitHub repo link**, paste the link of a public repository, like `https://github.com/owner/repo`.
3. Tick the box **This repository is public and I may scan its files.**
4. Optional: open **Also check a live website (optional)**, enter its `https` address and tick **I may test this site. It is mine, or I have permission to check it.**
5. Press **Check this repo** (with a website added, the button reads **Check repo + website**). When the run has finished, press **View report**.
6. Read the report: the gate at the top, **What was checked**, the **Next steps** (why, the steps to fix, and for most of them a fix prompt to paste into your AI tool) and the **Evidence** (each finding and where it was found).

What the result means: the gate says either **No leak found by these checks.** or **Not ready: see why**. `LEAKED` means a check saw the problem directly, for example a secret key in a file. `INCONCLUSIVE` is a warning sign that a person should confirm, not a proven leak. `BLOCKED` on a website header means the header is there. The result covers only what these checks read (see "Limitations") and is not an approval of the app.

On a server of your own, repository and website checks need `LOCK_C_AGENTS=on`.

## Advanced: try the Supabase test project

You need your own empty Supabase **test** project. Do not use a real or production project.

1. In Supabase, create a new, empty project for testing.
2. In its SQL editor, create a table with a `user_id` column and one text column, and leave row level security off:

   ```sql
   create table public.notes (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null,
     body text
   );
   alter table public.notes disable row level security;
   ```

3. Open the app and enter the access code (see below).
4. On the home page, open **Advanced: Supabase test project** at the bottom, enter your project's address, publishable key and secret key, tick the box that says it is a test project, and press **Run these checks**. The keys are only used for this audit; see "Security notes".
5. Expected result for `notes`: **LEAKED**. User B (or the visitor) was able to reach the canary row.
6. On the report, open the finding and read the suggested fix SQL. **Approve** it. Approving only records your decision; nothing changes in your database.
7. Apply the fix SQL yourself in the Supabase SQL editor.
8. Press **Re-test**. The same checks run again. If the table now answers `BLOCKED`, the finding shows as verified fixed.
9. When no table is `LEAKED`, at least one is `BLOCKED` and cleanup did not fail, **Open result view** on the report opens the **Re-test result** screen. It says "no leak found by these checks" and carries an integrity fingerprint, which is not a signature.

![Supabase result, dark theme](screenshots/03-result-supabase-dark.png)

### Access code

The audit routes need an access code, so the public service cannot be used by anyone who finds the address. The code is not published here. To test with our access code, contact the team.

## What is checked, and what is not

For each table that the project's REST API lists:

- User B (a second signed-in test user) tries to **read**, **update** and **delete** a temporary canary row owned by user A. A blocked update can answer HTTP 200 and change nothing, so the Prover re-reads the row with the secret key and judges by that, not by the status code.
- A visitor with no login tries to **read** the canary row.
- The owner (user A) reads the row, and inserts one, as a control. If B and the visitor received nothing but the owner is blocked too, the result is `INCONCLUSIVE`, not `BLOCKED`, because "nobody got the row" proves nothing when the table does not work for its owner.

Verdicts:

- `LEAKED`: B or the visitor received the canary row, or B changed or deleted it.
- `BLOCKED`: B and the visitor received nothing, the row is unchanged, and the owner can still use the table.
- `INCONCLUSIVE`: for example a table with no owner column that is readable by everyone (maybe public on purpose), the canary could not be planted, or the owner is blocked too. The reason is stated.

Not covered: inserts by other users or visitors (a spoofed insert is not tested), database functions (RPC), Storage, Realtime, Edge Functions, Auth settings, other schemas, and column-level rules.

Limits: updates are tested only on tables that have a text column; tables whose names contain characters other than letters, digits or underscore are skipped; a table with more than 100 rows stops the audit.

The full rules are in [`docs/prover-spec.md`](docs/prover-spec.md).

## Architecture

```
Browser (Next.js, Vercel)  --HTTPS-->  API (NestJS, Railway)  --HTTPS-->  your Supabase TEST project
                                          |
                                          +--> pipeline runner, step by step:
                                                 1. Planner, Ownership (skipped today, contract only)
                                                 2. Data Access Prover, Site headers, Bundle scan, Repo scan
                                                 3. Report agent (calls Groq, off by default)
                                                 4. Evidence   5. Roadmap   6. Guide

Claude Code  --stdio-->  MCP server (mcp/)  --HTTPS-->  the same API
```

- **Frontend** (`frontend/`): Next.js and React, deployed on Vercel. Dark theme by default with a light option, and an installable app (PWA) whose only offline feature is a fallback page.
- **Backend** (`backend/`): NestJS and TypeScript, deployed on Railway. Audits are kept in a table in the platform's own Supabase project (never the project being tested), so they survive a restart; the newest 50 are kept. The routes are in [`docs/api-contract.md`](docs/api-contract.md).
- **Data Access Prover**: the part that creates the temporary users, plants the canary rows, runs the attacks, and always cleans up. Data goes through `@supabase/supabase-js`. It can also be run alone with `npm run prove` in `backend/`.
- **Pipeline runner**: runs the agents in the steps shown above; the agents of one step run side by side. The Data Access Prover runs only when a Supabase project is given, the Report agent only after it and only with `REPORT_AGENT=groq`, Site headers and Bundle scan only when a website is given, and Repo scan only when a repository is given. Planner, Ownership, the three inspectors, Evidence, Roadmap and Guide are added by `LOCK_C_AGENTS=on` (the default is off) and use no AI model. Ownership is skipped today, contract only. If a critical agent (the Prover is the only one) fails, the steps that have not started do not run; Evidence, Roadmap and Guide, when they are on, still run. If a non-critical agent fails, the audit still completes and the failed agent is shown in the `modules` list.
- **Report agent (Groq), off by default**: with `REPORT_AGENT=groq` it may rewrite only the English explanation text of a finding. The verdict, severity, evidence, fix SQL and Urdu text always stay as the Prover made them. Its text must pass checks (a closed word list, two sentences, no claims such as "secure" or "safe", no severity words); text that fails is replaced by the Prover's own template text. What is sent to Groq: table names and check results, never keys.
- **MCP server** (`mcp/`): lets Claude Code start an audit, read the report, ask for a Re-test and get the result record, through five tools. It has no tool to approve a fix; that stays a human decision. Keys are read from its own `.env` at start-up and never pass through the model. See [`mcp/README.md`](mcp/README.md).

## Project structure

```
backend/                 API and checks (NestJS, TypeScript)
  src/                   application code
    access/              access code and rate limit
    agents/              the pipeline runner and its agents
    audits/              the audit routes, service and audit store
    common/              API error shape
    net/                 the fetcher for websites
    prover/              the Data Access Prover (Supabase tables)
    repo/                the GitHub repository scan
    report/              the Report agent (Groq)
    stages/              plan, evidence, roadmap, gate and fixed rules
  test/                  backend tests, one folder per area
    frontend/            the tests of the frontend
  migrations/            SQL of the audit store table
  scripts/               manual smoke scripts
frontend/                web app (Next.js)
  src/app/               pages, layout and styles
  src/components/        UI components
  src/lib/               API client, texts, page logic, sample data
  public/                icons, service worker, offline page
  scripts/               draws the app icons
mcp/                     MCP server
  src/                   server and tools
  test/                  its tests
docs/                    API contract, Prover spec, frontend brief, roadmap
  evidence/              saved output of earlier runs
  frontend-mock/         sample answers of the API
screenshots/             the pictures in this README
.claude/skills/          the skill that drives the MCP tools
```

Tests: `backend/test/` (run `npm test` in `backend/`; the frontend has no test runner of its own, so its tests are in `backend/test/frontend/`), two more spec files in `backend/src/`, and `mcp/test/` (run `npm test` in `mcp/`).

## Security notes

- **Keys are used from memory only.** The keys of the test project are sent with the request that starts an audit (and again with a Re-test). They are never stored on the audit, never returned by the API, and never logged. In the browser the access code is kept in memory and not in `localStorage`.
- **Redaction.** Error text and agent messages are cleaned of the keys before they are stored or shown. The MCP server replaces its configured keys with `[REDACTED]` in every result and error.
- **TEST confirmation.** An audit starts only when the request says `confirmTestProject: true`. The API also refuses any project address that is not `https://<project-ref>.supabase.co`.
- **100-row stop.** If any table has more than 100 rows, the audit stops before it changes anything, because that does not look like a test project.
- **Cleanup.** The temporary users and canary rows are removed in a `finally` block, and the result says `cleanup: "ok"` or `"failed"`. Every call to Supabase has a 20 second timeout.
- **Access code.** Every `/api/v1/audits` route needs the `X-Access-Code` header. The server does not start without a code of at least 24 characters (unless `ALLOW_OPEN_API=yes`, for local testing only). Ten wrong tries from one client address within 15 minutes give `429 RATE_LIMITED`.
- **Service worker.** It stores only one offline page. It never stores an API answer, a script or a style, and never sees a request that carries the access code.
- Secrets live only in `backend/.env` (local) and Railway Variables. `.env` files are git-ignored.

## Limitations

- A result of "no leak found by these checks" says nothing about what the checks did not read.
- **Repo:** only a public GitHub repository, its default branch as it is now; the history of old commits is not read. Only text files, chosen by their file type, each at most 1 MB. A repository whose zip is over 15 MB, over 40 MB unpacked or over 3000 entries is not read. The folders `node_modules`, `.git`, `dist`, `build`, `.next` and `vendor` are skipped; links and binary files are not read.
- **Repo warnings:** a key in a test path, a committed `.env` file, a `NEXT_PUBLIC_` or `VITE_` name with `SECRET` or `SERVICE_ROLE` (uppercase only, not in `.md` or `.txt` files) and a table without row level security are `INCONCLUSIVE`, not proven leaks. Migrations are checked only as `.sql` files in folders called `migrations`, and only for tables of the `public` schema; row level security may be turned on elsewhere. Renamed tables and SQL built by code are not followed.
- **Website headers:** read from the front page only (https, `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, framing and `Referrer-Policy`). Cookie settings, TLS versions, the TLS validity period and expiry, and other pages are not checked.
- **Website scripts:** the front page and at most 30 script files of the same origin, each at most 2 MB and 15 MB in total. Scripts from other origins are not scanned; scripts that could not be read are listed.
- **Keys:** only known formats are looked for (Supabase secret and `service_role` keys, OpenAI, Stripe live secret keys, AWS access key ids, GitHub, Slack bot, Anthropic and Groq). Whether a found key still works is not tested.
- **Known limit (Jira KAN-15):** an AWS access key id on its own (`AKIA...`) is reported as `LEAKED`, although the scan does not look for the matching secret access key.
- **No active checks:** no probes are sent to a website, and ownership of a site is not checked yet.
- **Supabase:** table data access only (see "What is checked, and what is not").
- Supabase test projects only, with at most 100 rows per table.
- One audit runs at a time; a second one gets `409 AUDIT_IN_PROGRESS`.
- Only the newest 50 audits are kept. A run that a restart cuts off is closed as `INTERRUPTED`. A Re-test needs the keys again.
- Fix SQL is a suggestion. The tool never applies it.
- Badges and fix progress in the browser are kept in `localStorage`. They are a convenience, not proof.
- Not yet verified in a real browser by the author: the install prompt, offline behaviour on a device, and the look of both themes on every device.

## Screenshots

All screenshots use sample data: no real audit, project or key is in them.

![Home page, dark theme (1280×800).](screenshots/01-home-dark.png)

*Home page, dark theme (1280×800).*

![Run page of a finished audit of a repository.](screenshots/02-run-dark.png)

*Run page of a finished audit of a repository.*

![Result of a Supabase test project: the gate, the counts and the first steps.](screenshots/03-result-supabase-dark.png)

*Result of a Supabase test project: the gate, the counts and the first steps.*

![Result of a GitHub repo: the gate, the counts and the first steps.](screenshots/04-result-repo-dark.png)

*Result of a GitHub repo: the gate, the counts and the first steps.*

![The Re-test result screen, after a fix was checked again.](screenshots/05-retest-result-dark.png)

*The Re-test result screen, after a fix was checked again.*

<img src="screenshots/06-home-phone-dark.png" alt="Home page on a phone (375×812)." width="375">

*Home page on a phone (375×812).*

![Home page, light theme.](screenshots/07-home-light.png)

*Home page, light theme.*

## Repository

- `backend/`: API and Prover. `backend/README.md` has the setup, the routes and the environment variables.
- `frontend/`: the web app.
- `mcp/`: the MCP server.
- `docs/`: `api-contract.md`, `prover-spec.md`, `frontend-brief.md`, `roadmap.md`.
