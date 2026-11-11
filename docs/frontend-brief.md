# Frontend specification: Vibe Code Auditor (v0.5.1)

Derived from: `docs/api-contract.md`, `docs/prover-spec.md`, `docs/roadmap.md` and `docs/evidence/*.json`. Where this document adds a rule or a decision, the rule is part of this specification.

If this document and `docs/api-contract.md` differ on a field name or value, the contract wins and this document is corrected.

## Change log

| Version | Date | Change |
|---|---|---|
| v0.5.1 | 11 Nov 2026 | Keys are cleared only after a successful `202`. On `400`, `401`, `409`, `429` and network errors they stay in memory (R4, R18, R29, checklist 4 and 10). Priority rule over chat messages added. Re-test example in the contract changed to `running`. |
| v0.5 | 11 Nov 2026 | Rewritten as a numbered specification. Four screens as in the contract. Decisions added for access code, offline handling, base address, ordering, language, fix status, certificate and re-test. Backend behaviour for unknown ids, failed audits, `label` and restarts stated from the code. |

## How to read this document

- **must / must not** are binding. **should** is strong advice.
- Part 1 is binding. It does not change with the design.
- Part 2 describes behaviour per screen. Layout, colour and visual design are the developer's choice.
- Requirements are numbered R1, R2, and so on.
- This document takes priority over chat messages. If they differ, this document is correct.

---

# Part 1: Binding requirements

## 1.1 Server and access

**R1.** The frontend must read the server address from the environment variable `NEXT_PUBLIC_API_BASE_URL`. The default is `http://localhost:4000`. All audit routes live under `/api/v1`. `GET /health` is outside that prefix and needs no access code.

**R2.** Route status:

| Route | Status |
|---|---|
| `GET /health` | Built |
| `POST /api/v1/audits` | Built |
| `GET /api/v1/audits/:id` | Built |
| `GET /api/v1/audits/:id/findings` | Built |
| `POST /api/v1/audits/:id/findings/:findingId/fix/approve` | Not built yet. Use mock data (R44). |
| `POST /api/v1/audits/:id/retest` | Not built yet. Use mock data (R44). |
| `GET /api/v1/audits/:id/certificate` | Not built yet. Use mock data (R44). |

**R3.** Every request to `/api/v1/audits...` must send the header `X-Access-Code: <code>`. This includes every poll. The code must not appear in the URL or in the request body.

**R4.** If the server cannot be reached (network error or no answer), the screen must show: "Cannot reach the server. Check your connection and try again." It must offer a Retry button. The values in the form must stay, including the keys and the access code, in memory only (R26). The user can press Retry without typing them again.

## 1.2 Audit lifecycle

**R5.** Start an audit with `POST /api/v1/audits`. The body is:
```json
{
  "label": "Hotel booking (test project)",
  "projectUrl": "https://example-project.supabase.co",
  "anonKey": "<publishable key>",
  "serviceKey": "<secret key>",
  "confirmTestProject": true
}
```
The field names are fixed. `anonKey` carries the publishable key. `serviceKey` carries the secret key.

**R6.** `confirmTestProject` must be the boolean `true`, not the text "true". The user must tick a checkbox that says the project is a TEST project. The frontend must not send `true` without that tick. The start action must stay disabled while the box is unticked.

**R7.** Input rules enforced by the backend:
- `projectUrl` must look like `https://<project-ref>.supabase.co`. No port, path or login.
- `label` is optional. If it is missing or blank, the backend uses the project address without `https://` as the label. If sent, it must be text of at most 120 characters.
- `anonKey` and `serviceKey` are required. Each is at most 4096 characters.
- Any violation gives `400 INVALID_INPUT`.

**R8.** On success the backend answers `202` with `{ "id": "aud_001", "status": "running" }`. The call returns at once. The work runs in the background. Only one audit runs at a time. A second start gives `409 AUDIT_IN_PROGRESS`. The frontend must not start a second audit while one is running.

**R9.** The frontend must poll `GET /api/v1/audits/:id` every 2 seconds while `status` is `queued` or `running`. It must stop when `status` is `completed` or `failed`.

**R10.** The status response has this shape:
```json
{
  "id": "aud_001",
  "status": "running",
  "createdAt": "2026-11-12T10:00:00Z",
  "target": { "label": "Hotel booking (test project)", "projectUrl": "https://example-project.supabase.co" },
  "summary": { "leaked": 1, "blocked": 1, "inconclusive": 1 },
  "modules": [ { "id": "data-access-prover", "name": "Data Access Prover", "status": "running", "progress": 60 } ],
  "cleanup": null
}
```
- `status` is `queued`, `running`, `completed` or `failed`.
- `cleanup` is `null` while running, then `"ok"` or `"failed"`.
- `cleanupNote` is present only when `cleanup` is `"failed"`.
- `error` is present only when `status` is `failed`. It is `{ "code": "...", "message": "..." }`. It never contains a key.
- For a failed audit, `summary` is all zeros and the module `status` is `failed`.

