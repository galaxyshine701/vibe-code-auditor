import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  findTablesWithoutRls,
  isMigrationFile,
  MAX_MIGRATION_HITS,
  maskSql,
  type MigrationFile,
} from '../../src/repo/migration-rules.js';
import { scanRepo, type RepoTransport } from '../../src/repo/repo-scanner.js';
import { buildCoverage } from '../../src/stages/evidence.js';
import { evaluateGate } from '../../src/stages/gate.js';
import { sqlName } from '../../src/stages/fix-prompts.js';
import { collectResults } from '../../src/stages/inspectors.js';
import {
  CHECKS,
  REPO_CHECK_ID,
  checksFor,
} from '../../src/stages/planner-config.js';
import { planChecks } from '../../src/stages/planner.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import { buildZip, type TestEntry } from './zip-builder.js';

// Rule 1 of Repo Scan: a table that a migration creates and no migration
// enables row level security for. INCONCLUSIVE only ("may be enabled
// elsewhere"), never LEAKED, and never a gate reason by itself.

const m = (path: string, text: string): MigrationFile => ({
  path: `supabase/migrations/${path}`,
  text,
});
const tablesOf = (...files: MigrationFile[]) =>
  findTablesWithoutRls(files).hits.map((h) => h.table);

describe('isMigrationFile', () => {
  it('is a .sql file in a folder called migrations', () => {
    expect(isMigrationFile('supabase/migrations/001_init.sql')).toBe(true);
    expect(isMigrationFile('db/migrations/2024/x.SQL')).toBe(true);
    expect(isMigrationFile('migrations/1.sql')).toBe(true);
    expect(isMigrationFile('supabase/seed.sql')).toBe(false);
    expect(isMigrationFile('supabase/migrations/readme.md')).toBe(false);
    expect(isMigrationFile('src/migrations.sql')).toBe(false);
  });
});

describe('the basic rule', () => {
  it('a created table with no RLS is listed, with file and line', () => {
    const out = findTablesWithoutRls([
      m('001.sql', '-- header\n\ncreate table public.orders (id int);'),
    ]);
    expect(out.hits).toEqual([
      { table: 'orders', path: 'supabase/migrations/001.sql', line: 3 },
    ]);
    expect(out.cut).toBe(false);
  });
  it('a table with RLS enabled is not listed', () => {
    expect(
      tablesOf(
        m(
          '001.sql',
          'create table orders (id int);\nalter table orders enable row level security;',
        ),
      ),
    ).toEqual([]);
  });
  it('disable and force are not enable', () => {
    expect(
      tablesOf(
        m('1.sql', 'create table a (id int);\nalter table a disable row level security;'),
        m('2.sql', 'create table b (id int);\nalter table b force row level security;'),
      ),
    ).toEqual(['a', 'b']);
  });
  it('no create table, nothing listed', () => {
    expect(tablesOf(m('1.sql', 'alter table x add column y int;'))).toEqual([]);
    expect(tablesOf()).toEqual([]);
  });
});

describe('create table if not exists, schema-qualified and quoted names', () => {
  it('create table if not exists', () => {
    expect(tablesOf(m('1.sql', 'CREATE TABLE IF NOT EXISTS notes (id int);'))).toEqual(['notes']);
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table if not exists notes (id int);\nalter table notes enable row level security;',
        ),
      ),
    ).toEqual([]);
  });
  it('public., quoted and "public"."x" are the same table', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table public.orders (id int);\nalter table "public"."orders" enable row level security;',
        ),
      ),
    ).toEqual([]);
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table "public"."orders" (id int);\nalter table orders enable row level security;',
        ),
      ),
    ).toEqual([]);
  });
  it('plain names are not case sensitive, quoted names are', () => {
    expect(
      tablesOf(m('1.sql', 'create table Orders (id int);\nalter table ORDERS enable row level security;')),
    ).toEqual([]);
    // "Orders" (quoted) is a different table from orders
    expect(
      tablesOf(m('1.sql', 'create table "Orders" (id int);\nalter table orders enable row level security;')),
    ).toEqual(['Orders']);
    expect(
      tablesOf(m('1.sql', 'create table "My Orders" (id int);')),
    ).toEqual(['My Orders']);
    expect(
      tablesOf(m('1.sql', 'create table "a""b" (id int);')),
    ).toEqual(['a"b']);
  });
  it('a table of another schema, a temporary table and a 3-part name are not looked at', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          [
            'create table private.secrets (id int);',
            'create table auth.extra (id int);',
            'create temp table scratch (id int);',
            'create temporary table scratch2 (id int);',
            'create table db.public.x (id int);',
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
  });
  it('unlogged tables count; an enable on a table of another schema does not enable the public one', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          'create unlogged table logs (id int);\ncreate table t (id int);\nalter table private.t enable row level security;',
        ),
      ),
    ).toEqual(['logs', 't']);
  });
});

