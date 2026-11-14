import { randomBytes, randomUUID } from 'node:crypto';
import { buildFinding, type Culprit, type FindingInput } from './findings.js';
import type { Gateway, RestResult } from './gateway.js';
import {
  buildCanaryRow,
  findEditableTextColumn,
  findOwnerColumn,
  parseTables,
} from './schema.js';
import {
  ProverError,
  type Finding,
  type AttackOperation,
  type OperationResult,
  type ProverResult,
  type TableInfo,
} from './types.js';

export const MAX_ROWS_PER_TABLE = 100;
const TAMPERED = 'vca-tampered';

interface RunState {
  userIds: string[];
  /** email of each user whose id we know (to name it if it cannot be removed) */
  emails: Map<string, string>;
  /**
   * Emails of users whose create call failed (for example a timeout). The user
   * may exist even though we never got an id, so we cannot delete it.
   */
  unconfirmedEmails: string[];
  planted: { table: string; column: string; value: string }[];
}

/**
 * Runs the Data Access Prover. Cleanup always runs, even when something fails.
 * Throws a ProverError (with the cleanup status attached) if the run cannot finish.
 */
export async function runProver(
  gateway: Gateway,
  log: (message: string) => void = () => {},
  onProgress: (percent: number) => void = () => {},
): Promise<ProverResult> {
  const state: RunState = {
    userIds: [],
    emails: new Map(),
    unconfirmedEmails: [],
    planted: [],
  };
  let findings: Finding[] = [];
  let failure: unknown = null;
  let cleanup: Cleanup = { status: 'failed' };
  try {
    findings = await runChecks(gateway, state, log, onProgress);
  } catch (error) {
    failure = error;
  } finally {
    cleanup = await teardown(gateway, state, log);
  }
  if (failure) {
    const code =
      failure instanceof ProverError ? failure.code : 'PROVER_FAILED';
    const message =
      failure instanceof Error
        ? failure.message
        : 'The Prover stopped unexpectedly.';
    throw new ProverError(code, message, cleanup.status, cleanup.note);
  }
  return {
    findings,
    cleanup: cleanup.status,
    ...(cleanup.note ? { cleanupNote: cleanup.note } : {}),
  };
}

async function runChecks(
  gateway: Gateway,
  state: RunState,
  log: (message: string) => void,
  onProgress: (percent: number) => void,
): Promise<Finding[]> {
  // 1. Preflight
  log('Preflight: reading the table list and counting rows');
  const tables = parseTables(await gateway.fetchOpenApi());
  if (tables.length === 0) {
    throw new ProverError('NO_TABLES', 'No exposed tables were found to test.');
  }
  for (const table of tables) {
    const count = await gateway.countRows(table.name);
    if (count > MAX_ROWS_PER_TABLE) {
      throw new ProverError(
        'TOO_MUCH_DATA',
        `Table "${table.name}" has ${count} rows (limit ${MAX_ROWS_PER_TABLE}). This does not look like a test project. Nothing was changed.`,
      );
    }
  }

  onProgress(10);

  // 2 + 3. Users A and B, signed in
  log('Creating two temporary test users');
  const userA = await newUser(gateway, state);
  const userB = await newUser(gateway, state);
  const tokenA = await gateway.signIn(userA.email, userA.password);
  const tokenB = await gateway.signIn(userB.email, userB.password);

  // 4 - 7. One finding per table
  onProgress(15);
  const findings: Finding[] = [];
  for (const table of tables) {
    log(`Checking table "${table.name}"`);
    const id = `fnd_${String(findings.length + 1).padStart(3, '0')}`;
    findings.push(
      await checkTable(gateway, state, table, id, userA.id, tokenA, tokenB),
    );
    onProgress(15 + Math.floor((80 * findings.length) / tables.length));
  }
  return findings;
}

async function newUser(gateway: Gateway, state: RunState) {
  const email = `vca-${randomBytes(6).toString('hex')}@example.com`;
  const password = `${randomBytes(24).toString('base64url')}aA1!`;
  let id: string;
  try {
    id = await gateway.createUser(email, password);
  } catch (error) {
    // A timeout can happen after the user was really created.
    state.unconfirmedEmails.push(email);
    throw error;
  }
  state.userIds.push(id);
  state.emails.set(id, email);
  return { id, email, password };
}

const OWNER_BLOCKED_NOTE =
  'Owner is also blocked; the app may be broken or this table is not meant for direct client access.';

