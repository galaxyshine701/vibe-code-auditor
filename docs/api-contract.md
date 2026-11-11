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
| 4. Certificate | Opens the shareable result page | `GET /audits/:id/certificate` |

## Words the UI must understand (fixed values)

- `audit.status`: `queued` | `running` | `completed` | `failed`
- `finding.verdict`: `LEAKED` (red) | `BLOCKED` (green) | `INCONCLUSIVE` (grey)
- `finding.severity`: `critical` | `high` | `medium` | `low` | `info`
- `fix.status`: `proposed` | `approved` | `applied` | `rejected`
- Version 1 returns only `proposed` and `approved`. `applied` and `rejected` are reserved.
- `retest.status`: `not_run` | `running` | `passed` | `failed`

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
Example only. Version 1 returns only `data-access-prover`.

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
A human approves the suggested fix. This route is not built yet. Response `200`: the updated finding with `fix.status = "approved"`.
(The backend does not change the user's database by itself in version 1; approval only records the decision and marks the fix as ready to apply.)

### POST /audits/:id/retest
Runs the same checks again. This route is not built yet. Response `202`: `{ "id": "aud_001", "status": "running" }`. After it finishes, each finding's `retest.status` is `passed` or `failed`.

### GET /audits/:id/certificate
This route is not built yet. Only available when no `LEAKED` finding remains and the re-test passed. Otherwise `409` with `{ "error": { "code": "NOT_ELIGIBLE", "message": "..." } }`.
```json
{
  "auditId": "aud_001",
  "issuedAt": "2026-11-12T12:30:00Z",
  "result": "NO_LEAK_FOUND_BY_THESE_CHECKS",
  "checksRun": ["data-access-prover"],
  "disclaimer": "This is evidence that specific checks passed. It is not a guarantee that the app is secure.",
  "recordHash": "<sha256 of the audit record>"
}
```

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
Codes used so far: `PRODUCTION_REFUSED` (reserved), `NOT_FOUND`, `NOT_ELIGIBLE`, `INVALID_INPUT`, `AUDIT_IN_PROGRESS`, `ACCESS_DENIED`, `RATE_LIMITED`.

## What the frontend should show for each state
Loading, empty (no findings), error (use `error.message`), and the three verdicts. Every finding card needs: verdict badge, table name, title, plain-language explanation (English / Roman Urdu toggle), collapsible evidence, collapsible suggested fix, and the buttons "Approve fix" and "Re-test".