describe('other ways to write create table', () => {
  it('upper and mixed case: CREATE TABLE, Create Table, and ALTER TABLE ... ENABLE ROW LEVEL SECURITY', () => {
    expect(tablesOf(m('1.sql', 'CREATE TABLE Orders (id int);'))).toEqual(['orders']);
    expect(tablesOf(m('1.sql', 'Create Table IF Not Exists Notes (id int);'))).toEqual(['notes']);
    expect(tablesOf(m('1.sql', 'CREATE\n  TABLE\tPUBLIC.Items (id int);'))).toEqual(['items']);
    expect(
      tablesOf(
        m('1.sql', 'CREATE TABLE Orders (id int);\nALTER TABLE ORDERS ENABLE ROW LEVEL SECURITY;'),
      ),
    ).toEqual([]);
  });
  it('create unlogged table, in any case', () => {
    expect(tablesOf(m('1.sql', 'create unlogged table cache (id int);'))).toEqual(['cache']);
    expect(tablesOf(m('1.sql', 'CREATE UNLOGGED TABLE IF NOT EXISTS public.Cache2 (id int);'))).toEqual([
      'cache2',
    ]);
    expect(
      tablesOf(m('1.sql', 'create unlogged table cache (id int);\nalter table cache enable row level security;')),
    ).toEqual([]);
  });
  it('create table ... partition of: the partition is a table of its own and is listed; RLS on the parent does not cover it', () => {
    const sql =
      'create table events (id int, at date) partition by range (at);\n' +
      'alter table events enable row level security;\n' +
      "create table events_2024 partition of events for values from ('2024-01-01') to ('2025-01-01');";
    expect(tablesOf(m('1.sql', sql))).toEqual(['events_2024']);
    expect(
      tablesOf(
        m('1.sql', sql + '\nalter table events_2024 enable row level security;'),
      ),
    ).toEqual([]);
    expect(
      tablesOf(m('1.sql', 'CREATE TABLE public.logs_2024 PARTITION OF public.logs DEFAULT;')),
    ).toEqual(['logs_2024']);
  });
  it('create table ... (like ...): the copy does not carry row level security, so it is listed', () => {
    expect(tablesOf(m('1.sql', 'create table orders_copy (like orders including all);'))).toEqual([
      'orders_copy',
    ]);
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table a (id int);\nalter table a enable row level security;\ncreate table b (like a including all);',
        ),
      ),
    ).toEqual(['b']);
    expect(tablesOf(m('1.sql', 'CREATE TABLE c (LIKE public.a INCLUDING DEFAULTS, extra int);'))).toEqual(['c']);
  });
  it('create table ... as select is a table too', () => {
    expect(tablesOf(m('1.sql', 'create table snap as select * from orders;'))).toEqual(['snap']);
  });
});

describe('alter table only ... enable row level security', () => {
  it('alter table only public.x enable row level security counts', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table x (id int);\nALTER TABLE ONLY public.x ENABLE ROW LEVEL SECURITY;',
        ),
      ),
    ).toEqual([]);
  });
  it('alter table if exists, and enable among other actions in one statement', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table x (id int);\nalter table if exists only x enable row level security;',
        ),
      ),
    ).toEqual([]);
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table y (id int);\nalter table y add column z int,\n  enable row level security;',
        ),
      ),
    ).toEqual([]);
  });
  it('a different table named like a prefix is not matched', () => {
    expect(
      tablesOf(
        m('1.sql', 'create table order (id int);\nalter table orders enable row level security;'),
      ),
    ).toEqual(['order']);
  });
});

