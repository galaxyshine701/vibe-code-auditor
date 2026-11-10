import type { Finding, Operation, OperationResult, Verdict } from './types.js';

export type Culprit = 'user' | 'anon';

export interface FindingInput {
  table: string;
  ownerColumn: string | null;
  verdict: Verdict;
  operation: Operation;
  httpStatus: number | null;
  rowsReturned: number | null;
  canaryRowId: string | null;
  /** The value of the owner column on the canary (used only to build the reproducer). */
  ownerValue?: string;
  /** Who got the data: logged-in user B or an anonymous visitor. */
  culprit?: Culprit;
  /** For INCONCLUSIVE: why. */
  reason?: 'no-owner-column' | 'plant-failed';
  reasonDetail?: string;
  operations: OperationResult[];
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** curl command with placeholders only. Never real keys or tokens. */
export function buildReproducer(input: FindingInput): string | null {
  if (input.verdict !== 'LEAKED' || !input.ownerColumn || !input.ownerValue) {
    return null;
  }
  const url = `'<PROJECT_URL>/rest/v1/${input.table}?${input.ownerColumn}=eq.${input.ownerValue}'`;
  const auth =
    input.culprit === 'anon' && input.operation === 'SELECT'
      ? ''
      : ` -H 'Authorization: Bearer <USER_B_JWT>'`;
  if (input.operation === 'SELECT') {
    return `curl -H 'apikey: <ANON_KEY>'${auth} ${url}`;
  }
  if (input.operation === 'UPDATE') {
    return `curl -X PATCH -H 'apikey: <ANON_KEY>'${auth} -H 'Content-Type: application/json' -d '{"<COLUMN>":"changed"}' ${url}`;
  }
  return `curl -X DELETE -H 'apikey: <ANON_KEY>'${auth} ${url}`;
}

function fixFor(input: FindingInput, ops: Operation[]): Finding['fix'] {
  if (input.verdict !== 'LEAKED' || !input.ownerColumn) return null;
  const t = q(input.table);
  const c = q(input.ownerColumn);
  const lines = [`alter table ${t} enable row level security;`];
  for (const op of ops) {
    const name = `Owners can ${op.toLowerCase()} own rows`;
    if (op === 'UPDATE') {
      lines.push(
        `create policy "${name}" on ${t} for update to authenticated using ((select auth.uid()) = ${c}) with check ((select auth.uid()) = ${c});`,
      );
    } else {
      lines.push(
        `create policy "${name}" on ${t} for ${op.toLowerCase()} to authenticated using ((select auth.uid()) = ${c});`,
      );
    }
  }
  return {
    status: 'proposed',
    description:
      'Turn on row-level security and let users reach only their own rows. If a broader policy already exists on this table, remove it, because policies add up. Review before applying.',
    sql: lines.join('\n'),
  };
}

export function buildFinding(
  id: string,
  input: FindingInput,
  leakedOps: Operation[] = [input.operation],
): Finding {
  const base = {
    id,
    module: 'data-access-prover' as const,
    table: input.table,
    operation: input.operation,
    retest: { status: 'not_run' as const, lastRunAt: null },
  };
  const evidence = {
    rowsReturned: input.rowsReturned,
    httpStatus: input.httpStatus,
    canaryRowId: input.canaryRowId,
    reproducer: buildReproducer(input),
    operations: input.operations,
  };

  if (input.verdict === 'LEAKED') {
    const who =
      input.culprit === 'anon' ? 'anonymous visitor' : 'second test user';
    const whoUr =
      input.culprit === 'anon' ? 'bina login wala visitor' : 'doosra test user';
    const what = {
      SELECT: ['read', 'parh li'],
      UPDATE: ['change', 'badal di'],
      DELETE: ['delete', 'delete kar di'],
    }[input.operation];
    return {
      ...base,
      verdict: 'LEAKED',
      severity: 'critical',
      title: `Any ${input.culprit === 'anon' ? 'visitor' : 'logged-in user'} can ${what[0]} other users' rows in "${input.table}"`,
      explanation: {
        en: `The ${who} was able to ${what[0]} a row that belongs to the first user. The table has no rule that limits rows to their owner.`,
        ur: `${whoUr[0].toUpperCase()}${whoUr.slice(1)} ne pehle user ki row ${what[1]}. Is table me aisa rule nahi jo har row ko sirf uske maalik tak mehdood kare.`,
      },
      evidence,
      fix: fixFor(input, leakedOps),
    };
  }

  if (input.verdict === 'BLOCKED') {
    return {
      ...base,
      verdict: 'BLOCKED',
      severity: 'info',
      title: `"${input.table}" is protected`,
      explanation: {
        en: "The second test user and an anonymous visitor received no rows, and the first user's row stayed unchanged. No leak found by these checks.",
        ur: 'Doosre test user aur bina login wale visitor ko koi row nahi mili, aur pehle user ki row waisi hi rahi. In checks se koi leak nahi mila.',
      },
      evidence,
      fix: null,
    };
  }

  const noOwner = input.reason === 'no-owner-column';
  return {
    ...base,
    verdict: 'INCONCLUSIVE',
    severity: 'low',
    title: noOwner
      ? `"${input.table}": no owner column, is this intended?`
      : `"${input.table}": canary row could not be planted`,
    explanation: noOwner
      ? {
          en: `This table has no column that links a row to a user, so a canary row could not be planted. If it holds public information such as a hotel list, that is fine. Please confirm.${input.rowsReturned ? ' An anonymous visitor can read it.' : ''}`,
          ur: `Is table me aisa column nahi jo row ko kisi user se jore, isliye canary row nahi daali ja saki. Agar isme sirf public maloomat hain (jaise hotel list) to theek hai. Barae meharbani confirm karein.${input.rowsReturned ? ' Bina login wala visitor ise parh sakta hai.' : ''}`,
        }
      : {
          en: `The canary row could not be inserted, so this table was not tested. Reason: ${input.reasonDetail ?? 'unknown'}.`,
          ur: `Canary row insert nahi ho saki, isliye is table ka test nahi hua. Wajah: ${input.reasonDetail ?? 'maloom nahi'}.`,
        },
    evidence,
    fix: null,
  };
}
