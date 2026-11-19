import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The API layer of the stages (frontend/src/lib/api.ts, mock-bundle.ts).
// The frontend has no test runner of its own, so the files are loaded by path.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'frontend-mock');
const BUNDLES = ['supabase-only', 'url-only', 'both'];
const FILES = ['audit', 'evidence', 'roadmap', 'client-report', 'findings'];

interface Audit {
  id: string;
  status: string;
  schemaVersion?: number;
  gate?: { decision: string };
  error?: { code: string };
  cleanup?: string | null;
  modules: { id: string; status: string; reason?: unknown; message?: string }[];
  summary: Record<string, number>;
}
interface Api {
  getAudit: (id: string, code: string) => Promise<Audit>;
  getFindings: (
    id: string,
    code: string,
  ) => Promise<{ findings: { id: string }[] }>;
  startAudit: (
    input: Record<string, unknown>,
    code: string,
  ) => Promise<{ id: string }>;
  getEvidence: (id: string, code: string) => Promise<unknown>;
  getStageBundle: (
    audit: { id: string; schemaVersion?: number },
    code: string,
  ) => Promise<Record<string, unknown>>;
  retest: (id: string, input: unknown, code: string) => Promise<unknown>;
}
interface Bundle {
  bundleFromId: (id: string) => string | null;
  selectedBundle: () => string | null;
}

// config.ts reads the environment when it is first loaded, so every load starts
// from empty module caches.
async function load<T>(file: string): Promise<T> {
  vi.resetModules();
  const url = pathToFileURL(join(FRONTEND, 'src', 'lib', file)).href;
  return (await import(/* @vite-ignore */ url)) as T;
}

function stubWindow(search: string): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { search },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the bundle copies in the frontend', () => {
  for (const bundle of BUNDLES) {
    for (const file of FILES) {
      it(`${bundle}/${file}.json is the same as docs/frontend-mock`, () => {
        const copy = readFileSync(
          join(FRONTEND, 'src', 'lib', 'mock-bundles', bundle, `${file}.json`),
          'utf8',
        );
        const original = readFileSync(
          join(DOCS, bundle, `${file}.json`),
          'utf8',
        );
        expect(JSON.parse(copy)).toEqual(JSON.parse(original));
      });
    }
  }
});