**R11.** The frontend must show the modules that the backend returns. It must not add modules of its own.

**R12.** `GET /api/v1/audits/:id/findings` does not check the audit status. It answers `200` with `{ "findings": [] }` while the audit is running and when the audit has failed. It answers `404 NOT_FOUND` only for an unknown id. The frontend must read the findings only after the status is `completed`.

**R13.** Audits are kept in the backend's memory. After a server restart every audit is gone. The backend keeps the newest 50 audits. A request for a gone audit gives `404 NOT_FOUND`. The frontend must treat that answer as "this audit no longer exists" and offer to start a new audit.

## 1.3 Findings

**R14.** A finding has this shape:
```json
{
  "id": "fnd_001",
  "module": "data-access-prover",
  "table": "bookings",
  "operation": "SELECT",
  "verdict": "LEAKED",
  "severity": "critical",
  "title": "...",
  "explanation": { "en": "...", "ur": "..." },
  "evidence": {
    "rowsReturned": 1,
    "httpStatus": 200,
    "canaryRowId": "...",
    "reproducer": "curl -H 'apikey: <ANON_KEY>' ...",
    "operations": []
  },
  "fix": { "status": "proposed", "description": "...", "sql": "..." },
  "retest": { "status": "not_run", "lastRunAt": null }
}
```
- `verdict` is `LEAKED` (red), `BLOCKED` (green) or `INCONCLUSIVE` (grey).
- `severity` is `critical`, `high`, `medium`, `low` or `info`.
- `explanation.en` is English. `explanation.ur` is Roman Urdu.
- `reproducer` holds placeholders (`<PROJECT_URL>`, `<ANON_KEY>`, `<USER_B_JWT>`), never real values. It is `null` when there is nothing to reproduce.
- `fix` is `null` when there is nothing to fix. The frontend must not show an empty fix section.
- `retest.status` is `not_run`, `running`, `passed` or `failed`.

**R15.** The frontend must sort findings by verdict in this order: `LEAKED`, `INCONCLUSIVE`, `BLOCKED`. Inside one verdict, it must sort by severity (`critical`, `high`, `medium`, `low`, `info`). Inside one severity, it must sort by table name, A to Z.

**R16.** `evidence.operations` is optional. If shown, each item has `operation` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), `actor`, `allowed`, `httpStatus`, `rowsReturned` and an optional `note`.
- `actor` is `user_b` (second test user), `anon` (visitor with no login) or `owner` (test user A, a control: the rightful owner should be able to use the row).
- `allowed` is `true` (the canary row was read, inserted, changed or deleted), `false` (blocked) or `null` (not tested, see `note`).
- A normal table has 6 items. A table with no owner column has 1 item (`anon` SELECT). A table whose canary row could not be planted has 0 items.
- A blocked UPDATE or DELETE can show `httpStatus` 200 with `rowsReturned` 0. The frontend must not present that as a failure.
- If the second test user and the visitor got nothing but the owner is blocked too, the verdict is `INCONCLUSIVE`. The frontend must show the finding's own explanation.
- Owner INSERT can be `null` with a note. The frontend should show "Not tested" and the note.

## 1.4 Error handling

**R17.** Every error has the shape `{ "error": { "code": "...", "message": "..." } }`. The frontend must show `error.message` as given. For an unknown code it must still show `error.message`.

**R18.** `400 INVALID_INPUT`: show `error.message` next to the form. All form values stay, including the keys (in memory only, R26). The user corrects the input and sends again.

**R19.** `401 ACCESS_DENIED`: the frontend must clear the stored access code, show "Access denied." and return the user to the access code field.

**R20.** `404 NOT_FOUND`: the status is 404. For an unknown audit id the message is "No audit with this id was found." For an unknown address the message is "Nothing was found at this address." The access code is checked first. A wrong code on an unknown id gives 401, not 404.

**R21.** `409 AUDIT_IN_PROGRESS`: show `error.message`. The user may try again later.

**R22.** `429 RATE_LIMITED`: this means 10 wrong access codes within 15 minutes from one client. The answer carries a `Retry-After` header in seconds. The frontend must disable the submit button until the `Retry-After` time has passed. While blocked, even the right code gets 429. The stored access code is not cleared by a 429.

**R23.** `400 PRODUCTION_REFUSED` is reserved. The backend does not send it yet. The frontend needs no special handling.

**R24.** If an audit has `status` `failed`, the frontend must show `error.message`. It must not show finding cards.

