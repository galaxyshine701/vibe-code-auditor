import { randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Agent, AgentState } from '../agents/agent.js';
import { runPipeline } from '../agents/pipeline.js';
import { createProverAgent, type RunContext } from '../agents/prover-agent.js';
import { ApiError } from '../common/api-error.js';
import type { Gateway } from '../prover/gateway.js';
import { redact } from '../prover/redact.js';
import {
  ProverError,
  type Finding,
  type ProverConfig,
  type ProverResult,
} from '../prover/types.js';
import type { AuditInput, RetestInput } from './audit-input.js';
import type { AuditRecord, AuditStatus } from './audit-record.js';
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
  type StoredAudit,
} from './audit-repository.js';
import { buildCertificate, certificateBlocker } from './certificate.js';
import { redactForStorage } from './redact-for-storage.js';
import { mergeRetest } from './retest-merge.js';
import { sweepInterrupted } from './sweeper.js';
import { createReportAgent, REPORT_AGENT_ID } from '../report/report-agent.js';
import { REPORT_SETUP, type ReportSetup } from '../report/report-config.js';

export type { AuditStatus, LastRetest } from './audit-record.js';

/** Builds the connection to the target project. Replaced by a fake in tests. */
export type GatewayFactory = (config: ProverConfig) => Gateway;
export const GATEWAY_FACTORY = Symbol('GATEWAY_FACTORY');

/** How often progress is saved, and how a failed final save is retried. */
export interface AuditTiming {
  flushMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}
export const AUDIT_TIMING = Symbol('AUDIT_TIMING');
export const DEFAULT_AUDIT_TIMING: AuditTiming = {
  flushMs: 1000,
  retryBaseMs: 1000,
  retryMaxMs: 30_000,
};

/**
 * The run that is working on one audit right now (in this process). The
 * working copy of the record lives here; the audit store gets copies of it.
 */
interface ActiveRun {
  id: string;
  /** Only this run may write the row while it is `running`. */
  runId: string;
  record: AuditRecord;
  /** every secret value of this run, for redactForStorage */
  secrets: string[];
  /** a guarded write changed 0 rows: the row is not ours any more */
  stopped: boolean;
  /** the final write was started: no more progress writes */
  closed: boolean;
  dirty: boolean;
  timer: NodeJS.Timeout | null;
  lastFlushAt: number;
  /** all writes of this run go through here, one after the other */
  chain: Promise<unknown>;
}

const MODULE_ID = 'data-access-prover';
const MAX_KEPT_AUDITS = 50;

const inProgress = () =>
  new ApiError(
    409,
    'AUDIT_IN_PROGRESS',
    'Another audit is still running. Wait until it finishes, then try again.',
  );

const notFound = () =>
  new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');

/**
 * Runs audits in the background. Audits are kept in the audit store (a table
 * in the platform's Supabase project), so they survive a restart.
 * Only one run (audit or re-test) happens at a time IN THIS PROCESS
 * (`runningId`), so two runs can never delete each other's temporary users in
 * the same project.
 */
@Injectable()
export class AuditsService implements OnModuleDestroy {
  private readonly logger = new Logger('Audits');
  private runningId: string | null = null;
  private destroyed = false;
  private readonly timing: AuditTiming;
  /**
   * Runs that have finished but whose final write is not in the store yet
   * (the store was unreachable). GET answers from here while it retries.
   */
  private readonly pending = new Map<string, ActiveRun>();

  constructor(
    @Inject(GATEWAY_FACTORY) private readonly makeGateway: GatewayFactory,
    @Inject(REPORT_SETUP) private readonly reportSetup: ReportSetup,
    @Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository,
    @Optional() @Inject(AUDIT_TIMING) timing?: AuditTiming,
  ) {
    this.timing = timing ?? DEFAULT_AUDIT_TIMING;
  }

  onModuleDestroy(): void {
    this.destroyed = true;
  }

