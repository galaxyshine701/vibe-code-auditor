# Frontend specification: Vibe Code Auditor (v0.5.4)

Derived from: `docs/api-contract.md`, `docs/prover-spec.md`, `docs/roadmap.md` and `docs/evidence/*.json`. Where this document adds a rule or a decision, the rule is part of this specification.

If this document and `docs/api-contract.md` differ on a field name or value, the contract wins and this document is corrected.

## Change log

| Version | Date | Change |
|---|---|---|
| v0.5.4 | 14 Nov 2026 | `retest.status` `passed` is kept by later Re-tests (R10, R53). |
| v0.5.3 | 14 Nov 2026 | Disclaimer sentence changed (R35, R39). Coverage section on the Report screen (R61). |
| v0.5.2 | 13 Nov 2026 | Approve fix, Re-test and Certificate are built (R2). Re-test sends the keys again and never `projectUrl` (R33). New fields `lastRetest` and `retest.previousVerdict`, and the fix status after a Re-test (R10, R14). Errors `NO_FIX_TO_APPROVE`, `NOT_ELIGIBLE` and Re-test `INVALID_INPUT` (R47 to R49). Re-test running, failed Re-test, added and removed tables, previous verdict (R50 to R53). Certificate rule and body changed (R35). Mock rules changed (R43 to R46). Design requirements (R54 to R60). |
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
| `POST /api/v1/audits/:id/findings/:findingId/fix/approve` | Built |
| `POST /api/v1/audits/:id/retest` | Built |
| `GET /api/v1/audits/:id/certificate` | Built |

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

**R9.** The frontend must poll `GET /api/v1/audits/:id` every 2 seconds while `status` is `queued` or `running`. It must stop when `status` is `completed` or `failed`. The same rule applies after a Re-test has been accepted (R33).

**R10.** The status response has this shape:
```json
{
  "id": "aud_001",
  "status": "running",
  "createdAt": "2026-11-12T10:00:00Z",
  "target": { "label": "Hotel booking (test project)", "projectUrl": "https://example-project.supabase.co" },
  "summary": { "leaked": 1, "blocked": 1, "inconclusive": 1 },
  "modules": [ { "id": "data-access-prover", "name": "Data Access Prover", "status": "running", "progress": 60 } ],
  "cleanup": null,
  "lastRetest": null
}
```
- `status` is `queued`, `running`, `completed` or `failed`. While a Re-test runs, `status` is `running`. When the Re-test ends, `status` is `completed` again, also when the Re-test failed.
- `cleanup` is `null` while the first audit runs, then `"ok"` or `"failed"`. While a Re-test runs it keeps the value of the run before and changes when that run ends. It describes the most recent run.
- `cleanupNote` is present only when `cleanup` is `"failed"`.
- `error` is present only when `status` is `failed`. It is `{ "code": "...", "message": "..." }`. It never contains a key. A failed Re-test does not set `error`.
- For a failed audit, `summary` is all zeros and the module `status` is `failed`.
- `lastRetest` is `null` until a Re-test has been started. Otherwise it is `{ "status": "running" | "completed" | "failed", "startedAt": "...", "finishedAt": "..." | null, "tablesAdded": [], "tablesRemoved": [], "error": null | { "code": "...", "message": "..." } }`.
- `lastRetest.finishedAt` is `null` while the Re-test runs. `lastRetest.error` is set only when `lastRetest.status` is `failed`. `tablesAdded` and `tablesRemoved` are empty arrays while it runs and when it failed.
- While a Re-test runs, `summary` counts the findings of the run before.

**R11.** The frontend must show the modules that the backend returns. It must not add modules of its own.

**R12.** `GET /api/v1/audits/:id/findings` does not check the audit status. It answers `200` with `{ "findings": [] }` while the audit is running and when the audit has failed. It answers `404 NOT_FOUND` only for an unknown id. While a Re-test runs, it answers with the findings of the run before, each with `retest.status` `running`. The frontend must read the findings only after the status is `completed`, except that it keeps showing the findings it already has during a Re-test (R50).