describe('comments and strings that hold the words', () => {
  it('a commented-out create table is not a table', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          '-- create table ghost (id int);\n/* create table ghost2 (id int);\n  /* nested */ create table ghost3 (id int); */\nselect 1;',
        ),
      ),
    ).toEqual([]);
  });
  it('a commented-out "enable row level security" does not enable', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          'create table t (id int);\n-- alter table t enable row level security;\n/* alter table t enable row level security; */',
        ),
      ),
    ).toEqual(['t']);
  });
  it('a string, a dollar-quoted body or a comment on the table holding the words does not count', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          [
            "create table t (id int, note text default 'alter table t enable row level security;');",
            "comment on table t is 'create table fake (id int); alter table t enable row level security';",
            'create function f() returns void language plpgsql as $body$',
            '  begin execute \'alter table t enable row level security\'; create table inner_t (id int); end',
            '$body$;',
            'do $$ begin create table in_do (id int); end $$;',
          ].join('\n'),
        ),
      ),
    ).toEqual(['t']);
  });
  it('a quote or a semicolon inside a comment or string does not break the next statement', () => {
    expect(
      tablesOf(
        m(
          '1.sql',
          "-- it's a comment; with a quote\nselect 'a;b''c';\ncreate table after_it (id int);",
        ),
      ),
    ).toEqual(['after_it']);
  });
  it('the line number is right after comments, blocks and strings', () => {
    const out = findTablesWithoutRls([
      m('1.sql', "/* one\ntwo */\n-- three\nselect 'a\nb';\n\ncreate table late (id int);"),
    ]);
    expect(out.hits[0].line).toBe(7);
  });
  it('maskSql keeps the length and the new lines, and keeps quoted names', () => {
    const sql = "select 'x\ny' /* a\nb */ -- c\n\"Keep Me\" $t$ z\nz $t$ end";
    const masked = maskSql(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked.split('\n')).toHaveLength(sql.split('\n').length);
    expect(masked).toContain('"Keep Me"');
    expect(masked).not.toMatch(/x|a\b|b\b|\bc\b|z/);
  });
});

describe('RLS enabled in a different file', () => {
  it('a later migration that enables RLS clears the table', () => {
    expect(
      tablesOf(
        m('20240101_init.sql', 'create table items (id int);'),
        m('20240202_rls.sql', 'alter table items enable row level security;'),
      ),
    ).toEqual([]);
  });
  it('the order of the files given does not matter (they are read in path order)', () => {
    expect(
      tablesOf(
        m('20240202_rls.sql', 'alter table items enable row level security;'),
        m('20240101_init.sql', 'create table items (id int);'),
      ),
    ).toEqual([]);
  });
  it('the table is listed with the file that creates it, once', () => {
    const out = findTablesWithoutRls([
      m('1.sql', 'create table t (id int);'),
      m('2.sql', 'create table if not exists t (id int);'),
    ]);
    expect(out.hits).toEqual([
      { table: 't', path: 'supabase/migrations/1.sql', line: 1 },
    ]);
  });
  it('a table that is dropped later is not listed; one created again needs its own enable', () => {
    expect(
      tablesOf(m('1.sql', 'create table t (id int);'), m('2.sql', 'drop table if exists public.t;')),
    ).toEqual([]);
    expect(
      tablesOf(
        m('1.sql', 'create table t (id int);\nalter table t enable row level security;'),
        m('2.sql', 'drop table t;'),
        m('3.sql', 'create table t (id int);'),
      ),
    ).toEqual(['t']);
  });
});

describe('the list is cut at MAX_MIGRATION_HITS', () => {
  const many = (n: number) =>
    m('1.sql', Array.from({ length: n }, (_, i) => `create table t${i} (id int);`).join('\n'));
  it('says so when it is cut, not at the cap', () => {
    const cut = findTablesWithoutRls([many(MAX_MIGRATION_HITS + 3)]);
    expect(cut.hits).toHaveLength(MAX_MIGRATION_HITS);
    expect(cut.cut).toBe(true);
    const exact = findTablesWithoutRls([many(MAX_MIGRATION_HITS)]);
    expect(exact.hits).toHaveLength(MAX_MIGRATION_HITS);
    expect(exact.cut).toBe(false);
  });
});

// ---- through the scanner, the agent, the roadmap and the gate ----

const REPO = { owner: 'someone', repo: 'app' };
const control = (): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
});
const zip = (...entries: TestEntry[]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});
const provided = { website: false, supabase: false, repo: true };

