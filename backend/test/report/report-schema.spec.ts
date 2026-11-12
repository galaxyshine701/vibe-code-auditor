import {
  REPORT_LIMITS,
  hasUnnegated,
  parseReport,
} from '../../src/report/report-schema.js';
import { goodAnswer } from './helpers.js';

const withText = (
  verdict: 'LEAKED' | 'BLOCKED' | 'INCONCLUSIVE',
  explanationEn: string,
  extra: Record<string, unknown> = {},
) => goodAnswer(verdict, { explanationEn, ...extra });

describe('parseReport: shape and length', () => {
  const ctx = { verdict: 'LEAKED' as const, hasFix: true };

  it('accepts a good answer', () => {
    const result = parseReport(goodAnswer('LEAKED'), ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    expect(parseReport('Sure! Here you go', ctx)).toEqual({
      ok: false,
      reason: 'not-json',
    });
  });

  it('rejects an answer that is not an object', () => {
    expect(parseReport('["a"]', ctx)).toEqual({ ok: false, reason: 'shape' });
    expect(parseReport('"text"', ctx)).toEqual({ ok: false, reason: 'shape' });
    expect(parseReport('null', ctx)).toEqual({ ok: false, reason: 'shape' });
  });

  it('rejects a missing field and a field that is not text', () => {
    const missing = JSON.parse(goodAnswer('LEAKED')) as Record<string, unknown>;
    delete missing.title;
    expect(parseReport(JSON.stringify(missing), ctx).ok).toBe(false);
    expect(parseReport(goodAnswer('LEAKED', { title: 42 }), ctx)).toEqual({
      ok: false,
      reason: 'shape',
    });
  });

  it('rejects an extra field, so the AI cannot hand back a verdict', () => {
    for (const extra of [{ verdict: 'BLOCKED' }, { severity: 'info' }]) {
      expect(parseReport(goodAnswer('LEAKED', extra), ctx)).toEqual({
        ok: false,
        reason: 'shape',
      });
    }
  });

  it('rejects text that is too long or too short', () => {
    expect(
      parseReport(
        goodAnswer('LEAKED', {
          title: 'x'.repeat(REPORT_LIMITS.title.max + 1),
        }),
        ctx,
      ),
    ).toEqual({ ok: false, reason: 'length' });
    expect(
      parseReport(
        goodAnswer('LEAKED', {
          explanationEn: 'e'.repeat(REPORT_LIMITS.explanationEn.max + 1),
        }),
        ctx,
      ),
    ).toEqual({ ok: false, reason: 'length' });
    expect(
      parseReport(goodAnswer('LEAKED', { explanationUr: 'short' }), ctx),
    ).toEqual({ ok: false, reason: 'length' });
  });

  it('needs a fix description only when the Prover made a fix', () => {
    const noFix = { verdict: 'BLOCKED' as const, hasFix: false };
    const ok = parseReport(goodAnswer('BLOCKED'), noFix);
    expect(ok.ok && ok.value.fixDescription).toBe('');
    // text sent for a finding without a fix is dropped, not trusted
    const dropped = parseReport(
      goodAnswer('BLOCKED', { fixDescription: 'Do something else entirely.' }),
      noFix,
    );
    expect(dropped.ok && dropped.value.fixDescription).toBe('');
    // a finding with a fix must have a real description
    expect(
      parseReport(goodAnswer('LEAKED', { fixDescription: '' }), ctx),
    ).toEqual({ ok: false, reason: 'length' });
  });
});

describe('parseReport: script and unsafe text', () => {
  const ctx = { verdict: 'LEAKED' as const, hasFix: true };

  it('rejects Urdu script (the Urdu text must be Roman Urdu)', () => {
    const result = parseReport(
      goodAnswer('LEAKED', {
        explanationUr:
          'دوسرے ٹیسٹ یوزر نے کسی اور کی رو پڑھ لی ہے اور یہ غلط ہے',
      }),
      ctx,
    );
    expect(result).toEqual({ ok: false, reason: 'script' });
  });

  it.each([
    ['a code fence', 'See ```sql select 1``` for details about this table.'],
    ['a link', 'Read more at https://example.com about this finding today.'],
    [
      'an HTML tag',
      'The <b>table</b> lets any logged-in user read other rows.',
    ],
    ['SQL', 'Run alter table bookings disable row level security to fix it.'],
    [
      'a JWT start',
      'The token eyJhbGciOiJIUzI1NiJ9 was visible in the answer.',
    ],
    ['a key prefix', 'The value sb_secret_abc was visible to the test user.'],
    [
      'a Groq key prefix',
      'The value gsk_abcdefghij was visible to the test user.',
    ],
    ['service_role', 'The service_role key must be used to repair this table.'],
  ])('rejects %s', (_name, text) => {
    expect(parseReport(withText('LEAKED', text), ctx)).toEqual({
      ok: false,
      reason: 'unsafe-text',
    });
  });
});

describe('parseReport: forbidden claims (negation-aware)', () => {
  const blocked = { verdict: 'BLOCKED' as const, hasFix: false };
  const leaked = { verdict: 'LEAKED' as const, hasFix: true };

  it.each([
    'The app is secure and the table is private for every user.',
    'This table is safe because the rows stay private for others.',
    'The rows are fully protected against any kind of access by others.',
    'The result is guaranteed to hold for every future request made.',
    'This report works as a certificate of security for the project.',
  ])('rejects the claim: %s', (text) => {
    expect(parseReport(withText('BLOCKED', text), blocked)).toEqual({
      ok: false,
      reason: 'forbidden-claim',
    });
  });

  it('also rejects the claim for a LEAKED finding', () => {
    expect(
      parseReport(
        withText('LEAKED', 'Overall the app is secure, but one row was read.'),
        leaked,
      ),
    ).toEqual({ ok: false, reason: 'forbidden-claim' });
  });

  it.each([
    'These checks do not say it is safe for all uses, only that no leak was found.',
    'Nothing here is guaranteed to stay true after a later change in the app.',
    'This is not a certificate of security. No leak found by these checks.',
    "The result isn't guaranteed to hold after the next change to the app.",
  ])('allows the same words when they are negated: %s', (text) => {
    expect(parseReport(withText('BLOCKED', text), blocked).ok).toBe(true);
  });

  it('does not let a negation in an earlier sentence excuse a claim', () => {
    expect(
      parseReport(
        withText(
          'BLOCKED',
          'There is no problem here. The table is secure now.',
        ),
        blocked,
      ),
    ).toEqual({ ok: false, reason: 'forbidden-claim' });
  });

  it('does not let a negation four words earlier excuse a claim', () => {
    expect(hasUnnegated('not one of the rows is secure', 'is secure')).toBe(
      true,
    );
    expect(hasUnnegated('not the rows is secure', 'is secure')).toBe(false);
  });
});

describe('parseReport: the word "leaked"', () => {
  const blocked = { verdict: 'BLOCKED' as const, hasFix: false };
  const inconclusive = { verdict: 'INCONCLUSIVE' as const, hasFix: false };

  it.each([
    'Rows have leaked to the second test user in this table today.',
    'The data leaked, although the checks say otherwise for others.',
    'Leaked rows were found by the checks in this exact table.',
  ])('is rejected for BLOCKED when not negated: %s', (text) => {
    expect(parseReport(withText('BLOCKED', text), blocked)).toEqual({
      ok: false,
      reason: 'contradicts-verdict',
    });
    expect(parseReport(withText('INCONCLUSIVE', text), inconclusive)).toEqual({
      ok: false,
      reason: 'contradicts-verdict',
    });
  });

  it.each([
    'Nothing was leaked: the second test user received no rows at all.',
    'No data has leaked, and the owner can still use the row as expected.',
    'The row was not leaked to the visitor in any of the checks made.',
    'Rows stayed private, without any leaked row for the other users.',
  ])('is allowed when a negator is within 3 words before: %s', (text) => {
    expect(parseReport(withText('BLOCKED', text), blocked).ok).toBe(true);
  });

  it('is rejected when the negator is more than 3 words away', () => {
    expect(
      parseReport(
        withText(
          'BLOCKED',
          'Not once in all the test runs here has any row leaked at all.',
        ),
        blocked,
      ),
    ).toEqual({ ok: false, reason: 'contradicts-verdict' });
  });

  it('is fine for a LEAKED finding', () => {
    const result = parseReport(
      withText('LEAKED', 'A row leaked to a second test user in this table.'),
      { verdict: 'LEAKED', hasFix: true },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects "no leak found" inside a LEAKED finding', () => {
    expect(
      parseReport(
        withText('LEAKED', 'No leak found by these checks in this table.'),
        { verdict: 'LEAKED', hasFix: true },
      ),
    ).toEqual({ ok: false, reason: 'contradicts-verdict' });
  });
});
