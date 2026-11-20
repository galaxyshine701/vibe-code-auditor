// Smoke test for Repo Scan Lite, step 0: can this machine (or Railway) reach
// GitHub, and what do the rate limits look like? NOT part of the production
// build (it lives in scripts/). Self-contained: no imports from the app, no
// secrets inside, so it can be pasted into `railway ssh` as base64.
//
//   node smoke-repo.mjs                      (default: octocat/Hello-World)
//   node smoke-repo.mjs owner/repo
//
// Three modes, 5 downloads in a row each:
//   archive    https://github.com/{o}/{r}/archive/refs/heads/{default}.zip
//              (a plain web URL: a token is NEVER sent here)
//   rest-anon  https://api.github.com/repos/{o}/{r}/zipball   (no token)
//   rest-token same as rest-anon, with GITHUB_TOKEN, only if it is set. The
//              token goes only to api.github.com, never to codeload.
// Output: status codes per mode, the first non-200 with its headers
// (only a safe allow-list of headers), sizes, timings. Never file contents,
// never the token (only "set" / "not set").

const MAX_COMPRESSED = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const RUNS = 5;
const ALLOWED_HOSTS = new Set([
  'api.github.com',
  'codeload.github.com',
  'github.com',
]);
const SAFE_HEADERS = [
  'content-type',
  'content-length',
  'location',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-used',
  'x-ratelimit-resource',
  'x-ratelimit-reset',
  'x-github-request-id',
  'server',
];

const target = process.argv[2] ?? 'octocat/Hello-World';
const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(target);
if (!match) {
  console.error('Use the form owner/repo');
  process.exit(2);
}
const [, owner, repo] = match;
const token = (process.env.GITHUB_TOKEN ?? '').trim();

const pick = (headers) => {
  const out = {};
  for (const name of SAFE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
};

// One request. Redirects by hand, only to the allowed hosts, max 3 hops.
// The token is added only for api.github.com.
async function get(url, useToken) {
  let current = url;
  const hosts = [];
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).host;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`host not allowed: ${host}`);
    hosts.push(host);
    const headers = {
      'user-agent': 'vibe-code-auditor-smoke',
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    if (token && useToken && host === 'api.github.com') {
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
    return { res, hosts };
  }
  throw new Error('too many redirects');
}

async function download(url, useToken) {
  const started = Date.now();
  const { res, hosts } = await get(url, useToken);
  let bytes = 0;
  let pk = false;
  let overCap = false;
  if (res.ok && res.body) {
    for await (const chunk of res.body) {
      if (bytes === 0) pk = chunk[0] === 0x50 && chunk[1] === 0x4b;
      bytes += chunk.length;
      if (bytes > MAX_COMPRESSED) {
        overCap = true;
        await res.body.cancel();
        break;
      }
    }
  } else {
    await res.body?.cancel();
  }
  return {
    status: res.status,
    hosts: hosts.join(' > '),
    ms: Date.now() - started,
    bytes,
    pk,
    overCap,
    headers: pick(res.headers),
  };
}

console.log('Repo Scan Lite smoke, GitHub reachability');
console.log(`repo: ${owner}/${repo}   token: ${token ? 'set' : 'not set'}`);

// metadata (needs the default branch for the archive mode)
let branch = 'main';
try {
  const { res } = await get(`https://api.github.com/repos/${owner}/${repo}`, true);
  console.log('\n[metadata]');
  console.log(`  status: ${res.status}`);
  console.log(`  headers: ${JSON.stringify(pick(res.headers))}`);
  if (res.ok) {
    const body = await res.json();
    branch = body.default_branch;
    console.log(
      `  private: ${body.private}   size(KB): ${body.size}   default branch: ${branch}   archived: ${body.archived}`,
    );
  } else {
    await res.body?.cancel();
  }
} catch (error) {
  console.log(`  metadata FAILED: ${error instanceof Error ? error.message : 'unknown'}`);
}

const modes = [
  [
    'archive (github.com web URL, never a token)',
    `https://github.com/${owner}/${repo}/archive/refs/heads/${encodeURIComponent(branch)}.zip`,
    false,
  ],
  ['rest-anon (api zipball, no token)', `https://api.github.com/repos/${owner}/${repo}/zipball`, false],
];
if (token) {
  modes.push([
    'rest-token (api zipball, token to api.github.com only)',
    `https://api.github.com/repos/${owner}/${repo}/zipball`,
    true,
  ]);
}

for (const [name, url, useToken] of modes) {
  console.log(`\n[${name}]  ${RUNS} downloads in a row`);
  const codes = [];
  let firstBad = null;
  let ok = 0;
  let totalMs = 0;
  let sample = null;
  for (let i = 1; i <= RUNS; i++) {
    try {
      const r = await download(url, useToken);
      codes.push(r.status);
      totalMs += r.ms;
      if (r.status === 200) {
        ok += 1;
        sample ??= r;
      } else if (!firstBad) {
        firstBad = { run: i, ...r };
      }
    } catch (error) {
      codes.push('ERR');
      firstBad ??= { run: i, error: error instanceof Error ? error.message : 'unknown' };
    }
  }
  console.log(`  statuses: ${codes.join(' ')}   ok: ${ok}/${RUNS}   avg ${Math.round(totalMs / RUNS)} ms`);
  if (sample) {
    console.log(
      `  sample 200: path ${sample.hosts}   ${(sample.bytes / 1024).toFixed(0)} KB   zip (PK): ${sample.pk ? 'yes' : 'NO'}${sample.overCap ? '   over 15 MB cap' : ''}`,
    );
  }
  if (firstBad) {
    console.log(`  first non-200: run ${firstBad.run}  ${JSON.stringify(firstBad)}`);
  }
}
