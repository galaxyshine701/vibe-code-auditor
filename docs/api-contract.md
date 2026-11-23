# Vibe Code Auditor: API contract

Purpose: the frontend (Alishba) and the backend (Anam) agree on the shape of the data **before** either side is finished. The shapes below are examples. Mock data for the frontend comes from `docs/evidence` (see `docs/frontend-brief.md`, R45 and R46).

Rules
- Base path: `/api/v1`. Format: JSON. All dates are ISO 8601 (UTC).
- Any change to this file goes through a pull request that both of us approve.
- The backend NEVER returns keys (`serviceKey`, `anonKey`) in any response. The frontend must never store or display them after submitting.
- The tool is for **staging / test projects only**. The backend does not detect production from the URL. It requires `confirmTestProject: true` and aborts when a table has more than 100 rows.

## Screens and the endpoint each one uses

| Screen | What the user does | Endpoint |
|---|---|---|
| 1. Connect | Enters the test project's details and presses "Start audit" | `POST /audits` |
| 2. Progress | Watches each module's status (poll every 2 seconds) | `GET /audits/:id` |
| 3. Report | Reads findings, approves a fix, presses "Re-test" | `GET /audits/:id/findings`, `POST .../fix/approve`, `POST /audits/:id/retest` |
| 4. Certificate | Opens the result page inside the app (no public link) | `GET /audits/:id/certificate` |

## Words the UI must understand (fixed values)

- `audit.status`: `queued` | `running` | `completed` | `failed`
- `finding.verdict`: `LEAKED` (red) | `BLOCKED` (green) | `INCONCLUSIVE` (grey)
- `finding.severity`: `critical` | `high` | `medium` | `low` | `info`
- `fix.status`: `proposed` | `approved` | `applied` | `rejected`
- Version 1 returns only `proposed` and `approved`. `applied` and `rejected` are reserved.
- `retest.status`: `not_run` | `running` | `passed` | `failed`. `running` on every finding while a re-test is going on. After a re-test: `failed` = the verdict is now `LEAKED`, `passed` = it was `LEAKED` and is not now (it stays `passed` in later re-tests while the verdict is not `LEAKED`), `not_run` = anything else (see "POST /audits/:id/retest").

## Endpoints

### POST /audits
Starts an audit. Returns immediately; the work happens in the background.

Request
```json
{
  "label": "Hotel booking (test project)",
  "projectUrl": "https://example-project.supabase.co",
  "anonKey": "<write-only, never returned>",
  "serviceKey": "<write-only, never returned>",
  "confirmTestProject": true
}
```
- The field names `projectUrl`, `anonKey` and `serviceKey` are fixed.
- `confirmTestProject` is required and must be exactly `true` (the boolean, not the text "true"). It is the caller's confirmation that this is a TEST project. Otherwise: `400` `INVALID_INPUT`.
- `projectUrl` must look like `https://<project-ref>.supabase.co` (no port, path or login). Otherwise: `400` `INVALID_INPUT`.

Response `202` (the work starts at once, so the status is `running`)
```json
{ "id": "aud_001", "status": "running" }
```
Error `400` (confirmation missing, or the URL is not a plain Supabase project address)
```json
{ "error": { "code": "INVALID_INPUT", "message": "Confirm this is a TEST project: set confirmTestProject to true." } }
```
Error `409` (only one audit runs at a time; try again when the running one has finished)
```json
{ "error": { "code": "AUDIT_IN_PROGRESS", "message": "Another audit is still running. Wait until it finishes, then try again." } }
```
Error `400` `PRODUCTION_REFUSED` is reserved: version 1 of the backend cannot tell a production project from a test project by its address, so it relies on `confirmTestProject` and the URL check above.

### GET /audits/:id
```json
{
  "id": "aud_001",
  "status": "running",
  "createdAt": "2026-11-12T10:00:00Z",
  "target": { "label": "Hotel booking (test project)", "projectUrl": "https://example-project.supabase.co" },
  "summary": { "leaked": 1, "blocked": 1, "inconclusive": 1 },
  "modules": [
    { "id": "data-access-prover", "name": "Data Access Prover", "status": "running", "progress": 60 },
    { "id": "secrets-scanner", "name": "Secrets Scanner", "status": "queued", "progress": 0 }
  ],
  "cleanup": null
}
```
Example only. Version 1 returns `data-access-prover`, and also `report-agent` when the backend runs with the Report agent on (see "Additive fields: finding.explanationSource and the report-agent module").

Additive fields:
- `cleanup`: `"ok"` | `"failed"` | `null`. `null` while the audit is still running. `"failed"` means the temporary test users or canary rows could not be removed from the test project; the user should check it.
- `cleanupNote`: only present when `cleanup` is `"failed"`. Plain-language text that says what to remove by hand, for example the users in Supabase Auth with an email like `vca-*@example.com`.
- `error`: only present when `status` is `failed`: `{ "code": "TOO_MUCH_DATA", "message": "Plain-language message" }`. Keys are never part of it.

