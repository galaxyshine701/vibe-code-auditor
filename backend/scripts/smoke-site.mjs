// Local smoke test for the two website inspectors, with the REAL safe-fetch.
// NOT part of the production build (it lives in scripts/, the build only takes
// src/).
//
//   npm run smoke:site                      (the default test site)
//   npm run smoke:site -- https://example.com
//
// It reads only what any visitor can read: the front page and the scripts of
// the same origin (at most 30 files). It prints a SUMMARY only: verdicts,
// counts and the names of scripts (host + path). It never prints a key, a
// header value, a query, or any part of the bundle.
import { createBundleInspectorAgent } from '../dist/agents/bundle-inspector-agent.js';
import { createHeadersInspectorAgent } from '../dist/agents/headers-inspector-agent.js';
import { parseAuditRequest } from '../dist/audits/audit-input.js';
import { safeFetch } from '../dist/net/safe-fetch.js';
import { planRun } from '../dist/stages/planner.js';

const DEFAULT_SITE = 'https://havenstay-hotel.netlify.app';
const target = process.argv[2] ?? DEFAULT_SITE;

let websiteUrl;
try {
  // the same rules as POST /audits
  websiteUrl = parseAuditRequest(
    { websiteUrl: target, confirmSiteAccess: true },
    true,
  ).websiteUrl;
} catch {
  console.error('The address is not a public https address.');
  process.exit(2);
}

// A fetcher that counts, and that notices (without keeping or printing)
// whether a public Supabase key is in what it reads.
const seen = {
  fetches: 0,
  bytes: 0,
  statuses: {},
  anonJwtPresent: false,
  publishableKeyPresent: false,
};
function noticePublicKeys(text) {
  if (/sb_publishable_[A-Za-z0-9_-]{16,}/.test(text)) {
    seen.publishableKeyPresent = true;
  }
  let checked = 0;
  for (const match of text.matchAll(
    /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g,
  )) {
    if (++checked > 200) break;
    try {
      const payload = JSON.parse(
        Buffer.from(match[1], 'base64url').toString('utf8'),
      );
      if (payload && payload.role === 'anon') seen.anonJwtPresent = true;
    } catch {
      // not a JWT
    }
  }
}
const fetcher = async (address, options) => {
  seen.fetches += 1;
  const result = await safeFetch(address, options);
  seen.bytes += result.body.length;
  seen.statuses[result.status] = (seen.statuses[result.status] ?? 0) + 1;
  noticePublicKeys(result.body.toString('utf8'));
  return result;
};

const context = {
  websiteUrl,
  siteResults: {},
  siteEvidence: [],
  limits: planRun().limits,
};
const control = {
  shouldStop: () => false,
  redact: (text) => text,
  states: () => [],
  failure: () => null,
};
const noop = () => {};

const started = Date.now();
// like the pipeline: both inspectors together
await Promise.all([
  createHeadersInspectorAgent({ fetcher }).run(context, noop, control),
  createBundleInspectorAgent({ fetcher }).run(context, noop, control),
]);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const items = context.siteEvidence;
const count = (check, verdict) =>
  items.filter((i) => i.check === check && i.verdict === verdict).length;
const headers = context.siteResults['tls-headers'];
const bundle = context.siteResults['bundle-secrets'];
const reasonOf = (result) =>
  result && result.status === 'failedToRun' ? ` (${result.reason.en})` : '';

console.log('Website inspectors, real safe-fetch');
console.log(`target: ${new URL(websiteUrl).host}   time: ${seconds}s`);

console.log('\n[tls-headers]');
console.log(`  result: ${headers?.status ?? 'no result'}${reasonOf(headers)}`);
for (const item of items.filter((i) => i.check === 'tls-headers')) {
  console.log(`  ${item.subject}: ${item.verdict}`);
}
console.log(
  `  verdicts: BLOCKED ${count('tls-headers', 'BLOCKED')}, INCONCLUSIVE ${count('tls-headers', 'INCONCLUSIVE')}, LEAKED ${count('tls-headers', 'LEAKED')}`,
);
for (const left of headers?.outOfScope ?? []) {
  console.log(`  left out: ${left.name} (${left.reason.en})`);
}

console.log('\n[bundle-secrets]');
console.log(`  result: ${bundle?.status ?? 'no result'}${reasonOf(bundle)}`);
const scriptFetches = Math.max(0, seen.fetches - 2); // each inspector reads the front page once
console.log(`  files fetched: ${seen.fetches} (2 front pages + ${scriptFetches} scripts)`);
console.log(`  total size read: ${(seen.bytes / 1024).toFixed(0)} KB`);
console.log(`  other-origin scripts (not scanned): ${(bundle?.outOfScope ?? []).length}`);
console.log(`  scripts not read: ${(bundle?.notRead ?? []).length}`);
console.log(
  `  verdicts: LEAKED ${count('bundle-secrets', 'LEAKED')}`,
);
for (const item of items.filter((i) => i.check === 'bundle-secrets')) {
  console.log(`  LEAKED in: ${item.subject}`);
}

console.log('\n[keys]');
console.log(
  `  secret key or service_role key flagged: ${count('bundle-secrets', 'LEAKED') > 0 ? 'YES' : 'no'}`,
);
console.log(
  '  anon / publishable key flagged: no (they are public by design and are never reported)',
);
console.log(
  `  anon key present in the scripts: ${seen.anonJwtPresent ? 'yes' : 'no'}   publishable key present: ${seen.publishableKeyPresent ? 'yes' : 'no'}   (only whether, never the key)`,
);
console.log(`\nfetch statuses: ${JSON.stringify(seen.statuses)}`);
