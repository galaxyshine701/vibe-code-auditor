import { buildFinding } from '../../src/prover/findings.js';
import type { Finding, Verdict } from '../../src/prover/types.js';
import { parseReport } from '../../src/report/report-schema.js';
import { goodAnswer } from './helpers.js';

/** The Urdu sentence under test, followed by a harmless sentence of its own. */
const ur = (sentence: string) =>
  `${sentence}. Is table ke baare me aur koi baat likhi nahi gayi.`;

const check = (verdict: Verdict, sentence: string) =>
  parseReport(goodAnswer(verdict, { explanationUr: ur(sentence) }), {
    verdict,
    hasFix: verdict === 'LEAKED',
  });

describe('Roman Urdu claims', () => {
  it.each([
    'Yeh table secure nahi hai',
    'Yeh table secured nahi hai',
    'Yeh table safe nahi hai',
    'Yeh table mehfooz nahi hai',
    'Yeh table mahfuz nahin hai',
    'Yeh table surakshit nahi hai',
    'Yeh table bilkul theek nahi hai',
    'Is result ki guarantee nahi hai',
    'Nahi, yeh table secure hai nahi',
    'Bina guarantee ke yeh result diya gaya hai',
    'Hum nahi kehte ke mehfooz hai',
  ])('is accepted when negated: %s', (sentence) => {
    expect(check('BLOCKED', sentence).ok).toBe(true);
  });

  it.each([
    'Yeh table secure hai',
    'Yeh table SECURE hai',
    'Yeh table secured hai',
    'Yeh table safe hai',
    'Yeh table mehfooz hai',
    'Yeh table mahfooz hai',
    'Yeh table mehfuz hai',
    'Yeh table mahfuz hai',
    'Yeh table mehfoz hai',
    'Yeh table mafuz hai',
    'Yeh table surakshit hai',
    'Yeh table bilkul theek hai',
    'Is result ki guarantee hai',
    'Result guaranteed hai',
    'Yeh table secure hai na',
  ])('is rejected when not negated: %s', (sentence) => {
    expect(check('BLOCKED', sentence)).toEqual({
      ok: false,
      reason: 'forbidden-claim',
    });
  });

  it('rejects the claim for every verdict, LEAKED included', () => {
    for (const verdict of ['LEAKED', 'BLOCKED', 'INCONCLUSIVE'] as const) {
      expect(check(verdict, 'Baqi sab kuch mehfooz hai')).toEqual({
        ok: false,
        reason: 'forbidden-claim',
      });
    }
  });

  it('counts a negator up to 3 words away on either side, not 4', () => {
    // 3 words after "secure": hai, bilkul, nahi? -> "secure hai ke nahi" (nahi is the 3rd)
    expect(check('BLOCKED', 'Yeh table secure hai ke nahi').ok).toBe(true);
    // 3 words before: "nahi kaha ja sakta" -> mehfooz is the 4th word after nahi
    expect(check('BLOCKED', 'Bina kisi bhi shak mehfooz hai')).toEqual({
      ok: false,
      reason: 'forbidden-claim',
    });
    // 4 words after the claim
    expect(check('BLOCKED', 'Yeh table secure hai aur isme nahi')).toEqual({
      ok: false,
      reason: 'forbidden-claim',
    });
  });

  it('does not use a negator from another sentence', () => {
    const text = 'Koi masla nahi. Yeh table secure hai. Aur kuch nahi bacha';
    const result = parseReport(
      goodAnswer('BLOCKED', {
        explanationUr: `${text}, is table ke baare me.`,
      }),
      { verdict: 'BLOCKED', hasFix: false },
    );
    expect(result).toEqual({ ok: false, reason: 'forbidden-claim' });
  });

  it('does not treat "na" as a negator', () => {
    expect(check('BLOCKED', 'Kya yeh table secure hai na')).toEqual({
      ok: false,
      reason: 'forbidden-claim',
    });
  });

  it('checks the Urdu text only (English has its own list)', () => {
    const result = parseReport(
      goodAnswer('BLOCKED', {
        explanationEn:
          'The row-level security rule keeps rows private. No leak found by these checks.',
      }),
      { verdict: 'BLOCKED', hasFix: false },
    );
    expect(result.ok).toBe(true);
  });
});