**R13.** Audits are kept in the backend's memory. After a server restart every audit is gone. The backend keeps the newest 50 audits. A request for a gone audit gives `404 NOT_FOUND`. The frontend must treat that answer as "this audit no longer exists" and offer to start a new audit. The same applies to the approve, retest and certificate routes.

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
  "retest": { "status": "not_run", "lastRunAt": null, "previousVerdict": null }
}
```
- `verdict` is `LEAKED` (red), `BLOCKED` (green) or `INCONCLUSIVE` (grey).
- `severity` is `critical`, `high`, `medium`, `low` or `info`.
- `explanation.en` is English. `explanation.ur` is Roman Urdu.
- `reproducer` holds placeholders (`<PROJECT_URL>`, `<ANON_KEY>`, `<USER_B_JWT>`), never real values. It is `null` when there is nothing to reproduce.
- `fix` is `null` when there is nothing to fix. A finding whose verdict is `BLOCKED` or `INCONCLUSIVE` has `fix` `null`. The frontend must not show an empty fix section.
- `fix.status` is `proposed` or `approved` (R30).
- `retest.status` is `not_run`, `running`, `passed` or `failed`. `running`: a Re-test is going on. `failed`: the verdict is now `LEAKED`. `passed`: the verdict was `LEAKED` and is not now; it stays `passed` in later Re-tests until the verdict is `LEAKED` again. `not_run`: every other case.
- `retest.lastRunAt` is the time the last successful Re-test of this table finished, or `null`.
- `retest.previousVerdict` is `LEAKED`, `BLOCKED`, `INCONCLUSIVE` or `null`. It is the verdict of the same table in the run before; while `retest.status` is `passed` it stays `LEAKED`. It is `null` for the first audit and for a table that is new.
- After a Re-test, a table that was in both runs keeps the same finding `id`. The frontend must match findings by `id`.
- After a Re-test, a finding that is still `LEAKED` has the fix proposed now. If the SQL is the same as before, `fix.status` stays as it was. If the SQL is different, `fix.status` is `proposed` again. The frontend must show the status it receives and must not keep an earlier "approved" for changed SQL.
- After a Re-test, a finding that is now `BLOCKED` or `INCONCLUSIVE` has `fix` `null` and no approval.

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

**R21.** `409 AUDIT_IN_PROGRESS`: show `error.message`. The user may try again later. The same code is sent by Approve fix and Re-test while an audit or a Re-test is running.

**R22.** `429 RATE_LIMITED`: this means 10 wrong access codes within 15 minutes from one client. The answer carries a `Retry-After` header in seconds. The frontend must disable the submit button until the `Retry-After` time has passed. While blocked, even the right code gets 429. The stored access code is not cleared by a 429.

**R23.** `400 PRODUCTION_REFUSED` is reserved. The backend does not send it yet. The frontend needs no special handling.

**R24.** If an audit has `status` `failed`, the frontend must show `error.message`. It must not show finding cards. A failed Re-test is not a failed audit (R51).

**R25.** If `cleanup` is `"failed"`, the frontend must show a clear warning with `cleanupNote`. The note says what to remove by hand, for example users in Supabase Auth with an email like `vca-*@example.com`. The warning must stay visible on the Progress and Report screens for that audit. It can appear with `completed` and with `failed`. It also applies after a Re-test: `cleanup` then describes the most recent run.

**R47.** `409 NO_FIX_TO_APPROVE`: sent when Approve fix is called for a finding whose `fix` is `null`. Show `error.message`. The Approve fix action must not be shown for such a finding (R31).

**R48.** `409 NOT_ELIGIBLE`: sent by Re-test when the audit has `status` `failed`, and by the certificate route when a condition of R35 is not met. Show `error.message`.

**R49.** `400 INVALID_INPUT` from Re-test: show `error.message` next to the key fields. The keys stay in memory (R29).

## 1.5 Keys and the access code

**R26.** The publishable key, the secret key and the access code must exist only in the memory of the running page. They must not be written to `localStorage`, `sessionStorage`, cookies, the URL, IndexedDB, logs or analytics. This also applies to mock mode.

**R27.** The user types the access code once. The code stays in the memory of the browser page for the session. A page refresh removes it. A `401` removes it (R19).

**R28.** The frontend must not show the keys or the access code after they have been typed, except as masked input while typing.

**R29.** When the backend answers `202` to the start call or to a Re-test call, the frontend must clear the publishable key and the secret key from its state. On `400`, `401`, `409`, `429` and on a network error the keys must stay in memory, so the user can send again. The backend never returns the keys. For another audit or another Re-test the user types them again.

## 1.6 Approve fix, Re-test and Certificate

**R30.** The UI must use only the `fix.status` values `proposed` and `approved`. It must not use `applied` or `rejected`. There is no Reject button.

**R31.** "Approve fix" records the decision. It does not change the user's database. The call is `POST /api/v1/audits/:id/findings/:findingId/fix/approve`, with no body. It answers `200` with the updated finding and `fix.status` `approved`.
- Approving a fix that is already `approved` also answers `200`.
- The action must be shown only on a finding whose `fix.status` is `proposed`. It must be disabled while the audit `status` is `running`.
- The user may approve before or after running the SQL.
- Errors: `404 NOT_FOUND` for an unknown audit or finding (R13, R20), `409 AUDIT_IN_PROGRESS` (R21), `409 NO_FIX_TO_APPROVE` (R47).

**R32.** After approval the UI must tell the user to run the SQL in their own Supabase project, then press Re-test. The SQL must be copyable. The UI must not run or edit the SQL.

**R33.** "Re-test" runs the same checks again on the same audit. The call is `POST /api/v1/audits/:id/retest`. The body is:
```json
{
  "anonKey": "<publishable key>",
  "serviceKey": "<secret key>",
  "confirmTestProject": true
}
```
- The user must type both keys again for every Re-test, as masked input (R26, R28), and tick the test-project box (R6). The frontend must not send `true` without the tick.
- The body must not contain `projectUrl`. The backend answers `400 INVALID_INPUT` if it does.
- The action is available only when the audit `status` is `completed`.
- It answers `202` with `{ "id": "aud_001", "status": "running" }`. The frontend must then clear the keys (R29) and poll as in R9.
- When the status is `completed` again, it must read the status (for `lastRetest`) and then the findings (R12).
- Errors: `400 INVALID_INPUT` (R49), `404 NOT_FOUND` (R13), `409 AUDIT_IN_PROGRESS` (R21), `409 NOT_ELIGIBLE` (R48).

**R34.** There is no instant pass and no auto-fix. The UI must not claim a fix was applied. A finding is shown as `BLOCKED` only when the findings returned by the backend say so. `passed` is shown only when `retest.status` is `passed`.

**R35.** `GET /api/v1/audits/:id/certificate` answers `200` only when all of these are true: the audit `status` is `completed`, `summary.leaked` is 0, `summary.blocked` is at least 1, and `cleanup` is not `"failed"`. Otherwise it answers `409 NOT_ELIGIBLE` with a message. The `200` body is:
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
- `summary` counts the findings of the run that made the audit eligible.
- `issuedAt` is the time the latest completed run finished. It stays the same between requests until a new Re-test finishes.
- The UI must label `recordHash` "integrity fingerprint, not a signature".
- The action that opens the certificate view must be shown only when the conditions above hold in the data the frontend has. If the call still answers `409`, show `error.message`.

**R36.** The certificate is a view inside the app. There must be no public link and no share address.

**R37.** The UI must have no part for Jira tickets or for an MCP server.

**R50.** While a Re-test runs (`lastRetest.status` is `running`), the Report screen must keep showing the findings it had before the Re-test. Each finding must show `retest.status` `running`. Approve fix and Re-test must be disabled. The new findings replace the old ones in one step, when the status is `completed`.

**R51.** If the status is `completed` and `lastRetest.status` is `failed`, the frontend must show `lastRetest.error.message`, keep the findings from before the Re-test unchanged, and allow Re-test again (R33). It must not show the audit as failed (R24).

**R52.** If `lastRetest.tablesAdded` is not empty, the frontend must show the table names. If `lastRetest.tablesRemoved` is not empty, it must show the table names with the text "This table was not checked in the last re-test."

**R53.** If `retest.previousVerdict` is not `null` and differs from `verdict`, the finding must show both, for example "was LEAKED, now BLOCKED". If `previousVerdict` is `null` or missing, it shows nothing. After a second Re-test a fixed finding still shows `passed` and "was LEAKED, now BLOCKED".

## 1.7 Wording

**R38.** The UI must say "no leak found by these checks". It must not use the phrase "certificate of security". It must not call a result "secure", "safe" or "certified".

**R39.** The sentence "This result covers table data access only: read, update and delete as another signed-in user, and read as a visitor." must appear on the Report screen and on the Certificate screen.

**R40.** An empty findings list must show "No findings". It must not claim that the app is secure.

**R41.** The UI must not hide `INCONCLUSIVE` findings. They need a human decision. A public table such as `hotels` can be public on purpose.

**R42.** The default language is English. A toggle switches the explanation to Roman Urdu (`explanation.ur`). The toggle must be available on the Report screen.

## 1.8 Mock data

**R43.** The frontend should keep mock mode behind a single switch. The switch must be off by default.

**R44.** With the switch off, all six audit routes in R2 (not `/health`) use the real backend. With it on, mock responses must match the shapes in R10, R14, R31, R33 and R35.

**R45.** For findings, the mock may use `docs/evidence/audit-http-run-1.json`. It is a real backend response with `profiles` BLOCKED, `bookings` BLOCKED and `hotels` INCONCLUSIVE, each with the full `operations` list. It has no `LEAKED` finding.

**R46.** For a `LEAKED` card and for the state after a fix, the mock may use `docs/evidence/audit-http-run-3-leaked.json` and `docs/evidence/audit-http-run-4-after-fix.json`. The files in `docs/evidence` have no `lastRetest` and no `retest.previousVerdict`. The frontend must treat a missing `lastRetest` or `previousVerdict` as `null`.

## 1.9 Design

**R54.** All four screens must be usable at widths of 375, 768 and 1280 px.

**R55.** The app must have a light and a dark theme. The theme follows the system setting by default. A manual toggle must be available on all four screens.

**R56.** A verdict must be shown as text plus an icon. Colour alone must never carry the verdict.

**R57.** Icons must be SVG. Emoji must not be used as icons.

**R58.** The user-facing names are "Publishable key" and "Secret key". The API field names `anonKey` and `serviceKey` stay as in the contract (R5) and must not be shown as labels.

**R59.** The app must be an installable PWA, with a web app manifest and a service worker. The service worker must not cache any API response, and must not cache any request that carries the access code.

**R60.** `frontend/README.md` must contain a short "Design notes" section and screenshots of the four screens in both themes (eight screenshots).

**R61.** The Report screen must show a coverage section. It lists what is checked, what is not covered and the limits, as written in `frontend/src/lib/coverage.ts`. It states that tables where no owner column can be detected are reported as inconclusive.

---

# Part 2: Screen guidance

The four screens follow the contract: Connect, Progress, Report, Certificate. Approve fix and Re-test are actions on the Report screen. Layout and visual design are the developer's choice. This part describes behaviour only.

## 2.1 Screen: Connect

**Purpose.** Collect the test project's details and start an audit.

**Data.**
- Label (optional), project URL, "Publishable key", "Secret key" (R58), test-project checkbox, access code (R5, R6, R7).
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
- Per finding: verdict (text plus icon, R56), severity, table, title, explanation in the chosen language (R42), evidence, operations (R16), fix (R14), `retest` with `previousVerdict` (R53).
- The audit `summary`, and the cleanup warning (R25).
- `lastRetest`, with `tablesAdded` and `tablesRemoved` (R52).

**Actions.**
- Switch language between English and Roman Urdu (R42).
- Expand or collapse the evidence and the fix.
- Copy the reproducer and the fix SQL.
- Approve fix, on a finding whose `fix.status` is `proposed` (R31).
- Re-test: the user types both keys again and ticks the test-project box (R33).
- Open the certificate view (Screen 2.4), when the conditions of R35 hold.

**States.**
- Loading: the findings call is open.
- Empty: "No findings" (R40).
- Findings: the cards, `LEAKED` first (R15).
- Fix approved: `fix.status` is `approved` and the message of R32 is shown.
- Re-test running: `lastRetest.status` is `running` and each finding shows `retest.status` `running`. The old findings stay. Buttons are disabled. Polling runs (R33, R50).
- Re-test finished: each finding shows `retest.status`, `retest.lastRunAt` and, when it differs, the previous verdict (R53). Added and removed tables are shown (R52).
- Re-test failed: `lastRetest.error.message` is shown, the findings from before stay, and Re-test is allowed again (R51).
- No finding has a fix: Approve fix is hidden. Re-test is still allowed.
- Error: R17. `401`: R19. `429`: R22. Server unreachable: R4.

**Constraints.**
- Must not call a result secure (R38).
- Must not hide `INCONCLUSIVE` (R41).
- Must not run or edit the SQL (R32).
- Must not offer Reject (R30).
- Must show the disclaimer (R39).
- Must not send `projectUrl` in the Re-test body (R33).

## 2.4 Screen: Certificate

**Purpose.** Show the result of the checks when no leak remains.

**Data.**
- `auditId`, `issuedAt`, `result`, `checksRun`, `summary`, `disclaimer`, `recordHash` (R35).
- `recordHash` is labelled "integrity fingerprint, not a signature".
- `result` `NO_LEAK_FOUND_BY_THESE_CHECKS` is shown as "No leak found by these checks".

**Actions.**
- Back to the Report screen.

**States.**
- Loading: the call is open.
- Available: the `200` body is shown.
- Not eligible: `409 NOT_ELIGIBLE` (R35, R48). Show `error.message`.
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
4. The publishable key and the secret key are cleared after a `202` from the start call or from a Re-test call, and they stay in memory after a `400`, `401`, `409`, `429` or network error (R29).
5. A page refresh asks for the access code again, and a `401` returns the user to the access code field (R19, R27).
6. The Start action is disabled until the test-project box is ticked, and the body sends the boolean `true` (R6).
7. Progress polls every 2 seconds and stops at `completed` or `failed` (R9).
8. A `429` disables the submit button until `Retry-After` ends (R22).
9. `cleanupNote` is visible on Progress and Report when `cleanup` is `"failed"` (R25).
10. An unreachable server shows "Cannot reach the server. Check your connection and try again.", a Retry button, and form values (keys and access code included, in memory only) that are kept (R4).
11. Findings appear in the order `LEAKED`, `INCONCLUSIVE`, `BLOCKED`, then severity, then table name (R15).
12. The Report screen shows English by default, switches to Roman Urdu, shows the disclaimer, and has no Reject button (R30, R39, R42).
13. The Re-test body has `anonKey`, `serviceKey` and `confirmTestProject: true` and no `projectUrl`. The keys are asked for again on every Re-test (R33).
14. During a Re-test the old findings stay, each shows `retest.status` `running`, and Approve fix and Re-test are disabled (R50).
15. A failed Re-test shows `lastRetest.error.message`, keeps the old findings, does not show the audit as failed, and allows Re-test again (R51).
16. Added and removed tables are shown, and a finding shows its previous verdict when it differs (R52, R53).
17. Approve fix is shown only for a `proposed` fix. A second approval is not an error. `409 NO_FIX_TO_APPROVE` shows its message (R31, R47).
18. The certificate action appears only when `summary.leaked` is 0, `summary.blocked` is at least 1 and `cleanup` is not `"failed"`. A `409 NOT_ELIGIBLE` shows `error.message`. `recordHash` is labelled "integrity fingerprint, not a signature" (R35).
19. The mock switch is off by default. With it off, all six audit routes in R2 (not `/health`) use the backend (R43, R44).
20. All four screens are usable at 375, 768 and 1280 px (R54).
21. The theme follows the system setting, and the manual toggle on every screen overrides it (R55).
22. Every verdict shows text plus an SVG icon. No emoji is used as an icon (R56, R57).
23. The key fields are labelled "Publishable key" and "Secret key". `anonKey` and `serviceKey` appear nowhere in the UI (R58).
24. The app has a manifest and a service worker and can be installed. In DevTools > Application > Cache Storage there is no API response and no request that carried the access code (R59).
25. `frontend/README.md` has a "Design notes" section and eight screenshots: four screens in light and dark (R60).
26. The Report screen has a coverage section with the lists Checked, Not covered and Limits (R61). The sentence in R39 is shown on the Report and Certificate screens.
