import { buildReproducer } from '../../src/prover/findings.js';
import { loadConfig } from '../../src/prover/config.js';
import { runProver } from '../../src/prover/prover.js';
import { redact } from '../../src/prover/redact.js';
import { findOwnerColumn, parseTables } from '../../src/prover/schema.js';
import { ProverError } from '../../src/prover/types.js';
import { FakeGateway, type FakeTable } from './fake-gateway.js';

const demoTables = (): FakeTable[] => [
  { name: 'bookings', policy: 'off', ownerColumn: 'user_id' },
  { name: 'profiles', policy: 'own', ownerColumn: 'id' },
  { name: 'hotels', policy: 'public-read', ownerColumn: null },
];

describe('Prover against the three demo tables (fake project)', () => {
  it('gives LEAKED, BLOCKED, INCONCLUSIVE and cleans up', async () => {
    const fake = new FakeGateway(demoTables());
    const result = await runProver(fake);
    const by = Object.fromEntries(result.findings.map((f) => [f.table, f]));

    expect(by.bookings.verdict).toBe('LEAKED');
    expect(by.bookings.severity).toBe('critical');
    expect(by.bookings.fix?.sql).toContain('enable row level security');
    expect(by.profiles.verdict).toBe('BLOCKED');
    expect(by.profiles.severity).toBe('info');
    expect(by.profiles.evidence.httpStatus).toBe(200);
    expect(by.profiles.evidence.rowsReturned).toBe(0);
    expect(by.hotels.verdict).toBe('INCONCLUSIVE');
    expect(by.hotels.severity).toBe('low');
    expect(result.cleanup).toBe('ok');

    // nothing left behind
    expect(fake.users.size).toBe(0);
    expect(fake.data.get('bookings')).toHaveLength(0);
    expect(fake.data.get('profiles')).toHaveLength(0);
  });

  it('matches the api-contract shape and uses only placeholders', async () => {
    const fake = new FakeGateway(demoTables());
    const result = await runProver(fake);
    for (const f of result.findings) {
      expect(f.module).toBe('data-access-prover');
      expect(f.retest).toEqual({ status: 'not_run', lastRunAt: null });
      expect(f.explanation.en).toBeTruthy();
      expect(f.explanation.ur).toBeTruthy();
    }
    const leaked = result.findings.find((f) => f.verdict === 'LEAKED')!;
    expect(leaked.evidence.reproducer).toContain('<PROJECT_URL>');
    expect(leaked.evidence.reproducer).toContain('<ANON_KEY>');
    expect(leaked.evidence.reproducer).toContain('<USER_B_JWT>');
    const text = JSON.stringify(result);
    expect(text).not.toContain('fake-token-');
    for (const u of fake.users.values()) {
      expect(text).not.toContain(u.password);
    }
  });

  it('flags a table everyone can read as LEAKED', async () => {
    const fake = new FakeGateway([
      { name: 'notes', policy: 'public-read', ownerColumn: 'owner_id' },
    ]);
    const [finding] = (await runProver(fake)).findings;
    expect(finding.verdict).toBe('LEAKED');
    expect(finding.operation).toBe('SELECT');
  });

  it('leaves the user token out of an anonymous reproducer', () => {
    const text = buildReproducer({
      table: 'notes',
      ownerColumn: 'owner_id',
      verdict: 'LEAKED',
      operation: 'SELECT',
      culprit: 'anon',
      ownerValue: 'abc',
      httpStatus: 200,
      rowsReturned: 1,
      canaryRowId: 'abc',
      operations: [],
    });
    expect(text).toContain('<ANON_KEY>');
    expect(text).not.toContain('USER_B_JWT');
  });

  it('marks a table INCONCLUSIVE when the canary cannot be planted', async () => {
    const fake = new FakeGateway([
      {
        name: 'orders',
        policy: 'own',
        ownerColumn: 'user_id',
        insertError: 'check constraint failed',
      },
    ]);
    const result = await runProver(fake);
    expect(result.findings[0].verdict).toBe('INCONCLUSIVE');
    expect(result.findings[0].explanation.en).toContain(
      'check constraint failed',
    );
    expect(result.cleanup).toBe('ok');
  });
});

