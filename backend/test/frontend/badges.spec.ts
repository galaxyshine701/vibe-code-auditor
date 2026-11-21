import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// These tests check the logic of the frontend (frontend/src/lib/badges.ts).
// The file is loaded by path at run time, so the backend's TypeScript never
// compiles frontend code (see progress.spec.ts for why the tests run here).
type Verdict = 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE';
type BadgeId = 'first_audit' | 'first_fix' | 'no_leak_found';
interface BadgeRecord {
  at: string;
  celebrated: boolean;
}
type BadgeState = Partial<Record<BadgeId, BadgeRecord>>;
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface Finding {
  id: string;
  verdict: Verdict;
  retest: {
    status: 'not_run' | 'running' | 'passed' | 'failed';
    lastRunAt: string | null;
    previousVerdict?: Verdict | null;
  };
}
interface AwardContext {
  auditCompleted: boolean;
  retestActive: boolean;
  lastRetestStatus: 'running' | 'completed' | 'failed' | null;
  findings: readonly Finding[] | null;
  leaked: number;
  blocked: number;
  cleanup: 'ok' | 'failed' | null;
  actionObserved: boolean;
}
interface BadgesModule {
  BADGE_KEY: string;
  BADGE_IDS: readonly BadgeId[];
  parseBadgeState(raw: string | null): BadgeState;
  serializeBadgeState(state: BadgeState): string;
  createBadgeStore(getStorage: () => StorageLike | null): {
    read(): BadgeState;
    add(
      ids: readonly BadgeId[],
      at: string,
      celebrate?: readonly BadgeId[],
    ): BadgeState;
    markCelebrated(id: BadgeId): BadgeState;
  };
  decideAwards(
    state: BadgeState,
    context: AwardContext,
  ): { earn: BadgeId[]; celebrate: BadgeId[] };
  shouldAnimate(state: BadgeState, id: BadgeId, requested: boolean): boolean;
}

const FRONTEND_LIB = join(process.cwd(), '..', 'frontend', 'src', 'lib');
const {
  BADGE_KEY,
  BADGE_IDS,
  parseBadgeState,
  serializeBadgeState,
  createBadgeStore,
  decideAwards,
  shouldAnimate,
} = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND_LIB, 'badges.ts')).href
)) as BadgesModule;

const AT = '2026-11-15T10:00:00.000Z';

/** A fake localStorage. Two stores on the same fake behave like two tabs. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** One fake storage that the store keeps using (not a new one at every call). */
const oneStorage = () => {
  const storage = fakeStorage();
  return () => storage;
};

const finding = (
  verdict: Verdict,
  status: Finding['retest']['status'],
  previousVerdict: Verdict | null,
  id = 'f1',
): Finding => ({
  id,
  verdict,
  retest: { status, lastRunAt: null, previousVerdict },
});

/** A finished first audit with a leak: nothing but "first audit" holds. */
const firstAudit = (over: Partial<AwardContext> = {}): AwardContext => ({
  auditCompleted: true,
  retestActive: false,
  lastRetestStatus: null,
  findings: [finding('LEAKED', 'failed', null)],
  leaked: 1,
  blocked: 0,
  cleanup: 'ok',
  actionObserved: false,
  ...over,
});

/** A finished Re-test that fixed the leak: all three hold. */
const afterFix = (over: Partial<AwardContext> = {}): AwardContext => ({
  auditCompleted: true,
  retestActive: false,
  lastRetestStatus: 'completed',
  findings: [finding('BLOCKED', 'passed', 'LEAKED')],
  leaked: 0,
  blocked: 1,
  cleanup: 'ok',
  actionObserved: true,
  ...over,
});

