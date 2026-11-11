import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type { Gateway } from '../prover/gateway.js';
import { runProver } from '../prover/prover.js';
import { redact } from '../prover/redact.js';
import {
  ProverError,
  type Finding,
  type ProverConfig,
} from '../prover/types.js';
import type { AuditInput } from './audit-input.js';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Builds the connection to the target project. Replaced by a fake in tests. */
export type GatewayFactory = (config: ProverConfig) => Gateway;
export const GATEWAY_FACTORY = Symbol('GATEWAY_FACTORY');

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
}

const MODULE_ID = 'data-access-prover';
const MAX_KEPT_AUDITS = 50;

/**
 * Runs audits in the background and keeps them IN MEMORY ONLY.
 * There is no database: when the server restarts, every audit is gone.
 * Only one audit runs at a time, so two runs can never delete each other's
 * temporary users in the same project.
 */
@Injectable()
export class AuditsService {
  private readonly logger = new Logger('Audits');
  private readonly audits = new Map<string, AuditRecord>();
  private runningId: string | null = null;

  constructor(
    @Inject(GATEWAY_FACTORY) private readonly makeGateway: GatewayFactory,
  ) {}

  /** Starts an audit and returns at once. The work continues in the background. */
  start(input: AuditInput): { id: string; status: AuditStatus } {
    // Check and claim in one synchronous step, so two requests cannot both pass.
    if (this.runningId) {
      throw new ApiError(
        409,
        'AUDIT_IN_PROGRESS',
        'Another audit is still running. Wait until it finishes, then try again.',
      );
    }
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
          status: record.status,
          progress: record.progress,
        },
      ],
      cleanup: record.cleanup,
      ...(record.cleanupNote ? { cleanupNote: record.cleanupNote } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }

  getFindings(id: string): { findings: Finding[] } {
    return { findings: this.find(id).findings };
  }

  private find(id: string): AuditRecord {
    const record = this.audits.get(id);
    if (!record) {
      throw new ApiError(404, 'NOT_FOUND', 'No audit with this id was found.');
    }
    return record;
  }

  private async execute(
    record: AuditRecord,
    config: ProverConfig,
  ): Promise<void> {
    const secrets = [config.publishableKey, config.secretKey];
    this.logger.log(`${record.id} started`);
    try {
      const gateway = this.makeGateway(config);
      const result = await runProver(
        gateway,
        () => {},
        (percent) => {
          record.progress = percent;
        },
      );
      record.findings = result.findings;
      record.cleanup = result.cleanup;
      record.cleanupNote = result.cleanupNote ?? null;
      record.progress = 100;
      record.status = 'completed';
    } catch (error) {
      const known = error instanceof ProverError ? error : null;
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

  private forgetOldAudits(): void {
    while (this.audits.size > MAX_KEPT_AUDITS) {
      const oldest = this.audits.keys().next().value;
      if (oldest === undefined || oldest === this.runningId) break;
      this.audits.delete(oldest);
    }
  }
}
