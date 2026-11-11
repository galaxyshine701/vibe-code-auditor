import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config.js';
import { SupabaseGateway } from './gateway.js';
import { runProver } from './prover.js';
import { redact } from './redact.js';
import { ProverError } from './types.js';

// backend/.env (this file lives in backend/dist/prover/ after the build)
loadDotenv({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const secrets = [
  process.env.SUPABASE_SECRET_KEY ?? '',
  process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
];
const print = (value: unknown) =>
  console.log(redact(JSON.stringify(value, null, 2), secrets));

try {
  const config = loadConfig(process.env);
  const result = await runProver(new SupabaseGateway(config), (message) =>
    console.error(redact(message, secrets)),
  );
  print(result);
  process.exitCode = result.cleanup === 'ok' ? 0 : 2;
} catch (error) {
  const known = error instanceof ProverError ? error : null;
  print({
    error: {
      code: known?.code ?? 'PROVER_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'The Prover stopped unexpectedly.',
    },
    cleanup: known?.cleanup ?? null,
    ...(known?.cleanupNote ? { cleanupNote: known.cleanupNote } : {}),
  });
  process.exitCode = 1;
}