**R25.** If `cleanup` is `"failed"`, the frontend must show a clear warning with `cleanupNote`. The note says what to remove by hand, for example users in Supabase Auth with an email like `vca-*@example.com`. The warning must stay visible on the Progress and Report screens for that audit. It can appear with `completed` and with `failed`.

## 1.5 Keys and the access code

**R26.** The publishable key, the secret key and the access code must exist only in the memory of the running page. They must not be written to `localStorage`, `sessionStorage`, cookies, the URL, IndexedDB, logs or analytics. This also applies to mock mode.

**R27.** The user types the access code once. The code stays in the memory of the browser page for the session. A page refresh removes it. A `401` removes it (R19).

**R28.** The frontend must not show the keys or the access code after they have been typed, except as masked input while typing.

**R29.** When the backend answers `202` to the start call, the frontend must clear the publishable key and the secret key from its state. On `400`, `401`, `409`, `429` and on a network error the keys must stay in memory, so the user can send again. The backend never returns the keys. For another audit the user types them again.

## 1.6 Approve fix, Re-test and Certificate

**R30.** The UI must use only the `fix.status` values `proposed` and `approved`. It must not use `applied` or `rejected`. There is no Reject button.

**R31.** "Approve fix" records the decision. It does not change the user's database. The call is `POST /api/v1/audits/:id/findings/:findingId/fix/approve`. It answers `200` with the updated finding and `fix.status` `approved`.

**R32.** After approval the UI must tell the user to run the SQL in their own Supabase project, then press Re-test. The SQL must be copyable. The UI must not run or edit the SQL.

**R33.** "Re-test" runs the same checks again. The call is `POST /api/v1/audits/:id/retest`. It answers `202` with `{ "id": "aud_001", "status": "running" }`. The frontend must then poll as in R9. When the status is `completed` it must read the findings again (R12). Each finding then has `retest.status` `passed` or `failed` and `retest.lastRunAt`.

**R34.** There is no instant pass and no auto-fix. The UI must not claim a fix was applied. A finding that was `LEAKED` is shown as `BLOCKED` only when the re-test says so.

**R35.** `GET /api/v1/audits/:id/certificate` answers `200` only when no `LEAKED` finding remains and the re-test passed. Otherwise it answers `409 NOT_ELIGIBLE` with a message. The `200` body is:
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

**R36.** The certificate is a view inside the app. There must be no public link and no share address.

**R37.** The UI must have no part for Jira tickets or for an MCP server.

## 1.7 Wording

**R38.** The UI must say "no leak found by these checks". It must not use the phrase "certificate of security". It must not call a result "secure", "safe" or "certified".

**R39.** The disclaimer "This is evidence that specific checks passed. It is not a guarantee that the app is secure." must appear on the Report screen and on the Certificate screen.

**R40.** An empty findings list must show "No findings". It must not claim that the app is secure.

**R41.** The UI must not hide `INCONCLUSIVE` findings. They need a human decision. A public table such as `hotels` can be public on purpose.

**R42.** The default language is English. A toggle switches the explanation to Roman Urdu (`explanation.ur`). The toggle must be available on the Report screen.

## 1.8 Mock data

**R43.** The frontend should keep mock mode behind a single switch, so it can be removed when the real routes exist.

**R44.** The three routes marked "Not built yet" in R2 must use mock data. Mock responses must match the shapes in R31, R33 and R35.

**R45.** For findings, the mock is `docs/evidence/audit-http-run-1.json`. It is a real backend response with `profiles` BLOCKED, `bookings` BLOCKED and `hotels` INCONCLUSIVE, each with the full `operations` list. It has no `LEAKED` finding.

**R46.** For a `LEAKED` card, the mock may use the `bookings` finding in `docs/evidence/prover-run-2.json`. Its fix SQL is old: it has no INSERT policy. It will be replaced when a new `LEAKED` run is saved. The file `docs/evidence/prover-run-3-after-fix.json` shows the same table as BLOCKED after the fix.

---

# Part 2: Screen guidance

The four screens follow the contract: Connect, Progress, Report, Certificate. Approve fix and Re-test are actions on the Report screen. Layout and visual design are the developer's choice. This part describes behaviour only.

## 2.1 Screen: Connect

**Purpose.** Collect the test project's details and start an audit.

**Data.**
- Label (optional), project URL, publishable key, secret key, test-project checkbox, access code (R5, R6, R7).
- The access code goes in the `X-Access-Code` header, not in the body (R3).
- The access code field is shown when no code is held in memory (R27).

**Actions.**
- Start audit: `POST /api/v1/audits` (R5). On `202`, keep the `id`, clear the keys (R29) and go to Progress.

**States.**
- Idle: the form.
- Starting: the Start action is disabled while the call is open.
- `400`: R18. `401`: R19. `409`: R21. `429`: R22. Server unreachable: R4.

**Constraints.**
- Must not store or log any secret (R26).
- Must not send `confirmTestProject` without the tick (R6).
- Must not start a second audit while one is running (R8).

