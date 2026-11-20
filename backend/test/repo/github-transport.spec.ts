import { createGithubTransport } from '../../src/repo/github-transport.js';
import { RepoFetchError } from '../../src/repo/repo-scanner.js';

const TOKEN = 'github_pat_' + 'TESTTOKEN1234567890';
const REPO = { owner: 'someone', repo: 'app' };
const ZIP = Buffer.from('PK-pretend-zip');

interface Call {
  url: string;
  authorization: string | undefined;
}
/** A fake GitHub: a map from address to a response. Records every call. */
function fakeGithub(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchImpl = ((input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      authorization: (init?.headers as Record<string, string>)?.authorization,
    });
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response('nope', { status: 500 }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const redirect = (to: string) => () =>
  new Response(null, { status: 302, headers: { location: to } });
const ok = (body: Buffer = ZIP, headers: Record<string, string> = {}) => () =>
  new Response(new Uint8Array(body), { status: 200, headers });

const fetchWith = (
  routes: Record<string, () => Response>,
  token?: string,
) => {
  const github = fakeGithub(routes);
  const transport = createGithubTransport({ token, fetchImpl: github.fetchImpl });
  return { ...github, run: () => transport.fetchArchive(REPO, { maxBytes: 1000 }) };
};
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof RepoFetchError ? error.code : 'other';
  }
  return 'no error';
};

describe('github transport: no token', () => {
  it('uses the plain archive address (HEAD) and never sends a token', async () => {
    const t = fetchWith({
      'https://github.com/someone/app/archive/HEAD.zip': redirect(
        'https://codeload.github.com/someone/app/zip/abc',
      ),
      'https://codeload.github.com/someone/app/zip/abc': ok(),
    });
    expect((await t.run()).equals(ZIP)).toBe(true);
    expect(t.calls.map((c) => new URL(c.url).hostname)).toEqual([
      'github.com',
      'codeload.github.com',
    ]);
    expect(t.calls.every((c) => c.authorization === undefined)).toBe(true);
  });

  it('uses a named branch when one is given', async () => {
    const github = fakeGithub({
      'https://github.com/someone/app/archive/refs/heads/dev.zip': ok(),
    });
    const transport = createGithubTransport({ fetchImpl: github.fetchImpl });
    await transport.fetchArchive({ ...REPO, ref: 'dev' }, { maxBytes: 1000 });
    expect(github.calls).toHaveLength(1);
  });
});

describe('github transport: with a token', () => {
  it('uses ONE api call (zipball, no ref) and sends the token to api.github.com only', async () => {
    const t = fetchWith(
      {
        'https://api.github.com/repos/someone/app/zipball': redirect(
          'https://codeload.github.com/someone/app/legacy.zip/refs/heads/main',
        ),
        'https://codeload.github.com/someone/app/legacy.zip/refs/heads/main': ok(),
      },
      TOKEN,
    );
    await t.run();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(t.calls[1].authorization).toBeUndefined(); // codeload never sees it
  });

  it('never sends the token on to a host that is not GitHub, and refuses the redirect', async () => {
    const t = fetchWith(
      {
        'https://api.github.com/repos/someone/app/zipball': redirect(
          'https://evil.example.com/steal',
        ),
      },
      TOKEN,
    );
    expect(await codeOf(t.run())).toBe('FAILED');
    expect(t.calls).toHaveLength(1);
  });
});

describe('github transport: failures are fixed words', () => {
  const API = 'https://api.github.com/repos/someone/app/zipball';
  const respond = (status: number) => () => new Response('body', { status });

  it('404 = NOT_FOUND, 403 and 429 = RATE_LIMITED, 500 = FAILED', async () => {
    expect(await codeOf(fetchWith({ [API]: respond(404) }, TOKEN).run())).toBe('NOT_FOUND');
    expect(await codeOf(fetchWith({ [API]: respond(403) }, TOKEN).run())).toBe('RATE_LIMITED');
    expect(await codeOf(fetchWith({ [API]: respond(429) }, TOKEN).run())).toBe('RATE_LIMITED');
    expect(await codeOf(fetchWith({ [API]: respond(500) }, TOKEN).run())).toBe('FAILED');
  });

  it('an endless redirect loop stops', async () => {
    expect(await codeOf(fetchWith({ [API]: redirect(API) }, TOKEN).run())).toBe('FAILED');
  });

  it('a redirect with no location is refused', async () => {
    expect(
      await codeOf(fetchWith({ [API]: () => new Response(null, { status: 302 }) }, TOKEN).run()),
    ).toBe('FAILED');
  });

  it('a timeout is FAILED, and the error never contains the token or the address', async () => {
    const transport = createGithubTransport({
      token: TOKEN,
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new Error(`aborted ${TOKEN} ${String(_u)}`)),
          );
        })) as typeof fetch,
    });
    const error = await transport
      .fetchArchive(REPO, { maxBytes: 1000 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RepoFetchError);
    expect((error as RepoFetchError).code).toBe('FAILED');
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('someone');
  });

  it('a too-big answer is TOO_LARGE, by header and while reading', async () => {
    const t1 = fetchWith(
      { [API]: ok(ZIP, { 'content-length': '999999' }) },
      TOKEN,
    );
    expect(await codeOf(t1.run())).toBe('TOO_LARGE');
    const t2 = fetchWith({ [API]: ok(Buffer.alloc(5000)) }, TOKEN); // no header
    expect(await codeOf(t2.run())).toBe('TOO_LARGE');
  });

  it('a bad owner, repo or branch name never reaches the network', async () => {
    const github = fakeGithub({});
    const transport = createGithubTransport({ fetchImpl: github.fetchImpl });
    for (const bad of [
      { owner: 'a/b', repo: 'x' },
      { owner: 'a', repo: '..' + '/x' },
      { owner: 'a', repo: 'x', ref: '../../etc' },
      { owner: '', repo: 'x' },
    ]) {
      expect(await codeOf(transport.fetchArchive(bad, { maxBytes: 10 }))).toBe('FAILED');
    }
    expect(github.calls).toHaveLength(0);
  });
});
