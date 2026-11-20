// Smoke test for Repo Scan Lite, step 0: can this machine (or Railway) reach
// GitHub, and what do the rate limits look like? NOT part of the production
// build (it lives in scripts/).
//
//   node scripts/smoke-repo.mjs                      (default: octocat/Hello-World)
//   node scripts/smoke-repo.mjs owner/repo
//
// It does two things only:
//   1. GET https://api.github.com/repos/{owner}/{repo}      (metadata)
//   2. GET https://api.github.com/repos/{owner}/{repo}/zipball  (archive)
// and prints status codes, x-ratelimit-* headers, and sizes. It never prints
// file contents. Optional GITHUB_TOKEN (fine-grained, no scopes) is used if set
// and is NEVER printed: the output only says "token: set" or "token: not set".
//
// Limits are the same caps the scanner will use: compressed <= 15 MB. The
// download is stopped early if it goes over the cap.

const MAX_COMPRESSED = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const ALLOWED_HOSTS = new Set(['api.github.com', 'codeload.github.com']);

const target = process.argv[2] ?? 'octocat/Hello-World';
const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(target);
if (!match) {
  console.error('Use the form owner/repo');
  process.exit(2);
}
const [, owner, repo] = match;

const token = (process.env.GITHUB_TOKEN ?? '').trim();
const baseHeaders = {
  'user-agent': 'vibe-code-auditor-smoke',
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

const rateOf = (headers) => ({
  limit: headers.get('x-ratelimit-limit'),
  remaining: headers.get('x-ratelimit-remaining'),
  used: headers.get('x-ratelimit-used'),
  resource: headers.get('x-ratelimit-resource'),
  resetAt: headers.get('x-ratelimit-reset')
    ? new Date(Number(headers.get('x-ratelimit-reset')) * 1000).toISOString()
    : null,
  retryAfter: headers.get('retry-after'),
});

// One request. The token goes only to api.github.com. Redirects are followed by
// hand, only to the two GitHub hosts, at most 3 hops.
async function get(url, { withToken }) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).host;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`redirect to a host not allowed: ${host}`);
    const headers = { ...baseHeaders };
    if (token && withToken && host === 'api.github.com') {
      headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(current, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return { res, finalHost: host };
  }
  throw new Error('too many redirects');
}

console.log('Repo Scan Lite smoke, GitHub reachability');
console.log(`repo: ${owner}/${repo}   token: ${token ? 'set' : 'not set'}`);

// 1. metadata
try {
  const t = Date.now();
  const { res } = await get(`https://api.github.com/repos/${owner}/${repo}`, { withToken: true });
  const body = res.ok ? await res.json() : null;
  if (!res.ok) await res.body?.cancel();
  console.log('\n[metadata]');
  console.log(`  status: ${res.status}   time: ${Date.now() - t} ms`);
  console.log(`  rate: ${JSON.stringify(rateOf(res.headers))}`);
  if (body) {
    console.log(
      `  private: ${body.private}   size(KB, GitHub's number): ${body.size}   default branch: ${body.default_branch}   archived: ${body.archived}`,
    );
  }
} catch (error) {
  console.log('\n[metadata]');
  console.log(`  FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
}

// 2. archive (zip), streamed and counted, never saved and never printed
try {
  const t = Date.now();
  const { res, finalHost } = await get(
    `https://api.github.com/repos/${owner}/${repo}/zipball`,
    { withToken: true },
  );
  console.log('\n[archive]');
  console.log(`  status: ${res.status}   served by: ${finalHost}   time to first byte: ${Date.now() - t} ms`);
  console.log(`  content-type: ${res.headers.get('content-type')}   content-length: ${res.headers.get('content-length') ?? 'none'}`);
  console.log(`  rate (api): ${JSON.stringify(rateOf(res.headers))}`);
  if (res.ok && res.body) {
    let bytes = 0;
    let magic = '';
    let overCap = false;
    for await (const chunk of res.body) {
      if (bytes === 0) magic = Buffer.from(chunk.subarray(0, 2)).toString('latin1');
      bytes += chunk.length;
      if (bytes > MAX_COMPRESSED) {
        overCap = true;
        await res.body.cancel();
        break;
      }
    }
    console.log(
      `  downloaded: ${(bytes / 1024).toFixed(0)} KB in ${Date.now() - t} ms   starts like a zip (PK): ${magic === 'PK' ? 'yes' : 'NO'}${overCap ? '   STOPPED: over the 15 MB cap' : ''}`,
    );
  } else {
    await res.body?.cancel();
  }
} catch (error) {
  console.log('\n[archive]');
  console.log(`  FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
}
