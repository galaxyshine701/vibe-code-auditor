# Vibe Code Auditor: API contract (draft v0.1)

Purpose: the frontend (Alishba) and the backend (Anam) agree on the shape of the data **before** either side is finished. The frontend can build every screen now with the mock data below; the backend will return exactly this shape.

Rules
- Base path: `/api/v1`. Format: JSON. All dates are ISO 8601 (UTC).
- Any change to this file goes through a pull request that both of us approve.
- The backend NEVER returns keys (`serviceKey`, `anonKey`) in any response. The frontend must never store or display them after submitting.
- The tool is for **staging / test projects only**. The backend refuses production-looking URLs.

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
  "serviceKey": "<write-only, never returned>"
}
```
Response `202`
```json
{ "id": "aud_001", "status": "queued" }
```
Error `400` (production-looking URL)
```json
{ "error": { "code": "PRODUCTION_REFUSED", "message": "This looks like a production project. Use a test project." } }
```

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
  ]
}
```

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
  { "operation": "SELECT", "actor": "anon",   "allowed": false, "httpStatus": 200, "rowsReturned": 0 }
]
```

- `operation`: `SELECT` | `UPDATE` | `DELETE`
- `actor`: `"user_b"` (second test user) | `"anon"` (visitor with no login)
- `allowed`: `true` = the canary row was read / changed / deleted; `false` = blocked; `null` = not tested (see `note`)
- `httpStatus` / `rowsReturned`: what the API answered; `null` when not tested
- `note` (optional): short plain-language reason, e.g. "Not tested: ..."
- The list can have 4 items (normal), 1 item (table has no owner column: only the anonymous read), or be empty (canary could not be planted).
- A blocked UPDATE or DELETE can still show `httpStatus` 200 with `rowsReturned` 0, because the row is judged by re-reading it, not by the status code.

### POST /audits/:id/findings/:findingId/fix/approve
A human approves the suggested fix. Response `200`: the updated finding with `fix.status = "approved"`.
(The backend does not change the user's database by itself in version 1; approval only records the decision and marks the fix as ready to apply.)

### POST /audits/:id/retest
Runs the same checks again. Response `202`: `{ "id": "aud_001", "status": "queued" }`. After it finishes, each finding's `retest.status` is `passed` or `failed`.

### GET /audits/:id/certificate
Only available when no `LEAKED` finding remains and the re-test passed. Otherwise `409` with `{ "error": { "code": "NOT_ELIGIBLE", "message": "..." } }`.
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

## Errors (all endpoints)
```json
{ "error": { "code": "SOME_CODE", "message": "Plain-language message" } }
```
Codes used so far: `PRODUCTION_REFUSED`, `NOT_FOUND`, `NOT_ELIGIBLE`, `INVALID_INPUT`.

## What the frontend should show for each state
Loading, empty (no findings), error (use `error.message`), and the three verdicts. Every finding card needs: verdict badge, table name, title, plain-language explanation (English / Roman Urdu toggle), collapsible evidence, collapsible suggested fix, and the buttons "Approve fix" and "Re-test".