async function checkTable(
  gateway: Gateway,
  state: RunState,
  table: TableInfo,
  findingId: string,
  userAId: string,
  tokenA: string,
  tokenB: string,
): Promise<Finding> {
  const ownerColumn = findOwnerColumn(table);
  const anon = { kind: 'anon' } as const;

  if (!ownerColumn) {
    const res = await gateway.restCall('GET', table.name, null, anon);
    return buildFinding(findingId, {
      table: table.name,
      ownerColumn: null,
      verdict: 'INCONCLUSIVE',
      operation: 'SELECT',
      httpStatus: res.status,
      rowsReturned: res.rows.length,
      canaryRowId: null,
      reason: 'no-owner-column',
      operations: [
        {
          operation: 'SELECT',
          actor: 'anon',
          allowed: res.rows.length > 0,
          httpStatus: res.status,
          rowsReturned: res.rows.length,
          note: 'No owner column, so no canary row was planted.',
        },
      ],
    });
  }

  // Plant the canary (owned by A) with the secret key
  let planted: Record<string, unknown>;
  state.planted.push({
    table: table.name,
    column: ownerColumn,
    value: userAId,
  });
  try {
    planted = await gateway.insertRow(
      table.name,
      buildCanaryRow(table, ownerColumn, userAId, randomUUID),
    );
  } catch (error) {
    return buildFinding(findingId, {
      table: table.name,
      ownerColumn,
      verdict: 'INCONCLUSIVE',
      operation: 'SELECT',
      httpStatus: null,
      rowsReturned: null,
      canaryRowId: null,
      reason: 'plant-failed',
      reasonDetail: error instanceof Error ? error.message : 'unknown',
      operations: [],
    });
  }
  const pk = table.columns.find((c) => c.isPrimaryKey);
  const canaryRowId = String(pk ? planted[pk.name] : userAId);
  const filter = { column: ownerColumn, value: userAId };
  const asA = { kind: 'user', token: tokenA } as const;
  const asB = { kind: 'user', token: tokenB } as const;

  // Positive control, part 1: the owner (A) reads their own canary. This runs
  // first, because B's DELETE below may remove the canary.
  const selectOwner = await gateway.restCall('GET', table.name, filter, asA);

  // Attack as B: SELECT, UPDATE, DELETE. Judge UPDATE/DELETE by re-reading, not by status.
  const selectB = await gateway.restCall('GET', table.name, filter, asB);

  // Anonymous check. Runs BEFORE the write attacks, because a successful DELETE
  // would remove the canary and hide an anonymous read leak.
  const selectAnon = await gateway.restCall('GET', table.name, filter, anon);

  const editColumn = findEditableTextColumn(table, ownerColumn);
  let update: RestResult | null = null;
  let updated = false;
  if (editColumn) {
    update = await gateway.restCall('PATCH', table.name, filter, asB, {
      [editColumn]: TAMPERED,
    });
    const after = await gateway.readRows(table.name, ownerColumn, userAId);
    updated = after.length > 0 && after[0][editColumn] === TAMPERED;
  }

  const del = await gateway.restCall('DELETE', table.name, filter, asB);
  const afterDelete = await gateway.readRows(table.name, ownerColumn, userAId);
  const deleted = afterDelete.length === 0;

  // Positive control, part 2: the owner adds one new row of their own. Last, so
  // the extra row cannot disturb the attack checks. Cleanup removes it
  // (it is owned by A, and cleanup deletes every row owned by A).
  const ownerInsert = await ownerInsertCheck(
    gateway,
    table,
    ownerColumn,
    userAId,
    asA,
  );

  const operations: OperationResult[] = [
    {
      operation: 'SELECT',
      actor: 'user_b',
      allowed: selectB.rows.length > 0,
      httpStatus: selectB.status,
      rowsReturned: selectB.rows.length,
    },
    editColumn && update
      ? {
          operation: 'UPDATE',
          actor: 'user_b',
          allowed: updated,
          httpStatus: update.status,
          rowsReturned: update.rows.length,
        }
      : {
          operation: 'UPDATE',
          actor: 'user_b',
          allowed: null,
          httpStatus: null,
          rowsReturned: null,
          note: 'Not tested: the table has no text column that is safe to change.',
        },
    {
      operation: 'DELETE',
      actor: 'user_b',
      allowed: deleted,
      httpStatus: del.status,
      rowsReturned: del.rows.length,
    },
    {
      operation: 'SELECT',
      actor: 'anon',
      allowed: selectAnon.rows.length > 0,
      httpStatus: selectAnon.status,
      rowsReturned: selectAnon.rows.length,
    },
    {
      operation: 'SELECT',
      actor: 'owner',
      allowed: selectOwner.rows.length > 0,
      httpStatus: selectOwner.status,
      rowsReturned: selectOwner.rows.length,
    },
    ownerInsert,
  ];

  const leaks: { op: AttackOperation; culprit: Culprit; res: RestResult }[] =
    [];
  if (selectB.rows.length > 0)
    leaks.push({ op: 'SELECT', culprit: 'user', res: selectB });
  if (selectAnon.rows.length > 0)
    leaks.push({ op: 'SELECT', culprit: 'anon', res: selectAnon });
  if (updated && update)
    leaks.push({ op: 'UPDATE', culprit: 'user', res: update });
  if (deleted) leaks.push({ op: 'DELETE', culprit: 'user', res: del });

  const common = {
    table: table.name,
    ownerColumn,
    canaryRowId,
    ownerValue: userAId,
    operations,
  };

  if (leaks.length > 0) {
    const first = leaks[0];
    const input: FindingInput = {
      ...common,
      verdict: 'LEAKED',
      operation: first.op,
      culprit: first.culprit,
      httpStatus: first.res.status,
      rowsReturned: first.res.rows.length,
    };
    const reached: Partial<Record<Culprit, AttackOperation[]>> = {};
    for (const l of leaks) (reached[l.culprit] ??= []).push(l.op);
    return buildFinding(
      findingId,
      input,
      [...new Set(leaks.map((l) => l.op))],
      reached,
    );
  }

  // Nobody else got anything. That only counts as "protected" if the owner can
  // still use the table. If the owner is blocked too, we cannot tell.
  const ownerBlocked = operations.some(
    (o) => o.actor === 'owner' && o.allowed === false,
  );
  if (ownerBlocked) {
    for (const o of operations) {
      if (o.actor === 'owner' && o.allowed === false)
        o.note = OWNER_BLOCKED_NOTE;
    }
    return buildFinding(findingId, {
      ...common,
      verdict: 'INCONCLUSIVE',
      reason: 'owner-blocked',
      operation: 'SELECT',
      httpStatus: selectB.status,
      rowsReturned: selectB.rows.length,
    });
  }

  return buildFinding(findingId, {
    ...common,
    verdict: 'BLOCKED',
    operation: 'SELECT',
    httpStatus: selectB.status,
    rowsReturned: selectB.rows.length,
  });
}

