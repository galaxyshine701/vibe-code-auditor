import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError, type Api } from './api.js';
import type { Config } from './config.js';
import { COVERAGE } from './coverage.js';

/**
 * The model can pass only an audit id, a label and a wait time. Every schema
 * is strict, so a key, an address or a confirmation sent by the model is
 * rejected instead of being ignored. Keys and addresses come from Config.
 */
const SCOPE =
  'The result covers table data access only (read, update and delete as another signed-in user, read as a visitor). It is not a statement that the app is secure.';

const auditId = z
  .string()
  .regex(
    /^aud_[0-9a-f]{1,64}$/,
    'id must look like aud_ followed by hex characters.',
  );

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ToolDeps {
  config: Config;
  api: Api;
  sleep?: (ms: number) => Promise<void>;
}

const POLL_MS = 2_000;
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function needTestConfirmation(config: Config): void {
  if (!config.confirmTestProject) {
    throw new ToolError(
      'Refused: VCA_CONFIRM_TEST_PROJECT is not set to "yes" in mcp/.env. Set it only for a throwaway TEST project.',
    );
  }
}

function auditView(audit: Record<string, unknown>) {
  return {
    id: audit.id,
    status: audit.status,
    summary: audit.summary,
    modules: audit.modules,
    cleanup: audit.cleanup,
    ...(audit.cleanupNote ? { cleanupNote: audit.cleanupNote } : {}),
    ...(audit.error ? { error: audit.error } : {}),
    lastRetest: audit.lastRetest ?? null,
  };
}

export function buildTools(deps: ToolDeps): ToolDef[] {
  const { config, api } = deps;
  const sleep = deps.sleep ?? defaultSleep;

  return [
    {
      name: 'start_audit',
      title: 'Start an audit',
      description: `Starts a Data Access audit of the configured TEST project and returns its id at once. Takes no keys or addresses; they come from the server settings. ${SCOPE}`,
      schema: z.strictObject({ label: z.string().trim().max(120).optional() }),
      async run(args) {
        needTestConfirmation(config);
        const label = typeof args.label === 'string' ? args.label : '';
        const started = obj(
          await api.post('/audits', {
            label: label || 'MCP audit',
            projectUrl: config.supabaseUrl,
            anonKey: config.publishableKey,
            serviceKey: config.secretKey,
            confirmTestProject: true,
          }),
        );
        return { id: started.id, status: started.status };
      },
    },
    {
      name: 'get_audit',
      title: 'Get audit status',
      description:
        'Returns the status, progress, summary counts and cleanup state of an audit. waitSeconds (0 to 30) waits while it is still running.',
      schema: z.strictObject({
        id: auditId,
        waitSeconds: z.number().int().min(0).max(30).optional(),
      }),
      async run(args) {
        const id = args.id as string;
        const waitMs = ((args.waitSeconds as number | undefined) ?? 0) * 1000;
        let waited = 0;
        for (;;) {
          const audit = obj(await api.get(`/audits/${id}`));
          const busy = audit.status === 'queued' || audit.status === 'running';
          if (!busy || waited >= waitMs) return auditView(audit);
          await sleep(POLL_MS);
          waited += POLL_MS;
        }
      },
    },
    {
      name: 'get_report',
      title: 'Get the report',
      description: `Returns the findings of an audit in English (verdict, severity, explanation, suggested fix SQL, re-test state) and what the checks cover. The fix SQL is a suggestion only; a person decides. ${SCOPE}`,
      schema: z.strictObject({ id: auditId }),
      async run(args) {
        const id = args.id as string;
        const audit = obj(await api.get(`/audits/${id}`));
        const list = obj(await api.get(`/audits/${id}/findings`));
        const findings = Array.isArray(list.findings) ? list.findings : [];
        return {
          id: audit.id,
          status: audit.status,
          summary: audit.summary,
          coverage: COVERAGE,
          findings: findings.map((item) => {
            const f = obj(item);
            const fix = f.fix ? obj(f.fix) : null;
            return {
              id: f.id,
              table: f.table,
              verdict: f.verdict,
              severity: f.severity,
              title: f.title,
              explanation: obj(f.explanation).en,
              fix: fix
                ? {
                    status: fix.status,
                    description: fix.description,
                    sql: fix.sql,
                  }
                : null,
              retest: f.retest,
            };
          }),
        };
      },
    },
    {
      name: 'request_retest',
      title: 'Re-test an audit',
      description: `Runs the same checks again on a finished audit of the configured TEST project. Takes no keys; they come from the server settings. ${SCOPE}`,
      schema: z.strictObject({ id: auditId }),
      async run(args) {
        needTestConfirmation(config);
        const started = obj(
          await api.post(`/audits/${args.id as string}/retest`, {
            anonKey: config.publishableKey,
            serviceKey: config.secretKey,
            confirmTestProject: true,
          }),
        );
        return { id: started.id, status: started.status };
      },
    },
    {
      name: 'get_certificate',
      title: 'Get the result record',
      description: `Returns the result record when no leak was found by these checks, or says why none can be issued yet. ${SCOPE}`,
      schema: z.strictObject({ id: auditId }),
      async run(args) {
        try {
          const certificate = obj(
            await api.get(`/audits/${args.id as string}/certificate`),
          );
          return { eligible: true, ...certificate };
        } catch (error) {
          if (error instanceof ToolError && error.code === 'NOT_ELIGIBLE') {
            return { eligible: false, message: error.message };
          }
          throw error;
        }
      },
    },
  ];
}

/** Registers the tools. Every result and every error text goes through `redact`. */
export function registerTools(
  server: McpServer,
  tools: ToolDef[],
  redact: (text: string) => string,
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(args);
          return {
            content: [
              {
                type: 'text' as const,
                text: redact(JSON.stringify(result, null, 2)),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof ToolError
              ? error.message
              : 'The tool stopped unexpectedly.';
          return {
            isError: true,
            content: [{ type: 'text' as const, text: redact(message) }],
          };
        }
      },
    );
  }
}
