import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/prover/types.js';
import { buildPayload } from '../../src/report/report-payload.js';
import {
  buildPrompt,
  RESPONSE_SCHEMA,
} from '../../src/report/report-prompt.js';
import {
  checkExplanation,
  checkSentence,
  parseChunk,
  removeTableNames,
  sanitizeExplanation,
  wordsOutsideVocabulary,
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
        'Turn on Row Level Security for bookings. No leak found by these checks, so the table is BLOCKED.',
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
    const tail = ' The table is INCONCLUSIVE.'; // 27 characters
    const sized = (total: number) =>
      `${'a'.repeat(total - tail.length - 1)}.${tail}`;
    expect(check('', 'LEAKED', [])).toBe('length');
    expect(sized(400).length).toBe(400);
    expect(check(sized(400), 'INCONCLUSIVE', [])).toBeNull();
    expect(check(sized(401), 'INCONCLUSIVE', [])).toBe('length');
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
      expect(
        check(
          `No leak found by these checks. The table is ${verdict}.`,
          verdict,
          [],
        ),
      ).toBeNull();
    },
  );
});

describe('parseChunk', () => {
  const chunk = [finding('f1', 'bookings'), finding('f2', 'safe_deposit')];
  const answer = (items: unknown) => JSON.stringify({ items });

  it('composes the explanation: the AI sentence, then the result sentence from the program', () => {
    const parsed = parseChunk(
      answer([
        { id: 'f1', sentence: 'User B was able to read bookings.' },
        { id: 'f2', sentence: 'this table is safe' },
      ]),
      chunk,
    );
    expect([...parsed.accepted.keys()]).toEqual(['f1']);
    expect(parsed.accepted.get('f1')).toBe(
      'User B was able to read bookings. The table is LEAKED.',
    );
    expect(parsed.rejected).toBe(1);
    expect(parsed.unusable).toBe(false);
  });

  it('accepts a correct answer about safe_deposit', () => {
    const parsed = parseChunk(
      answer([
        { id: 'f1', sentence: 'User B was able to read bookings.' },
        {
          id: 'f2',
          sentence: 'A visitor was able to read rows of safe_deposit.',
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
        { id: 'other', sentence: 'User B was able to read the row.' },
        { id: 'f1', sentence: 'User B was able to read the row.' },
        { id: 'f1', sentence: 'The owner was able to read the row.' },
      ]),
      chunk,
    );
    expect(parsed.accepted.size).toBe(0);
    expect(parsed.rejected).toBe(2);
  });

  it('rejects an item with an extra key, the old key "explanation", or a non-text sentence', () => {
    const parsed = parseChunk(
      answer([
        {
          id: 'f1',
          sentence: 'User B was able to read the row.',
          severity: 'low',
        },
        { id: 'f2', sentence: 5 },
      ]),
      chunk,
    );
    expect(parsed.accepted.size).toBe(0);
    const old = parseChunk(
      answer([
        {
          id: 'f1',
          explanation: 'User B was able to read the row. The table is LEAKED.',
        },
      ]),
      chunk,
    );
    expect(old.accepted.size).toBe(0);
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
      check(
        'User B was able to read the row. The table is LEAKED, a leak was found.',
        'LEAKED',
        [],
      ),
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

  it('asks for one sentence, and says the program adds the result sentence', () => {
    expect(prompt).toContain('exactly ONE sentence');
    expect(prompt).toContain('The table is <VERDICT>.');
    expect(prompt).not.toContain('exactly two sentences');
    for (const word of ['LEAKED', 'BLOCKED', 'INCONCLUSIVE']) {
      expect(prompt).toContain(word);
    }
  });

  it('lists the words it may use, as the validator has them', () => {
    expect(prompt).toContain('Use ONLY these words');
    for (const word of [
      'user',
      'visitor',
      'owner',
      'read',
      'delete',
      'block',
      'row',
      'expected',
    ]) {
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
      'risk',
      'potential',
    ]) {
      expect(prompt).toContain(word);
    }
  });

  it('tells INCONCLUSIVE to say the result cannot be trusted, and not to say blocked', () => {
    expect(prompt).toContain('so the result cannot be trusted');
    expect(prompt).toContain(
      'Do not use the words blocked, denied, protected, safe or secure for INCONCLUSIVE',
    );
  });

  it('keeps the meaning of allowed=false, and does not ask for the table name', () => {
    expect(prompt).toContain('allowed=false means the actor got no rows');
    expect(prompt).toContain('Do not write the table name');
  });

  it('asks for the answer field "sentence"', () => {
    expect(JSON.stringify(RESPONSE_SCHEMA)).toContain('"sentence"');
    expect(JSON.stringify(RESPONSE_SCHEMA)).not.toContain('"explanation"');
  });
});

describe('plain characters (the sanitizer is unchanged)', () => {
  const SENTENCE = 'User B was able to read the row.';
  const COMPOSED = 'User B was able to read the row. The table is LEAKED.';
  const chunk = [finding('f1', 'bookings')];
  /** What is kept for one sentence written by the AI. */
  const kept = (sentence: string) =>
    parseChunk(
      JSON.stringify({ items: [{ id: 'f1', sentence }] }),
      chunk,
    ).accepted.get('f1');

  it.each([
    ['no-break space', '\u00a0'],
    ['narrow no-break space', '\u202f'],
    ['thin space', '\u2009'],
    ['hair space', '\u200a'],
    ['figure space', '\u2007'],
    ['ideographic space', '\u3000'],
    // NFKC leaves this one alone, so the explicit space rule is what handles it
    ['ogham space mark', '\u1680'],
  ])(
    'turns a %s into a normal space and keeps the plain text',
    (_name, space) => {
      const odd = `${['User', 'B', 'was', 'able', 'to', 'read', 'the', 'row'].join(space)}.`;
      expect(sanitizeExplanation(odd)).toBe(SENTENCE);
      expect(kept(odd)).toBe(COMPOSED);
    },
  );

  it.each([
    ['zero-width space', '\u200b'],
    ['zero-width joiner', '\u200d'],
    ['word joiner', '\u2060'],
    ['byte order mark', '\ufeff'],
    ['soft hyphen', '\u00ad'],
  ])('rejects a %s, which could hide a word', (_name, mark) => {
    expect(sanitizeExplanation(`The${mark}table`)).toBeNull();
    expect(
      check(
        `User B was able to read the row. The${mark}table is LEAKED.`,
        'LEAKED',
        [],
      ),
    ).toBe('characters');
    expect(
      check(`The app is se${mark}cure. The table is BLOCKED.`, 'BLOCKED', []),
    ).toBe('characters');
    expect(kept(`User B was able to read the${mark}row.`)).toBeUndefined();
  });

  it('turns full-width letters into normal letters, so a hidden claim is still caught', () => {
    expect(
      check(
        'The app is \uff53\uff45\uff43\uff55\uff52\uff45. The table is BLOCKED.',
        'BLOCKED',
        [],
      ),
    ).toBe('claim');
  });

  it('rejects a letter from another alphabet, an accent and an emoji', () => {
    expect(sanitizeExplanation('The t\u0430ble')).toBeNull(); // Cyrillic a
    expect(sanitizeExplanation('caf\u00e9')).toBeNull();
    expect(sanitizeExplanation('fine \ud83d\ude00')).toBeNull();
  });

  it('turns curly quotes and long dashes into plain ones', () => {
    const odd =
      'User B was able to read the owner\u2019s row \u2013 all of it.';
    expect(kept(odd)).toBe(
      "User B was able to read the owner's row - all of it. The table is LEAKED.",
    );
  });

  it('collapses repeated spaces and trims', () => {
    expect(sanitizeExplanation('  a   b \u00a0\u00a0 c  ')).toBe('a b c');
  });

  it('still refuses a line break or a tab as before', () => {
    expect(
      check('Line one.\nLine two. The table is LEAKED.', 'LEAKED', []),
    ).toBe('shape');
    expect(check('Tab\there. The table is LEAKED.', 'LEAKED', [])).toBe(
      'shape',
    );
  });
});

describe('the composed text: exactly two sentences, the second with the verdict word', () => {
  it.each(['LEAKED', 'BLOCKED', 'INCONCLUSIVE'] as const)(
    'accepts two sentences for %s',
    (verdict) => {
      expect(
        check(
          `Each actor was checked on the test row. The table is ${verdict}.`,
          verdict,
          [],
        ),
      ).toBeNull();
    },
  );

  it('rejects one sentence and three sentences', () => {
    expect(check('The table is LEAKED.', 'LEAKED', [])).toBe('sentences');
    expect(
      check(
        'User B was able to read the row. The visitor was blocked. The table is LEAKED.',
        'LEAKED',
        [],
      ),
    ).toBe('sentences');
  });

  it('rejects a second sentence without the verdict word, or with it in small letters', () => {
    expect(
      check(
        'User B was able to read the row. The owner should look at it, this is a leak.',
        'LEAKED',
        [],
      ),
    ).toBe('verdict-word');
    expect(
      check(
        'User B was able to read the row. The table is leaked.',
        'LEAKED',
        [],
      ),
    ).toBe('verdict-word');
  });

  it('rejects the verdict word only in the first sentence', () => {
    expect(
      check(
        'The table is LEAKED because user B was able to read the row. The owner should act.',
        'LEAKED',
        [],
      ),
    ).toBe('verdict-word');
  });

  it('rejects the verdict word of another verdict', () => {
    expect(
      check(
        'Each actor was checked on the test row. The table is BLOCKED.',
        'INCONCLUSIVE',
        [],
      ),
    ).toBe('verdict-word');
  });
});

describe('a mixed chunk (LEAKED, BLOCKED, INCONCLUSIVE)', () => {
  const chunk = [
    finding('f1', 'safe_deposit', 'LEAKED'),
    finding('f2', 'bookings', 'BLOCKED'),
    finding('f3', 'hotels', 'INCONCLUSIVE'),
  ];
  const sentences: Record<string, string> = {
    f1: "User B was able to read and delete the owner's row, while the visitor was blocked.",
    f2: 'User B and the visitor were blocked, and the owner was able to read the row.',
    f3: 'User B and the visitor did not see any row, and the owner could not read its own row, so the result cannot be trusted.',
  };
  const answer = (over: Record<string, string> = {}) =>
    JSON.stringify({
      items: Object.entries({ ...sentences, ...over }).map(
        ([id, sentence]) => ({
          id,
          sentence,
        }),
      ),
    });

  it('accepts all three and composes each text with its own verdict word', () => {
    const parsed = parseChunk(answer(), chunk);
    expect([...parsed.accepted.keys()].sort()).toEqual(['f1', 'f2', 'f3']);
    expect(parsed.rejected).toBe(0);
    expect(parsed.accepted.get('f1')).toMatch(/ The table is LEAKED\.$/);
    expect(parsed.accepted.get('f2')).toMatch(/ The table is BLOCKED\.$/);
    expect(parsed.accepted.get('f3')).toMatch(/ The table is INCONCLUSIVE\.$/);
  });

  it('rejects only the findings with a bad sentence', () => {
    const parsed = parseChunk(
      answer({
        f2: 'The table is secure.',
        f3: 'The\u200btable could not be checked.',
      }),
      chunk,
    );
    expect([...parsed.accepted.keys()]).toEqual(['f1']);
    expect(parsed.rejected).toBe(2);
  });
});

describe('the program writes the second sentence', () => {
  const chunk = [finding('f1', 'bookings')];
  const kept = (sentence: unknown) =>
    parseChunk(
      JSON.stringify({ items: [{ id: 'f1', sentence }] }),
      chunk,
    ).accepted.get('f1');

  it('adds " The table is {VERDICT}." itself', () => {
    expect(kept('User B was able to read the row')).toBe(
      'User B was able to read the row. The table is LEAKED.',
    );
    expect(kept('User B was able to read the row.')).toBe(
      'User B was able to read the row. The table is LEAKED.',
    );
  });

  it('rejects an AI sentence that is two sentences, or empty', () => {
    expect(
      kept(
        'User B was able to read the row. The owner was able to read the row.',
      ),
    ).toBeUndefined();
    expect(kept('...')).toBeUndefined();
    expect(kept('')).toBeUndefined();
  });

  it('does not accept the verdict word from the AI (it is not in the vocabulary)', () => {
    expect(kept('The table is LEAKED')).toBeUndefined();
  });
});

describe('the closed vocabulary of the AI sentence', () => {
  const f = finding('f1', 'bookings');
  const sentence = (
    text: string,
    verdict: Finding['verdict'] = 'LEAKED',
    tables: string[] = ['bookings'],
  ) => checkSentence(text, { verdict }, tables);

  it.each([
    "User B was able to read and delete the owner's row, while the visitor was blocked",
    'User B and the visitor were blocked, and the owner was able to read the row',
    'user_b could read the row but the anonymous visitor could not',
    'The anonymous visitor was blocked from reading the data in its row',
    'User B was able to update and change rows, and also access data from their owner',
    'Only the owner was able to see the row, as expected',
    'User B returned 1 row and the owner checked and verified it',
    'User B was not able to read rows, but the owner could',
    'A logged-in user was able to read the row without login',
  ])('accepts: %s', (text) => {
    expect(sentence(text)).toBeNull();
  });

  it.each([
    ['Thetable', 'User B was able to read Thetable'],
    ['tableis', 'User B was able to read the tableis'],
    ['a glued actor', 'UserB was able to read the row'],
    ['an unknown word', 'User B was able to download the row'],
    ['a rating', 'User B was able to read the row and it is critical'],
    ['a table word that is not a name', 'User B was able to read the table'],
    ['a quote', 'User B was able to read "the row"'],
    ['a bracket', 'User B was able to read the row (all of it)'],
    ['a colon', 'Result: User B was able to read the row'],
  ])('rejects %s', (_name, text) => {
    expect(sentence(text)).toBe('vocabulary');
  });

  it('lets the AI write the name of a table of the chunk, and only a name of the chunk', () => {
    expect(
      sentence('User B was able to read bookings', 'LEAKED', ['bookings']),
    ).toBeNull();
    expect(sentence('User B was able to read bookings', 'LEAKED', [])).toBe(
      'vocabulary',
    );
    expect(
      sentence('User B was able to read safe_deposit', 'LEAKED', [
        'safe_deposit',
      ]),
    ).toBeNull();
  });

  it('allows the words for the result only on INCONCLUSIVE', () => {
    const text =
      'User B and the visitor did not see any row, so the result cannot be trusted';
    expect(sentence(text, 'INCONCLUSIVE')).toBeNull();
    expect(sentence(text, 'LEAKED')).toBe('vocabulary');
    expect(sentence(text, 'BLOCKED')).toBe('vocabulary');
  });

  it('lists the words outside the vocabulary', () => {
    expect(
      wordsOutsideVocabulary('The tableis ready', { verdict: 'BLOCKED' }, []),
    ).toEqual(['tableis', 'ready']);
    expect(f.table).toBe('bookings');
  });
});

describe('glued words are not repaired', () => {
  const kept = (sentence: string) =>
    parseChunk(JSON.stringify({ items: [{ id: 'f1', sentence }] }), [
      finding('f1', 'bookings'),
    ]).accepted.get('f1');

  it.each([
    ['therow', 'User B was able to read therow'],
    ['Thetable', 'Thetable was read by User B'],
    ['tableis', 'User B was able to read the tableis'],
    ['ofthe', 'User B was able to read the data ofthe owner'],
  ])(
    'rejects the plain glued word in "%s" and does not split it',
    (_word, sentence) => {
      expect(kept(sentence)).toBeUndefined();
      // the sanitizer does not touch letters: the glued word stays as it is
      expect(sanitizeExplanation(sentence)).toBe(sentence);
    },
  );

  it('only a space-like character is replaced, and then the words are two words', () => {
    // looks like "therow" in a terminal, but the characters between are spaces
    expect(kept('User B was able to read the\u200arow')).toBe(
      'User B was able to read the row. The table is LEAKED.',
    );
    expect(kept('User B was able to read the\u202frow')).toBe(
      'User B was able to read the row. The table is LEAKED.',
    );
  });
});

describe('"trust" is not in the vocabulary, only "trusted"', () => {
  const inconclusive = (text: string) =>
    checkSentence(text, { verdict: 'INCONCLUSIVE' }, []);

  it('rejects "... so the result cannot be trust" on INCONCLUSIVE', () => {
    expect(
      inconclusive(
        'User B and the visitor did not see any row, so the result cannot be trust',
      ),
    ).toBe('vocabulary');
    const parsed = parseChunk(
      JSON.stringify({
        items: [
          {
            id: 'f1',
            sentence:
              'User B and the visitor did not see any row, so the result cannot be trust.',
          },
        ],
      }),
      [finding('f1', 'hotels', 'INCONCLUSIVE')],
    );
    expect(parsed.accepted.size).toBe(0);
  });

  it('rejects "trusts" and "trust", and accepts "trusted"', () => {
    expect(inconclusive('The owner trusts the result')).toBe('vocabulary');
    expect(inconclusive('The result cannot trust')).toBe('vocabulary');
    expect(inconclusive('so the result cannot be trusted')).toBeNull();
  });

  it('is not in the words told to the AI either', () => {
    const prompt = buildPrompt([
      finding('f1', 'hotels', 'INCONCLUSIVE'),
    ]).system;
    expect(prompt).toContain('trusted');
    expect(prompt).not.toMatch(/\btrust\b/);
    expect(prompt).not.toMatch(/\btrusts\b/);
  });
});

describe('INCONCLUSIVE does not sound like a clear answer', () => {
  const chunk = [finding('f1', 'hotels', 'INCONCLUSIVE')];
  const text =
    'User B and the visitor were blocked from reading, and the owner could not be checked.';

  it('rejects the sentence "... were blocked from reading, and the owner could not be checked."', () => {
    expect(
      checkSentence(text.replace(/\.$/, ''), { verdict: 'INCONCLUSIVE' }, []),
    ).toBe('inconclusive-word');
    const parsed = parseChunk(
      JSON.stringify({ items: [{ id: 'f1', sentence: text }] }),
      chunk,
    );
    expect(parsed.accepted.size).toBe(0);
    expect(parsed.rejected).toBe(1);
  });

  it.each(['blocked', 'denied', 'protected', 'safe', 'secure'])(
    'rejects "%s"',
    (word) => {
      expect(
        checkSentence(
          `User B was ${word} and the owner could not read the row`,
          { verdict: 'INCONCLUSIVE' },
          [],
        ),
      ).not.toBeNull();
    },
  );

  it('accepts the sentence the prompt asks for', () => {
    expect(
      checkSentence(
        'User B and the visitor did not see any row, and the owner could not read its own row, so the result cannot be trusted',
        { verdict: 'INCONCLUSIVE' },
        [],
      ),
    ).toBeNull();
  });

  it('allows "blocked" on LEAKED and BLOCKED', () => {
    for (const verdict of ['LEAKED', 'BLOCKED'] as const) {
      expect(
        checkSentence(
          'The visitor was blocked and the owner was able to read the row',
          { verdict },
          [],
        ),
      ).toBeNull();
    }
  });
});

describe('the checks of the whole text still run on the composed text', () => {
  const kept = (sentence: string, verdict: Finding['verdict']) =>
    parseChunk(JSON.stringify({ items: [{ id: 'f1', sentence }] }), [
      finding('f1', 'bookings', verdict),
    ]).accepted.get('f1');

  it.each(['LEAKED', 'BLOCKED'] as const)(
    'rejects "could be" (a soft word made of allowed words) on %s',
    (verdict) => {
      expect(
        kept('The visitor could be able to read the row', verdict),
      ).toBeUndefined();
      expect(
        kept('The visitor was able to read the row', verdict),
      ).toBeDefined();
    },
  );

  it('allows "could be" on INCONCLUSIVE', () => {
    expect(
      kept(
        'The owner could be checked, so the result cannot be trusted',
        'INCONCLUSIVE',
      ),
    ).toBeDefined();
  });
});
