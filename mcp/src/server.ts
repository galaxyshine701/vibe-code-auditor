import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApi } from './api.js';
import type { Config } from './config.js';
import { makeRedactor, secretsOf } from './redact.js';
import { buildTools, registerTools } from './tools.js';

/** Builds the server. `fetchImpl` is replaced by a fake in tests. */
export function createServer(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  sleep?: (ms: number) => Promise<void>,
): McpServer {
  const server = new McpServer({ name: 'vca', version: '0.0.1' });
  const api = createApi(config, fetchImpl);
  registerTools(
    server,
    buildTools({ config, api, sleep }),
    makeRedactor(secretsOf(config)),
  );
  return server;
}