describe('with the backend (mock off)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK', 'false');
    stubWindow('');
  });

  function fetchStub(answers: Record<string, [number, unknown]>) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        const key = Object.keys(answers).find((k) => url.endsWith(k));
        const [status, body] = key ? answers[key] : [500, null];
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }),
    );
    return calls;
  }

  const OLD_AUDIT = {
    id: 'a1',
    status: 'completed',
    createdAt: '2026-11-18T10:00:00Z',
    target: { label: 'x', projectUrl: 'https://p.supabase.co' },
    summary: { leaked: 0, blocked: 1, inconclusive: 0 },
    modules: [],
    cleanup: 'ok',
  };

  it('an old answer (no schemaVersion) is version 1 and the three routes are never asked', async () => {
    const calls = fetchStub({ '/audits/a1': [200, OLD_AUDIT] });
    const api = await load<Api>('api.ts');
    const audit = await api.getAudit('a1', 'code');
    expect(audit.schemaVersion).toBe(1);
    const bundle = await api.getStageBundle(audit, 'code');
    expect(bundle).toEqual({
      evidence: null,
      roadmap: null,
      clientReport: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('version 2 reads evidence, roadmap and client-report, each null on a 404 (R72)', async () => {
    const calls = fetchStub({
      '/evidence': [200, { schemaVersion: 2, items: [] }],
      '/roadmap': [404, { error: { code: 'NOT_FOUND', message: 'x' } }],
      '/client-report': [404, { error: { code: 'NOT_FOUND', message: 'x' } }],
    });
    const api = await load<Api>('api.ts');
    const bundle = await api.getStageBundle(
      { id: 'a1', schemaVersion: 2 },
      'c',
    );
    expect(bundle).toEqual({
      evidence: { schemaVersion: 2, items: [] },
      roadmap: null,
      clientReport: null,
    });
    expect(calls.map((u) => u.split('/').pop())).toEqual(
      expect.arrayContaining(['evidence', 'roadmap', 'client-report']),
    );
  });

  it('an error that is not 404 is thrown, not hidden', async () => {
    fetchStub({
      '/evidence': [500, { error: { code: 'INTERNAL', message: 'broke' } }],
    });
    const api = await load<Api>('api.ts');
    await expect(api.getEvidence('a1', 'c')).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('mock mode and the bundle switch', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCK', 'true');
  });

  it('ids carry the bundle name; the old mock id and unknown ids are not bundles', async () => {
    stubWindow('');
    const bundle = await load<Bundle>('mock-bundle.ts');
    expect(bundle.bundleFromId('mock-both')).toBe('both');
    expect(bundle.bundleFromId('mock-url-only')).toBe('url-only');
    expect(bundle.bundleFromId('aud_mock_001')).toBeNull();
    expect(bundle.bundleFromId('mock-nothing')).toBeNull();
  });

  it('?mock=<name> is read, kept in the tab, and ?mock=old clears it', async () => {
    const store = stubWindow('?mock=url-only');
    const bundle = await load<Bundle>('mock-bundle.ts');
    expect(bundle.selectedBundle()).toBe('url-only');
    expect(store.get('vca-mock-bundle')).toBe('url-only');
    stubWindow('');
    // a new tab state without the query and without storage: the old mock
    expect(bundle.selectedBundle()).toBeNull();
    const kept = stubWindow('?mock=nonsense');
    kept.set('vca-mock-bundle', 'both');
    expect(bundle.selectedBundle()).toBe('both');
    const cleared = stubWindow('?mock=old');
    cleared.set('vca-mock-bundle', 'both');
    expect(bundle.selectedBundle()).toBeNull();
    expect(cleared.has('vca-mock-bundle')).toBe(false);
  });

  it('without a choice the old mock answers, with no stage fields', async () => {
    stubWindow('');
    const api = await load<Api>('api.ts');
    const audit = await api.getAudit('aud_mock_001', '');
    expect(audit.schemaVersion).toBe(1);
    expect(audit.gate).toBeUndefined();
    expect(await api.getEvidence('aud_mock_001', '')).toBeNull();
    expect(await api.getStageBundle(audit, '')).toEqual({
      evidence: null,
      roadmap: null,
      clientReport: null,
    });
  });

  for (const name of BUNDLES) {
    it(`${name}: a finished audit has the stage fields and the three routes`, async () => {
      stubWindow('');
      const api = await load<Api>('api.ts');
      const audit = await api.getAudit(`mock-${name}`, '');
      expect(audit.status).toBe('completed');
      expect(audit.schemaVersion).toBe(2);
      expect(audit.gate?.decision).toBe('not_ready');
      const stage = await api.getStageBundle(audit, '');
      expect(stage.evidence).not.toBeNull();
      expect(stage.roadmap).not.toBeNull();
      expect(stage.clientReport).not.toBeNull();
    });
  }

  it('a started audit plays its progress first: skipped rows stay skipped with their reason', async () => {
    stubWindow('?mock=url-only');
    const api = await load<Api>('api.ts');
    const started = await api.startAudit(
      { websiteUrl: 'https://www.example-shop.com', confirmSiteAccess: true },
      '',
    );
    expect(started.id).toBe('mock-url-only');
    const running = await api.getAudit(started.id, '');
    expect(running.status).toBe('running');
    expect(running.gate).toBeUndefined();
    const skipped = running.modules.find((m) => m.id === 'data-access-prover');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.reason).toBeTruthy();
    expect((await api.getFindings(started.id, '')).findings).toEqual([]);
  });

  it('a website address that is not https gives the 400 of the backend', async () => {
    stubWindow('?mock=both');
    const api = await load<Api>('api.ts');
    await expect(
      api.startAudit(
        { websiteUrl: 'http://x.test', confirmSiteAccess: true },
        '',
      ),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  });

  it('timeout: a failed audit with TIMEOUT, a failed row and a failed cleanup', async () => {
    stubWindow('');
    const api = await load<Api>('api.ts');
    const audit = await api.getAudit('mock-timeout', '');
    expect(audit.status).toBe('failed');
    expect(audit.error?.code).toBe('TIMEOUT');
    expect(audit.cleanup).toBe('failed');
    const failed = audit.modules.find((m) => m.status === 'failed');
    expect(failed?.message).toBeTruthy();
  });

  it('Re-test is not played for a bundle, with the 409 of the backend', async () => {
    stubWindow('');
    const api = await load<Api>('api.ts');
    await expect(
      api.retest('mock-both', { anonKey: 'a', serviceKey: 'b' }, ''),
    ).rejects.toMatchObject({ status: 409, code: 'NOT_ELIGIBLE' });
  });
});
