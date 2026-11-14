import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/prover/types.js';
import { buildPayload } from '../../src/report/report-payload.js';
import { buildPrompt } from '../../src/report/report-prompt.js';
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
      'Another logged-in user could read, change and delete a row of safe_deposit. The table is LEAKED.';
    expect(check(text, 'LEAKED', ['safe_deposit'])).toBeNull();
  });

  it('accepts a correct answer about a table whose whole name is a banned word', () => {
    expect(
      check(
        'Anyone could read rows of certificate. The table is LEAKED.',
        'LEAKED',
        ['certificate'],
      ),
    ).toBeNull();
    expect(
      check(
        'A visitor could read the rows of safe. The table is LEAKED.',
        'LEAKED',
        ['safe'],
      ),
    ).toBeNull();
    // the same words without a table of that name are still claims
    expect(
      check(
        'A visitor could read the rows of safe. The table is LEAKED.',
        'LEAKED',
        [],
      ),
    ).toBe('claim');
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
    expect(check('a'.repeat(400), 'INCONCLUSIVE', [])).toBeNull();
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
        {
          id: 'f1',
          explanation: 'User B was able to read bookings. The table is LEAKED.',
        },
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
        {
          id: 'f1',
          explanation: 'User B was able to read bookings. The table is LEAKED.',
        },
        {
          id: 'f2',
          explanation:
            'A visitor was able to read rows of safe_deposit. The table is LEAKED.',
        },
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

describe('the tightened rules', () => {
  it('rejects the example that hedges and rates the finding', () => {
    const text =
      'User B was able to read and delete a row they should not access, while an anonymous visitor was blocked. The owner could read the row as expected. This indicates a critical data leak.';
    expect(check(text, 'LEAKED', ['bookings'])).not.toBeNull();
  });

  it('accepts the example with two plain sentences and the verdict word', () => {
    const text =
      "User B could read and delete the owner's row, while an anonymous visitor was blocked. The table is LEAKED.";
    expect(check(text, 'LEAKED', ['bookings'])).toBeNull();
  });

  it('accepts "could not" on INCONCLUSIVE', () => {
    const text =
      'The owner could not read the test row, so the other actors could not be compared. The table is INCONCLUSIVE.';
    expect(check(text, 'INCONCLUSIVE', ['bookings'])).toBeNull();
  });

  it('rejects a LEAKED text that never says leak or LEAKED', () => {
    expect(
      check(
        'User B was able to read the row, while the visitor was blocked. The table has a problem.',
        'LEAKED',
        [],
      ),
    ).toBe('missing-leak');
    expect(
      check(
        'User B was able to read the row. The table is LEAKED.',
        'LEAKED',
        [],
      ),
    ).toBeNull();
    expect(
      check('User B was able to read the row. A leak was found.', 'LEAKED', []),
    ).toBeNull();
  });

  describe('severity words, on every verdict', () => {
    const words = ['critical', 'severe', 'severity', 'high', 'major', 'low'];
    const verdicts = ['LEAKED', 'BLOCKED', 'INCONCLUSIVE'] as const;
    for (const verdict of verdicts) {
      it.each(words)(`rejects "%s" on ${verdict}`, (word) => {
        const text = `This is a ${word} case. The table is ${verdict}.`;
        expect(check(text, verdict, [])).toBe('severity');
      });
    }

    it('does not reject a table whose name holds such a word', () => {
      expect(
        check(
          'User B was able to read high_scores. The table is LEAKED.',
          'LEAKED',
          ['high_scores'],
        ),
      ).toBeNull();
      expect(
        check('User B was able to read low. The table is LEAKED.', 'LEAKED', [
          'low',
        ]),
      ).toBeNull();
    });
  });

  describe('hedge words', () => {
    const hedges = [
      'This indicates a leak.',
      'This suggests a leak.',
      'Data may leak.',
      'Data might leak.',
      'There is a risk of a leak.',
      'This is a potential leak.',
      'This could be a leak.',
    ];
    it.each(hedges)('rejects "%s" on LEAKED', (text) => {
      expect(check(text, 'LEAKED', [])).toBe('hedge');
    });
    it.each([
      'This indicates that nobody got rows.',
      'It may be fine, it might not. The table is BLOCKED.',
      'There is no risk found. The table is BLOCKED.',
      'This could mean no rows came back. The table is BLOCKED.',
    ])('rejects "%s" on BLOCKED', (text) => {
      expect(check(text, 'BLOCKED', [])).toBe('hedge');
    });
    it('allows them on INCONCLUSIVE', () => {
      expect(
        check(
          'This may mean the owner column is missing, so it could not be checked. The table is INCONCLUSIVE.',
          'INCONCLUSIVE',
          [],
        ),
      ).toBeNull();
    });
    it('does not treat "could read" or "could not" as a hedge', () => {
      expect(
        check('User B could read the row. The table is LEAKED.', 'LEAKED', []),
      ).toBeNull();
      expect(
        check(
          'User B could not read the row. The table is BLOCKED.',
          'BLOCKED',
          [],
        ),
      ).toBeNull();
    });
  });

  it('keeps the old checks: a claim and a contradiction are still rejected', () => {
    expect(
      check('The app is secure. The table is BLOCKED.', 'BLOCKED', []),
    ).toBe('claim');
    expect(
      check('There is no leak here. The table is LEAKED.', 'LEAKED', []),
    ).toBe('contradicts-verdict');
    expect(
      check(
        'Data was leaked to visitors. The table is BLOCKED.',
        'BLOCKED',
        [],
      ),
    ).toBe('contradicts-verdict');
  });
});

describe('the prompt', () => {
  const prompt = buildPrompt([finding('f1', 'bookings')]).system;

  it('asks for exactly two sentences with the verdict word', () => {
    expect(prompt).toContain('exactly two sentences');
    expect(prompt).toContain('Sentence 1');
    expect(prompt).toContain('Sentence 2');
    for (const word of ['LEAKED', 'BLOCKED', 'INCONCLUSIVE']) {
      expect(prompt).toContain(word);
    }
  });

  it('forbids severity words and soft words', () => {
    expect(prompt).toContain('Never mention severity');
    for (const word of ['critical', 'severe', 'high', 'major', 'low']) {
      expect(prompt).toContain(word);
    }
    for (const word of [
      'indicates',
      'suggests',
      'may',
      'might',
      'could',
      'risk',
      'potential',
    ]) {
      expect(prompt).toContain(word);
    }
  });

  it('keeps the meaning of allowed=false, and does not ask for the table name', () => {
    expect(prompt).toContain('allowed=false means the actor got no rows');
    expect(prompt).not.toMatch(/table name/i);
  });
});
