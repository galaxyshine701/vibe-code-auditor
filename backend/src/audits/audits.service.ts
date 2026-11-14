import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { buildCertificate, certificateBlocker } from './certificate.js';
import { mergeRetest } from './retest-merge.js';
import { createReportAgent, REPORT_AGENT_ID } from '../report/report-agent.js';
import { REPORT_SETUP, type ReportSetup } from '../report/report-config.js';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Builds the connection to the target project. Replaced by a fake in tests. */
export type GatewayFactory = (config: ProverConfig) => Gateway;
export const GATEWAY_FACTORY = Symbol('GATEWAY_FACTORY');

export interface LastRetest {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tablesAdded: string[];
  tablesRemoved: string[];
  error: { code: string; message: string } | null;
}

/**
 * One audit. There is deliberately NO field for a key here, so a key cannot
 * end up in a response by accident.
 */
interface AuditRecord {
  id: string;
  status: AuditStatus;
  createdAt: string;
  label: string;
  projectUrl: string;
  progress: number;
  findings: Finding[];
  cleanup: 'ok' | 'failed' | null;
  /** Only when cleanup failed: what to remove by hand. */
  cleanupNote: string | null;
  error: { code: string; message: string } | null;
  /** when the latest completed run (the audit or a successful re-test) finished */
  completedAt: string | null;
  /** the next finding number to hand out; a number is never used twice */
  nextFindingNumber: number;
  lastRetest: LastRetest | null;
  /** The Prover has finished (used while the Report agent is still working). */
  proverDone: boolean;
  /** The Report agent's row. null when the Report agent is off. */
  reportRow: ReportRow | null;
}

interface ReportRow {
  status: AuditStatus;
  progress: number;
  message?: string;
}

const MODULE_ID = 'data-access-prover';
const MAX_KEPT_AUDITS = 50;

const inProgress = () =>
  new ApiError(
    409,
    'AUDIT_IN_PROGRESS',
    'Another audit is still running. Wait until it finishes, then try again.',
  );

/**
 * Runs audits in the background and keeps them IN MEMORY ONLY.
 * There is no database: when the server restarts, every audit is gone.
 * Only one run (audit or re-test) happens at a time, so two runs can never
 * delete each other's temporary users in the same project.
 */
@Injectable()
export class AuditsService {
  private readonly logger = new Logger('Audits');
  private readonly audits = new Map<string, AuditRecord>();
  private runningId: string | null = null;

  constructor(
    @Inject(GATEWAY_FACTORY) private readonly makeGateway: GatewayFactory,
    @Inject(REPORT_SETUP) private readonly reportSetup: ReportSetup,
  ) {}

  /** The Report agent's row at the start of a run; none when it is off. */
  private initialReportRow(): ReportRow | null {
    return this.reportSetup.mode === 'groq'
      ? { status: 'queued', progress: 0 }
      : null;
  }

  /** Starts an audit and returns at once. The work continues in the background. */
  start(input: AuditInput): { id: string; status: AuditStatus } {
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
    this.audits.set(record.id, record);
    this.runningId = record.id;
    this.forgetOldAudits();

    // The keys live only in this call. They are not stored on the record.
    const config: ProverConfig = {
      supabaseUrl: input.projectUrl,
      publishableKey: input.publishableKey,
      secretKey: input.secretKey,
    };
    void this.execute(record, config);
    return { id: record.id, status: record.status };
  }

  /**
   * Runs the same checks again on an existing audit. The old findings stay
   * visible; the new ones replace them in one step when the run has finished.
   * The address is always the one saved with the audit.
   */
  retest(
    id: string,
    parseInput: () => RetestInput,
  ): { id: string; status: AuditStatus } {
    const record = this.find(id);
    const input = parseInput();
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
    this.runningId = record.id;

    const config: ProverConfig = {
      supabaseUrl: record.projectUrl,
      publishableKey: input.publishableKey,
      secretKey: input.secretKey,
    };
    void this.executeRetest(record, config);
    return { id: record.id, status: record.status };
  }

  /** A human decision only. It does not change the user's database. */
  approveFix(id: string, findingId: string): Finding {
    const record = this.find(id);
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
    return approved;
  }

  certificate(id: string) {
    const record = this.find(id);
    const blocker = certificateBlocker(record);
    if (blocker) throw new ApiError(409, 'NOT_ELIGIBLE', blocker);
    return buildCertificate(record);
  }

  get(id: string) {
    const record = this.find(id);
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

  getFindings(id: string): { findings: Finding[] } {
    const record = this.find(id);
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

  private find(id: string): AuditRecord {
    const record = this.audits.get(id);
    if (!record) {
      throw new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');
    }
    return record;
  }

  /**
   * Runs the pipeline: the Prover, then the Report agent when it is on.
   * Returns the Prover result; the Report agent has already put its text into
   * the findings of that result.
   */
  private async runAgents(
    gateway: Gateway,
    record: AuditRecord,
    secrets: string[],
  ): Promise<ProverResult> {
    const context: RunContext = {};
    const agents: Agent<RunContext>[] = [
      createProverAgent(gateway, (percent) => {
        record.progress = percent;
      }),
    ];
    const setup = this.reportSetup;
    if (setup.mode === 'groq') {
      agents.push(
        createReportAgent({ llm: setup.llm, problem: setup.problem }),
      );
    }
    const allSecrets =
      setup.mode === 'groq' ? [...secrets, setup.secret] : secrets;

    await runPipeline(agents, context, {
      redact: (text) => redact(text, allSecrets),
      onState: (states) => this.showStates(record, states),
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
  private showStates(record: AuditRecord, states: AgentState[]): void {
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
  }

  private async execute(
    record: AuditRecord,
    config: ProverConfig,
  ): Promise<void> {
    const secrets = [config.publishableKey, config.secretKey];
    this.logger.log(`${record.id} started`);
    try {
      const gateway = this.makeGateway(config);
      const result = await this.runAgents(gateway, record, secrets);
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
          secrets,
        ),
      };
    } finally {
      this.runningId = null;
      this.logger.log(`${record.id} ${record.status}`);
    }
  }

  /**
   * A failed re-test does NOT fail the audit. The old findings are never
   * touched until the new list is ready, so on failure there is nothing to undo.
   */
  private async executeRetest(
    record: AuditRecord,
    config: ProverConfig,
  ): Promise<void> {
    const secrets = [config.publishableKey, config.secretKey];
    const lastRetest = record.lastRetest!;
    this.logger.log(`${record.id} re-test started`);
    try {
      const gateway = this.makeGateway(config);
      const result = await this.runAgents(gateway, record, secrets);
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
            secrets,
          ),
        },
      };
    } finally {
      record.status = 'completed';
      record.progress = 100;
      this.runningId = null;
      this.logger.log(`${record.id} re-test ${record.lastRetest?.status}`);
    }
  }

  private forgetOldAudits(): void {
    while (this.audits.size > MAX_KEPT_AUDITS) {
      const oldest = this.audits.keys().next().value;
      if (oldest === undefined || oldest === this.runningId) break;
      this.audits.delete(oldest);
    }
  }
}