describe('what is stored', () => {
  it('keeps only the three ids, a date and a flag, and nothing else', () => {
    const storage = fakeStorage();
    const store = createBadgeStore(() => storage);
    store.add(['first_audit', 'first_fix', 'no_leak_found'], AT);
    const text = storage.data.get(BADGE_KEY)!;
    const json = JSON.parse(text);
    expect(Object.keys(json).sort()).toEqual(['badges', 'v']);
    expect(Object.keys(json.badges).sort()).toEqual([
      'first_audit',
      'first_fix',
      'no_leak_found',
    ]);
    for (const record of Object.values(json.badges)) {
      expect(Object.keys(record as object).sort()).toEqual([
        'at',
        'celebrated',
      ]);
    }
    // no key, address, access code, table name or audit id
    for (const forbidden of [
      'http',
      'supabase',
      'aud_',
      'eyJ',
      'sb_',
      'table',
      'code',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text.length).toBeLessThan(500);
  });

  it('writes to the key vca-badges-v1', () => {
    expect(BADGE_KEY).toBe('vca-badges-v1');
    const storage = fakeStorage();
    createBadgeStore(() => storage).add(['first_audit'], AT);
    expect([...storage.data.keys()]).toEqual(['vca-badges-v1']);
  });

  it('serializes a state with extra fields without them', () => {
    const dirty = {
      first_audit: {
        at: AT,
        celebrated: true,
        projectUrl: 'https://x.supabase.co',
      },
    } as unknown as BadgeState;
    expect(serializeBadgeState(dirty)).not.toContain('supabase');
  });
});

describe('reading what is stored', () => {
  const ok = (badges: unknown, v: unknown = 1) => JSON.stringify({ v, badges });

  it('reads a good value', () => {
    const state = parseBadgeState(
      ok({ first_audit: { at: AT, celebrated: true } }),
    );
    expect(state).toEqual({ first_audit: { at: AT, celebrated: true } });
  });

  it.each([
    ['nothing', null],
    ['empty text', ''],
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['a number', '5'],
    ['another version', ok({ first_audit: { at: AT, celebrated: true } }, 2)],
    ['no version', JSON.stringify({ badges: {} })],
    ['badges that is not an object', ok('x')],
    ['badges that is an array', ok([])],
  ])('gives an empty state for %s', (_name, raw) => {
    expect(parseBadgeState(raw)).toEqual({});
  });

  it('drops an unknown badge and keeps the good one', () => {
    const state = parseBadgeState(
      ok({
        first_audit: { at: AT, celebrated: false },
        gold_star: { at: AT, celebrated: true },
      }),
    );
    expect(Object.keys(state)).toEqual(['first_audit']);
  });

  it.each([
    ['a date that is not a date', { at: 'not a date', celebrated: true }],
    ['a date that is not text', { at: 5, celebrated: true }],
    [
      'a date that is too long',
      { at: `${AT}${'0'.repeat(60)}`, celebrated: true },
    ],
    ['a flag that is not a boolean', { at: AT, celebrated: 'yes' }],
    ['no flag', { at: AT }],
    ['a record that is not an object', 'x'],
  ])('drops a record with %s', (_name, record) => {
    expect(parseBadgeState(ok({ first_audit: record }))).toEqual({});
  });

  it('ignores a value that is too big', () => {
    const big = ok({
      first_audit: { at: AT, celebrated: true },
      pad: 'x'.repeat(5_000),
    });
    expect(parseBadgeState(big)).toEqual({});
  });

  it('drops extra fields of a record', () => {
    const state = parseBadgeState(
      ok({ first_audit: { at: AT, celebrated: true, extra: 'x' } }),
    );
    expect(state.first_audit).toEqual({ at: AT, celebrated: true });
  });
});

describe('the store', () => {
  it('only adds: an earned badge is never overwritten', () => {
    const store = createBadgeStore(oneStorage());
    store.add(['first_audit'], AT, ['first_audit']);
    const later = store.add(['first_audit'], '2027-01-01T00:00:00.000Z');
    expect(later.first_audit).toEqual({ at: AT, celebrated: false });
  });

  it('a second tab does not lose a badge of the first', () => {
    const storage = fakeStorage();
    const tabOne = createBadgeStore(() => storage);
    const tabTwo = createBadgeStore(() => storage);
    tabOne.read();
    tabTwo.read();
    tabOne.add(['first_audit'], AT);
    const state = tabTwo.add(['first_fix'], AT);
    expect(Object.keys(state).sort()).toEqual(['first_audit', 'first_fix']);
    expect(
      Object.keys(parseBadgeState(storage.data.get(BADGE_KEY)!)).sort(),
    ).toEqual(['first_audit', 'first_fix']);
  });

  it('stores a badge as celebrated unless its animation is still to run', () => {
    const store = createBadgeStore(oneStorage());
    const state = store.add(['first_audit', 'first_fix'], AT, ['first_fix']);
    expect(state.first_audit?.celebrated).toBe(true);
    expect(state.first_fix?.celebrated).toBe(false);
  });

  it('markCelebrated sets the flag, once, and ignores a badge that is not earned', () => {
    const storage = fakeStorage();
    const store = createBadgeStore(() => storage);
    store.add(['first_fix'], AT, ['first_fix']);
    expect(store.markCelebrated('first_fix').first_fix?.celebrated).toBe(true);
    expect(store.markCelebrated('first_audit')).toEqual({
      first_fix: { at: AT, celebrated: true },
    });
  });

  it('keeps working in memory when the storage cannot be read or written', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = createBadgeStore(() => broken);
    expect(store.read()).toEqual({});
    expect(store.add(['first_audit'], AT)).toEqual({
      first_audit: { at: AT, celebrated: true },
    });
    expect(store.read().first_audit).toBeDefined();
  });

  it('keeps working in memory when there is no storage at all, or the getter throws', () => {
    const none = createBadgeStore(() => null);
    expect(none.add(['first_audit'], AT).first_audit).toBeDefined();
    expect(none.read().first_audit).toBeDefined();
    const throwing = createBadgeStore(() => {
      throw new Error('no window');
    });
    expect(throwing.add(['first_fix'], AT).first_fix).toBeDefined();
  });

  it('starts empty when the stored value is damaged', () => {
    const store = createBadgeStore(() =>
      fakeStorage({ [BADGE_KEY]: '{broken' }),
    );
    expect(store.read()).toEqual({});
    expect(Object.keys(store.add(['first_audit'], AT))).toEqual([
      'first_audit',
    ]);
  });
});