describe('Roman Urdu "a leak happened"', () => {
  it.each([
    'Data leak nahi hua',
    'Koi data leak nahi hua',
    'Bina leak ho gaya kuch bhi nahi badla',
    'Yeh na kaho ke leak ho gaya nahi',
    'In checks se koi leak nahi mila',
  ])('is accepted for BLOCKED when negated: %s', (sentence) => {
    expect(check('BLOCKED', sentence).ok).toBe(true);
  });

  it.each([
    'Data leak ho gaya',
    'Data leak ho gayi',
    'Data leak ho gaye',
    'Data leak hua',
    'Data leak hui',
    'Data leak hue',
    'Data leak ho chuka',
    'Data leak ho chuki',
    'Data leak ho chuke',
    'DATA LEAK HO GAYA',
  ])('is rejected for BLOCKED: %s', (sentence) => {
    expect(check('BLOCKED', sentence)).toEqual({
      ok: false,
      reason: 'contradicts-verdict',
    });
  });

  it('is rejected for INCONCLUSIVE too', () => {
    expect(check('INCONCLUSIVE', 'Data leak ho gaya')).toEqual({
      ok: false,
      reason: 'contradicts-verdict',
    });
  });

  it('is allowed for LEAKED', () => {
    expect(check('LEAKED', 'Data leak ho gaya').ok).toBe(true);
    expect(check('LEAKED', 'Doosre user ka data leak hua').ok).toBe(true);
  });
});

describe("the Prover's own texts pass the guard", () => {
  const base = {
    ownerColumn: 'user_id',
    operation: 'SELECT' as const,
    httpStatus: 200,
    rowsReturned: 1,
    canaryRowId: 'x',
    ownerValue: 'y',
    operations: [],
  };
  const build = (id: string, over: Record<string, unknown>) =>
    buildFinding(id, {
      table: 'bookings',
      ...base,
      verdict: 'LEAKED',
      ...over,
    } as Parameters<typeof buildFinding>[1]);

  const findings: [string, Finding][] = [];
  for (const culprit of ['user', 'anon'] as const) {
    for (const operation of ['SELECT', 'UPDATE', 'DELETE'] as const) {
      findings.push([
        `LEAKED ${culprit} ${operation}`,
        build('f', { verdict: 'LEAKED', culprit, operation }),
      ]);
    }
  }
  findings.push(
    ['BLOCKED', build('f', { verdict: 'BLOCKED', rowsReturned: 0 })],
    [
      'INCONCLUSIVE owner blocked',
      build('f', { verdict: 'INCONCLUSIVE', reason: 'owner-blocked' }),
    ],
    [
      'INCONCLUSIVE no owner column',
      build('f', {
        verdict: 'INCONCLUSIVE',
        reason: 'no-owner-column',
        ownerColumn: null,
        rowsReturned: 0,
      }),
    ],
    [
      'INCONCLUSIVE no owner column, visitor can read',
      build('f', {
        verdict: 'INCONCLUSIVE',
        reason: 'no-owner-column',
        ownerColumn: null,
        rowsReturned: 12,
      }),
    ],
    [
      'INCONCLUSIVE canary not planted',
      build('f', {
        verdict: 'INCONCLUSIVE',
        reason: 'plant-failed',
        reasonDetail: 'a required column has no default',
      }),
    ],
    [
      'INCONCLUSIVE canary not planted, no detail',
      build('f', { verdict: 'INCONCLUSIVE', reason: 'plant-failed' }),
    ],
  );

  it.each(findings)('%s', (_name, finding) => {
    const result = parseReport(
      JSON.stringify({
        title: finding.title,
        explanationEn: finding.explanation.en,
        explanationUr: finding.explanation.ur,
        fixDescription: finding.fix?.description ?? '',
      }),
      { verdict: finding.verdict, hasFix: finding.fix !== null },
    );
    expect(result).toEqual({ ok: true, value: expect.any(Object) });
  });
});