### GET /audits/:id/findings
```json
{
  "findings": [
    {
      "id": "fnd_001",
      "module": "data-access-prover",
      "table": "bookings",
      "operation": "SELECT",
      "verdict": "LEAKED",
      "severity": "critical",
      "title": "Any logged-in user can read other users' bookings",
      "explanation": {
        "en": "A second test user was able to read a booking that belongs to the first user. The table has no rule that limits rows to their owner.",
        "ur": "Doosre test user ne pehle user ki booking parh li. Is table me aisa rule nahi jo har row ko sirf uske maalik tak mehdood kare."
      },
      "evidence": {
        "rowsReturned": 1,
        "httpStatus": 200,
        "canaryRowId": "canary-4f2a",
        "reproducer": "curl -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <USER_B_JWT>' '<PROJECT_URL>/rest/v1/bookings?id=eq.canary-4f2a'"
      },
      "fix": {
        "status": "proposed",
        "description": "Turn on row-level security and allow users to read only their own rows.",
        "sql": "alter table bookings enable row level security;\ncreate policy \"own rows\" on bookings for select to authenticated using ((select auth.uid()) = user_id);"
      },
      "retest": { "status": "not_run", "lastRunAt": null }
    },
    {
      "id": "fnd_002",
      "module": "data-access-prover",
      "table": "profiles",
      "operation": "SELECT",
      "verdict": "BLOCKED",
      "severity": "info",
      "title": "Profiles are protected",
      "explanation": {
        "en": "The second test user received no rows. The first user's data stayed private.",
        "ur": "Doosre test user ko koi row nahi mili. Pehle user ka data mehfooz raha."
      },
      "evidence": { "rowsReturned": 0, "httpStatus": 200, "canaryRowId": "canary-9b1c", "reproducer": null },
      "fix": null,
      "retest": { "status": "not_run", "lastRunAt": null }
    },
    {
      "id": "fnd_003",
      "module": "data-access-prover",
      "table": "hotels",
      "operation": "SELECT",
      "verdict": "INCONCLUSIVE",
      "severity": "low",
      "title": "Readable by everyone: is this intended?",
      "explanation": {
        "en": "Anyone can read this table. That is fine if it holds public information such as hotel listings. Please confirm.",
        "ur": "Is table ko har koi parh sakta hai. Agar isme sirf public maloomat hain (jaise hotel list) to theek hai. Barae meharbani confirm karein."
      },
      "evidence": { "rowsReturned": 12, "httpStatus": 200, "canaryRowId": null, "reproducer": null },
      "fix": null,
      "retest": { "status": "not_run", "lastRunAt": null }
    }
  ]
}
```

### Additive field: finding.evidence.operations
Added in the Data Access Prover. Optional for the frontend: ignore it if you don't need it.

```json
"operations": [
  { "operation": "SELECT", "actor": "user_b", "allowed": true,  "httpStatus": 200, "rowsReturned": 1 },
  { "operation": "UPDATE", "actor": "user_b", "allowed": false, "httpStatus": 200, "rowsReturned": 0 },
  { "operation": "DELETE", "actor": "user_b", "allowed": false, "httpStatus": 200, "rowsReturned": 0 },
  { "operation": "SELECT", "actor": "anon",   "allowed": false, "httpStatus": 200, "rowsReturned": 0 },
  { "operation": "SELECT", "actor": "owner",  "allowed": true,  "httpStatus": 200, "rowsReturned": 1 },
  { "operation": "INSERT", "actor": "owner",  "allowed": true,  "httpStatus": 201, "rowsReturned": 1 }
]
```

- `operation`: `SELECT` | `INSERT` | `UPDATE` | `DELETE`
- `actor`: `"user_b"` (second test user) | `"anon"` (visitor with no login) | `"owner"` (first test user, a positive control: the rightful owner should be able to use their own row)
- `allowed`: `true` = the canary row was read / inserted / changed / deleted; `false` = blocked; `null` = not tested (see `note`)
- `httpStatus` / `rowsReturned`: what the API answered; `null` when not tested
- `note` (optional): short plain-language reason, e.g. "Not tested: ..."
- Number of items in the list:
  - 6 items (normal): `user_b` SELECT / UPDATE / DELETE, `anon` SELECT, `owner` SELECT / INSERT.
  - 1 item (table has no owner column): only the `anon` SELECT.
  - 0 items (the canary row could not be planted).
- A blocked UPDATE or DELETE can still show `httpStatus` 200 with `rowsReturned` 0, because the row is judged by re-reading it, not by the status code.
- If the second user and the anonymous visitor get nothing but the owner is blocked too (`allowed: false`), the finding is `INCONCLUSIVE`: the app may be broken, or the table is not meant for direct client access.
- The owner `INSERT` is `allowed: null` (not tested, see `note`) when the owner column is the table's primary key, or when the insert fails for a reason that says nothing about access rules (for example HTTP 409).