describe('which badges are earned', () => {
  it('first audit: when the audit is completed', () => {
    expect(decideAwards({}, firstAudit()).earn).toEqual(['first_audit']);
  });

  it.each([['not completed', { auditCompleted: false }]])(
    'nothing when the audit is %s',
    (_name, over) => {
      expect(decideAwards({}, afterFix(over)).earn).toEqual([]);
    },
  );

  it('first leak fixed and no leak found: after a Re-test that fixed the leak', () => {
    const { earn } = decideAwards({}, afterFix());
    expect([...earn].sort()).toEqual([
      'first_audit',
      'first_fix',
      'no_leak_found',
    ]);
  });

  it('first leak fixed needs a finished Re-test and a verified fix', () => {
    // a leak that became INCONCLUSIVE is not a fix
    const inconclusive = afterFix({
      findings: [finding('INCONCLUSIVE', 'passed', 'LEAKED')],
      leaked: 0,
      blocked: 0,
    });
    expect(decideAwards({}, inconclusive).earn).not.toContain('first_fix');
    // BLOCKED that was never LEAKED is not a fix
    const never = afterFix({ findings: [finding('BLOCKED', 'not_run', null)] });
    expect(decideAwards({}, never).earn).not.toContain('first_fix');
    // no Re-test yet
    const noRetest = afterFix({ lastRetestStatus: null });
    expect(decideAwards({}, noRetest).earn).not.toContain('first_fix');
  });

  it('no leak found: the same rule as the certificate', () => {
    const base = afterFix();
    expect(decideAwards({}, { ...base, leaked: 1 }).earn).not.toContain(
      'no_leak_found',
    );
    expect(decideAwards({}, { ...base, blocked: 0 }).earn).not.toContain(
      'no_leak_found',
    );
    expect(decideAwards({}, { ...base, cleanup: 'failed' }).earn).not.toContain(
      'no_leak_found',
    );
    expect(decideAwards({}, { ...base, cleanup: null }).earn).toContain(
      'no_leak_found',
    );
    expect(decideAwards({}, { ...base, cleanup: 'ok' }).earn).toContain(
      'no_leak_found',
    );
  });

  it('a badge that is already earned is not earned again', () => {
    const state: BadgeState = { first_audit: { at: AT, celebrated: true } };
    expect(decideAwards(state, firstAudit()).earn).toEqual([]);
    expect(decideAwards(state, afterFix()).earn.sort()).toEqual([
      'first_fix',
      'no_leak_found',
    ]);
  });

  it('a Re-test that failed gives nothing, even when every rule holds', () => {
    const failed = afterFix({ lastRetestStatus: 'failed' });
    expect(decideAwards({}, failed)).toEqual({ earn: [], celebrate: [] });
    // the same findings with a Re-test that finished do give the badges
    expect(decideAwards({}, afterFix()).earn.length).toBe(3);
  });

  it('a Re-test that is running gives nothing', () => {
    expect(decideAwards({}, afterFix({ retestActive: true }))).toEqual({
      earn: [],
      celebrate: [],
    });
    expect(decideAwards({}, afterFix({ lastRetestStatus: 'running' }))).toEqual(
      {
        earn: [],
        celebrate: [],
      },
    );
  });

  it('the Progress screen has no findings: only first audit and no leak found can hold', () => {
    const context = firstAudit({ findings: null, leaked: 0, blocked: 2 });
    expect(decideAwards({}, context).earn.sort()).toEqual([
      'first_audit',
      'no_leak_found',
    ]);
  });
});