  /**
   * Runs at boot, before the server listens. Fails (and the server does not
   * start) when the store cannot be used. Then every row that is still
   * `running` is closed as INTERRUPTED. Returns how many rows were closed.
   */
  async bootCheck(): Promise<number> {
    await this.repo.ping();
    const swept = await sweepInterrupted(this.repo);
    if (swept > 0) {
      this.logger.warn(`${swept} audit(s) were interrupted by a restart`);
    }
    return swept;
  }

  /** The Report agent's row at the start of a run; none when it is off. */
  private initialReportRow(): AuditRecord['reportRow'] {
    return this.reportSetup.mode === 'groq'
      ? { status: 'queued', progress: 0 }
      : null;
  }

  private newRun(record: AuditRecord, secrets: string[]): ActiveRun {
    return {
      id: record.id,
      runId: `run_${randomBytes(8).toString('hex')}`,
      record,
      secrets: [...secrets, ...this.repo.ownSecrets],
      stopped: false,
      closed: false,
      dirty: false,
      timer: null,
      lastFlushAt: 0,
      chain: Promise.resolve(),
    };
  }

  /** Starts an audit and returns at once. The work continues in the background. */
  async start(input: AuditInput): Promise<{ id: string; status: AuditStatus }> {
    // Check and claim in one synchronous step, so two requests cannot both pass.
    if (this.runningId) throw inProgress();
    const record: AuditRecord = {
      id: `aud_${randomBytes(8).toString('hex')}`,
      status: 'running',
      createdAt: new Date().toISOString(),
      label: input.label,
      projectUrl: input.projectUrl,
      progress: 0,
      findings: [],
      cleanup: null,
      cleanupNote: null,
      error: null,
      completedAt: null,
      nextFindingNumber: 1,
      lastRetest: null,
      proverDone: false,
      reportRow: this.initialReportRow(),
    };
    // The keys live only in this call. They are not stored on the record.
    const config: ProverConfig = {
      supabaseUrl: input.projectUrl,
      publishableKey: input.publishableKey,
      secretKey: input.secretKey,
    };
    const run = this.newRun(record, this.runSecrets(config));
    this.runningId = record.id;
    try {
      await this.repo.insert({
        id: record.id,
        status: 'running',
        createdAt: record.createdAt,
        runId: run.runId,
        record: redactForStorage(record, run.secrets),
      });
    } catch (error) {
      this.runningId = null;
      throw error;
    }
    try {
      await this.repo.prune(MAX_KEPT_AUDITS);
    } catch {
      // An old audit that stays a little longer does no harm.
    }
    void this.execute(run, config);
    return { id: record.id, status: 'running' };
  }

  /**
   * Runs the same checks again on an existing audit. The old findings stay
   * visible; the new ones replace them in one step when the run has finished.
   * The address is always the one saved with the audit.
   */
  async retest(
    id: string,
    parseInput: () => RetestInput,
  ): Promise<{ id: string; status: AuditStatus }> {
    const record = structuredClone(await this.readRecord(id));
    const input = parseInput();
    // From here to the claim there is no `await`, so two requests cannot both pass.
    if (this.runningId) throw inProgress();
    if (record.status !== 'completed') {
      throw new ApiError(
        409,
        'NOT_ELIGIBLE',
        'This audit did not complete, so there is nothing to re-test. Start a new audit.',
      );
    }
    record.status = 'running';
    record.progress = 0;
    record.proverDone = false;
    record.reportRow = this.initialReportRow();
    record.lastRetest = {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tablesAdded: [],
      tablesRemoved: [],
      error: null,
    };
    const config: ProverConfig = {
      supabaseUrl: record.projectUrl,
      publishableKey: input.publishableKey,
      secretKey: input.secretKey,
    };
    const run = this.newRun(record, this.runSecrets(config));
    this.runningId = record.id;
    try {
      const started = await this.repo.beginRetest(
        record.id,
        run.runId,
        redactForStorage(record, run.secrets),
      );
      if (!started) throw inProgress();
    } catch (error) {
      this.runningId = null;
      throw error;
    }
    void this.executeRetest(run, config);
    return { id: record.id, status: 'running' };
  }

