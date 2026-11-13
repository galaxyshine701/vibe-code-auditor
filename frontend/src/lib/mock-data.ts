import type { Finding } from './types';

const PROFILES_BLOCKED: Finding = {
  id: 'fnd_001',
  module: 'data-access-prover',
  table: 'profiles',
  operation: 'SELECT',
  verdict: 'BLOCKED',
  severity: 'info',
  title: '"profiles" is protected',
  explanation: {
    en: "The second test user and an anonymous visitor received no rows, and the first user's row stayed unchanged. No leak found by these checks.",
    ur: 'Doosre test user aur bina login wale visitor ko koi row nahi mili, aur pehle user ki row waisi hi rahi. In checks se koi leak nahi mila.',
  },
  evidence: {
    rowsReturned: 0,
    httpStatus: 200,
    canaryRowId: '20ba83c6-8d61-4f34-8f67-f7038fdbd682',
    reproducer: null,
    operations: [
      {
        operation: 'SELECT',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'UPDATE',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'DELETE',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'SELECT',
        actor: 'owner',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'INSERT',
        actor: 'owner',
        allowed: null,
        httpStatus: null,
        rowsReturned: null,
        note: 'Not tested: the owner column is the primary key, so the owner cannot add a second row.',
      },
    ],
  },
  fix: null,
  retest: { status: 'not_run', lastRunAt: null },
};

const BOOKINGS_LEAKED: Finding = {
  id: 'fnd_002',
  module: 'data-access-prover',
  table: 'bookings',
  operation: 'SELECT',
  verdict: 'LEAKED',
  severity: 'critical',
  title: 'Any logged-in user can read other users\' rows in "bookings"',
  explanation: {
    en: 'The second test user was able to read a row that belongs to the first user. The table has no rule that limits rows to their owner.',
    ur: 'Doosra test user ne pehle user ki row parh li. Is table me aisa rule nahi jo har row ko sirf uske maalik tak mehdood kare.',
  },
  evidence: {
    rowsReturned: 1,
    httpStatus: 200,
    canaryRowId: '576167ba-119c-4bca-b53c-822486d6f5bc',
    reproducer:
      "curl -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <USER_B_JWT>' '<PROJECT_URL>/rest/v1/bookings?user_id=eq.73b88578-7eea-41fb-86e8-fce277739f7f'",
    operations: [
      {
        operation: 'SELECT',
        actor: 'user_b',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'UPDATE',
        actor: 'user_b',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'DELETE',
        actor: 'user_b',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
    ],
  },
  fix: {
    status: 'proposed',
    description:
      'Turn on row-level security and let users reach only their own rows. If a broader policy already exists on this table, remove it, because policies add up. Review before applying.',
    sql: 'alter table "bookings" enable row level security;\ncreate policy "Owners can select own rows" on "bookings" for select to authenticated using ((select auth.uid()) = "user_id");\ncreate policy "Owners can update own rows" on "bookings" for update to authenticated using ((select auth.uid()) = "user_id") with check ((select auth.uid()) = "user_id");\ncreate policy "Owners can delete own rows" on "bookings" for delete to authenticated using ((select auth.uid()) = "user_id");',
  },
  retest: { status: 'not_run', lastRunAt: null },
};

const HOTELS_INCONCLUSIVE: Finding = {
  id: 'fnd_003',
  module: 'data-access-prover',
  table: 'hotels',
  operation: 'SELECT',
  verdict: 'INCONCLUSIVE',
  severity: 'low',
  title: '"hotels": no owner column, is this intended?',
  explanation: {
    en: 'This table has no column that links a row to a user, so a canary row could not be planted. If it holds public information such as a hotel list, that is fine. Please confirm. An anonymous visitor can read it.',
    ur: 'Is table me aisa column nahi jo row ko kisi user se jore, isliye canary row nahi daali ja saki. Agar isme sirf public maloomat hain (jaise hotel list) to theek hai. Barae meharbani confirm karein. Bina login wala visitor ise parh sakta hai.',
  },
  evidence: {
    rowsReturned: 2,
    httpStatus: 200,
    canaryRowId: null,
    reproducer: null,
    operations: [
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 2,
        note: 'No owner column, so no canary row was planted.',
      },
    ],
  },
  fix: null,
  retest: { status: 'not_run', lastRunAt: null },
};

const BOOKINGS_AFTER_FIX: Finding = {
  id: 'fnd_002',
  module: 'data-access-prover',
  table: 'bookings',
  operation: 'SELECT',
  verdict: 'BLOCKED',
  severity: 'info',
  title: '"bookings" is protected',
  explanation: {
    en: "The second test user and an anonymous visitor received no rows, and the first user's row stayed unchanged. No leak found by these checks.",
    ur: 'Doosre test user aur bina login wale visitor ko koi row nahi mili, aur pehle user ki row waisi hi rahi. In checks se koi leak nahi mila.',
  },
  evidence: {
    rowsReturned: 0,
    httpStatus: 200,
    canaryRowId: 'b86dd01b-91e2-4090-86c5-c91cd9711674',
    reproducer: null,
    operations: [
      {
        operation: 'SELECT',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'UPDATE',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'DELETE',
        actor: 'user_b',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'SELECT',
        actor: 'anon',
        allowed: false,
        httpStatus: 200,
        rowsReturned: 0,
      },
      {
        operation: 'SELECT',
        actor: 'owner',
        allowed: true,
        httpStatus: 200,
        rowsReturned: 1,
      },
      {
        operation: 'INSERT',
        actor: 'owner',
        allowed: true,
        httpStatus: 201,
        rowsReturned: 1,
      },
    ],
  },
  fix: null,
  retest: { status: 'not_run', lastRunAt: null },
};

function cloneFinding(finding: Finding): Finding {
  return JSON.parse(JSON.stringify(finding)) as Finding;
}

export function initialMockFindings(): Finding[] {
  return [
    cloneFinding(PROFILES_BLOCKED),
    cloneFinding(BOOKINGS_LEAKED),
    cloneFinding(HOTELS_INCONCLUSIVE),
  ];
}

// What a successful Re-test returns after the fix: only the table that was
// LEAKED is "passed"; the others were not LEAKED before, so "not_run".
export function retestedMockFindings(ranAt: string): Finding[] {
  const retestOf = (
    status: Finding['retest']['status'],
    previousVerdict: Finding['verdict'],
  ): Finding['retest'] => ({ status, lastRunAt: ranAt, previousVerdict });
  return [
    {
      ...cloneFinding(PROFILES_BLOCKED),
      retest: retestOf('not_run', 'BLOCKED'),
    },
    {
      ...cloneFinding(BOOKINGS_AFTER_FIX),
      retest: retestOf('passed', 'LEAKED'),
    },
    {
      ...cloneFinding(HOTELS_INCONCLUSIVE),
      retest: retestOf('not_run', 'INCONCLUSIVE'),
    },
  ];
}
