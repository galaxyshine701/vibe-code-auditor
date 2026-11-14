import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createServer } from './server.js';

// stdout carries the protocol, so every message here goes to stderr.
// Messages name a variable or a file, never a value.
async function main(): Promise<void> {
  let loaded: ReturnType<typeof loadConfig>;
  try {
    loaded = loadConfig(process.env);
  } catch (error) {
    const message =
      error instanceof ConfigError ? error.message : 'Could not read settings.';
    process.stderr.write(`vca-mcp: ${message}\n`);
    process.exit(1);
  }
  for (const warning of loaded.warnings) {
    process.stderr.write(`vca-mcp: warning: ${warning}\n`);
  }
  const server = createServer(loaded.config);
  await server.connect(new StdioServerTransport());
  process.stderr.write('vca-mcp: ready\n');
}

main().catch(() => {
  process.stderr.write('vca-mcp: stopped unexpectedly.\n');
  process.exit(1);
});