## 2.2 Screen: Progress

**Purpose.** Show how the running audit is going.

**Data.**
- `target.label` and `target.projectUrl`.
- Overall `status`.
- One row per item of `modules`: `name`, `status`, `progress` (R10, R11).
- `summary` counts when the audit is `completed`.
- `cleanup` and `cleanupNote` (R25).

**Actions.**
- Poll `GET /api/v1/audits/:id` every 2 seconds (R9).
- View report, when `completed`.
- Start a new audit, when `failed` or when the audit is gone.

**States.**
- Waiting: the first poll is not answered yet.
- Running or queued: progress follows the `progress` value.
- Completed: polling stops. Show the summary and the action to view the report.
- Failed: polling stops. Show `error.message` (R24).
- Cleanup failed: show the warning with `cleanupNote` (R25).
- `401`: R19. `404`: R13 and R20. `429`: R22. Server unreachable: R4. For a failed poll, Retry resumes polling.

**Constraints.**
- Must not poll more often than every 2 seconds.
- Must not hide `cleanupNote`.
- Must not invent a progress value.

## 2.3 Screen: Report

**Purpose.** Show the findings with evidence and the suggested fix. Let the user approve a fix and re-test.

**Data.**
- The findings, sorted as in R15, read after the status is `completed` (R12).
- Per finding: verdict, severity, table, title, explanation in the chosen language (R42), evidence, operations (R16), fix (R14), `retest`.
- The audit `summary`, and the cleanup warning (R25).

**Actions.**
- Switch language between English and Roman Urdu (R42).
- Expand or collapse the evidence and the fix.
- Copy the reproducer and the fix SQL.
- Approve fix, on a finding whose `fix.status` is `proposed` (R31).
- Re-test (R33).
- Open the certificate view (Screen 2.4).

**States.**
- Loading: the findings call is open.
- Empty: "No findings" (R40).
- Findings: the cards, `LEAKED` first (R15).
- Fix approved: `fix.status` is `approved` and the message of R32 is shown.
- Re-test running: `retest.status` is `running`. Buttons are disabled. Polling runs (R33).
- Re-test finished: each finding shows `passed` or `failed` and `lastRunAt`.
- No finding has a fix: Approve fix is hidden. Re-test is still allowed.
- Error: R17. `401`: R19. `429`: R22. Server unreachable: R4.

**Constraints.**
- Must not call a result secure (R38).
- Must not hide `INCONCLUSIVE` (R41).
- Must not run or edit the SQL (R32).
- Must not offer Reject (R30).
- Must show the disclaimer (R39).

## 2.4 Screen: Certificate

**Purpose.** Show the result of the checks when no leak remains.

**Data.**
- `auditId`, `issuedAt`, `result`, `checksRun`, `disclaimer`, `recordHash` (R35).
- `result` `NO_LEAK_FOUND_BY_THESE_CHECKS` is shown as "No leak found by these checks".

**Actions.**
- Back to the Report screen.

**States.**
- Loading: the call is open.
- Available: the `200` body is shown.
- Not eligible: `409 NOT_ELIGIBLE`. Show `error.message`.
- Error: R17. `401`: R19. `429`: R22. Server unreachable: R4.

**Constraints.**
- Must be a view inside the app, with no public link (R36).
- Must show the disclaimer (R39).
- Must not use the phrase "certificate of security" (R38).

---

# Acceptance checklist

1. The server address comes from `NEXT_PUBLIC_API_BASE_URL` and defaults to `http://localhost:4000` (R1).
2. Every `/api/v1/audits...` request, including polls, carries `X-Access-Code`, and the code is not in any URL or body (R3).
3. No key or access code is present in `localStorage`, `sessionStorage` or cookies (check in DevTools > Application), in mock mode too (R26).
4. The publishable key and the secret key are cleared after a `202`, and they stay in memory after a `400`, `401`, `409`, `429` or network error (R29).
5. A page refresh asks for the access code again, and a `401` returns the user to the access code field (R19, R27).
6. The Start action is disabled until the test-project box is ticked, and the body sends the boolean `true` (R6).
7. Progress polls every 2 seconds and stops at `completed` or `failed` (R9).
8. A `429` disables the submit button until `Retry-After` ends (R22).
9. `cleanupNote` is visible on Progress and Report when `cleanup` is `"failed"` (R25).
10. An unreachable server shows "Cannot reach the server. Check your connection and try again.", a Retry button, and form values (keys and access code included, in memory only) that are kept (R4).
11. Findings appear in the order `LEAKED`, `INCONCLUSIVE`, `BLOCKED`, then severity, then table name (R15).
12. The Report screen shows English by default, switches to Roman Urdu, shows the disclaimer, and has no Reject button (R30, R39, R42).
