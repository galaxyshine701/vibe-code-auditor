import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Starts the built server as a real process. `npm test` builds first.
const ENTRY = join(process.cwd(), 'dist', 'index.js');
const SEED = 'fake-seed-value-77777777';

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  env: Record<string, string>,
  args: string[] = [],
  stopOnReady = false,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, ENTRY], {
      env: { PATH: process.env.PATH ?? '', ...env },
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('server did not finish in time'));
    }, 15_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stopOnReady && stderr.includes('ready')) child.kill();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('starting the built server', () => {
  it('has been built', () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  it('stops with a clear message when mcp/.env is missing, and prints nothing on stdout', async () => {
    const out = await run({}, ['--env-file-if-exists=does-not-exist.env']);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('mcp/.env');
    expect(out.stdout).toBe('');
  });

  it('names the missing variables and never prints a value that is set', async () => {
    const out = await run({ SUPABASE_SECRET_KEY: SEED });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('VCA_API_URL');
    expect(out.stderr).not.toContain(SEED);
    expect(out.stdout).toBe('');
  });

  it('warns on stderr about a short access code, without printing it, and still starts', async () => {
    const out = await run(
      {
        VCA_API_URL: 'https://api.example.test',
        VCA_ACCESS_CODE: 'short7x',
        SUPABASE_URL: 'https://fakeproject.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'fake-publishable-key-111111',
        SUPABASE_SECRET_KEY: SEED,
      },
      [],
      true,
    );
    expect(out.stderr).toContain('warning');
    expect(out.stderr).toContain('VCA_ACCESS_CODE');
    expect(out.stderr).not.toContain('short7x');
    expect(out.stderr).not.toContain(SEED);
    expect(out.stdout).toBe('');
  });
});
