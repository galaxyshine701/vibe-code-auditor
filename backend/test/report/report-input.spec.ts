import { buildReportInput } from '../../src/report/report-input.js';
import { buildPrompt } from '../../src/report/report-prompt.js';
import {
  CANARY_ID,
  DB_NOTE,
  OWNER_VALUE,
  blockedFinding,
  inconclusiveFinding,
  leakedFinding,
} from './helpers.js';

describe('buildReportInput', () => {
  it('has exactly the allowed fields', () => {
    const input = buildReportInput(leakedFinding());
    expect(Object.keys(input).sort()).toEqual([
      'hasFix',
      'operations',
      'severity',
      'table',
      'verdict',
    ]);
    for (const op of input.operations) {
      expect(Object.keys(op).sort()).toEqual([
        'actor',
        'allowed',
        'httpStatus',
        'operation',
        'rowsReturned',
      ]);
    }
  });

  it('carries the verdict, severity, table and test results', () => {
    const input = buildReportInput(leakedFinding('bookings'));
    expect(input).toMatchObject({
      table: 'bookings',
      verdict: 'LEAKED',
      severity: 'critical',
      hasFix: true,
    });
    expect(input.operations[0]).toEqual({
      operation: 'SELECT',
      actor: 'user_b',
      allowed: true,
      httpStatus: 200,
      rowsReturned: 1,
    });
  });

  it('says whether the Prover made a fix, without sending the fix', () => {
    expect(buildReportInput(leakedFinding()).hasFix).toBe(true);
    expect(buildReportInput(blockedFinding()).hasFix).toBe(false);
    expect(buildReportInput(inconclusiveFinding()).hasFix).toBe(false);
  });

  it('leaves out the canary id, owner value, reproducer, SQL and notes', () => {
    const finding = leakedFinding();
    expect(finding.fix?.sql).toContain('create policy'); // there is SQL to leave out
    expect(finding.evidence.reproducer).toContain('curl');

    const input = buildReportInput(finding);
    const prompt = buildPrompt(input);
    const everything = JSON.stringify(input) + prompt.system + prompt.user;
    for (const secret of [
      CANARY_ID,
      OWNER_VALUE,
      DB_NOTE,
      'create policy',
      'curl',
      'apikey',
      '<ANON_KEY>',
      'supabase.co',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('sends the input as plain data in the user message', () => {
    const input = buildReportInput(blockedFinding());
    expect(JSON.parse(buildPrompt(input).user)).toEqual(input);
  });
});
