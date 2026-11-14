import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/prover/types.js';
import { buildPayload } from '../../src/report/report-payload.js';
import {
  checkExplanation,
  parseChunk,
  removeTableNames,
} from '../../src/report/report-validate.js';

const finding = (
  id: string,
  table: string,
  verdict: Finding['verdict'] = 'LEAKED',
): Finding =>
  ({
    id,
    module: 'data-access-prover',
    table,
    operation: 'SELECT',
    verdict,
    severity: 'critical',
    title: 't',
    explanation: { en: 'template', ur: 'urdu' },
    evidence: {
      rowsReturned: 1,
      httpStatus: 200,
      canaryRowId: 'canary-123',
      reproducer: 'curl https://x.supabase.co',
      operations: [
        {
          operation: 'SELECT',
          actor: 'user_b',
          allowed: true,
          httpStatus: 200,
          rowsReturned: 1,
        },
      ],
    },
    fix: null,
    retest: { status: 'not_run', lastRunAt: null },
  }) as Finding;

const check = (text: string, verdict: Finding['verdict'], tables: string[]) =>
  checkExplanation(text, { verdict }, tables);

describe('banned words, after table names are removed', () => {
  it('accepts a correct answer that names a table called safe_deposit', () => {
    const text =
      'Another logged-in user could read, change and delete a row of safe_deposit.';
    expect(check(text, 'LEAKED', ['safe_deposit'])).toBeNull();
  });

  it('accepts a correct answer about a table whose whole name is a banned word', () => {
    expect(
      check('Anyone could read rows of certificate.', 'LEAKED', [
        'certificate',
      ]),
    ).toBeNull();
    expect(
      check('A visitor could read the rows of safe.', 'LEAKED', ['safe']),
    ).toBeNull();
    // the same words without a table of that name are still claims
    expect(check('A visitor could read the rows of safe.', 'LEAKED', [])).toBe(
      'claim',
    );
  });

  it('rejects "this table is safe"', () => {
    expect(check('this table is safe', 'BLOCKED', ['safe_deposit'])).toBe(
      'claim',
    );
    expect(
      check('safe_deposit is safe and nobody can read it.', 'BLOCKED', [
        'safe_deposit',
      ]),
    ).toBe('claim');
  });

  it.each([
    'The app is secure.',
    'Access is secured by policies.',
    'This is certified.',
    'It is guaranteed to be private.',
    'A certificate was issued.',
    'It works safely.',
  ])('rejects: %s', (text) => {
    expect(check(text, 'BLOCKED', ['bookings'])).toBe('claim');
  });

  it('accepts "Row Level Security" and the allowed phrase', () => {
    expect(
      check(
        'Turn on Row Level Security for bookings. No leak found by these checks.',
        'BLOCKED',
        ['bookings'],
      ),
    ).toBeNull();
  });

  it('keeps a banned word that only touches a table name from hiding a real claim', () => {
    expect(
      check('safe_deposit is protected and the app is secure.', 'BLOCKED', [
        'safe_deposit',
      ]),
    ).toBe('claim');
  });

  it('removes a table name only as a whole word', () => {
    expect(removeTableNames('x and exact and x_y', ['x'])).toBe(
      '  and exact and x_y',
    );
    expect(removeTableNames('a safe_deposit b', ['safe', 'safe_deposit'])).toBe(
      'a   b',
    );
  });
});

describe('what an answer may not contain', () => {
  const bad: [string, string][] = [
    ['an address', 'See https://example.test for details.'],
    ['a token start', 'The key eyJhbGciOi is shown.'],
    ['a supabase key start', 'Use sb_secret_abc here.'],
    ['a code fence', '```sql\nselect 1\n```'],
    ['SQL', 'Run create policy on bookings.'],
    ['a line break', 'Line one.\nLine two.'],
  ];
  it.each(bad)('rejects %s', (_name, text) => {
    expect(check(text, 'LEAKED', ['bookings'])).toBe('shape');
  });

  it('rejects an empty text and a text longer than 400 characters', () => {
    expect(check('', 'LEAKED', [])).toBe('length');
    expect(check('a'.repeat(400), 'LEAKED', [])).toBeNull();
    expect(check('a'.repeat(401), 'LEAKED', [])).toBe('length');
  });
});

describe('the verdict', () => {
  it('rejects "no leak" for LEAKED', () => {
    expect(check('There is no leak here.', 'LEAKED', [])).toBe(
      'contradicts-verdict',
    );
  });
  it.each(['BLOCKED', 'INCONCLUSIVE'] as const)(
    'rejects a leak claim for %s, but allows the standard phrase',
    (verdict) => {
      expect(check('Data was leaked to visitors.', verdict, [])).toBe(
        'contradicts-verdict',
      );
      expect(check('The rows are exposed.', verdict, [])).toBe(
        'contradicts-verdict',
      );
      expect(check('No leak found by these checks.', verdict, [])).toBeNull();
    },
  );
});

describe('parseChunk', () => {
  const chunk = [finding('f1', 'bookings'), finding('f2', 'safe_deposit')];
  const answer = (items: unknown) => JSON.stringify({ items });

  it('accepts good items and counts the rest', () => {
    const parsed = parseChunk(
      answer([
        { id: 'f1', explanation: 'Anyone logged in could read bookings.' },
        { id: 'f2', explanation: 'this table is safe' },
      ]),
      chunk,
    );
    expect([...parsed.accepted.keys()]).toEqual(['f1']);
    expect(parsed.rejected).toBe(1);
    expect(parsed.unusable).toBe(false);
  });

  it('accepts a correct answer about safe_deposit', () => {
    const parsed = parseChunk(
      answer([
        { id: 'f1', explanation: 'A logged-in user could read bookings.' },
        { id: 'f2', explanation: 'A visitor could read rows of safe_deposit.' },
      ]),
      chunk,
    );
    expect(parsed.accepted.size).toBe(2);
    expect(parsed.rejected).toBe(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['an array', '[]'],
    ['no items', '{}'],
    ['items that is not a list', '{"items":1}'],
  ])('treats %s as unusable', (_name, content) => {
    const parsed = parseChunk(content, chunk);
    expect(parsed.unusable).toBe(true);
    expect(parsed.rejected).toBe(2);
    expect(parsed.accepted.size).toBe(0);
  });

  it('ignores unknown ids, and drops an id that appears twice', () => {
    const parsed = parseChunk(
      answer([
        { id: 'other', explanation: 'Fine text.' },
        { id: 'f1', explanation: 'First text.' },
        { id: 'f1', explanation: 'Second text.' },
      ]),
      chunk,
    );
    expect(parsed.accepted.size).toBe(0);
    expect(parsed.rejected).toBe(2);
  });

  it('rejects an item with an extra key or a non-text explanation', () => {
    const parsed = parseChunk(
      answer([
        { id: 'f1', explanation: 'Fine text.', severity: 'low' },
        { id: 'f2', explanation: 5 },
      ]),
      chunk,
    );
    expect(parsed.accepted.size).toBe(0);
  });
});

describe('the payload', () => {
  it('has only the allowed fields', () => {
    const [item] = buildPayload([finding('f1', 'bookings')]);
    expect(Object.keys(item).sort()).toEqual([
      'hasFix',
      'id',
      'operations',
      'severity',
      'table',
      'verdict',
    ]);
    expect(Object.keys(item.operations[0]).sort()).toEqual([
      'actor',
      'allowed',
      'httpStatus',
      'operation',
      'rowsReturned',
    ]);
    const text = JSON.stringify(item);
    expect(text).not.toContain('canary-123');
    expect(text).not.toContain('supabase.co');
  });
});