describe('Per-operation evidence', () => {
  const find = (
    ops: { operation: string; actor: string }[],
    operation: string,
    actor: string,
  ) => ops.find((o) => o.operation === operation && o.actor === actor)!;

  it('shows every operation as allowed on an unprotected table', async () => {
    const result = await runProver(new FakeGateway(demoTables()));
    const ops = result.findings.find((f) => f.table === 'bookings')!.evidence
      .operations;
    expect(ops).toHaveLength(6);
    for (const [operation, actor] of [
      ['SELECT', 'user_b'],
      ['UPDATE', 'user_b'],
      ['DELETE', 'user_b'],
      ['SELECT', 'anon'],
    ]) {
      const o = find(ops, operation, actor);
      expect(o.allowed).toBe(true);
      expect(o.httpStatus).toBe(200);
      expect(o.rowsReturned).toBe(1);
    }
  });

  it('shows every operation as blocked (status 200, 0 rows) when RLS works', async () => {
    const result = await runProver(new FakeGateway(demoTables()));
    const ops = result.findings.find((f) => f.table === 'profiles')!.evidence
      .operations;
    expect(ops).toHaveLength(6);
    for (const o of ops.filter((x) => x.actor !== 'owner')) {
      expect(o.allowed).toBe(false);
      expect(o.httpStatus).toBe(200);
      expect(o.rowsReturned).toBe(0);
    }
  });

  it('separates reading from changing: read allowed, write blocked', async () => {
    const result = await runProver(
      new FakeGateway([
        { name: 'notes', policy: 'public-read', ownerColumn: 'owner_id' },
      ]),
    );
    const ops = result.findings[0].evidence.operations;
    expect(find(ops, 'SELECT', 'user_b').allowed).toBe(true);
    expect(find(ops, 'UPDATE', 'user_b').allowed).toBe(false);
    expect(find(ops, 'DELETE', 'user_b').allowed).toBe(false);
    // the fix only asks for what actually leaked
    expect(result.findings[0].fix?.sql).not.toContain('for update');
    expect(result.findings[0].fix?.sql).not.toContain('for delete');
  });

  it('says UPDATE was not tested when there is no safe text column', async () => {
    const result = await runProver(
      new FakeGateway([
        {
          name: 'logs',
          policy: 'own',
          ownerColumn: 'user_id',
          noTextColumn: true,
        },
      ]),
    );
    const update = find(
      result.findings[0].evidence.operations,
      'UPDATE',
      'user_b',
    );
    expect(update.allowed).toBeNull();
    expect(update.httpStatus).toBeNull();
    expect(update.note).toContain('Not tested');
  });

  it('has only the anonymous read for a table with no owner column', async () => {
    const result = await runProver(new FakeGateway(demoTables()));
    const ops = result.findings.find((f) => f.table === 'hotels')!.evidence
      .operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operation: 'SELECT', actor: 'anon' });
  });

  it('has an empty list when the canary could not be planted', async () => {
    const result = await runProver(
      new FakeGateway([
        {
          name: 'orders',
          policy: 'own',
          ownerColumn: 'user_id',
          insertError: 'nope',
        },
      ]),
    );
    expect(result.findings[0].evidence.operations).toEqual([]);
  });
});

describe('Owner positive control and INSERT', () => {
  const owner = (
    ops: { operation: string; actor: string }[],
    operation: string,
  ) => ops.find((o) => o.actor === 'owner' && o.operation === operation)!;

  it('removes the extra row the owner inserted', async () => {
    const fake = new FakeGateway([
      { name: 'trips', policy: 'own', ownerColumn: 'user_id' },
    ]);
    const result = await runProver(fake);
    const ops = result.findings[0].evidence.operations;
    expect(owner(ops, 'SELECT')).toMatchObject({
      allowed: true,
      httpStatus: 200,
      rowsReturned: 1,
    });
    expect(owner(ops, 'INSERT')).toMatchObject({
      allowed: true,
      httpStatus: 201,
    });
    expect(result.findings[0].verdict).toBe('BLOCKED');
    expect(result.cleanup).toBe('ok');
    expect(fake.data.get('trips')).toHaveLength(0);
  });

  it('is INCONCLUSIVE when nobody is allowed anything, not even the owner', async () => {
    const result = await runProver(
      new FakeGateway([
        { name: 'vault', policy: 'deny-all', ownerColumn: 'user_id' },
      ]),
    );
    const [finding] = result.findings;
    expect(finding.verdict).toBe('INCONCLUSIVE');
    expect(finding.severity).toBe('low');
    expect(finding.explanation.en).toContain(
      'Owner is also blocked; the app may be broken or this table is not meant for direct client access.',
    );
    const ops = finding.evidence.operations;
    expect(owner(ops, 'SELECT')).toMatchObject({ allowed: false });
    expect(owner(ops, 'INSERT')).toMatchObject({
      allowed: false,
      httpStatus: 403,
    });
    expect(owner(ops, 'SELECT').note).toContain('Owner is also blocked');
    expect(result.cleanup).toBe('ok');
  });

  it('catches a fix that forgot the INSERT policy (owner can read but not insert)', async () => {
    const result = await runProver(
      new FakeGateway([
        { name: 'bookings', policy: 'own-no-insert', ownerColumn: 'user_id' },
      ]),
    );
    const [finding] = result.findings;
    expect(finding.verdict).toBe('INCONCLUSIVE');
    const ops = finding.evidence.operations;
    expect(owner(ops, 'SELECT').allowed).toBe(true);
    expect(owner(ops, 'INSERT').allowed).toBe(false);
  });

  it('does not treat a 409 conflict as "owner blocked"', async () => {
    const result = await runProver(
      new FakeGateway([
        {
          name: 'trips',
          policy: 'own',
          ownerColumn: 'user_id',
          insertConflict: true,
        },
      ]),
    );
    const [finding] = result.findings;
    const insert = owner(finding.evidence.operations, 'INSERT');
    expect(insert.allowed).toBeNull();
    expect(insert.httpStatus).toBe(409);
    expect(finding.verdict).toBe('BLOCKED');
  });

  it('reports INSERT as not tested when the owner column is the primary key', async () => {
    const result = await runProver(new FakeGateway(demoTables()));
    const ops = result.findings.find((f) => f.table === 'profiles')!.evidence
      .operations;
    expect(owner(ops, 'SELECT').allowed).toBe(true);
    const insert = owner(ops, 'INSERT');
    expect(insert.allowed).toBeNull();
    expect(insert.note).toContain('Not tested');
  });

  it('writes the fix SQL with public."table" and an INSERT policy', async () => {
    const result = await runProver(new FakeGateway(demoTables()));
    const sql = result.findings.find((f) => f.table === 'bookings')!.fix!.sql;
    expect(sql).toContain(
      'alter table public."bookings" enable row level security;',
    );
    expect(sql).toContain(
      'create policy "Owners can insert own rows" on public."bookings" for insert to authenticated with check ((select auth.uid()) = "user_id");',
    );
    expect(sql).not.toMatch(/on "bookings"/);
    expect(sql).not.toMatch(/alter table "bookings"/);
  });

  it('adds the INSERT policy even when only reading leaked', async () => {
    const result = await runProver(
      new FakeGateway([
        { name: 'notes', policy: 'public-read', ownerColumn: 'owner_id' },
      ]),
    );
    const sql = result.findings[0].fix!.sql;
    expect(sql).toContain('for insert to authenticated with check');
    expect(sql).not.toContain('for update');
    expect(sql).not.toContain('for delete');
  });
});