/**
 * The owner adds one new row of their own through the public API.
 * Only a 401/403 counts as "blocked". Any other failure (for example a 409
 * conflict) says nothing about the policy, so it is reported as not tested.
 */
async function ownerInsertCheck(
  gateway: Gateway,
  table: TableInfo,
  ownerColumn: string,
  userAId: string,
  asA: { kind: 'user'; token: string },
): Promise<OperationResult> {
  const base = { operation: 'INSERT', actor: 'owner' } as const;
  if (table.columns.find((c) => c.name === ownerColumn)?.isPrimaryKey) {
    return {
      ...base,
      allowed: null,
      httpStatus: null,
      rowsReturned: null,
      note: 'Not tested: the owner column is the primary key, so the owner cannot add a second row.',
    };
  }
  const res = await gateway.restCall(
    'POST',
    table.name,
    null,
    asA,
    buildCanaryRow(table, ownerColumn, userAId, randomUUID),
  );
  const common = {
    ...base,
    httpStatus: res.status,
    rowsReturned: res.rows.length,
  };
  if (res.status >= 200 && res.status < 300) {
    return { ...common, allowed: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { ...common, allowed: false };
  }
  return {
    ...common,
    allowed: null,
    note: `Not tested: the insert failed for another reason (HTTP ${res.status}).`,
  };
}

interface Cleanup {
  status: 'ok' | 'failed';
  note?: string;
}

/**
 * Deletes canary rows and both users, then checks they are really gone.
 * "ok" is only returned when nothing can be left behind. If a user might be
 * left (also one we could not look up by email), the result is "failed" with
 * a note that says what to remove by hand.
 */
async function teardown(
  gateway: Gateway,
  state: RunState,
  log: (message: string) => void,
): Promise<Cleanup> {
  if (
    state.planted.length > 0 ||
    state.userIds.length > 0 ||
    state.unconfirmedEmails.length > 0
  ) {
    log('Cleaning up canary rows and test users');
  }
  const leftoverTables = new Set<string>();
  const leftoverEmails = new Set<string>();
  for (const p of state.planted) {
    try {
      await gateway.deleteRows(p.table, p.column, p.value);
    } catch {
      leftoverTables.add(p.table);
    }
  }
  for (const p of state.planted) {
    try {
      if ((await gateway.readRows(p.table, p.column, p.value)).length > 0)
        leftoverTables.add(p.table);
    } catch {
      leftoverTables.add(p.table);
    }
  }
  for (const userId of state.userIds) {
    const email = state.emails.get(userId) ?? 'vca-?@example.com';
    try {
      await gateway.deleteUser(userId);
    } catch {
      leftoverEmails.add(email);
    }
    try {
      if (await gateway.userExists(userId)) leftoverEmails.add(email);
    } catch {
      leftoverEmails.add(email);
    }
  }
  // A create call that never answered: the user may exist without us knowing
  // its id. Look for exactly the emails made in this run (no wildcard).
  // Not found = nothing to clean. Found = delete it and check it is gone.
  for (const email of state.unconfirmedEmails) {
    try {
      const id = await gateway.deleteUserByEmail(email);
      if (id !== null && (await gateway.userExists(id))) {
        leftoverEmails.add(email);
      }
    } catch {
      leftoverEmails.add(email);
    }
  }
  if (leftoverEmails.size === 0 && leftoverTables.size === 0) {
    return { status: 'ok' };
  }
  const parts: string[] = [];
  if (leftoverEmails.size > 0) {
    parts.push(
      `Test users may be left behind in Supabase Auth. Delete the users with an email like vca-*@example.com by hand (Authentication > Users). Possible leftovers: ${[...leftoverEmails].join(', ')}.`,
    );
  }
  if (leftoverTables.size > 0) {
    parts.push(
      `Canary rows may be left in: ${[...leftoverTables].join(', ')}. They are owned by the test users above; delete them by hand.`,
    );
  }
  return { status: 'failed', note: parts.join(' ') };
}