  /** A human decision only. It does not change the user's database. */
  async approveFix(id: string, findingId: string): Promise<Finding> {
    if (this.pending.has(id)) throw inProgress();
    const stored = await this.readStored(id);
    const record = stored.record;
    if (record.status === 'running' || record.status === 'queued') {
      throw inProgress();
    }
    const index = record.findings.findIndex((f) => f.id === findingId);
    if (index === -1) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'No finding with this id was found in this audit.',
      );
    }
    const finding = record.findings[index];
    if (!finding.fix) {
      throw new ApiError(
        409,
        'NO_FIX_TO_APPROVE',
        'This finding has no suggested fix to approve.',
      );
    }
    const approved: Finding = {
      ...finding,
      fix: { ...finding.fix, status: 'approved' },
    };
    record.findings[index] = approved;
    // Saved only if nobody else saved in between and no run has started.
    const saved = await this.repo.saveIdle(
      id,
      stored.version,
      redactForStorage(record, this.repo.ownSecrets),
    );
    if (!saved) throw inProgress();
    return approved;
  }

  async certificate(id: string) {
    const record = await this.readRecord(id);
    const blocker = certificateBlocker(record);
    if (blocker) throw new ApiError(409, 'NOT_ELIGIBLE', blocker);
    return buildCertificate(record);
  }

  async get(id: string) {
    const record = await this.readRecord(id);
    const count = (verdict: string) =>
      record.findings.filter((f) => f.verdict === verdict).length;
    return {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt,
      target: { label: record.label, projectUrl: record.projectUrl },
      summary: {
        leaked: count('LEAKED'),
        blocked: count('BLOCKED'),
        inconclusive: count('INCONCLUSIVE'),
      },
      modules: [
        {
          id: MODULE_ID,
          name: 'Data Access Prover',
          // While the Report agent still works, the Prover's own row is done.
          status:
            record.reportRow && record.proverDone
              ? ('completed' as const)
              : record.status,
          progress: record.progress,
        },
        ...(record.reportRow
          ? [
              {
                id: REPORT_AGENT_ID,
                name: 'Report agent',
                status: record.reportRow.status,
                progress: record.reportRow.progress,
                ...(record.reportRow.message
                  ? { message: record.reportRow.message }
                  : {}),
              },
            ]
          : []),
      ],
      cleanup: record.cleanup,
      ...(record.cleanupNote ? { cleanupNote: record.cleanupNote } : {}),
      ...(record.error ? { error: record.error } : {}),
      lastRetest: record.lastRetest,
    };
  }

  async getFindings(id: string): Promise<{ findings: Finding[] }> {
    const record = await this.readRecord(id);
    // While a re-test runs the old findings stay, each marked "running".
    const retesting = record.lastRetest?.status === 'running';
    return {
      findings: retesting
        ? record.findings.map((f) => ({
            ...f,
            retest: { ...f.retest, status: 'running' as const },
          }))
        : record.findings,
    };
  }

  private async readStored(id: string): Promise<StoredAudit> {
    const stored = await this.repo.get(id);
    if (!stored) throw notFound();
    return stored;
  }

  /**
   * The record a reader sees. Normally it comes from the store. If a finished
   * run could not save its final state yet, that run's own record is used
   * first, but only while the store row still belongs to the same run.
   */
  private async readRecord(id: string): Promise<AuditRecord> {
    const waiting = this.pending.get(id);
    let stored: StoredAudit | null;
    try {
      stored = await this.repo.get(id);
    } catch (error) {
      if (waiting) return waiting.record;
      throw error;
    }
    if (waiting && (!stored || stored.runId === waiting.runId)) {
      return waiting.record;
    }
    if (!stored) throw notFound();
    return stored.record;
  }

  private runSecrets(config: ProverConfig): string[] {
    const groq =
      this.reportSetup.mode === 'groq' ? [this.reportSetup.secret] : [];
    return [config.publishableKey, config.secretKey, ...groq];
  }

  // ---- saving a run ---------------------------------------------------

  /** Runs `job` after the earlier writes of this run. The chain never breaks. */
  private enqueue<T>(run: ActiveRun, job: () => Promise<T>): Promise<T> {
    const next = run.chain.then(job);
    run.chain = next.catch(() => undefined);
    return next;
  }

  /** Something changed: save it soon, but at most about once per flushMs. */
  private touch(run: ActiveRun): void {
    run.dirty = true;
    if (run.closed || run.stopped || run.timer || this.destroyed) return;
    const wait = Math.max(
      0,
      this.timing.flushMs - (Date.now() - run.lastFlushAt),
    );
    run.timer = setTimeout(() => {
      run.timer = null;
      void this.flush(run);
    }, wait);
    run.timer.unref();
  }

  private flush(run: ActiveRun): Promise<void> {
    return this.enqueue(run, async () => {
      if (!run.dirty || run.closed || run.stopped) return;
      run.dirty = false;
      run.lastFlushAt = Date.now();
      try {
        const ok = await this.repo.writeRunning(
          run.id,
          run.runId,
          redactForStorage(run.record, run.secrets),
        );
        if (!ok) this.markStopped(run);
      } catch {
        // The store did not answer. The change is kept and saved next time.
        run.dirty = true;
        this.touch(run);
      }
    });
  }

  /** A guarded write changed 0 rows: the row is not ours. Stop the run. */
  private markStopped(run: ActiveRun): void {
    if (!run.stopped) {
      this.logger.warn(`${run.id} stopped: its record was changed elsewhere`);
    }
    run.stopped = true;
  }

  /**
   * The final write. The record is redacted first, and the redacted copy is
   * also what stays in memory, so a reader sees the same text before and after.
   * If the store does not answer, this retries in the background and GET
   * answers from the run's own record meanwhile.
   */
  private async persistFinal(
    run: ActiveRun,
    status: 'completed' | 'failed',
  ): Promise<void> {
    run.closed = true;
    if (run.timer) clearTimeout(run.timer);
    run.timer = null;
    Object.assign(run.record, redactForStorage(run.record, run.secrets));
    this.pending.set(run.id, run);
    let delay = this.timing.retryBaseMs;
    while (!this.destroyed) {
      try {
        const ok = await this.enqueue(run, () =>
          this.repo.finish(run.id, run.runId, status, run.record),
        );
        if (!ok) this.markStopped(run);
        break;
      } catch {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref();
        });
        delay = Math.min(delay * 2, this.timing.retryMaxMs);
      }
    }
    if (this.pending.get(run.id) === run) this.pending.delete(run.id);
  }

  // ---- running the agents ---------------------------------------------

  /**
   * Runs the pipeline: the Prover, then the Report agent when it is on.
   * Returns the Prover result; the Report agent has already put its text into
   * the findings of that result.
   */
  private async runAgents(
    gateway: Gateway,
    run: ActiveRun,
  ): Promise<ProverResult> {
    const context: RunContext = {};
    const record = run.record;
    const agents: Agent<RunContext>[] = [
      createProverAgent(
        gateway,
        (percent) => {
          record.progress = percent;
          this.touch(run);
        },
        () => run.stopped,
      ),
    ];
    const setup = this.reportSetup;
    if (setup.mode === 'groq') {
      agents.push(
        createReportAgent({ llm: setup.llm, problem: setup.problem }),
      );
    }

    await runPipeline(agents, context, {
      redact: (text) => redact(text, run.secrets),
      onState: (states) => this.showStates(run, states),
    });
    return context.prover!;
  }

  /**
   * The Prover failed, so the Report agent never started. Its row says so,
   * instead of staying "queued" for ever.
   */
  private markReportNotRun(record: AuditRecord, message: string): void {
    if (record.reportRow?.status === 'queued') {
      record.reportRow = { status: 'failed', progress: 0, message };
    }
  }

  /** Copies the agents' states to the record. Does nothing when only the Prover runs. */
  private showStates(run: ActiveRun, states: AgentState[]): void {
    const record = run.record;
    const report = states[1];
    if (!report) return;
    if (states[0].status === 'completed') {
      record.progress = 100;
      record.proverDone = true;
    }
    record.reportRow = {
      status: report.status,
      progress: report.progress,
      ...(report.message ? { message: report.message } : {}),
    };
    this.touch(run);
  }

  private async execute(run: ActiveRun, config: ProverConfig): Promise<void> {
    const record = run.record;
    this.logger.log(`${record.id} started`);
    try {
      const gateway = this.makeGateway(config);
      const result = await this.runAgents(gateway, run);
      record.findings = result.findings.map((f) => ({
        ...f,
        retest: { ...f.retest, previousVerdict: null },
      }));
      record.nextFindingNumber = result.findings.length + 1;
      record.cleanup = result.cleanup;
      record.cleanupNote = result.cleanupNote ?? null;
      record.progress = 100;
      record.completedAt = new Date().toISOString();
      record.status = 'completed';
    } catch (error) {
      const known = error instanceof ProverError ? error : null;
      this.markReportNotRun(record, 'Not run: the audit did not finish.');
      record.status = 'failed';
      record.cleanup = known?.cleanup ?? null;
      record.cleanupNote = known?.cleanupNote ?? null;
      record.error = {
        code: known?.code ?? 'PROVER_FAILED',
        message: redact(
          error instanceof Error
            ? error.message
            : 'The audit stopped unexpectedly.',
          run.secrets,
        ),
      };
    } finally {
      this.runningId = null;
      this.logger.log(`${record.id} ${record.status}`);
      void this.persistFinal(
        run,
        record.status === 'completed' ? 'completed' : 'failed',
      ).catch(() => undefined);
    }
  }

  /**
   * A failed re-test does NOT fail the audit. The old findings are never
   * touched until the new list is ready, so on failure there is nothing to undo.
   */
  private async executeRetest(
    run: ActiveRun,
    config: ProverConfig,
  ): Promise<void> {
    const record = run.record;
    const lastRetest = record.lastRetest!;
    this.logger.log(`${record.id} re-test started`);
    try {
      const gateway = this.makeGateway(config);
      const result = await this.runAgents(gateway, run);
      const finishedAt = new Date().toISOString();
      // Everything is worked out first, then swapped in together.
      const merged = mergeRetest(
        record.findings,
        result.findings,
        record.nextFindingNumber,
        finishedAt,
      );
      record.findings = merged.findings;
      record.nextFindingNumber = merged.nextFindingNumber;
      record.cleanup = result.cleanup;
      record.cleanupNote = result.cleanupNote ?? null;
      record.completedAt = finishedAt;
      record.lastRetest = {
        status: 'completed',
        startedAt: lastRetest.startedAt,
        finishedAt,
        tablesAdded: merged.tablesAdded,
        tablesRemoved: merged.tablesRemoved,
        error: null,
      };
    } catch (error) {
      const known = error instanceof ProverError ? error : null;
      this.markReportNotRun(record, 'Not run: the Re-test did not finish.');
      if (known?.cleanup) {
        record.cleanup = known.cleanup;
        record.cleanupNote = known.cleanupNote ?? null;
      }
      record.lastRetest = {
        status: 'failed',
        startedAt: lastRetest.startedAt,
        finishedAt: new Date().toISOString(),
        tablesAdded: [],
        tablesRemoved: [],
        error: {
          code: known?.code ?? 'PROVER_FAILED',
          message: redact(
            error instanceof Error
              ? error.message
              : 'The re-test stopped unexpectedly.',
            run.secrets,
          ),
        },
      };
    } finally {
      record.status = 'completed';
      record.progress = 100;
      this.runningId = null;
      this.logger.log(`${record.id} re-test ${record.lastRetest?.status}`);
      void this.persistFinal(run, 'completed').catch(() => undefined);
    }
  }
}
