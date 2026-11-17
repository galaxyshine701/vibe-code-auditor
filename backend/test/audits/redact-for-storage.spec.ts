import { redactForStorage } from '../../src/audits/redact-for-storage.js';

// Made-up values that are easy to search for. They are not real keys.
const SECRET = 'SECRET-KEY-VALUE-1a2b3c';
const PLATFORM = 'PLATFORM-KEY-VALUE-7e6d5c';
// not a real token: three base64url-looking parts, shaped like a JWT
const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl';

describe('redactForStorage', () => {
  it('replaces known secret values in every string, deep inside findings', () => {
    const record = {
      error: { code: 'X', message: `failed for key ${SECRET}` },
      cleanupNote: `platform ${PLATFORM} here`,
      findings: [
        {
          explanation: {
            en: `Reason: ${SECRET}.`,
            ur: `Wajah: ${SECRET}.`,
          },
          evidence: { operations: [{ note: `note ${PLATFORM}` }] },
        },
      ],
    };
    const clean = redactForStorage(record, [SECRET, PLATFORM]);
    const text = JSON.stringify(clean);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(PLATFORM);
    expect(text).toContain('[REDACTED]');
  });

  it('removes key shapes even when the value is not known', () => {
    const clean = redactForStorage(
      {
        a: `token ${JWT}`,
        b: 'key sb_secret_AbCdEfGh1234567890',
        c: 'key sb_publishable_AbCdEfGh1234567890',
        d: 'groq gsk_AbCdEfGhIjKlMnOpQrStUvWx',
      },
      [],
    );
    const text = JSON.stringify(clean);
    expect(text).not.toContain('eyJhbGci');
    expect(text).not.toContain('sb_secret_');
    expect(text).not.toContain('sb_publishable_');
    expect(text).not.toContain('gsk_');
  });

  it('an empty, tiny or blank secret does not change the text', () => {
    const text =
      'The second test user was blocked from reading its own row 12345.';
    const record = { a: text, list: [text], nested: { b: text } };
    for (const secrets of [
      [''],
      ['a'],
      [' '],
      ['abc12'], // 5 characters: under the minimum
      ['      '], // only spaces
      ['', 'e', ' ', 'abc12', '      '],
    ]) {
      expect(redactForStorage(record, secrets)).toEqual(record);
    }
    // a real secret in the same list is still removed
    const mixed = redactForStorage({ a: `${text} ${SECRET}` }, [
      '',
      'e',
      SECRET,
    ]);
    expect(mixed.a).toBe(`${text} [REDACTED]`);
  });

  it('keeps the placeholders of a reproducer (they are not keys)', () => {
    const reproducer =
      "curl -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <USER_B_JWT>' '<PROJECT_URL>/rest/v1/t'";
    expect(redactForStorage({ reproducer }, [SECRET]).reproducer).toBe(
      reproducer,
    );
  });

  it('returns a copy: the original is not changed, and numbers, nulls and keys stay', () => {
    const original = {
      n: 3,
      none: null,
      yes: true,
      text: SECRET,
      list: [SECRET],
    };
    const clean = redactForStorage(original, [SECRET]);
    expect(original.text).toBe(SECRET);
    expect(original.list[0]).toBe(SECRET);
    expect(clean).toEqual({
      n: 3,
      none: null,
      yes: true,
      text: '[REDACTED]',
      list: ['[REDACTED]'],
    });
  });
});