describe('scanRepo and the inspector agent', () => {
  const entries: TestEntry[] = [
    { name: 'o-r-1/supabase/migrations/001_init.sql', data: 'create table public.orders (id int);\ncreate table public.notes (id int);' },
    { name: 'o-r-1/supabase/migrations/002_rls.sql', data: 'alter table public.notes enable row level security;' },
    { name: 'o-r-1/supabase/seed.sql', data: 'create table seed_only (id int);' },
  ];

  it('scanRepo reads only the migrations and lists orders', async () => {
    const outcome = await scanRepo(zip(...entries), REPO);
    expect(outcome.migrationHits).toEqual([
      { table: 'orders', path: 'supabase/migrations/001_init.sql', line: 1 },
    ]);
    expect(outcome.migrationHitsCut).toBe(false);
  });

  it('the agent writes INCONCLUSIVE, UNVERIFIED evidence of kind repo-migration', async () => {
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({ transport: zip(...entries) }).run(
      context,
      () => {},
      control(),
    );
    expect(context.siteResults?.[REPO_CHECK_ID]).toEqual({
      id: REPO_CHECK_ID,
      status: 'completed',
    });
    expect(context.siteEvidence).toMatchObject([
      {
        check: REPO_CHECK_ID,
        kind: 'repo-migration',
        verdict: 'INCONCLUSIVE',
        proof: 'UNVERIFIED',
        table: 'orders',
        subject: 'supabase/migrations/001_init.sql',
        line: 1,
      },
    ]);
    const text = JSON.stringify(context.siteEvidence);
    expect(text).toContain('may be enabled elsewhere');
    expect(text).not.toContain('"LEAKED"');
  });

  it('a cut list is said in the limits and does not hold the gate', async () => {
    const sql = Array.from(
      { length: MAX_MIGRATION_HITS + 2 },
      (_, i) => `create table t${i} (id int);`,
    ).join('\n');
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({
      transport: zip({ name: 'o-r-1/migrations/1.sql', data: sql }),
    }).run(context, () => {}, control());
    const checks = checksFor(CHECKS, provided);
    const coverage = buildCoverage(
      checks,
      collectResults(checks, {
        findings: [],
        cleanup: null,
        dataAccess: { status: 'notProvided' },
        provided,
        siteResults: context.siteResults,
      }),
    );
    expect(coverage.checked).toContain(REPO_CHECK_ID);
    expect(context.siteEvidence).toHaveLength(MAX_MIGRATION_HITS);
    expect(coverage.limits.map((l) => l.en).join(' ')).toContain(
      'tables without row level security in the migrations is not complete',
    );
    const gate = evaluateGate({
      plan: planChecks(CHECKS, provided),
      coverage,
      evidence: context.siteEvidence ?? [],
      cleanup: null,
    });
    expect(gate.decision).toBe('ready_by_these_checks');
  });

  it('the fixed limits say what is and is not followed', async () => {
    const checks = checksFor(CHECKS, provided);
    const limits = buildCoverage(checks, []).limits.map((l) => l.en).join(' ');
    expect(limits).toContain('may be enabled elsewhere');
    expect(limits).toContain('public schema');
    expect(limits).toContain('any folder called migrations');
    expect(limits).toContain('PARTITION OF');
  });
});

describe('roadmap and gate for a table without RLS in the migrations', () => {
  const plan = planChecks(CHECKS, provided);
  const checks = checksFor(CHECKS, provided);
  const coverage = buildCoverage(
    checks,
    collectResults(checks, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      provided,
      siteResults: { [REPO_CHECK_ID]: { id: REPO_CHECK_ID, status: 'completed' } },
    }),
  );
  const item = (table: string) => ({
    id: 'ev_site_repo-secrets_1',
    check: REPO_CHECK_ID,
    findingId: null,
    table,
    subject: 'supabase/migrations/001.sql',
    line: 2,
    kind: 'repo-migration' as const,
    verdict: 'INCONCLUSIVE' as const,
    proof: 'UNVERIFIED' as const,
    summary: { en: 'x', ur: 'x' },
  });
  const items = (table: string) =>
    buildRoadmap({ plan, findings: [], evidence: [item(table)], coverage, cleanup: null, provided })
      .items.filter((i) => i.kind !== 'provide-input');

  it('is one improve-repo item (high, like a public variable name) with its own specific prompt', () => {
    const [one, ...rest] = items('orders');
    expect(rest).toHaveLength(0);
    expect(one).toMatchObject({
      kind: 'improve-repo',
      severity: 'high',
      refs: { checkId: REPO_CHECK_ID, evidenceIds: ['ev_site_repo-secrets_1'] },
    });
    expect(one.title.en).toContain('"orders"');
    expect(one.why.en).toContain('may be enabled elsewhere');
    expect(one.fixPrompt!.en).toContain('alter table public.orders enable row level security');
    expect(one.fixPrompt!.en).toContain('show me the policies');
    expect(one.fixPrompt!.en).toContain('Show me the plan first');
    expect(one.fixPrompt!.ur).toContain('Pehle mujhe plan dikhao');
    expect(JSON.stringify(one)).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{8,}/);
  });

  it('a name that is not plain SQL is quoted in the prompt', () => {
    expect(sqlName('orders')).toBe('orders');
    expect(sqlName('My Orders')).toBe('"My Orders"');
    expect(sqlName('Orders')).toBe('"Orders"');
    expect(items('My Orders')[0].fixPrompt!.en).toContain('public."My Orders"');
  });

  it('never makes the gate not_ready by itself', () => {
    const without = evaluateGate({ plan, coverage, evidence: [], cleanup: null });
    const withItem = evaluateGate({ plan, coverage, evidence: [item('orders')], cleanup: null });
    expect(withItem).toEqual(without);
    expect(withItem.decision).toBe('ready_by_these_checks');
  });
});
