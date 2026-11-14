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
- Approvals are kept in memory only (see "What the backend keeps").

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
- `error`: `null`, or `{ "code": "...", "message": "Plain-language message" }` when `status` is `failed`.
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

### What happens to finding ids, tables and fixes between runs
- A table that exists in both runs keeps the same finding `id`. A table that appears gets a new `id`, a `previousVerdict` of `null`, and `retest.status` by the rule above (so a new table that is `LEAKED` gets `failed`). A table that disappears is dropped from the list and is named in `lastRetest.tablesRemoved`; a dropped id is never reused. A table that disappeared is not proof that its leak was fixed, so the UI should show `tablesRemoved` to the user.
- A finding that becomes `BLOCKED` or `INCONCLUSIVE` gets `fix: null` (those findings never have a fix). The approval is not kept; the `previousVerdict` of `LEAKED` and `retest.status = "passed"` tell the story.
- A finding that is still `LEAKED` gets the fix the Prover proposes now. If the SQL is identical to the old one, `fix.status` stays as it was (for example `approved`). If the SQL is different, `fix.status` goes back to `proposed`, because the approval was for different SQL.

### What the backend keeps
Audits, approvals and re-test results are kept in memory only (newest 50 audits). After a server restart they are gone, and every route in this file answers `404` `NOT_FOUND` for the old id.

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