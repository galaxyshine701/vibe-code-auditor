# Frontend specification: [Project name] (v0.7.0)

Derived from: `docs/api-contract.md`, `docs/prover-spec.md`, `docs/roadmap.md` and `docs/evidence/*.json`. Where this document adds a rule or a decision, the rule is part of this specification.

If this document and `docs/api-contract.md` differ on a field name or value, the contract wins and this document is corrected.

## Change log

| Version | Date | Change |
|---|---|---|
| v0.7.0 | 18 Nov 2026 | Additive, plus two corrections: R13 now says audits are kept in the audit store (not memory), and the Certificate screen is labelled "Re-test result" with check labels written by the UI from the check id (R87). Agent pipeline (`LOCK_C_AGENTS=on`): audit of a website with or without Supabase, dynamic module rows (`skipped`, `reason`, `TIMEOUT`), stage fields (`gate`, `plan`, `coverage`), evidence of site checks (`kind`), and the routes `GET /audits/:id/evidence`, `/roadmap` and `/client-report` (R71 to R88, Part 3). Mock bundles in `docs/frontend-mock/`. Nothing of R1 to R70 is changed. |
| v0.6.2 | 15 Nov 2026 | Intro of the home page is now its own logo scene on the whole screen, rendered in the layout so that it is fixed to the screen (R70). |
| v0.6.1 | 15 Nov 2026 | Intro of the home page: the example run on the whole screen, once per tab, with Visitor, a lock and one verdict per chip (R70). |
| v0.6.0 | 15 Nov 2026 | "Fix confirmed" seal, Before -> After strip and certificate lock with an unlock animation (R66 to R69). |
| v0.5.9 | 15 Nov 2026 | Minimal PWA: manifest, own icons, a service worker that only shows an offline page and caches nothing else (R59). |
| v0.5.8 | 15 Nov 2026 | Dark is the default theme, not the system setting; the choice is kept in the browser (R55). Contrast of both themes checked: text 4.5:1, control edges 3:1. |
| v0.5.7 | 15 Nov 2026 | Badges: First audit completed, First leak fixed (verified by Re-test), Zero leaks reached; kept in this browser; one animation (R64, R65). |
| v0.5.6 | 15 Nov 2026 | Fix progress on the Report screen: "N of M findings verified fixed" (R63). |
| v0.5.5 | 14 Nov 2026 | Report agent (optional AI text): `finding.explanationSource`, `modules[].message`, the `report-agent` module and the Groq privacy line (R62). `recordHash` no longer covers the explanation text. |
| v0.5.4 | 14 Nov 2026 | `retest.status` `passed` is kept by later Re-tests (R10, R53). |
| v0.5.3 | 14 Nov 2026 | Disclaimer sentence changed (R35, R39). Coverage section on the Report screen (R61). |
| v0.5.2 | 13 Nov 2026 | Approve fix, Re-test and Certificate are built (R2). Re-test sends the keys again and never `projectUrl` (R33). New fields `lastRetest` and `retest.previousVerdict`, and the fix status after a Re-test (R10, R14). Errors `NO_FIX_TO_APPROVE`, `NOT_ELIGIBLE` and Re-test `INVALID_INPUT` (R47 to R49). Re-test running, failed Re-test, added and removed tables, previous verdict (R50 to R53). Certificate rule and body changed (R35). Mock rules changed (R43 to R46). Design requirements (R54 to R60). |
| v0.5.1 | 11 Nov 2026 | Keys are cleared only after a successful `202`. On `400`, `401`, `409`, `429` and network errors they stay in memory (R4, R18, R29, checklist 4 and 10). Priority rule over chat messages added. Re-test example in the contract changed to `running`. |
| v0.5 | 11 Nov 2026 | Rewritten as a numbered specification. Four screens as in the contract. Decisions added for access code, offline handling, base address, ordering, language, fix status, certificate and re-test. Backend behaviour for unknown ids, failed audits, `label` and restarts stated from the code. |

## How to read this document

- **must / must not** are binding. **should** is strong advice.
- Part 1 is binding. It does not change with the design.
- Part 2 describes behaviour per screen. Layout, colour and visual design are the developer's choice.
- Requirements are numbered R1, R2, and so on. R71 to R88 (Part 3) are the additions of v0.7.0 and apply when the backend runs with `LOCK_C_AGENTS=on`; with the flag off the backend answers as before and R1 to R70 are all there is.
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
| `GET /api/v1/audits/:id/evidence` | Built (v0.7.0; `404` for an audit without stage fields) |
| `GET /api/v1/audits/:id/roadmap` | Built (v0.7.0; only with `LOCK_C_AGENTS=on`) |
| `GET /api/v1/audits/:id/client-report` | Built (v0.7.0; only with `LOCK_C_AGENTS=on`) |

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

