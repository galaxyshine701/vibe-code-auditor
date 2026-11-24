import { REPO_SCAN_LIMITS } from '../../src/repo/repo-limits.js';
import {
  isScannable,
  RepoFetchError,
  scanRepo,
  type RepoTransport,
} from '../../src/repo/repo-scanner.js';
import { buildZip, type TestEntry } from './zip-builder.js';

const REPO = { owner: 'someone', repo: 'app' };
// built from pieces so no real-looking key sits in the source of this test
const SECRET = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0';
const serviceRoleJwt = () => {
  const part = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ role: 'service_role' })}.${'x'.repeat(20)}`;
};

const transportOf = (entries: TestEntry[]): RepoTransport => ({
  fetchArchive: () => Promise.resolve(buildZip(entries)),
});
const failing = (error: unknown): RepoTransport => ({
  fetchArchive: () => Promise.reject(error),
});

describe('isScannable', () => {
  it('reads source and config text, not dependencies or binaries', () => {
    expect(isScannable('src/app.ts')).toBe(true);
    expect(isScannable('.env')).toBe(true);
    expect(isScannable('.env.local')).toBe(true);
    expect(isScannable('supabase/migrations/001.sql')).toBe(true);
    expect(isScannable('node_modules/x/index.js')).toBe(false);
    expect(isScannable('dist/main.js')).toBe(false);
    expect(isScannable('logo.png')).toBe(false);
  });
});

describe('scanRepo', () => {
  it('finds a secret key and a service_role key and reports kind and path only', async () => {
    const outcome = await scanRepo(
      transportOf([
        { name: 'o-r-1/src/client.ts', data: `const k = "${SECRET}";` },
        { name: 'o-r-1/.env', data: `KEY=${serviceRoleJwt()}` },
        { name: 'o-r-1/src/ok.ts', data: 'const x = 1;' },
      ]),
      REPO,
    );
    expect(outcome.completed).toBe(true);
    expect(outcome.hits).toEqual([
      { path: 'src/client.ts', kind: 'secret-key', line: 1, testPath: false },
      { path: '.env', kind: 'service-role-jwt', line: 1, testPath: false },
    ]);
    expect(outcome.filesScanned).toBe(3);
    // the key itself is nowhere in the outcome
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('a clean repo has no hits', async () => {
    const outcome = await scanRepo(
      transportOf([{ name: 'o-r-1/a.ts', data: 'export const a = 1;' }]),
      REPO,
    );
    expect(outcome).toMatchObject({ completed: true, hits: [], filesScanned: 1 });
  });

  it('does not look inside node_modules, and lists big files and symlinks as not read', async () => {
    const outcome = await scanRepo(
      transportOf([
        { name: 'o-r-1/node_modules/p/i.js', data: SECRET },
        {
          name: 'o-r-1/big.json',
          data: Buffer.alloc(REPO_SCAN_LIMITS.maxFileBytes + 1, 97),
        },
        { name: 'o-r-1/link.ts', data: 'x', mode: 0o120777 },
      ]),
      REPO,
    );
    expect(outcome.hits).toEqual([]);
    expect(outcome.notRead).toEqual(
      expect.arrayContaining([
        { path: 'big.json', reason: 'too-large' },
        { path: 'link.ts', reason: 'symlink' },
      ]),
    );
  });

  it('a binary file with a text name is not read', async () => {
    const outcome = await scanRepo(
      transportOf([
        { name: 'o-r-1/x.json', data: Buffer.from([0, 1, 2, 3]) },
      ]),
      REPO,
    );
    expect(outcome.notRead).toEqual([{ path: 'x.json', reason: 'binary' }]);
  });

  it('a hostile zip is an outcome, never a throw', async () => {
    const outcome = await scanRepo(
      transportOf([{ name: '../evil.ts', data: 'x' }]),
      REPO,
    );
    expect(outcome).toMatchObject({ completed: false, failure: 'archive-refused' });
  });

  it('maps every transport failure to a fixed reason', async () => {
    const cases: [unknown, string][] = [
      [new RepoFetchError('NOT_FOUND', 'x'), 'not-found'],
      [new RepoFetchError('RATE_LIMITED', 'x'), 'rate-limited'],
      [new RepoFetchError('TOO_LARGE', 'x'), 'too-large'],
      [new RepoFetchError('FAILED', 'x'), 'could-not-fetch'],
      [new Error('ECONNRESET with a secret in the text'), 'could-not-fetch'],
    ];
    for (const [error, failure] of cases) {
      const outcome = await scanRepo(failing(error), REPO);
      expect(outcome).toMatchObject({ completed: false, failure });
      expect(JSON.stringify(outcome)).not.toContain('secret in the text');
    }
  });

  it('asks the transport for no more than the compressed cap', async () => {
    let asked = 0;
    await scanRepo(
      {
        fetchArchive: (_r, o) => {
          asked = o.maxBytes;
          return Promise.resolve(buildZip([]));
        },
      },
      REPO,
    );
    expect(asked).toBe(15 * 1024 * 1024);
  });
});