### POST /audits/:id/findings/:findingId/fix/approve
A human approves the suggested fix. Response `200`: the updated finding with `fix.status = "approved"`.
(The backend does not change the user's database by itself in version 1; approval only records the decision and marks the fix as ready to apply.)

- No request body.
- Approving a fix that is already `approved` is not an error: `200` again with the same finding.
- Approval may be given before or after the user has run the SQL. The backend cannot know whether the SQL was run; it only records the decision.
- `404` `NOT_FOUND`: unknown audit or unknown finding.
- `409` `AUDIT_IN_PROGRESS`: the audit (or a re-test of it) is still running.
- `409` `NO_FIX_TO_APPROVE`: the finding has `fix: null` (for example it is `BLOCKED` or `INCONCLUSIVE`).
- Approvals are kept in the audit store, like the audits (see "What the backend keeps").

### POST /audits/:id/retest
Runs the same checks again on the same audit. The keys are sent again on every re-test, because the backend never stores them.

Request
```json
{
  "anonKey": "<write-only, never returned>",
  "serviceKey": "<write-only, never returned>",
  "confirmTestProject": true
}
```
- `confirmTestProject` must be exactly `true`, `anonKey` and `serviceKey` are required (same rules as `POST /audits`). Otherwise `400` `INVALID_INPUT`.
- `projectUrl` is NOT accepted. If the body contains `projectUrl`, the answer is `400` `INVALID_INPUT`, and nothing is run. The re-test always uses the `projectUrl` stored with the audit, so the keys cannot be pointed at another project.

Response `202` (the work starts at once)
```json
{ "id": "aud_001", "status": "running" }
```
Errors: `404` `NOT_FOUND` (unknown audit); `409` `AUDIT_IN_PROGRESS` (this audit, or any other audit, is running; only one run at a time); `409` `NOT_ELIGIBLE` (the audit has `status` `failed`, so there are no findings to re-test; start a new audit).

While the re-test runs
- `audit.status` is `running` (so the screen can poll as before). `GET /audits/:id/findings` still returns the OLD findings, and each finding shows `retest.status = "running"`.
- The new findings replace the old ones in ONE step, when the re-test has finished successfully. The report never shows a half-new list.

When the re-test finishes successfully: `audit.status` is `completed` again, and each finding's `retest.status` is set by this rule, comparing the new verdict with the verdict from the run before:
- `failed`: the verdict is now `LEAKED` (a leak was found again).
- `passed`: the verdict was `LEAKED` and is not `LEAKED` now. `passed` is kept: in every later re-test a finding that is `passed` stays `passed` while its verdict is not `LEAKED`. Its `previousVerdict` stays `LEAKED`, and only `lastRunAt` changes. If its verdict is `LEAKED` again, the status is `failed` and `previousVerdict` is the verdict from the run before.
- `not_run`: in every other case. In particular, a finding that was already `BLOCKED` or `INCONCLUSIVE` and still is gets `not_run`. A second re-test does not reset an earlier `passed`. The history lives in `retest.previousVerdict`.

When the re-test fails (wrong keys, the Prover cannot run, network error)
- The audit is NOT marked `failed`. `audit.status` goes back to `completed`, the old findings stay exactly as they were (their `retest.status` returns to the value it had before the re-test started), and the user can press Re-test again at once.
- The top-level `error` field stays absent (it is only for an audit whose own `status` is `failed`). The failure is reported in `lastRetest` instead (see below). Keys are never part of it.
- Nothing from the failed run is merged into the findings.

### Additive field: audit.lastRetest
In `GET /audits/:id`. `null` until a re-test has been started.
```json
"lastRetest": {
  "status": "completed",
  "startedAt": "2026-11-12T12:20:00Z",
  "finishedAt": "2026-11-12T12:20:40Z",
  "tablesAdded": [],
  "tablesRemoved": [],
  "error": null
}
```
- `status`: `running` | `completed` | `failed`. `finishedAt` is `null` while running.
- `error`: `null`, or `{ "code": "...", "message": "Plain-language message" }` when `status` is `failed`. `code` is `INTERRUPTED` when a server restart stopped the re-test (see "What the backend keeps").
- `tablesAdded` / `tablesRemoved`: names of tables that appear in this run but not in the run before, and the other way round. Always arrays; empty while running and when `failed`.
- `cleanup` and `cleanupNote` (see above) describe the most recent run that finished, the first audit or a re-test, successful or not. While a re-test runs they keep the value of the run before, and are updated when it ends.

### Additive field: finding.retest.previousVerdict
```json
"retest": { "status": "passed", "lastRunAt": "2026-11-12T12:20:40Z", "previousVerdict": "LEAKED" }
```
- `previousVerdict`: `LEAKED` | `BLOCKED` | `INCONCLUSIVE` | `null`. The verdict of the same table in the run before; while `retest.status` is `passed` it stays `LEAKED`. `null` when there was no run before (the first audit) or the table is new.
- `lastRunAt`: when the last successful re-test of this table finished; `null` if never. A failed re-test does not change it.
- Findings are matched by `table`, never by position.

### Additive fields: finding.explanationSource and the report-agent module
Optional. They appear only when the backend runs with the Report agent on (`REPORT_AGENT=groq`). With it off (the default) nothing changes.
```json
"explanationSource": "ai"
```
```json
"modules": [
  { "id": "data-access-prover", "name": "Data Access Prover", "status": "completed", "progress": 100 },
  { "id": "report-agent", "name": "Report agent", "status": "failed", "progress": 100, "message": "AI text was not used for 3 of 3 findings (the AI service is rate limited). Template text kept for those." }
]
```
- `finding.explanationSource`: `"template"` | `"ai"`. It says who wrote `explanation.en`. If the field is missing, treat it as `"template"`.
- An AI may write only `explanation.en`. `explanation.ur`, `title`, `verdict`, `severity`, `evidence`, `fix` and `retest` always come from the Prover's own code. An AI never changes them.
- AI text is checked before it is used: format, length, no claim that an app is secure, safe, certified or guaranteed, and no contradiction of the verdict. A finding whose text fails the checks keeps the template text and gets `"template"`.
- The Report agent runs after the Prover, in the same run, and after a Re-test. While it works, the Prover row is `completed`, the `report-agent` row is `running`, and the audit `status` is still `running`. The audit becomes `completed` after the Report agent has finished.
- If the Report agent fails (timeout, rate limit, bad answer, no key), the audit still completes and the findings keep the template text. The `report-agent` row is `failed`. If some findings got AI text and some did not, the row is `failed` and its `message` says how many were not used.
- If the Prover itself fails (the audit, or a Re-test), the Report agent never starts. Its row is then `failed` with the message "Not run: the audit did not finish." or "Not run: the Re-test did not finish."
- `modules[].message`: optional, only on a `failed` row. One plain sentence. It never contains a key, a request or the AI's own text.
- Privacy: table names and check results (never keys) are sent to Groq to write the explanation. A key, the project address, the canary row id, the reproducer and user ids are never sent.

### Additive fields: agent rows, `skipped`, `reason` and `TIMEOUT` (`LOCK_C_AGENTS`)
Optional. They appear only when the backend runs with `LOCK_C_AGENTS=on`. With it off (the default) nothing changes: the response is the same as before.
```json
"modules": [
  { "id": "data-access-prover", "name": "Data Access Prover", "status": "failed", "progress": 40 },
  {
    "id": "report-agent", "name": "Report agent", "status": "skipped", "progress": 0,
    "reason": { "en": "Not run: the audit did not finish.", "ur": "Nahi chala: audit poora nahi hua." }
  }
],
"error": { "code": "TIMEOUT", "message": "The audit reached its time limit and was stopped." }
```
- `modules[].status` gets one more value: `skipped`. The full list for a module row is `queued` | `running` | `completed` | `failed` | `skipped`. It means the agent did not run on purpose, for example because an earlier required step failed or the run was stopped.
- The audit's own `status` does NOT get `skipped`. It stays `queued` | `running` | `completed` | `failed`.
- `modules[].reason`: `{ "en": "...", "ur": "..." }`, both languages. Only present on a `skipped` row. A `skipped` row has no `message`. A `failed` row still has `message` and no `reason`.
- More rows: when more agents are added to the run, each one appears in `modules` after the rows above, in the same shape (`id`, `name`, `status`, `progress`, and `message` or `reason` when they apply). A client shows the rows it finds and does not depend on a fixed list.
- Stage rows: with `LOCK_C_AGENTS=on` the stage steps show as rows too, after the `data-access-prover` row (and the `report-agent` row when it is on), in this order: `planner`, `ownership`, `evidence`, `roadmap`, `guide` (`roadmap` is described in "Additive: roadmap and client report"). They are plain code (no AI). `planner`, `evidence`, `roadmap` and `guide` are `completed` when they finish. `ownership` is `skipped` with the same `reason` as `ownership.reason`, because ownership is not checked yet. With the flag off these four rows do not exist, and every other field is exactly as before.
- The stage fields (`plan`, `ownership`, `evidence`, `coverage`, `gate`) have the same values with the flag on and off. The `gate` is worked out only from the checks, the coverage, the evidence and `cleanup`; a `skipped` or `failed` row never changes it by itself.
- If the `evidence` step fails or runs out of time, the audit status is NOT changed (it stays `completed`), and the `evidence` row is `failed` with a `message`. The `gate` is then `not_ready`, its first reason is "The evidence of this run is not available, so there is no result.", `GET /audits/:id/evidence` has no `items`, and every planned check is in `coverage.failedToRun`. If the `guide` step itself fails or runs out of time, the `gate` is `not_ready` with the reason "The result of this run could not be worked out, so there is no result." A missing step never makes a run look ready.
- Time limits: every agent has its own time limit, and the whole run has one too. A run that runs out of time ends as `failed` with `error.code` `TIMEOUT` (a fixed plain sentence, no keys). `TIMEOUT` is a new value of the existing `error.code` field; no field was added for it. In a re-test the audit stays `completed` and `lastRetest.error.code` is `TIMEOUT`, as for any failed re-test.
- A `TIMEOUT` can leave the temporary test users in the test project (the checks were stopped before they could clean up). Then `cleanup` is `"failed"` and `cleanupNote` says to remove users with an email like `vca-*@example.com` by hand.
- A stopped run may still be finishing in the background. Until it ends (at most about 10 minutes), a new audit or re-test of the SAME project is refused with `409` `AUDIT_IN_PROGRESS` and the message "An earlier audit of this project is still stopping. Wait a few minutes, then try again." Another project is not affected. The code is the existing one.

### Additive request: a website, with or without Supabase (`LOCK_C_AGENTS`)
Optional. `POST /audits` can start from a website address. This works only when the backend runs with `LOCK_C_AGENTS=on`. **With the flag off (the default) `websiteUrl` and `confirmSiteAccess` do not exist: they are ignored like any other extra field, and the request, its errors and its answer are exactly as before** (Supabase details and `confirmTestProject` are always required).
```json
{
  "label": "My shop",
  "websiteUrl": "https://www.example-shop.com",
  "confirmSiteAccess": true,
  "projectUrl": "https://example-project.supabase.co",
  "anonKey": "<write-only, never returned>",
  "serviceKey": "<write-only, never returned>",
  "confirmTestProject": true
}
```
- A request with no `websiteUrl` is the old request, checked exactly as before (same fields, same error messages).
- With a `websiteUrl`: `confirmSiteAccess` must be exactly `true` (the caller says they may test this site). Otherwise `400` `INVALID_INPUT`.
- `websiteUrl`: a public `https` address, no login, no port, no IP address. Only its front page is looked at; a path, query or hash is dropped. Otherwise `400` `INVALID_INPUT` that names the field only.
- The Supabase group is `projectUrl` + `anonKey` + `serviceKey`. With a `websiteUrl` it is optional, but all or nothing: if some are given and some are not, `400` `INVALID_INPUT`, and the message names the missing fields only (never a value). When the group is given, `confirmTestProject` must be exactly `true`, as before. `confirmTestProject` is not needed without the group.
- A request needs a `websiteUrl` or the Supabase group (the old request has the group).

What changes in the answers (only for a request that has a `websiteUrl`, or when the flag is on; nothing changes with the flag off):
- `GET /audits/:id`: `target` is `{ "label", "projectUrl"?, "websiteUrl"? }`. A website-only audit has no `projectUrl`. An audit with only Supabase details has no `websiteUrl`, as before.
- A website-only audit has no tables: `findings` is `[]`, `summary` is all zeros, `cleanup` stays `null`, and the `data-access-prover` row is `skipped` with a `reason` "Not provided". There is no `report-agent` row. Its progress is the average of its rows and ends at 100.
- Checks are chosen from what was given. A check whose input was not given is in `plan` with `required: false`, and in `coverage.skipped` with a `reason` that starts with "Not provided" and names the check, in both languages. A check whose input was given keeps `required: true` (the Data Access Prover when Supabase details were given, the website checks when a website was given). This also holds for the old request (Supabase only) when the flag is on: the two website checks are then "Not provided" and optional.
- `gate`: when it is `not_ready`, every check that was not provided is named in `gate.reasons` ("Not checked, because it was not provided: ..."). A run with no Supabase details needs no blocked table (there is no table check), but it is never `ready_by_these_checks` unless at least one REQUIRED check completed. An empty coverage is never ready.
- Re-test of a website-only audit: `409` `NOT_ELIGIBLE` for now. `GET /audits/:id/certificate` needs a BLOCKED table, so a website-only audit gets `409` `NOT_ELIGIBLE`.

### Additive: website checks and evidence that is not about a table (`LOCK_C_AGENTS`)
Optional. With a `websiteUrl` (see "Additive request: a website, with or without Supabase") the two website checks run. They are plain code (no AI), read only what any visitor can read, and use a network guard that refuses private addresses. With the flag off nothing here exists.
- Rows: `tls-headers` and `bundle-secrets` appear in `modules` (after `ownership`, before `evidence`), in the same shape as the other rows. They run together with the Prover, not after it. If one runs out of time its row is `failed` with a `message`, and its check is in `coverage.failedToRun`.
- `tls-headers` reads the front page and looks at the security headers (Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options, framing, Referrer-Policy) and at whether the page was reached over https. The certificate itself is NOT read yet: `coverage.outOfScope` names "TLS validity period and expiry" with the reason "Not implemented yet". Out of scope does not hold the gate back.
- `bundle-secrets` reads the front page and the scripts of the same origin (at most 30 files, 2 MB each, 15 MB in all) and looks for a Supabase secret key (`sb_secret_...`) or a `service_role` key. It does not test whether a key works. Scripts of another origin are named in `coverage.outOfScope`. A script that was not read (limit, size, error, stop) is named in `coverage.partial[].notRead`, and a required check that is `partial` keeps the gate `not_ready`.
- A site that cannot be read: the check is in `coverage.failedToRun` with a fixed sentence (never the address), and the audit still completes.
- `GET /audits/:id/evidence`: the items of these checks use the same shape as the others, with these differences. `findingId` and `table` are `null` (they are not about a finding or a table). `kind` is `"site-headers"` or `"site-bundle"`. `subject` says what it is about: a header name (`"strict-transport-security"`, `"content-security-policy"`, `"x-content-type-options"`, `"framing"`, `"referrer-policy"`, `"https"`) or a script (`host/path` only: a query, a hash and a login are always cut off). The items of the Data Access Prover are as before; for them `kind` is missing, and a missing `kind` means `"table"`. A client must accept `null` in `findingId` and `table`.
  ```json
  { "id": "ev_site_bundle-secrets_1", "check": "bundle-secrets", "findingId": null, "table": null,
    "subject": "www.example-shop.com/assets/app.js", "kind": "site-bundle",
    "verdict": "LEAKED", "proof": "PROVEN", "summary": { "en": "...", "ur": "..." } }
  ```
- `verdict` for `site-bundle`: `LEAKED` = a secret key is in a script of the site (the gate is then `not_ready`). For `site-headers`: `BLOCKED` = the header is there, `INCONCLUSIVE` = it is missing or weak. A header is never `LEAKED`. The key itself is never in any answer: only its kind (in the sentence) and the script's name.
- `summary.leaked`, `blocked` and `inconclusive` and `findings` stay about tables. For an audit that has a `websiteUrl`, `summary` also has `siteLeaked`: the number of secret keys found in the scripts of the site (the `site-bundle` evidence items with verdict `LEAKED`), `0` when none or when the site could not be read (the coverage says what was not checked). An audit without a `websiteUrl` has no `siteLeaked` key at all, and with the flag off nothing changes.
- With the flag on, a run with a website and no Supabase details can be `ready_by_these_checks` when both website checks completed with no leak and the cleanup is not `"failed"`. The sentence "Today the gate is always `not_ready`" below is true only with the flag off.

### Additive: Repo Scan Lite, a public GitHub repository (`LOCK_C_AGENTS`, phase A1)
Optional. `POST /audits` can take a public GitHub repository. Like the website, it works only with `LOCK_C_AGENTS=on`. **With no `repoUrl`, nothing here exists, and the request, the errors, the answers, the plan and the gate are byte-for-byte as before. With the flag off, a `repoUrl` is refused with `400` `INVALID_INPUT` and the message `Repo scan is not enabled on this server.` (it is not skipped silently, and no audit is started).**

```json
{ "repoUrl": "https://github.com/owner/repo", "confirmRepoAccess": true }
```

Request:
- `repoUrl`: a plain `https://github.com/{owner}/{repo}` address (a trailing `/` or `.git` is accepted and dropped). No other host, no `www`, no login, no port, no query, no hash, no path after the repo name (no `/tree/...`). Otherwise `400` `INVALID_INPUT` that names the field only and never quotes the value.
- With a `repoUrl`, `confirmRepoAccess` must be exactly `true` (the caller says the repository is public and they may scan its files). Otherwise `400` `INVALID_INPUT`. Without a `repoUrl`, `confirmRepoAccess` does not exist.
- It can be given alone, or together with `websiteUrl` and/or the Supabase group. The other rules do not change: a `websiteUrl` still needs `confirmSiteAccess: true`, and the Supabase group is still all-or-nothing with `confirmTestProject: true`. Only a public repository can be read.
- Only the default branch, as it is now, is read. The history of old commits is not read.

The check (only for a run that has a `repoUrl`):
- A new check `repo-secrets` is added at the end of `plan[]` (mode `passive`, `required: true`: a repository that was given counts like a website that was given). A run without a `repoUrl` does not have it.
- It reads the zip of the repository and looks in its text files for a Supabase secret key (`sb_secret_...`) or a `service_role` key, with the same rules as `bundle-secrets`. It does not test whether a key works. Plain code, no AI.
- Limits (fixed): the zip at most 15 MB, 40 MB unpacked, 3000 entries; one file at most 1 MB; `node_modules`, `dist`, `build`, `.next`, `vendor` and `.git` folders and binary files are not read. Repo scans run one at a time (the backend already runs one audit at a time). The zip is read in memory only; a path with `..` or an absolute path, zip64 and encrypted zips are refused.
- A file that was too big, or a link (links are never followed), is named in `coverage.partial[].notRead` and the check is `partial`.
- If the repository cannot be read (not found or private, GitHub refused with 403 or 429, a redirect that is refused, a timeout, too big, an unsafe zip) the check is `failedToRun` with a fixed sentence in `coverage.failedToRun[].reason`, and its row in `modules` is as for the other checks. The rest of the audit still runs.

What changes in the answers (only for an audit that has a `repoUrl`):
- `GET /audits/:id`: `target.repoUrl` (the cleaned address). `summary.repoLeaked`: the number of `repo-file` evidence items with verdict `LEAKED` (`0` when none or when the repository could not be read). `summary.leaked` and `siteLeaked` do not change meaning. An audit without a `repoUrl` has neither key.
- `GET /audits/:id/evidence`: items of this check have `check: "repo-secrets"`, `kind: "repo-file"`, `findingId: null`, `table: null`, `proof: "PROVEN"`, `verdict: "LEAKED"`, `subject` = the path of the file inside the repository, and `line` = the 1-based line of the first key of that kind in the file (an additive field: a client must accept it missing). The key itself is never in any answer: only its kind (in the sentence), the path and the line. A client must accept an unknown `kind`.
- `GET /audits/:id/roadmap`: a `repo-file` leak gives an item of kind `fix-repo-secret` (a new kind: a client must accept an unknown kind), severity `critical` (rotate the key; remove it from the file; old commits keep it).
- `GET /audits/:id/client-report`: `findings.repo` is `{ "leaked": n }`, or `null` when the repo scan failed or did not run (a partial scan still gives the number found); the field is missing for a run without a repo. A key in the repository counts in the `headline` ("... in the files of the GitHub repository"). The scope lists `repo-secrets` in the same buckets as the other checks.
- **The gate.** `repo-secrets` is required when it is in the plan, so a run that was given a repository must not say "No leak found by these checks" as if the code had been read when it was not. Only when `repo-secrets` is in the plan and it did not complete: `gate.decision` is `not_ready` and `gate.reasons` has `"Repo scan did not run."` (failed or skipped) or `"Repo scan was only partly done: some files of the repository were not read."` (partial). A key found is a leak and holds the gate as for any other leak. The gate banner shows `gate.reasons` as they are.
- A run with only a repository (no Supabase, no website) can be `ready_by_these_checks`: the repo check is its required check, and it needs no Data Access result, exactly as a website-only run. It is `not_ready` with a leak, and with "Repo scan did not run." when the repository could not be read.

The optional environment variable `GITHUB_TOKEN` (a fine-grained token with no scopes) is read by the backend only. If set, it is sent only to `api.github.com` (never to the download host). If not set, the plain archive address is used. It is never logged, stored or returned.

### Additive: roadmap and client report (`LOCK_C_AGENTS`)
Optional. Two new routes and one new row. They exist only for a run made with `LOCK_C_AGENTS=on`. **With the flag off nothing here exists** and every answer is exactly as before. `GET /audits/:id` gets no new field: only the `roadmap` row (see "Stage rows").
- `roadmap` is a code-only agent (no AI) that runs after `evidence` and before `guide`. It still runs after a failure. It has its own time limit (the finalizer limit). If it fails or runs out of time its row is `failed` (a `message`, fixed sentence for a timeout), the audit is not changed, the roadmap is empty and the client report says "Roadmap not available." in `limits`. If the `guide` itself fails, the roadmap is empty and the client report is a fixed `not_ready` one.
- A re-test makes both again (from the findings after the merge). A failed re-test leaves them as they were.
- `404` `NOT_FOUND` for an unknown audit, and for an audit that has none (made with the flag off, or before this step).
- They never contain a key, a query, a hash, or the Prover's SQL (a fix item points at the finding that holds it).

#### GET /audits/:id/roadmap
```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "rm_001",
      "kind": "fix-finding",
      "severity": "critical",
      "fromRequiredCheck": true,
      "title": { "en": "Fix the leak in table \"bookings\"", "ur": "..." },
      "why": { "en": "...", "ur": "..." },
      "steps": [ { "en": "...", "ur": "..." } ],
      "refs": { "checkId": "data-access-prover", "findingIds": ["fnd_001"], "evidenceIds": ["ev_fnd_001"] }
    }
  ],
  "truncated": 0
}
```
- `kind`: `fix-finding` | `fix-site-secret` | `improve-header` | `confirm` | `cleanup` | `finish-check` | `provide-input` | `retest`. A client shows a kind it does not know as plain text.
- `severity`: the usual values. `fromRequiredCheck`: the item comes from a check that is required in this run.
- `improve-repo` (new kind): a `repo-env-name` evidence item, which is a variable named with `NEXT_PUBLIC_` or `VITE_` and `SECRET` or `SERVICE_ROLE` in a code or config file of the repository (not a `.md` or `.txt` file; one item per file, at most 50). Evidence: `kind` `repo-env-name` (a new kind: a client must accept an unknown kind), `verdict` `INCONCLUSIVE`, `proof` `UNVERIFIED`, `subject` the file path, `line` the 1-based line. Never the value. A line that also holds a recognised key is not listed: the `repo-file` rule reports it as `LEAKED`. Severity `high`. It never makes the gate `not_ready` by itself, and it is not counted in `summary.repoLeaked`.
- `improve-repo` from a `repo-migration` evidence item: a migration (a `.sql` file in a folder called `migrations`) creates a table of the public schema and no migration enables row level security for it. Evidence: `kind` `repo-migration` (a new kind: a client must accept an unknown kind), `verdict` `INCONCLUSIVE`, `proof` `UNVERIFIED`, `table` the table name, `subject` the path of the file with the `create table`, `line` its 1-based line. It is a warning sign only: row level security may be enabled elsewhere (for example in the Supabase dashboard). Severity `medium`. It is never `LEAKED`, never makes the gate `not_ready` by itself, and is not counted in `summary.repoLeaked`. At most 50 tables are listed; when more exist the coverage `limits` say the list is not complete.
- `fixPrompt` (optional, `{ en, ur }`): a fixed text to paste into the AI tool that built the app. Only on `fix-finding`, `fix-site-secret`, `fix-repo-secret`, `improve-header` and `improve-repo` items (a header the audit does not know has none). It is built from templates in code, not by an AI model. English comes first, `ur` is the Roman Urdu copy of the same prompt. It always says to show the plan first and apply only after the person approves. It never holds a key and never asks for one: only a table name, a file path, a script name or a header name goes into it. A `fix-finding` for a table with no owner column asks the person who should read and write, and does not guess. A client that does not know the field ignores it.
- `steps`: 1 to 4 items. `refs.findingIds` are ids from `GET .../findings`; `refs.evidenceIds` are ids from `GET .../evidence`; `refs.checkId` is an id from `plan`.
- Which item comes from what:
  - `fix-finding`: a table that is `LEAKED`. Severity is the finding's. The SQL stays in the finding's `fix`.
  - `fix-site-secret`: a secret key in a script of the site. Always `critical`. The steps say: rotate the key (Supabase -> API keys), remove it from the code and env files, redeploy, run the audit again.
  - `improve-header`: a header that is missing or weak. `https` is `high`; `strict-transport-security` and `content-security-policy` are `medium`; `x-content-type-options` and `framing` are `low`; `referrer-policy` is `info`.
  - `confirm`: a table that is `INCONCLUSIVE`.
  - `cleanup`: `cleanup` is `"failed"`. `high`.
  - `finish-check`: a check that is `partial` or `failedToRun`. `medium`. For `partial` the `why` names what was not read.
  - `provide-input`: an optional check that was "Not provided". `info`.
  - `retest`: there is a fix item and Supabase details were given. `info`.
  - No item for: a `BLOCKED` table or header, a check that is "Not implemented yet", ownership.
- Order (fixed, the same input always gives the same list): severity (`critical` first), then items from a required check first, then kind (`fix-site-secret`, `fix-finding`, `cleanup`, `finish-check`, `improve-header`, `confirm`, `provide-input`, `retest`), then the id of what it refers to. The ids `rm_001`... are given after sorting.
- At most 100 items. `truncated` is how many were left out (the least important ones).
- A run with nothing to do (or no roadmap) has `"items": []`.

#### GET /audits/:id/client-report
```json
{
  "schemaVersion": 1,
  "headline": { "en": "Leak found by these checks: 1 table.", "ur": "..." },
  "decision": "not_ready",
  "reasons": [ { "en": "...", "ur": "..." } ],
  "scope": {
    "checked": [ { "id": "data-access-prover", "title": { "en": "...", "ur": "..." } } ],
    "notProvided": [], "notImplemented": [], "partial": [], "failedToRun": [],
    "outOfScope": [ { "name": "TLS validity period and expiry", "reason": { "en": "...", "ur": "..." } } ]
  },
  "findings": {
    "tables": { "leaked": 1, "blocked": 1, "inconclusive": 1 },
    "site": { "siteLeaked": 0, "headersMissing": 2 }
  },
  "topActions": ["rm_001", "rm_002", "rm_003"],
  "limits": [ { "en": "...", "ur": "..." } ],
  "disclaimer": { "en": "...", "ur": "..." }
}
```
- `decision` and `reasons` are the `gate`, copied.
- `headline`: a leak (a table or a secret key in a script, both are named) says so; `ready_by_these_checks` says "No leak found by these checks."; not ready with no leak says the result is not complete; nothing finished says "No result". The words are always "by these checks". A client must not use `summary.leaked` alone as the headline: a secret key in a script is `summary.siteLeaked`.
- `scope`: every planned check is in exactly one of `checked`, `notProvided`, `notImplemented` (skipped for another reason, today: not built yet), `partial`, `failedToRun`. Each is `{ "id", "title" }`. `outOfScope` is the same list as `coverage.outOfScope`.
- `findings.tables` is `null` when the data access check did not complete. Its counts are the counts of `summary`. `findings.site` is `null` when no website check ran; `siteLeaked` is the same number as `summary.siteLeaked`, `headersMissing` is the number of headers that are missing or weak.
- `topActions`: the ids of the first three roadmap items.
- Wording: never a claim of approval (not "certified", "safe to launch", "guaranteed", "secure", and the same in Roman Urdu).

### Additive fields: the stages (`schemaVersion` 2)
Added to `GET /audits/:id` and a new route `GET /audits/:id/evidence`. Nothing is renamed or removed. An audit that finished a run (an audit or a re-test) after the stages were added has the fields below; an older audit does not. A client treats a missing `schemaVersion` as `1` and shows no stage fields for it.

`GET /audits/:id` gets four more fields:
```json
"schemaVersion": 2,
"ownership": {
  "status": "skipped",
  "reason": { "en": "Ownership of the site is not checked yet.", "ur": "Site ki malkiyat abhi check nahi hoti." }
},
"plan": [
  { "id": "data-access-prover", "title": { "en": "...", "ur": "..." }, "mode": "keyed", "required": true },
  { "id": "tls-headers", "title": { "en": "...", "ur": "..." }, "mode": "passive", "required": true },
  { "id": "bundle-secrets", "title": { "en": "...", "ur": "..." }, "mode": "passive", "required": true },
  { "id": "active-checks", "title": { "en": "...", "ur": "..." }, "mode": "active", "required": false }
],
"gate": {
  "decision": "not_ready",
  "reasons": [
    { "en": "The required check \"Certificate and security headers of the site\" was skipped.", "ur": "..." }
  ]
}
```
- `schemaVersion`: `2` while these fields exist.
- `ownership.status`: `skipped` | `proven` | `not_proven`. Today it is always `skipped`, with a `reason`. `proven` and `not_proven` are reserved for the day ownership of the site is checked.
- `plan`: the checks of this run, in order. Every check is listed, also one that is not built yet. `mode`: `passive` (reads what any visitor can read), `keyed` (runs with the keys the user typed in) or `active` (sends probes to the site; allowed only after ownership is proven). `required`: a required check that did not complete keeps `gate.decision` at `not_ready`.
- `gate.decision`: `ready_by_these_checks` | `not_ready`. It is `ready_by_these_checks` only when ALL of these are true: at least one check completed; every required check completed (not skipped, not partial, not failed to run); no leak was found; `cleanup` is not `"failed"`; and at least one table was shown to be blocked, or the Data Access Prover completed with no exposed table at all ("zero tables", see `coverage.nothingToTest`, reserved: not produced by the API today). An empty coverage is never ready. `gate.reasons` says why it is `not_ready` and is empty when it is ready. The words are always "by these checks": this is never a statement that an app is secure.
- Today the gate is always `not_ready`: the checks `tls-headers` and `bundle-secrets` are required but not built yet, so they are `skipped`.
- Every text that is `{ "en", "ur" }` has both languages.

### GET /audits/:id/evidence
New route. `404` `NOT_FOUND` for an unknown audit, and also for an audit that has no stage fields (an older audit).
```json
{
  "schemaVersion": 2,
  "items": [
    {
      "id": "ev_fnd_001",
      "check": "data-access-prover",
      "findingId": "fnd_001",
      "table": "bookings",
      "verdict": "LEAKED",
      "proof": "PROVEN",
      "summary": { "en": "...", "ur": "..." }
    }
  ],
  "coverage": {
    "checked": ["data-access-prover"],
    "partial": [],
    "skipped": [
      { "id": "tls-headers", "reason": { "en": "Not implemented yet.", "ur": "Abhi bana nahi." } }
    ],
    "outOfScope": [],
    "failedToRun": [],
    "nothingToTest": [],
    "limits": [
      { "en": "Scripts from other origins are not scanned.", "ur": "Doosre origin ki scripts scan nahi hotin." }
    ]
  }
}
```
- `items`: one per finding of the Data Access Prover. `findingId` is an id from `GET /audits/:id/findings`. `proof`: `PROVEN` (the check saw it directly: a leak, or a table that held up) or `UNVERIFIED` (the check could not tell: `INCONCLUSIVE`). `summary` is the finding's `explanation`.
- `coverage`: what was and was not looked at. Every planned check is in exactly one of `checked`, `partial`, `skipped` or `failedToRun`; a check that reported nothing counts as `skipped`, so a gap never looks like a pass.
  - `checked`: ids of the checks that completed.
  - `partial`: `{ "id", "reason", "notRead": [{ "name", "reason" }] }`. The check ran but could not read part of what it should (a size cap or a time limit); `notRead` names each part. A required check that is `partial` keeps the gate at `not_ready`.
  - `skipped` and `failedToRun`: `{ "id", "reason" }`.
  - `nothingToTest`: **Reserved: not produced by the API today.** The list is always `[]` for now. `{ "id", "note" }`. A check that completed but found nothing to test, for example the Data Access Prover when no table is exposed ("zero tables"). It is in `checked` too, it is not a failure and not a skip, and the note says that no table data was tested. For `data-access-prover` it lets the gate be ready without a blocked table. The Prover still ends an audit with no exposed table as `failed` with `error.code` `NO_TABLES` (that does not change), so a client must not wait for this list to be filled. If the Prover ever completes an audit with zero tables, this list will carry the note and the gate rule above will apply.
  - `outOfScope`: `{ "name", "reason" }`. Things left out on purpose, named one by one (for example a script of another origin). Out of scope is NOT partial and does not hold the gate back.
  - `limits`: what these checks can not tell, in plain words.

### What happens to finding ids, tables and fixes between runs
- A table that exists in both runs keeps the same finding `id`. A table that appears gets a new `id`, a `previousVerdict` of `null`, and `retest.status` by the rule above (so a new table that is `LEAKED` gets `failed`). A table that disappears is dropped from the list and is named in `lastRetest.tablesRemoved`; a dropped id is never reused. A table that disappeared is not proof that its leak was fixed, so the UI should show `tablesRemoved` to the user.
- A finding that becomes `BLOCKED` or `INCONCLUSIVE` gets `fix: null` (those findings never have a fix). The approval is not kept; the `previousVerdict` of `LEAKED` and `retest.status = "passed"` tell the story.
- A finding that is still `LEAKED` gets the fix the Prover proposes now. If the SQL is identical to the old one, `fix.status` stays as it was (for example `approved`). If the SQL is different, `fix.status` goes back to `proposed`, because the approval was for different SQL.

### What the backend keeps
Audits, approvals and re-test results are kept in the audit store (a table in the platform's own Supabase project; never a key). The newest 50 audits are kept. A server restart does not remove them: every route in this file still answers for an old id, and `404` `NOT_FOUND` now means only that the id is unknown or was removed because it was not among the newest 50.

A run that a restart stopped is closed when the server starts again:
- An audit that was `running` becomes `status` `failed` with `error` `{ "code": "INTERRUPTED", "message": "..." }`.
- A re-test that was `running` leaves the audit `completed` with its old findings unchanged, and `lastRetest` becomes `failed` with `error.code` `INTERRUPTED`. The top-level `error` stays absent.
- In both cases `cleanup` is `"failed"` and `cleanupNote` says that users with an email like `vca-*@example.com`, or canary rows, may be left in the target project and must be removed by hand. `INTERRUPTED` is a new value of the existing `error.code` field; no field was added, renamed or removed.

### GET /audits/:id/certificate
Available only when ALL of these are true: the audit `status` is `completed` (no run or re-test is going on), it has zero `LEAKED` findings, it has at least one `BLOCKED` finding, and `cleanup` is not `"failed"`. Otherwise `409` with `{ "error": { "code": "NOT_ELIGIBLE", "message": "..." } }`, and the message names the reason. An audit with only `INCONCLUSIVE` findings is not eligible: nothing was shown to be blocked.
```json
{
  "auditId": "aud_001",
  "issuedAt": "2026-11-12T12:30:00Z",
  "result": "NO_LEAK_FOUND_BY_THESE_CHECKS",
  "checksRun": ["data-access-prover"],
  "summary": { "blocked": 2, "inconclusive": 1 },
  "disclaimer": "This result covers table data access only: read, update and delete as another signed-in user, and read as a visitor.",
  "recordHash": "<sha256 of the audit record>"
}
```
- `summary` is additive. It counts the findings of the run that made the audit eligible. `leaked` is not listed because it is always 0.
- `issuedAt` is the time the latest completed run finished. It does not change between requests; it changes only after a new re-test.
- `recordHash` is an integrity fingerprint, NOT a signature. It is the sha256 of the audit record (target label and URL, findings without `explanation` and `explanationSource`, summary, run times; never a key). The wording of the explanation is not covered, because an AI may write it and it can differ between runs. It lets someone see that the record they hold matches the one that was hashed. It does not prove who made it, and anyone with the same record can compute the same value.
- Wording: this is "no leak found by these checks". It is not a statement that the app is secure, safe or certified.

## Access code (all `/audits` routes)
Additive. Every request to `/api/v1/audits...` must send the header `X-Access-Code: <code>` (the code is given to the user; the frontend sends it, never stores it in the page or in logs). `GET /health` needs no code.
- Missing or wrong code: `401`, `{ "error": { "code": "ACCESS_DENIED", "message": "Access denied." } }`
- Only a code that was sent and is wrong counts toward the limit. A missing header and CORS `OPTIONS` requests are never counted.
- Too many wrong codes (10 within 15 minutes from one client): `429`, `{ "error": { "code": "RATE_LIMITED", "message": "Too many wrong attempts. Try again later." } }`, with a `Retry-After` header in seconds. While blocked, even the right code gets `429`.
- The code is never part of any response.

## Errors (all endpoints)
```json
{ "error": { "code": "SOME_CODE", "message": "Plain-language message" } }
```
Codes used so far: `PRODUCTION_REFUSED` (reserved), `NOT_FOUND`, `NOT_ELIGIBLE`, `INVALID_INPUT`, `AUDIT_IN_PROGRESS`, `ACCESS_DENIED`, `RATE_LIMITED`, `NO_FIX_TO_APPROVE`.

## What the frontend should show for each state
Loading, empty (no findings), error (use `error.message`), and the three verdicts. Every finding card needs: verdict badge, table name, title, plain-language explanation (English / Roman Urdu toggle), collapsible evidence, collapsible suggested fix, and the buttons "Approve fix" and "Re-test".