import {
  safeFetch,
  SafeFetchError,
  type SafeFetchErrorCode,
} from './safe-fetch.js';

/**
 * Manual smoke check of safe-fetch with the REAL network (not part of the test
 * suite). Run it yourself, from the backend folder:
 *
 *   npm run smoke:safe-fetch
 *   npm run smoke:safe-fetch -- --url https://your-site.example/
 *   npm run smoke:safe-fetch -- --refusals-only      (no network needed)
 *
 * It needs no key and no .env. It prints a PASS or FAIL line per check and
 * exits with code 1 if any check failed.
 *
 *  1. A public https address is fetched for real (DNS, TLS, the pinned
 *     connection, the size cap). Default: https://example.com/
 *  2. http://169.254.169.254/ (the cloud metadata address) must be REFUSED
 *     before any connection is made. A few other inside addresses are checked
 *     the same way. A refusal must also be fast: if it took long, something
 *     tried to connect.
 *
 * Only the status, the size and the time of the public fetch are printed,
 * never the page itself.
 */

const MAX_REFUSAL_MS = 500;

interface Refusal {
  label: string;
  url: string;
  expected: SafeFetchErrorCode;
  required: boolean;
}

const REFUSALS: Refusal[] = [
  {
    label: 'cloud metadata address',
    url: 'http://169.254.169.254/',
    expected: 'BLOCKED_ADDRESS',
    required: true,
  },
  {
    label: 'loopback',
    url: 'http://127.0.0.1/',
    expected: 'BLOCKED_ADDRESS',
    required: false,
  },
  {
    label: 'localhost',
    url: 'http://localhost/',
    expected: 'BLOCKED_HOST',
    required: false,
  },
  {
    label: 'metadata address written as one decimal number',
    url: 'http://2852039166/',
    expected: 'BLOCKED_ADDRESS',
    required: false,
  },
  {
    label: 'IPv6 loopback',
    url: 'http://[::1]/',
    expected: 'BLOCKED_ADDRESS',
    required: false,
  },
  {
    label: 'private network address',
    url: 'http://10.0.0.1/',
    expected: 'BLOCKED_ADDRESS',
    required: false,
  },
  {
    label: 'a port that is not 80 or 443',
    url: 'http://example.com:8080/',
    expected: 'BLOCKED_PORT',
    required: false,
  },
];

let failures = 0;
const pass = (line: string) => console.log(`PASS  ${line}`);
const fail = (line: string) => {
  failures += 1;
  console.log(`FAIL  ${line}`);
};

async function checkPublicFetch(url: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await safeFetch(url);
    const ms = Date.now() - started;
    const line = `public fetch ${url}: status ${res.status}, ${res.body.length} bytes, ${ms} ms`;
    if (res.status >= 200 && res.status < 400) pass(line);
    else fail(`${line} (expected a status from 200 to 399)`);
  } catch (error) {
    const code = error instanceof SafeFetchError ? error.code : 'UNKNOWN';
    fail(`public fetch ${url}: refused or failed with ${code}`);
  }
}

async function checkRefusal(refusal: Refusal): Promise<void> {
  const started = Date.now();
  const name = `${refusal.label} (${refusal.url})`;
  try {
    await safeFetch(refusal.url);
    fail(`${name}: it was FETCHED, it must be refused`);
  } catch (error) {
    const ms = Date.now() - started;
    if (!(error instanceof SafeFetchError)) {
      fail(`${name}: failed in an unexpected way, not a refusal`);
    } else if (error.code !== refusal.expected) {
      fail(`${name}: refused with ${error.code}, expected ${refusal.expected}`);
    } else if (ms > MAX_REFUSAL_MS) {
      fail(
        `${name}: refused with ${error.code} but it took ${ms} ms (a refusal must come before any connection)`,
      );
    } else {
      pass(`${name}: refused with ${error.code} in ${ms} ms`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urlAt = args.indexOf('--url');
  const publicUrl =
    urlAt !== -1 && args[urlAt + 1] ? args[urlAt + 1] : 'https://example.com/';
  const refusalsOnly = args.includes('--refusals-only');

  if (refusalsOnly) {
    console.log('(--refusals-only: the public fetch is skipped)');
  } else {
    await checkPublicFetch(publicUrl);
  }
  for (const refusal of REFUSALS) await checkRefusal(refusal);

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED');
  } else {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

await main();
