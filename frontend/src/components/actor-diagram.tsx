import type {
  OperationActor,
  OperationEvidence,
  OperationName,
  Verdict,
} from '@/lib/types';

type OpState = 'allowed' | 'reached' | 'blocked' | 'untested';
type LaneTone = 'control' | 'leaked' | 'blocked' | 'inconclusive' | 'neutral';

const ACTORS: {
  key: OperationActor;
  name: string;
  initial: string;
  note: string;
}[] = [
  { key: 'owner', name: 'Owner A', initial: 'A', note: 'owns the canary row' },
  { key: 'user_b', name: 'User B', initial: 'B', note: 'second logged-in user' },
  { key: 'anon', name: 'Anon', initial: '?', note: 'visitor, no login' },
];

const OPERATIONS: OperationName[] = ['SELECT', 'UPDATE', 'DELETE', 'INSERT'];

const STATE_LABEL: Record<OpState, string> = {
  allowed: 'allowed',
  reached: 'reached',
  blocked: 'blocked',
  untested: 'not tested',
};

function stateFor(
  operation: OperationEvidence | undefined,
  actor: OperationActor,
  verdict: Verdict,
): OpState {
  if (!operation || operation.allowed === null) return 'untested';
  if (operation.allowed === false) return 'blocked';
  if (actor === 'owner') return 'allowed';
  return verdict === 'LEAKED' ? 'reached' : 'allowed';
}

function StateIcon({ state }: { state: OpState }) {
  if (state === 'blocked') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5.2 8h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (state === 'reached') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 5v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M8 10.9h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  if (state === 'allowed') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          d="m3.3 8.3 3 3L12.7 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M4 8h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ActorDiagram({
  operations,
  verdict,
}: {
  operations: OperationEvidence[];
  verdict: Verdict;
}) {
  return (
    <div className="actor-diagram">
      <div className="actor-diagram-head">
        <span>Who could reach the canary row</span>
        <span className="actor-canary-label">
          <span className="canary-dot-mini" aria-hidden="true" />
          canary row
        </span>
      </div>

      <div className="actor-lanes">
        {ACTORS.map((actor) => {
          const actorOperations = operations.filter(
            (item) => item.actor === actor.key,
          );
          const byOperation = new Map(
            actorOperations.map((item) => [item.operation, item]),
          );
          const states = OPERATIONS.map((operation) =>
            stateFor(byOperation.get(operation), actor.key, verdict),
          );

          const hasReached = states.includes('reached');
          const hasTested = states.some((state) => state !== 'untested');
          const allBlocked =
            hasTested && states.every((state) => state !== 'allowed' && state !== 'reached');

          let tone: LaneTone = 'neutral';
          if (actor.key === 'owner') tone = 'control';
          else if (hasReached) tone = 'leaked';
          else if (verdict === 'INCONCLUSIVE') tone = 'inconclusive';
          else if (allBlocked) tone = 'blocked';

          return (
            <div className="actor-lane" key={actor.key}>
              <div className="actor-id">
                <span className={`actor-avatar actor-avatar-${actor.key}`} aria-hidden="true">
                  {actor.initial}
                </span>
                <span>
                  <strong>{actor.name}</strong>
                  <small>{actor.note}</small>
                </span>
              </div>

              <div className="actor-body">
                <div className={`actor-track actor-track-${tone}`} aria-hidden="true">
                  <span className="actor-track-line" />
                  <span className="actor-canary-node" />
                </div>

                <div className="actor-ops">
                  {OPERATIONS.map((operation, index) => {
                    const state = states[index];
                    const evidence = byOperation.get(operation);
                    const title = evidence?.note
                      ? `${operation}: ${STATE_LABEL[state]}. ${evidence.note}`
                      : `${operation}: ${STATE_LABEL[state]}`;

                    return (
                      <span
                        key={operation}
                        className={`op-chip op-${state}`}
                        title={title}
                      >
                        <span className="op-name">{operation}</span>
                        <span className="op-state">
                          <StateIcon state={state} />
                          {STATE_LABEL[state]}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="actor-legend">
        Owner A is the control. User B and Anon are the attempts. A canary dot is
        a test row, not a real user row.
      </p>
    </div>
  );
}
