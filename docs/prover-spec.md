# Data Access Prover: spec

Goal: show whether user B (or an anonymous visitor) can read, change or delete data that belongs to user A, in a Supabase test project.

## Steps
1. **Preflight.** Check env vars and `CONFIRM_TEST_PROJECT=yes`. List exposed tables by reading the PostgREST OpenAPI document at `GET {SUPABASE_URL}/rest/v1/` with the secret key. Count rows per table (exact, head-only). Abort if any table has more than 100 rows.
2. **Create users.** With the secret key (admin API) create users A and B with random emails like `vca-<random>@example.com`, random strong passwords kept in memory only, `email_confirm: true`.
3. **Sign in** both with the publishable key (`signInWithPassword`) to get access tokens.
4. **Plant a canary** per table. Find the owner column: `user_id`, `owner_id`, or `id` when the table is a profile table whose primary key references `auth.users`. Insert one canary row owned by A using the secret key (so insert policies do not block setup), with harmless dummy values for other required columns. If there is no owner column, skip planting and run only the anonymous-read check (verdict at most INCONCLUSIVE). If planting fails, mark INCONCLUSIVE with the reason.
5. **Attack as B** through the REST API with B's token and the publishable key: SELECT the canary, UPDATE it, DELETE it. Then re-read the row with the secret key. A blocked update can return HTTP 200 and change nothing, so judge by the re-read, not the status code.
6. **Anonymous check.** Repeat SELECT with only the publishable key.
7. **Verdict per table.**
   - LEAKED (critical): B or anon received the canary row, or B changed or deleted it.
   - BLOCKED (info): B and anon received nothing, the row is unchanged, and the owner can still use the row (owner SELECT true; owner INSERT true or not tested).
   - If the owner is blocked too, the verdict is INCONCLUSIVE (low), not BLOCKED. See "Owner positive control" below.
   - INCONCLUSIVE (low): table readable by everyone but has no owner column (maybe public on purpose), or the canary could not be planted. State why.
8. **Teardown, always.** Delete canary rows and users A and B, verify, and include `cleanup: "ok" | "failed"`.
9. **Output** one object per table, matching `docs/api-contract.md`: table, operation, verdict, severity, evidence (rowsReturned, httpStatus, canaryRowId), reproducer, explanation (en, ur), suggestedFix, retest `not_run`. Reproducers use placeholders (`<PROJECT_URL>`, `<ANON_KEY>`, `<USER_B_JWT>`), never real values.

## Owner positive control
"Nobody else got the row" only proves protection if the rightful owner can still use the table. So user A (the owner) is also tested, through the REST API with A's token.
- **Owner SELECT** runs first, right after the canary is planted (B's DELETE could remove the canary later).
- **Owner INSERT** runs after all attacks, so the extra row cannot disturb them. The row is owned by A, so teardown deletes it with the canary rows and verifies it is gone.
- **INSERT counts as blocked only on HTTP 401 or 403.** Any other failure (for example 409 Conflict) says nothing about access rules, so the result is `allowed: null` (not tested) with a note.
- **If the owner column is the table's primary key** (for example `profiles.id`), the owner cannot add a second row, so INSERT is `allowed: null` (not tested).
- **Verdict rule:** if B and anon received nothing but the owner SELECT or INSERT is blocked (`allowed: false`), the verdict is INCONCLUSIVE (low), not BLOCKED. Note: "Owner is also blocked; the app may be broken or this table is not meant for direct client access." A real leak still wins: LEAKED stays LEAKED.
- Results go into `evidence.operations` with `actor: "owner"` (see `docs/api-contract.md`).
- **Known limitation:** a spoofed insert (B inserting a row that names A as the owner) is not tested yet.

## Test target (`vca-test-target`)
- `bookings`: RLS off. Expected LEAKED.
- `profiles`: RLS on, own row only. Expected BLOCKED.
- `hotels`: public by design. Expected INCONCLUSIVE.
If the result differs, treat it as a bug to investigate and report it honestly.