describe('Safety rules', () => {
  it('aborts before creating anything when a table has more than 100 rows', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
    const fake = new FakeGateway([
      { name: 'big', policy: 'off', ownerColumn: 'user_id', rows },
    ]);
    const error = await runProver(fake).catch((e) => e);
    expect(error).toBeInstanceOf(ProverError);
    expect(error.code).toBe('TOO_MUCH_DATA');
    expect(error.cleanup).toBe('ok');
    expect(fake.users.size).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(fake.data.get('big')).toHaveLength(101);
  });

  it('still cleans up when the attack step crashes', async () => {
    const fake = new FakeGateway(demoTables(), { throwOnRest: true });
    const error = await runProver(fake).catch((e) => e);
    expect(error).toBeInstanceOf(ProverError);
    expect(error.cleanup).toBe('ok');
    expect(fake.users.size).toBe(0);
    expect(fake.data.get('bookings')).toHaveLength(0);
  });

  it('says cleanup failed when a user cannot be deleted', async () => {
    const fake = new FakeGateway(demoTables(), { failDeleteUser: true });
    const result = await runProver(fake);
    expect(result.cleanup).toBe('failed');
  });
});

describe('loadConfig', () => {
  const good = {
    SUPABASE_URL: 'https://abc.supabase.co/',
    SUPABASE_PUBLISHABLE_KEY: 'pub-key-123456',
    SUPABASE_SECRET_KEY: 'sec-key-123456',
    CONFIRM_TEST_PROJECT: 'yes',
  };

  it('accepts a full config', () => {
    expect(loadConfig(good).supabaseUrl).toBe('https://abc.supabase.co');
  });

  it('refuses unless CONFIRM_TEST_PROJECT is yes', () => {
    expect(() => loadConfig({ ...good, CONFIRM_TEST_PROJECT: 'no' })).toThrow(
      /CONFIRM_TEST_PROJECT=yes/,
    );
  });

  it('names missing variables but never prints values', () => {
    try {
      loadConfig({ ...good, SUPABASE_SECRET_KEY: '' });
      throw new Error('should have thrown');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('SUPABASE_SECRET_KEY');
      expect(message).not.toContain('pub-key-123456');
    }
  });
});

describe('helpers', () => {
  it('redact hides secrets', () => {
    expect(redact('key=abcdef123 end', ['abcdef123'])).toBe(
      'key=[REDACTED] end',
    );
  });

  it('finds the owner column', () => {
    const doc = {
      definitions: {
        a: { properties: { user_id: { type: 'string' } } },
        b: { properties: { title: { type: 'string' } } },
      },
    };
    const [a, b] = parseTables(doc);
    expect(findOwnerColumn(a)).toBe('user_id');
    expect(findOwnerColumn(b)).toBeNull();
  });
});