describe('who gets the animation', () => {
  it("only a badge the user's own action produced", () => {
    const asked = decideAwards({}, afterFix({ actionObserved: true }));
    expect(asked.celebrate.sort()).toEqual(asked.earn.sort());
    expect(asked.celebrate.length).toBe(3);
  });

  it('a page that was just opened awards silently', () => {
    const opened = decideAwards({}, afterFix({ actionObserved: false }));
    expect(opened.earn.length).toBe(3);
    expect(opened.celebrate).toEqual([]);
  });

  it('shouldAnimate: once, for a badge that is earned and not celebrated yet', () => {
    const state: BadgeState = {
      first_audit: { at: AT, celebrated: false },
      first_fix: { at: AT, celebrated: true },
    };
    expect(shouldAnimate(state, 'first_audit', true)).toBe(true);
    // already shown: never again
    expect(shouldAnimate(state, 'first_fix', true)).toBe(false);
    // not asked, or not earned
    expect(shouldAnimate(state, 'first_audit', false)).toBe(false);
    expect(shouldAnimate(state, 'no_leak_found', true)).toBe(false);
  });

  it('the animation does not come back after it ended (store + shouldAnimate)', () => {
    const store = createBadgeStore(oneStorage());
    let state = store.add(['first_fix'], AT, ['first_fix']);
    expect(shouldAnimate(state, 'first_fix', true)).toBe(true);
    state = store.markCelebrated('first_fix');
    expect(shouldAnimate(state, 'first_fix', true)).toBe(false);
  });
});

describe('the ids', () => {
  it('are exactly the three badges', () => {
    expect([...BADGE_IDS]).toEqual([
      'first_audit',
      'first_fix',
      'no_leak_found',
    ]);
  });
});
