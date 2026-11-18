import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createBundleInspectorAgent } from '../../src/agents/bundle-inspector-agent.js';
import { createHeadersInspectorAgent } from '../../src/agents/headers-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import {
  SafeFetchError,
  type SafeFetchOptions,
  type SafeFetchResult,
} from '../../src/net/safe-fetch.js';
import { BUNDLE_SCAN_LIMITS } from '../../src/stages/planner-config.js';

const SITE = 'https://www.example-shop.com';
const KEY = 'sb_secret_AbCdEfGhIjKlMnOp123456';
const GOOD_HEADERS = {
  'strict-transport-security': 'max-age=63072000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

type Call = { url: string; options?: SafeFetchOptions };
type Handler = (
  url: string,
  options?: SafeFetchOptions,
) => SafeFetchResult | Promise<SafeFetchResult>;

const reply = (
  url: string,
  body: string,
  extra: Partial<SafeFetchResult> = {},
): SafeFetchResult => ({
  url,
  status: 200,
  headers: { ...GOOD_HEADERS },
  body: Buffer.from(body),
  ...extra,
});

function fetcherOf(handler: Handler) {
  const calls: Call[] = [];
  const fetcher = async (url: string, options?: SafeFetchOptions) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { fetcher, calls };
}

const control = (over: Partial<AgentControl> = {}): AgentControl => ({
  shouldStop: () => false,
  redact: (t) => t,
  states: () => [],
  failure: () => null,
  ...over,
});

const contextFor = (over: Partial<RunContext> = {}): RunContext => ({
  websiteUrl: SITE,
  siteResults: {},
  siteEvidence: [],
  ...over,
});

const page = (scripts: string, extra = '') =>
  `<html><head>${scripts}</head><body>${extra}</body></html>`;

describe('Headers inspector', () => {
  it('a good site: completed, six BLOCKED items about headers, with no table and no finding', async () => {
    const { fetcher, calls } = fetcherOf((url) => reply(url, page('')));
    const context = contextFor();
    const result = await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    expect(result).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([SITE]);
    expect(context.siteResults!['tls-headers'].status).toBe('completed');
    const items = context.siteEvidence!;
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item).toMatchObject({
        check: 'tls-headers',
        kind: 'site-headers',
        findingId: null,
        table: null,
        verdict: 'BLOCKED',
        proof: 'PROVEN',
      });
      expect(item.subject!.length).toBeGreaterThan(0);
      expect(item.summary.en.length).toBeGreaterThan(0);
      expect(item.summary.ur.length).toBeGreaterThan(0);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(6);
  });

  it('a missing header is INCONCLUSIVE (never LEAKED): it is a gap, not a leak', async () => {
    const { fetcher } = fetcherOf((url) =>
      reply(url, page(''), { headers: {} }),
    );
    const context = contextFor();
    await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const verdicts = Object.fromEntries(
      context.siteEvidence!.map((i) => [i.subject, i.verdict]),
    );
    expect(verdicts['strict-transport-security']).toBe('INCONCLUSIVE');
    expect(verdicts['content-security-policy']).toBe('INCONCLUSIVE');
    expect(context.siteEvidence!.some((i) => i.verdict === 'LEAKED')).toBe(
      false,
    );
    // the check itself still completed: it looked, and it knows
    expect(context.siteResults!['tls-headers'].status).toBe('completed');
  });

  it('the certificate itself is not read (the fetcher does not expose it): it is named as out of scope, "not implemented", and does not hold the gate', async () => {
    const { fetcher } = fetcherOf((url) => reply(url, page('')));
    const context = contextFor();
    await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['tls-headers'];
    expect(result.outOfScope).toHaveLength(1);
    expect(result.outOfScope![0].name).toMatch(/TLS/i);
    expect(result.outOfScope![0].reason.en).toMatch(/not implemented/i);
    expect(result.outOfScope![0].reason.ur.length).toBeGreaterThan(0);
    expect(result.status).not.toBe('partial');
  });

  it('asks for the front page only, with the size cap from the limits', async () => {
    const { fetcher, calls } = fetcherOf((url) => reply(url, page('')));
    await createHeadersInspectorAgent({ fetcher }).run(
      contextFor({
        limits: { bundle: { ...BUNDLE_SCAN_LIMITS, maxFileBytes: 1234 } },
      }),
      () => {},
      control(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.maxBytes).toBe(1234);
  });

  it('a site that cannot be read: failedToRun with the fixed sentence of the error, no address in it, no items', async () => {
    const { fetcher } = fetcherOf(() => {
      throw new SafeFetchError('BLOCKED_ADDRESS');
    });
    const context = contextFor();
    await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['tls-headers'];
    expect(result.status).toBe('failedToRun');
    expect(result.reason!.en).toBe(
      new SafeFetchError('BLOCKED_ADDRESS').message,
    );
    expect(result.reason!.ur.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('example-shop');
    expect(context.siteEvidence).toEqual([]);
  });

  it('an unexpected error never leaks its text', async () => {
    const { fetcher } = fetcherOf(() => {
      throw new Error('boom: secret-token-xyz at https://internal.example');
    });
    const context = contextFor();
    await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const text = JSON.stringify(context.siteResults);
    expect(text).not.toContain('secret-token-xyz');
    expect(context.siteResults!['tls-headers'].status).toBe('failedToRun');
  });

  it('looks at the stop flag before it fetches: stopped = nothing is fetched', async () => {
    const { fetcher, calls } = fetcherOf((url) => reply(url, page('')));
    const context = contextFor();
    await createHeadersInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control({ shouldStop: () => true }),
    );
    expect(calls).toHaveLength(0);
    expect(context.siteResults!['tls-headers'].status).toBe('failedToRun');
    expect(context.siteResults!['tls-headers'].reason!.en).toMatch(/stopped/i);
  });

  it('with no website it does nothing, and says "not provided"', async () => {
    const { fetcher, calls } = fetcherOf((url) => reply(url, ''));
    const result = await createHeadersInspectorAgent({ fetcher }).run(
      { siteResults: {} },
      () => {},
      control(),
    );
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({
      skipped: { en: expect.stringMatching(/^Not provided/) },
    });
  });

  it('is a plain agent: not critical, not a finalizer, id tls-headers', () => {
    const agent = createHeadersInspectorAgent();
    expect([agent.id, agent.critical, agent.alwaysRun]).toEqual([
      'tls-headers',
      false,
      undefined,
    ]);
  });
});

describe('Bundle inspector', () => {
  const scriptsOf = (...paths: string[]) =>
    paths.map((p) => `<script src="${p}"></script>`).join('');

  it('finds a secret key in a script: one LEAKED item about that script, and the key is NOT in any output', async () => {
    const { fetcher, calls } = fetcherOf((url) => {
      if (url === SITE)
        return reply(url, page(scriptsOf('/a.js', '/b.js?v=SECRETTOKEN')));
      if (url.includes('/b.js')) return reply(url, `var k="${KEY}";`);
      return reply(url, 'console.log(1)');
    });
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );

    expect(context.siteResults!['bundle-secrets'].status).toBe('completed');
    expect(context.siteEvidence).toHaveLength(1);
    expect(context.siteEvidence![0]).toMatchObject({
      check: 'bundle-secrets',
      kind: 'site-bundle',
      findingId: null,
      table: null,
      subject: 'www.example-shop.com/b.js',
      verdict: 'LEAKED',
      proof: 'PROVEN',
    });
    const everything = JSON.stringify([context, calls.map((c) => c.options)]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('AbCdEfGhIjKl');
    // the name has no query: a token in the address stays out
    expect(JSON.stringify(context.siteEvidence)).not.toContain('SECRETTOKEN');
    expect(context.siteEvidence![0].summary.en.length).toBeGreaterThan(0);
    expect(context.siteEvidence![0].summary.ur.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.url)).toEqual([
      SITE,
      `${SITE}/a.js`,
      `${SITE}/b.js?v=SECRETTOKEN`,
    ]);
  });

  it('a key written into the page itself (an inline script) is found, as "the front page"', async () => {
    const { fetcher } = fetcherOf((url) =>
      reply(url, page('', `<script>window.k="${KEY}"</script>`)),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    expect(context.siteEvidence).toHaveLength(1);
    expect(context.siteEvidence![0].subject).toMatch(/front page/i);
  });

  it('a clean site: completed, no item', async () => {
    const { fetcher } = fetcherOf((url) =>
      url === SITE ? reply(url, page(scriptsOf('/a.js'))) : reply(url, 'ok()'),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    expect(context.siteResults!['bundle-secrets']).toEqual({
      id: 'bundle-secrets',
      status: 'completed',
    });
    expect(context.siteEvidence).toEqual([]);
  });

  it('a script of another origin is named as out of scope, and is never fetched', async () => {
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE
        ? reply(
            url,
            page(
              scriptsOf(
                '/a.js',
                'https://cdn.other-site.net/lib/x.js?auth=ZZZ',
              ),
            ),
          )
        : reply(url, 'ok()'),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['bundle-secrets'];
    expect(result.status).toBe('completed'); // out of scope is not partial
    expect(result.outOfScope).toHaveLength(1);
    expect(result.outOfScope![0].name).toBe('cdn.other-site.net/lib/x.js');
    expect(result.outOfScope![0].reason.ur.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes('other-site'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('ZZZ');
  });

  it('reads at most maxFiles scripts; the rest are named as not read, and the check is partial', async () => {
    const names = Array.from({ length: 6 }, (_, i) => `/s${i}.js`);
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE ? reply(url, page(scriptsOf(...names))) : reply(url, 'ok()'),
    );
    const context = contextFor({
      limits: { bundle: { ...BUNDLE_SCAN_LIMITS, maxFiles: 3 } },
    });
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['bundle-secrets'];
    expect(result.status).toBe('partial');
    expect(result.reason!.en.length).toBeGreaterThan(0);
    expect(result.notRead!.map((n) => n.name)).toEqual([
      'www.example-shop.com/s3.js',
      'www.example-shop.com/s4.js',
      'www.example-shop.com/s5.js',
    ]);
    expect(calls).toHaveLength(1 + 3);
  });

  it('with the real limits it never fetches more than 1 + 30 files', async () => {
    const names = Array.from({ length: 80 }, (_, i) => `/s${i}.js`);
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE ? reply(url, page(scriptsOf(...names))) : reply(url, 'ok()'),
    );
    await createBundleInspectorAgent({ fetcher }).run(
      contextFor(),
      () => {},
      control(),
    );
    expect(calls.length).toBe(1 + BUNDLE_SCAN_LIMITS.maxFiles);
  });

  it('a file that is too large is not read: partial, named', async () => {
    const { fetcher } = fetcherOf((url) => {
      if (url === SITE) return reply(url, page(scriptsOf('/big.js', '/ok.js')));
      if (url.endsWith('/big.js')) throw new SafeFetchError('TOO_LARGE');
      return reply(url, 'ok()');
    });
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['bundle-secrets'];
    expect(result.status).toBe('partial');
    expect(result.notRead!.map((n) => n.name)).toEqual([
      'www.example-shop.com/big.js',
    ]);
  });

  it('a script that answers with an error status is not read either', async () => {
    const { fetcher } = fetcherOf((url) =>
      url === SITE
        ? reply(url, page(scriptsOf('/gone.js')))
        : reply(url, 'not found', { status: 404 }),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    expect(context.siteResults!['bundle-secrets'].status).toBe('partial');
  });

  it('the total size cap: what would not fit is not read, and the cap is passed to the fetcher', async () => {
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE
        ? reply(url, page(scriptsOf('/a.js', '/b.js', '/c.js')))
        : reply(url, 'x'.repeat(40)),
    );
    const context = contextFor({
      limits: {
        bundle: {
          ...BUNDLE_SCAN_LIMITS,
          maxFileBytes: 100,
          maxTotalBytes: 100 + 50,
        },
      },
    });
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    // page counts too (about 100 bytes), then the files need what is left
    const result = context.siteResults!['bundle-secrets'];
    for (const call of calls.slice(1)) {
      expect(call.options!.maxBytes!).toBeLessThanOrEqual(100);
    }
    expect(['completed', 'partial']).toContain(result.status);
    expect(
      calls.slice(1).reduce((sum) => sum + 1, 0) +
        (result.notRead?.length ?? 0),
    ).toBe(3);
  });

  it('looks at the stop flag before EVERY fetch, and stops: the rest is not read, and not fetched', async () => {
    let asked = 0;
    let stopAfter = 2; // the page and one script may be fetched
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE
        ? reply(url, page(scriptsOf('/a.js', '/b.js', '/c.js', '/d.js')))
        : reply(url, 'ok()'),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control({
        shouldStop: () => {
          asked += 1;
          return asked > stopAfter;
        },
      }),
    );
    expect(calls.length).toBeLessThanOrEqual(stopAfter);
    expect(asked).toBeGreaterThan(calls.length); // asked before each fetch, and once more when it stopped
    const result = context.siteResults!['bundle-secrets'];
    expect(result.status).toBe('partial');
    expect(result.notRead!.some((n) => /stopped/i.test(n.reason.en))).toBe(
      true,
    );
    stopAfter = 0;
  });

  it('stopped before the first fetch: nothing is fetched, failedToRun', async () => {
    const { fetcher, calls } = fetcherOf((url) => reply(url, ''));
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control({ shouldStop: () => true }),
    );
    expect(calls).toHaveLength(0);
    expect(context.siteResults!['bundle-secrets'].status).toBe('failedToRun');
  });

  it('the front page cannot be read: failedToRun with the fixed sentence', async () => {
    const { fetcher } = fetcherOf(() => {
      throw new SafeFetchError('TIMEOUT');
    });
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    const result = context.siteResults!['bundle-secrets'];
    expect(result.status).toBe('failedToRun');
    expect(result.reason!.en).toBe(new SafeFetchError('TIMEOUT').message);
  });

  it('a script that is listed twice is fetched once', async () => {
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE
        ? reply(url, page(scriptsOf('/a.js', '/a.js')))
        : reply(url, 'ok()'),
    );
    await createBundleInspectorAgent({ fetcher }).run(
      contextFor(),
      () => {},
      control(),
    );
    expect(calls.filter((c) => c.url.endsWith('/a.js'))).toHaveLength(1);
  });

  it('judges same origin by the page it finally got (after a redirect to www)', async () => {
    const { fetcher, calls } = fetcherOf((url) =>
      url === SITE
        ? reply(
            'https://shop.example-shop.com/',
            page(scriptsOf('/a.js', 'https://www.example-shop.com/old.js')),
          )
        : reply(url, 'ok()'),
    );
    const context = contextFor();
    await createBundleInspectorAgent({ fetcher }).run(
      context,
      () => {},
      control(),
    );
    expect(calls.map((c) => c.url)).toEqual([
      SITE,
      'https://shop.example-shop.com/a.js',
    ]);
    expect(context.siteResults!['bundle-secrets'].outOfScope).toHaveLength(1);
  });

  it('reports progress', async () => {
    const seen: number[] = [];
    const { fetcher } = fetcherOf((url) =>
      url === SITE
        ? reply(url, page(scriptsOf('/a.js', '/b.js')))
        : reply(url, 'ok()'),
    );
    await createBundleInspectorAgent({ fetcher }).run(
      contextFor(),
      (p) => seen.push(p),
      control(),
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of seen) expect(p).toBeLessThanOrEqual(100);
  });

  it('is a plain agent: not critical, not a finalizer, id bundle-secrets', () => {
    const agent = createBundleInspectorAgent();
    expect([agent.id, agent.critical, agent.alwaysRun]).toEqual([
      'bundle-secrets',
      false,
      undefined,
    ]);
  });
});

describe('the inspectors use only the safe fetcher', () => {
  it('the sources have no direct network call of their own', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'src',
    );
    for (const file of [
      'agents/headers-inspector-agent.ts',
      'agents/bundle-inspector-agent.ts',
      'stages/site-rules.ts',
    ]) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(
        /\bfetch\s*\(|node:https?|node:net\b.*connect|XMLHttpRequest|axios|undici/,
      );
      expect(source).not.toMatch(/report\/|groq|llm|openai|anthropic/i);
      expect(source).not.toMatch(/Math\.random|process\.env/);
    }
  });
});