**R13.** Audits are kept in the audit store (a table in the platform's own database), not in memory. A server restart does not remove them. The backend keeps the newest 50 audits (v0.7.0: corrected, see R85). A request for an unknown audit, or one that is no longer among the newest 50, gives `404 NOT_FOUND`. The frontend must treat that answer as "this audit no longer exists" and offer to start a new audit. The same applies to the approve, retest and certificate routes.

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

**R55.** The app has a dark and a light theme. The first visit opens in the dark theme; the system setting is not used. A manual toggle is available on all four screens, and its choice is kept in the browser (`localStorage`, key `vca-theme`). A small script in the page head sets the theme before the first paint, so there is no flash. The query `?theme=light` or `?theme=dark` overrides it for one visit (used for screenshots) and is not stored. In both themes text has a contrast of at least 4.5:1, and the edges of inputs, buttons and toggles at least 3:1, against what is behind them (decorative card borders are not counted). The browser bar colour follows the theme.

**R56.** A verdict must be shown as text plus an icon. Colour alone must never carry the verdict.

**R57.** Icons must be SVG. Emoji must not be used as icons.

**R58.** The user-facing names are "Publishable key" and "Secret key". The API field names `anonKey` and `serviceKey` stay as in the contract (R5) and must not be shown as labels.

**R59.** The app is an installable PWA, kept as small as possible.
- Manifest (`src/app/manifest.ts`): `name`, `short_name`, `start_url` "/", `display` `standalone`, `background_color` and `theme_color` `#0f1114` (the dark page colour, R55), icons of 192 and 512 pixels, normal and maskable. The icons are our own drawing (a canary-yellow dot with two rings on the dark colour), made by `frontend/scripts/make-icons.mjs`.
- Service worker (`public/sw.js`): it only shows `/offline.html` when a page cannot be loaded because the network is gone. It answers a request only when it is a page navigation (GET) of this site and not under `/api`. It never stores a response of the network, never touches the API, a script, a style, another address, or any request with an access code or a key, and does not precache the app's JS or CSS (an old deploy cannot be served from it). The only thing it stores is `/offline.html`, in a cache with a versioned name (`vca-offline-v1`).
- Redeploy: `sw.js` is served with `Cache-Control: no-cache, no-store, must-revalidate` and registered with `updateViaCache: 'none'`, so the browser checks it on every visit. A changed file installs a new worker, which takes over at once (`skipWaiting`, `clients.claim`) and deletes every older `vca-offline-*` cache. Change the cache name (v1 -> v2) whenever `offline.html` changes. To remove the worker for good, deploy a `sw.js` that calls `self.registration.unregister()`.
- The worker is registered only in a production build.
- The tests run in the backend for now (`backend/test/frontend/pwa.spec.ts`).

**R60.** `frontend/README.md` must contain a short "Design notes" section and screenshots of the four screens in both themes (eight screenshots).

**R61.** The Report screen must show a coverage section. It lists what is checked, what is not covered and the limits, as written in `frontend/src/lib/coverage.ts`. It states that tables where no owner column can be detected are reported as inconclusive.

**R62.** Report agent (optional, additive fields). (a) If a module has a `message`, the Progress screen shows it as one line under that module's row. The frontend does not add modules (R11): the `report-agent` row is shown only when the backend returns it. (b) If a finding has `explanationSource` `"ai"`, the Report screen shows the small label "Written by AI" under the English explanation. Missing means `"template"` and no label. The Roman Urdu text is always the template text. (c) The Connect screen always shows this line under the description of the form: "Table names and check results (never keys) are sent to Groq to write the explanation." The frontend cannot know whether the Report agent is on, so the line is always shown.

**R63.** Fix progress (Report screen). When at least one finding was LEAKED, the summary card shows "N of M findings verified fixed by a Re-test", with a bar. It is a count, not a score: no percentage, no grade, no ranking.
- N counts findings with `verdict` `BLOCKED`, `retest.status` `passed` and `retest.previousVerdict` `LEAKED`. `passed` alone is not enough: the backend also gives `passed` to a finding that went from LEAKED to INCONCLUSIVE, and that is not a fix.
- M counts findings that were LEAKED: `verdict` `LEAKED`, or `passed` with `previousVerdict` `LEAKED` (fixed, or INCONCLUSIVE now).
- A finding that went from LEAKED to INCONCLUSIVE is in M, not in N. The screen says how many tables are INCONCLUSIVE after the Re-test and not counted as fixed.
- When M is 0 nothing is shown (no "100%").
- The numbers come from the real findings, not from the copies shown as `running` during a Re-test. While a Re-test runs, the last numbers stay and a line says so.
- A failed Re-test changes nothing here (R51). If a Re-test makes a finding LEAKED again, N goes down.
- Nothing is stored: the numbers are worked out from the findings each time.
- The tests for fix progress run in the backend for now (`backend/test/frontend/progress.spec.ts`). Add vitest to the frontend when its `package-lock.json` can be generated on Linux.

**R64.** Badges (Report and Progress screens). Three badges, earned only from real results, kept in this browser (`localStorage`, key `vca-badges-v1`) and nowhere else:
- First audit completed: the audit is `completed`.
- First leak fixed (verified by Re-test): a Re-test finished and at least one finding is verified fixed (R63). A finding that became INCONCLUSIVE is not a fix.
- Zero leaks reached (certificate eligible): `summary.leaked` is 0, `summary.blocked` is at least 1 and `cleanup` is not `failed` (the rule of R35). It is always shown with the sentence of R39. When `summary.inconclusive` is above 0, the badge also says "N tables could not be verified."
- Nothing is earned while a Re-test runs, and nothing is earned from a failed Re-test (R51).
- Every earned badge shows "Earned <date>". A badge that is not earned yet shows how to earn it.
- What is stored: for each badge the date it was earned and one flag. No key, address, access code, name of a table or id of an audit. Reading checks the shape and drops everything else. If the storage is blocked or full, the badges stay in memory for that page and nothing breaks. There is no sync between tabs.
- Badges are an encouragement, not proof: a person can edit the storage. They are not part of the certificate or its `recordHash`, and the screen says they are saved in this browser only. The words "secure", "safe" and "certified" are never used (R38).
- The Report screen shows all three. The Progress screen shows only a badge the user has just earned.
- No score, no ranking, no leaderboard.
- The tests run in the backend for now (`backend/test/frontend/badges.spec.ts`), like those of R63.

**R65.** Badge animation. A badge plays one short animation, once, and only when the user's own action produced it: the Progress screen saw the audit the user started change from queued or running to completed, or the Report screen saw the Re-test the user started finish. A badge that is earned only because a page was opened (for example after a refresh, or in another browser) appears without animation. After the animation it is stored as shown and never plays again. With `prefers-reduced-motion: reduce` there is no animation; the line "Badge earned: ..." (`role="status"`) tells the user instead. Colours come from the CSS variables of both themes; the text is always `--ink` or `--muted`.

**R66.** "Fix confirmed" seal (Report screen). A finding card shows the seal only when a Re-test moved that finding from LEAKED to BLOCKED, that is `isVerifiedFixed` (`verdict` BLOCKED, `retest.status` `passed`, `retest.previousVerdict` LEAKED). `retest.status` `passed` alone is not enough: the backend also gives `passed` to a finding that went from LEAKED to INCONCLUSIVE, and that finding gets no seal. The seal is a ring and a tick with a small canary dot: first the alarm (a red ring and the dot flaring), then calm (a green ring, the tick drawn, the dot at rest). It animates once (under 650 ms), only for a finding that became fixed through the user's own Re-test in this page session. A page that is opened or refreshed shows the calm seal at once. The words "Fix confirmed" and "Re-test: LEAKED, now BLOCKED" are always there, so colour is never the only message. While a Re-test runs the seal stays (it is worked out from the real findings, not the copies shown as "running").

**R67.** Before and after (Report screen, above the toolbar). After a Re-test whose `lastRetest.status` is `completed`, a strip shows Leaked, Inconclusive and Blocked as "before -> after", for example Leaked 1 -> 0, Blocked 1 -> 2. Before is `retest.previousVerdict` (or the verdict when there is none), after is `verdict`, both from the real findings (not `shownFindings`). Nothing is shown for a failed or a running Re-test, or when no Re-test was run. A table that the Re-test did not check (`tablesRemoved`) is not in the findings any more, so it is counted on neither side, and the strip says so. A table found for the first time in the Re-test (`tablesAdded`) has no before, so it is also left out on both sides, and the strip says so. It is a count, not a score. No animation.

**R68.** Certificate lock (Report screen). "Open certificate view" is always there once the audit is completed. It is locked (`aria-disabled`, still reachable by keyboard) until the rule that was already on the Report screen holds: audit completed, no Re-test running, no LEAKED finding, at least one BLOCKED, cleanup not failed (the same as the backend `certificateBlocker`). `certificateLock` in `frontend/src/lib/outcome.ts` is that rule in one place, and it gives the reason in a sentence written next to the button, never only in a tooltip: with leaks, "Fix the leaks and Re-test to unlock."; a running Re-test, no BLOCKED table and a failed cleanup each have their own sentence. When the user's own Re-test makes it eligible, the padlock opens with one short animation (under 650 ms). A page that is opened already eligible (a refresh) shows the open padlock without animation.

**R69.** Animation limits. Every animation in R65, R66 and R68 runs once and lasts under 800 ms (the longest, the badge, is 700 ms). With `prefers-reduced-motion: reduce` none of them runs and the final state is shown at once. They work in both themes and at 375 px. The tests read the CSS and fail if one lasts 800 ms or more or repeats.

**R70.** Intro of the home page. A short logo scene fills the whole screen once per browser tab, and only on `/`. (a) The scene: a dark background, the canary dot in the middle, a lock appears around it open with a soft red pulse (the alarm), the lock closes and turns green with a green pulse (calm), then the name "Vibe Code Auditor" below. It lasts 2.2 s, stays 0.4 s and fades out in 0.35 s: 3 s at most in all (`INTRO_*` in `frontend/src/lib/intro.ts`). It is all CSS animation, so it starts at the first paint and does not wait for the page's code. The example-run card of the hero is not used for the intro. (b) When: a script in the `<head>` decides before the first paint (`INTRO_BOOT_SCRIPT`): on `/`, without `prefers-reduced-motion: reduce`, and without the flag `vca-intro-v1` in `sessionStorage`, it sets the flag and `data-intro="pending"` on `<html>`. If `sessionStorage` cannot be used there is no intro (it would repeat on every load). With reduced motion there is no intro and no replay. A refresh in the same tab skips it. (c) The overlay is a layer of the whole screen: `position: fixed`, `inset: 0`, `height: 100dvh`, a `z-index` above the header and everything else, and the scroll of the page is locked while it runs. All its sizes are in `vmin` (the smaller of the width and the height of the screen), `dvh` and `rem`, never a fixed height in px, so nothing is cut at 1908x874, 1366x768 or 375x667, and the scene is in the middle of the screen. (d) The overlay is rendered directly in `<body>` by the layout (`IntroOverlay`), never inside a page. Reason: the page's wrapper `.page-stack` has the animation `rise`, which ends with `transform: translateY(0)` and `both`. A `position: fixed` child of an element with a transform is fixed to that element, not to the screen, and its `z-index` stays inside that element, below the header. An overlay inside a page was therefore as tall as the page, started below the header, showed the header, and put the card at the bottom. (e) Order: `data-intro="pending"` (the scene runs), `"leaving"` (the overlay fades), `"done"` (the overlay is gone). The headline of the page waits (its animation is paused) while the value is `pending` or `leaving`, and then runs word by word; the two never run together. After the intro the access code field is nudged once. (f) Skip: a Skip button (it has the focus), a tap or click anywhere, or Esc. Tab cannot leave the overlay while it runs. The overlay is a dialog. (g) The app is never blocked, in three ways: the head script arms a timer of 5 s; the page's code replaces it by one that ends the intro at its normal end, counted from when the scene started (not from when the code was ready), plus 1.5 s at most; and a CSS animation hides the overlay after 5 s with no script at all. (h) The hero shows the example-run card as its last frame on a wide screen only (closed lock, BLOCKED), with a Replay intro button; on a screen of 980 px or less the card is not shown and a Replay intro button stands under the access code. Replay intro, and a click on the brand on the home page, play the logo scene again. (i) The actor of the card is called "Visitor" everywhere. The intro uses no word that claims safety or a guarantee.

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
- One row per item of `modules`: `name`, `status`, `progress`, and `message` when present (R10, R11, R62).
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
- Per finding: verdict (text plus icon, R56), severity, table, title, explanation in the chosen language (R42) with the label "Written by AI" when `explanationSource` is `"ai"` (R62), evidence, operations (R16), fix (R14), `retest` with `previousVerdict` (R53).
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

# Part 3: Additions of v0.7.0 (agent pipeline)

Everything here is **additive**. The shapes below were taken from real runs of the backend and are in `docs/frontend-mock/` (section 3.5). The names and values of `docs/api-contract.md` win if they differ. Every text that is `{ "en", "ur" }` has both languages, and the English / Roman Urdu toggle (R42) applies to all of them (R82).

## 3.1 Rollout and reading the answers

**R71.** Rollout. The backend runs the new pipeline only with the environment variable `LOCK_C_AGENTS=on` (default off). Switching it on is **one coordinated step with the deploy of this UI**: first deploy the UI (it must work with the flag off, where it behaves as R1 to R70), then switch the flag on in Railway Variables, then check one audit of each kind (section 3.5). Switching it on before the UI is deployed shows the old UI module rows it does not know. The UI must never need the flag to be on, and must never assume it is.

**R72.** What the UI can rely on, and what it must tolerate.
- `schemaVersion` of `GET /audits/:id`: missing means `1` (no stage fields: no `plan`, `gate`, `ownership`; show the old screens only). `2` means the stage fields are there. `GET .../evidence`, `.../roadmap` and `.../client-report` have their own `schemaVersion` (2, 1 and 1). Treat a higher number as "show what you know, ignore the rest".
- A field the UI does not know must be ignored. A value it does not know (a module `status`, a roadmap `kind`, an evidence `kind`, an `error.code`) must be shown as plain text and must never crash the page.
- `404 NOT_FOUND` from `/evidence`, `/roadmap` or `/client-report` means "this audit has none" (it was run with the flag off, or before these features). Hide that section. It is not an error to show.
- All three are read **after** `status` is `completed` (or `failed`: a failed audit also has them, see R86). While a Re-test runs they keep the answer of the run before, like the findings (R50).

**R73.** The headline of a result must not be `summary.leaked` alone. `summary.leaked` counts tables only. For an audit with a website, `summary.siteLeaked` counts secret keys found in the scripts of the site (the key itself is never in any answer). A site with a secret key and zero leaking tables has `leaked` 0 and `siteLeaked` 1: it must not look clean. Use `clientReport.headline` (R80) when it exists. Otherwise: `leaked` + `siteLeaked` above 0 is a leak; both 0 is "no leak found by these checks" only when `gate.decision` is `ready_by_these_checks` (R77). `siteLeaked` is missing for an audit without a website: treat it as 0.

**R74.** Certificate and Re-test for an audit without Supabase details. A website-only audit has no tables. `POST /audits/:id/retest` and `GET /audits/:id/certificate` answer `409 NOT_ELIGIBLE` for it (R48). The UI should **hide** the Re-test and the certificate actions when `target.projectUrl` is missing, or show the reason from `error.message` next to a locked action (R68). "Approve fix" does not exist for it (no findings, R31). The rest of R35 is unchanged: a certificate needs a `BLOCKED` table.

## 3.2 Progress screen: module rows

**R75.** The rows of `modules` are **dynamic**. R11 stays: the UI shows the rows it receives and adds none. With `LOCK_C_AGENTS=on` the backend returns more rows, in this order: `data-access-prover`, `report-agent` (only when it is on), `planner`, `ownership`, `tls-headers` and `bundle-secrets` (only with a website), `evidence`, `roadmap`, `guide`. The UI must not hard-code the list or the order; show the rows in the order received.
- Row `status`: `queued` | `running` | `completed` | `failed` | `skipped`. The audit's own `status` never has `skipped` (R10).
- A `skipped` row has `reason` `{ "en", "ur" }` and no `message`. Show the `reason` in the chosen language under the row. A `failed` row has `message` (a plain sentence) and no `reason` (R62). A row has at most one of them.
- Skipped is **not** a failure: do not colour it as one. The `data-access-prover` row of a website-only audit is `skipped` with a "Not provided" reason; `ownership` is always `skipped` ("Ownership of the site is not checked yet.").
- `error.code` `TIMEOUT` (audit `status` `failed`): "The audit reached its time limit and was stopped." Show `error.message` (R24). A single step can also end alone with `message` "This step took too long and was stopped." The UI does not count time itself.
- `cleanup` can be `"failed"` after a `TIMEOUT` (the temporary test users may be left in the test project): the warning of R25 applies, with `cleanupNote`.
- A stopped run may still be finishing in the background for up to about 10 minutes. A new audit or Re-test of the SAME Supabase project then answers `409 AUDIT_IN_PROGRESS` with "An earlier audit of this project is still stopping. Wait a few minutes, then try again." Show it as given (R21); the user tries again later. Another project is not affected.
- Real example (website only), the first three rows of `audit.json`; the rest are `tls-headers`, `bundle-secrets`, `evidence`, `roadmap` and `guide`, all `completed`:
```json
[
  {
    "id": "data-access-prover",
    "name": "Data Access Prover",
    "status": "skipped",
    "progress": 0,
    "reason": {
      "en": "Not provided: no Supabase details were given, so \"Data access (can another user or a visitor reach a row?)\" was not checked.",
      "ur": "Diya nahi gaya: Supabase ki details nahi di gayin, isliye \"Data access (kya doosra user ya visitor kisi row tak pahunch sakta hai?)\" check nahi hua."
    }
  },
  {
    "id": "planner",
    "name": "Planner",
    "status": "completed",
    "progress": 100
  },
  {
    "id": "ownership",
    "name": "Ownership",
    "status": "skipped",
    "progress": 0,
    "reason": {
      "en": "Ownership of the site is not checked yet.",
      "ur": "Site ki malkiyat abhi check nahi hoti."
    }
  }
]
```
- Progress values come from the backend; do not compute your own.

## 3.3 Connect screen: website and Supabase

**R76.** The Connect form has **two optional groups**, and at least one must be complete.
1. **Website address** (optional): one field, sent as `websiteUrl`: a public `https` address (no login, no port, no IP address; only the front page is looked at, a path or a query is dropped by the backend). When it is filled, a checkbox "I may test this site" must be ticked, and the UI sends `confirmSiteAccess: true` (the boolean, as in R6). The start action stays disabled while the box is unticked.
2. **Supabase project** (optional, as a group): "Project URL", "Publishable key", "Secret key" (R58), **all three together**, plus the test-project checkbox (`confirmTestProject: true`, R6). Keys follow R26 to R29.
- The start action is disabled until at least one group is complete. A group that is half filled blocks start with a note naming the missing fields (the backend would answer `400`).
- Request bodies (the field names are fixed): website only `{ "label", "websiteUrl", "confirmSiteAccess": true }`; Supabase only as in R5; both: all the fields. `confirmTestProject` is not sent for a website-only request.
- `400 INVALID_INPUT` messages name the field only, never a value: a bad `websiteUrl`, `confirmSiteAccess` not `true`, a Supabase group with missing fields (the message lists them), `confirmTestProject` missing. Show `error.message` next to the form and keep every value (R18).
- With the flag off, `websiteUrl` and `confirmSiteAccess` are ignored and the Supabase group is required. If an audit comes back with no `websiteUrl` in `target` and no `plan`, the flag is off: show only what R1 to R70 show.
- After a `202` the keys are cleared (R29). A website address is not a secret and may stay in the form.
- The Connect screen still shows the Groq line of R62(c).

## 3.4 Report screen: gate, coverage, evidence, roadmap, client report

**R77.** Gate banner. `gate` (in `GET /audits/:id`) is `{ "decision": "ready_by_these_checks" | "not_ready", "reasons": [{ en, ur }] }`. Show it at the top of the Report screen, from the data only.
- `ready_by_these_checks`: the text "No leak found by these checks." (no reasons). It is never "secure", "safe" or "ready to launch" (R38).
- `not_ready`: the text "Not ready: see why" and the `reasons` list in the chosen language. Reasons can name checks that were not provided, skipped, partial or failed to run, a leak that is still there, and a failed cleanup.
- The words are always "by these checks". A missing `gate` (`schemaVersion` 1) shows no banner.

**R78.** Coverage. Extends R61. `GET /audits/:id/evidence` returns `coverage`. Show these buckets, each with its own heading, never merged:
- `checked`: ids of the checks that completed.
- `partial`: `{ id, reason, notRead: [{ name, reason }] }`. The check ran but could not read part of what it should. List every `notRead` name.
- `skipped`: `{ id, reason }`. A `reason` that starts with "Not provided" means the user did not give that input: show it as "Not provided", with the way to add it (R76). Any other reason is "Not implemented yet".
- `failedToRun`: `{ id, reason }`.
- `outOfScope`: `{ name, reason }`. Left out on purpose. It is **not** a failure and not partial (for example a script of another origin, or "TLS validity period and expiry").
- `nothingToTest`: reserved, always `[]` today. Show nothing for an empty list.
- `limits`: `{ en, ur }` sentences, always shown.
- Names of checks: the UI writes its own labels from the check `id` (R87). It must not show `plan[].title` or a `title` of the client report directly. An unknown id is shown as the id.
- A required check (`plan[].required`) that is not in `checked` is a reason for `not_ready`. Mark `required`.
- `limits` and the lists are shown as given: a limit of a check that was not provided can still be in `limits`; the buckets say what was actually checked.

**R79.** Evidence items. `items[]` of `GET /audits/:id/evidence`: `{ id, check, findingId, table, verdict, proof, summary: { en, ur }, kind?, subject? }`.
- `kind` is `"table"` (or **missing**, which means `table`), `"site-bundle"` or `"site-headers"`. For a `table` item `findingId` is an id from `GET .../findings` and `table` is a table name. For the other two kinds **`findingId` and `table` are `null`** (accept `null`), and `subject` says what it is about: for `site-headers` one of `https`, `strict-transport-security`, `content-security-policy`, `x-content-type-options`, `framing`, `referrer-policy`; for `site-bundle` a script as `host/path` (never a query, a hash or a login). Show a subject the UI does not know as text.
- `verdict` for `site-bundle`: `LEAKED` = a secret key is in a script of the site. For `site-headers`: `BLOCKED` = the header is there, `INCONCLUSIVE` = it is missing or weak; a header is never `LEAKED`. Verdict colours, icon and text follow R56. `proof` is `PROVEN` or `UNVERIFIED` (the check could not tell).
- Group the items by `kind`: Tables, Site headers, Scripts of the site. Finding cards (R14) stay about tables only; site evidence has no fix, no Approve fix and no Re-test status.
- Real examples (the first and the last item of the website-only bundle):
```json
[
  {
    "id": "ev_site_tls-headers_1",
    "check": "tls-headers",
    "findingId": null,
    "table": null,
    "subject": "https",
    "kind": "site-headers",
    "verdict": "BLOCKED",
    "proof": "PROVEN",
    "summary": {
      "en": "The site is reached over https.",
      "ur": "Site https par khulti hai."
    }
  },
  {
    "id": "ev_site_bundle-secrets_1",
    "check": "bundle-secrets",
    "findingId": null,
    "table": null,
    "subject": "www.example-shop.com/assets/app.js",
    "kind": "site-bundle",
    "verdict": "LEAKED",
    "proof": "PROVEN",
    "summary": {
      "en": "A Supabase secret key (sb_secret_...) is in this script. Anyone who opens the site can read it. Remove it from the site and create a new key.",
      "ur": "Is script mein Supabase ki secret key (sb_secret_...) maujood hai. Jo bhi site kholta hai use parh sakta hai. Use site se hatayein aur nayi key banayein."
    }
  }
]
```

**R80.** Client report. `GET /audits/:id/client-report` (flag on only; `404` = hide, R72). Show it as a summary block above the details. Real example (website only; `scope`, `reasons` and `limits` are cut here, see the file):
```json
{
  "schemaVersion": 1,
  "headline": {
    "en": "Leak found by these checks: 1 secret key in the scripts of the site.",
    "ur": "In checks se leak mila: site ki scripts mein 1 secret key."
  },
  "decision": "not_ready",
  "findings": {
    "tables": null,
    "site": {
      "siteLeaked": 1,
      "headersMissing": 3
    }
  },
  "topActions": [
    "rm_001",
    "rm_002",
    "rm_003"
  ]
}
```
- `headline` `{ en, ur }`: use it as the headline (R73). `decision` and `reasons` are the `gate` (R77).
- `scope`: the buckets of R78 in short form. `checked`, `notProvided`, `notImplemented`, `partial` and `failedToRun` are lists of `{ id, title }` (label them from `id`, R87; `title` is not shown); `outOfScope` is a list of `{ name, reason }`. Every planned check is in exactly one list. `notImplemented` is a check that was skipped for a reason other than "Not provided".
- `findings.tables` is `null` when the table check did not complete: show "not checked", never zero. Its counts equal `summary`. `findings.site` is `null` when no site check ran; `siteLeaked` equals `summary.siteLeaked`; `headersMissing` is the number of headers that are missing or weak.
- `topActions` are the ids of the first three roadmap items (R81): show them as "Do this first", linking to the roadmap.
- `limits` and `disclaimer` `{ en, ur }` are always shown; show `disclaimer` together with the sentence of R39. When `limits` contains "Roadmap not available." the roadmap could not be made: say so and show no steps.
- The words are the backend's: "by these checks". The UI adds no claim of approval (R38, R88).

**R81.** Roadmap. `GET /audits/:id/roadmap` (flag on only; `404` = hide). The body is `{ schemaVersion: 1, items: [], truncated: N }`. Items are **already in the order to follow**: do not sort them again. Real example (the first item of the website-only bundle):
```json
{
  "id": "rm_001",
  "kind": "fix-site-secret",
  "severity": "critical",
  "fromRequiredCheck": true,
  "title": {
    "en": "Remove the secret key from the script \"www.example-shop.com/assets/app.js\"",
    "ur": "Script \"www.example-shop.com/assets/app.js\" se secret key hatayein"
  },
  "why": {
    "en": "A Supabase secret key was found in a script that any visitor can download. Anyone who reads it can use the key.",
    "ur": "Ek Supabase secret key aisi script mein mili jise har visitor download kar sakta hai. Jo bhi use parhe wo key istemal kar sakta hai."
  },
  "steps": [
    {
      "en": "Rotate the key now: in Supabase go to API keys, create a new secret key and delete the old one.",
      "ur": "Key abhi rotate karein: Supabase -> API keys mein nayi secret key banayein aur purani delete karein."
    },
    {
      "en": "Remove the key from your code and from any env file that is built into the site. Use it only on a server.",
      "ur": "Key ko apne code se aur us env file se hatayein jo site mein build hoti hai. Ise sirf server par istemal karein."
    },
    {
      "en": "Redeploy the site, so the old script is replaced.",
      "ur": "Site redeploy karein, taake purani script badal jaye."
    },
    {
      "en": "Run the audit again to check that the key is gone.",
      "ur": "Audit dobara chalayein aur dekhein ke key ab nahi hai."
    }
  ],
  "refs": {
    "checkId": "bundle-secrets",
    "evidenceIds": [
      "ev_site_bundle-secrets_1"
    ]
  }
}
```
- `id` is `rm_001`... in that order. `kind`:
  - `fix-finding`: a leaking table. The SQL stays in the finding's `fix`; `refs.findingIds` links to it.
  - `fix-site-secret`: a secret key in a script. Always `critical`. The steps say: rotate the key (Supabase -> API keys), remove it from code and env files, redeploy, run the audit again.
  - `improve-header`: a header that is missing or weak. `https` is `high`; HSTS and CSP are `medium`; nosniff and framing are `low`; referrer is `info`.
  - `confirm`: a table that is `INCONCLUSIVE`. A person decides.
  - `cleanup`: `high`. Remove the temporary test users and rows by hand.
  - `finish-check`: `medium`. A check that was `partial` or failed to run; the `why` names what was not read.
  - `provide-input`: `info`. An optional check that was not provided.
  - `retest`: `info`. There is a fix to check and Supabase details were given.
  - A BLOCKED table, a check that is "Not implemented yet" and ownership never get an item.
- `severity` uses the usual values and colours. `fromRequiredCheck` true means the item comes from a check that is required in this run: show a "Required check" label.
- `steps` are 1 to 4 `{ en, ur }` lines: show them as a numbered list. `refs.checkId` is an id from `plan`; `refs.findingIds` and `refs.evidenceIds` are ids of findings and evidence items: make them links where the screen has that thing.
- `truncated` is the number of items left out because a roadmap has at most 100. If it is above 0 say "N more steps are not shown."
- An empty `items` list is not an error and not a claim of safety: show "No next steps from these checks." (the gate banner shows the rest).
- The roadmap never holds the Prover's SQL; it points at the finding. R32 still applies to the SQL.

**R82.** Language. The toggle of R42 also switches: `gate.reasons`, the coverage `reason`s and `limits`, evidence `summary`, module `reason`, every roadmap text (`title`, `why`, `steps`) and every client-report text. `message`, `error.message`, `cleanupNote` and the finding `title` are plain English from the backend (as in R17). Both languages are always present; if one is missing, show English.

**R83.** Empty and special states.
- **Supabase only** (the old request, flag on): the website checks are in `coverage.skipped` as "Not provided" and have `required: false` in `plan`; `summary` has no `siteLeaked`; `clientReport.findings.site` is `null`. Show an invitation "Add a website address to check the site too" (R76) in place of site evidence. The roadmap has `provide-input` items for the two website checks.
- **Website only**: no tables. `findings` is `[]` and `summary` is all zeros (plus `siteLeaked`). Do **not** show "No findings" as the result (R40 is about tables); show "No Supabase details were given, so no table was checked." with the invitation to add them. `cleanup` stays `null`, so no cleanup warning (R25 does not apply). No Re-test and no certificate (R74).
- **Both**: everything, tables and site, in one report. The headline names both (R73).
- **A check failed or is partial**: the coverage says so (R78) and the gate is `not_ready`. This is not an audit error.
- **No stage fields** (`schemaVersion` missing): none of Part 3 is shown (R72).

**R84.** Re-test (Supabase audits only). A Re-test makes the roadmap and the client report again. The ids `rm_001`... are numbered again, so do not keep a roadmap item across a Re-test by its `id`. A failed Re-test leaves them as they were (R51). Poll as in R9, then read the audit, the findings and the three routes again.

**R85.** Memory of the backend. Audits are kept in the audit store and survive a server restart (this replaces the sentence "kept in the backend's memory" in R13; the newest 50 are kept). A run that a restart stopped is `failed` with `error.code` `INTERRUPTED` (R24); for a Re-test it is `lastRetest.error.code` `INTERRUPTED` (R51). In both cases `cleanup` is `"failed"` with a note (R25).

**R86.** A failed or stopped run still has stage fields. If the audit has `status` `failed`: show `error.message` and no finding cards (R24). `/evidence` can have no `items`, `coverage.failedToRun` names the checks, the roadmap can have `finish-check` or `cleanup` items, and the client report says "No result" in its headline. If a step of the pipeline itself failed or ran out of time, its module row is `failed` and the audit is **not** changed: the gate is `not_ready` with a fixed reason ("The evidence of this run is not available, so there is no result." or "The result of this run could not be worked out, so there is no result."); if the roadmap step failed, the roadmap is `[]` and the client report says "Roadmap not available." in `limits`. A missing step never makes a run look ready.

**R87.** Names in the UI (stricter in v0.7.0).
- The product name in every new text is the placeholder **[Project name]**.
- The UI must not show the words MCP or Jira anywhere (R37 stays).
- **Check labels come from the check `id`, written by the UI, in both languages.** The UI must never show an API title (`plan[].title`, `scope[].title`) directly. Fixed labels: `tls-headers` -> "Website headers and HTTPS"; `bundle-secrets` -> "Secret keys in the site's scripts"; `data-access-prover` -> "Table data access"; `active-checks` -> "Active checks (not built yet)". An unknown id is shown as the id. (Reason: the API title of `tls-headers` still contains the word "certificate".)
- The word "certificate" is not used in the UI's own words. The old Certificate screen (R35, R36, R68, Screen 2.4) is labelled **"Re-test result"** (the button "Open result view", the screen title "Re-test result"). The route stays `GET /api/v1/audits/:id/certificate`. R38 stays: no "certificate of security".
- The check "TLS validity period and expiry" (in `coverage.outOfScope`, text from the backend) was renamed so that it has no "certificate" in its name.
- Other texts that come from the backend (`reason`, `summary`, `why`, `steps`, `gate.reasons`) are shown as given.

**R88.** Wording of the new parts. Never "secure", "safe", "certified", "guaranteed" or "safe to launch" (and never the Roman Urdu mehfooz, surakshit, zamanat) as a claim, in the UI's own words (R38 and R40 stay). The backend's texts follow the rule and are tested for it; the UI's own words (labels, empty states, banner) must follow it too. Use "by these checks".

## 3.5 Mock bundles

`docs/frontend-mock/` has three bundles, each made from a **real run of the backend code** (a fake Supabase project and a fake website stand in for the network, so nothing outside the repo was touched). Each folder has the same six files: `request.json` (the body the form sends, with a placeholder instead of every key), `audit.json` (`GET /audits/:id`, completed), `findings.json`, `evidence.json`, `roadmap.json` and `client-report.json`. No key, no query and no real address is in any file. A backend test (`backend/test/frontend/mock-bundles.spec.ts`) compares the files with the real answers on every run, so they cannot drift.

| Folder | The run | What to expect |
|---|---|---|
| `supabase-only/` | `projectUrl`, keys and `confirmTestProject` (the old request), flag on | 1 leaking table, 1 blocked, 1 inconclusive; the website checks are "Not provided"; roadmap: fix, confirm, re-test, two provide-input; headline "Leak found by these checks: 1 table." |
| `url-only/` | `websiteUrl` and `confirmSiteAccess` | no tables; `summary.siteLeaked` is 1; a secret key in `www.example-shop.com/assets/app.js` and weak headers; no Re-test; the Prover row is `skipped` |
| `both/` | the website and Supabase | tables and site in one report; the roadmap has `fix-site-secret` first, then `fix-finding`; `lastRetest` is null |

Mock rules (extend R43 to R46): the switch stays off by default and one switch covers all routes of R2; in mock mode the three new routes answer from these files; mock mode must also show the `404` case (the section is hidden). The files in `docs/evidence` stay as they are. A mock must never contain a real key (R26).

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
21. The first visit opens in the dark theme whatever the system setting is. The toggle on every screen changes the theme, the choice stays after a reload, and there is no flash on load (R55). Text has 4.5:1 and the edges of controls 3:1 in both themes.
22. Every verdict shows text plus an SVG icon. No emoji is used as an icon (R56, R57).
23. The key fields are labelled "Publishable key" and "Secret key". `anonKey` and `serviceKey` appear nowhere in the UI (R58).
24. The app has a manifest, icons (192 and 512, normal and maskable) and a small service worker, and can be installed. In DevTools > Application > Cache Storage the only cache is `vca-offline-v1` and it holds only `/offline.html`: no API response, no script or style, and no request that carried the access code. With the network off, a page that cannot load shows the offline page (R59).
25. `frontend/README.md` has a "Design notes" section and eight screenshots: four screens in light and dark (R60).
26. The Report screen has a coverage section with the lists Checked, Not covered and Limits (R61). The sentence in R39 is shown on the Report and Certificate screens.
27. A module `message` is shown under its row; a finding with `explanationSource` `"ai"` shows "Written by AI"; the Connect screen shows the Groq line (R62).
28. The summary card shows "N of M findings verified fixed by a Re-test" only when a leak was found; a LEAKED -> INCONCLUSIVE finding is not counted as fixed (R63).
29. Badges: First audit completed, First leak fixed (verified by Re-test) and Zero leaks reached are earned only by the rules of R64, are stored only as a date and a flag under `vca-badges-v1`, and are not given for a failed or running Re-test. The text says "saved in this browser" and the R39 sentence is shown (R64).
30. A badge animates once, only for the user's own action, never after a refresh, and not at all with reduced motion; both themes keep readable text (R65).
31. A finding card shows "Fix confirmed" only for a finding that a Re-test moved from LEAKED to BLOCKED (not for LEAKED -> INCONCLUSIVE); the seal animates once after the user's own Re-test and not after a refresh (R66).
32. After a completed Re-test a strip shows Leaked, Inconclusive and Blocked as before -> after, from the real findings; it is not shown for a failed Re-test; tables that were not re-checked or are new are left out and named (R67).
33. "Open certificate view" is locked with the reason next to it ("Fix the leaks and Re-test to unlock." for leaks), opens with one short animation only after the user's own Re-test, and has no new rule of eligibility (R68). No animation lasts 800 ms or more, and none runs with reduced motion (R69).
34. On the home page the first visit of a tab opens the logo scene on the whole screen (3 s at most, over the header, the scene in the middle and not cut at 1908x874, 1366x768 and 375x667) with a Skip button, tap and Esc; the headline starts only after it; a refresh in the same tab skips it; with reduced motion there is no intro; the hero has a Replay intro button that plays the scene again (R70).
35. With `LOCK_C_AGENTS` off the UI behaves as R1 to R70; with it on, nothing breaks and no module row is hard-coded. Switching the flag on is done together with the deploy of this UI (R71, R75).
36. A website-only audit with a secret key in a script is never shown as clean: `summary.leaked` 0 and `summary.siteLeaked` 1 give a leak headline (R73).
37. A website-only audit has no Re-test action and no certificate action, or shows the `409 NOT_ELIGIBLE` reason (R74).
38. Module rows follow the backend's list and order; a `skipped` row shows its `reason` in the chosen language and is not coloured as a failure; `TIMEOUT`, `INTERRUPTED` and the project-hold `409` show the backend's message (R75, R85).
39. The Connect form has an optional Website address and an optional Supabase group (all three fields together); it sends `confirmSiteAccess: true` with a website and `confirmTestProject: true` with the group; a half-filled group blocks start; `400` messages are shown as given (R76).
40. The gate banner shows "No leak found by these checks." or "Not ready" with the reasons, never "safe" (R77).
41. The coverage section shows checked, partial (with the names not read), not provided, not implemented, failed to run, out of scope and limits as separate lists (R78).
42. Evidence items accept `kind` `site-bundle` and `site-headers` with `findingId` and `table` `null`, and a missing `kind` means `table` (R79).
43. The client report block shows the headline, scope, counts (a `null` is "not checked", not zero), "Do this first" and the disclaimer; a `404` hides it (R80).
44. The roadmap is shown in the order received, with steps as a numbered list, a "Required check" label, links to the findings, and "N more steps are not shown" when `truncated` is above 0 (R81).
45. The English / Roman Urdu toggle switches every `{ en, ur }` text of Part 3 (R82).
46. Empty states exist for Supabase only, website only and both, and "No findings" is not shown as the result of a website-only audit (R83).
47. No UI text uses MCP, Jira or "certificate"; check labels are written by the UI from the check id and no API title is shown directly; the old Certificate screen is labelled "Re-test result"; no new text claims safety (R87, R88). The product name in new texts is [Project name].
48. The three mock bundles load in mock mode, and the UI renders each without a real backend (section 3.5).
