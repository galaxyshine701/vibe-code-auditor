// Real HTTP smoke test for the audits API. NOT part of the committed code.
//
//   node scripts/http-smoke.mjs --log <server log file> --out <findings file>
//
// It reads backend/.env itself (dotenv) and never prints a key. It only prints
// status codes, progress, each table's verdict and the cleanup result.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000';
const POLL_MS = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const logPath = arg('--log');
const outPath = arg('--out');

const projectUrl = process.env.SUPABASE_URL;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const accessCode = process.env.AUDIT_ACCESS_CODE; // sent as a header, never printed
const missing = Object.entries({
  SUPABASE_URL: projectUrl,
  SUPABASE_PUBLISHABLE_KEY: publishable,
  SUPABASE_SECRET_KEY: secret,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing in backend/.env: ${missing.join(', ')}`);
  process.exit(2);
}
if (!logPath) {
  console.error('Pass --log <server log file>');
  process.exit(2);
}

const keys = [publishable, secret, accessCode].filter(Boolean);
const everything = []; // every response body we saw
const hasKey = (text) => keys.some((k) => text.includes(k));
const problems = [];
const fail = (message) => problems.push(message);

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessCode ? { 'X-Access-Code': accessCode } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  everything.push(`${method} ${path} -> ${res.status}\n${text}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, text, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requestBody = {
  label: 'http smoke',
  projectUrl,
  anonKey: publishable,
  serviceKey: secret,
  confirmTestProject: true,
};

// 1. start an audit
const first = await call('POST', '/api/v1/audits', requestBody);
console.log(`POST /audits            -> ${first.status} ${first.json?.status ?? ''}`);
if (first.status !== 202) fail(`first POST gave ${first.status}, expected 202`);
else if (first.json?.status !== 'running') fail('first POST status is not "running"');
const id = first.json?.id;
if (!id) {
  fail('no audit id came back');
  console.log('FAIL: ' + problems.join('; '));
  process.exit(1);
}

// 2. a second one right away must be refused
const second = await call('POST', '/api/v1/audits', requestBody);
console.log(`POST /audits (2nd)      -> ${second.status} ${second.json?.error?.code ?? ''}`);
if (second.status !== 409 || second.json?.error?.code !== 'AUDIT_IN_PROGRESS') {
  fail(`second POST gave ${second.status}, expected 409 AUDIT_IN_PROGRESS`);
}

// 3. poll until it is done
const started = Date.now();
let audit = null;
while (Date.now() - started < MAX_WAIT_MS) {
  const res = await call('GET', `/api/v1/audits/${id}`);
  audit = res.json;
  const progress = audit?.modules?.[0]?.progress;
  console.log(`GET  /audits/:id        -> ${res.status} ${audit?.status} progress=${progress}%`);
  if (res.status !== 200) {
    fail(`GET status gave ${res.status}`);
    break;
  }
  if (audit.status === 'completed' || audit.status === 'failed') break;
  await sleep(POLL_MS);
}
if (!audit || (audit.status !== 'completed' && audit.status !== 'failed')) {
  fail('the audit did not finish in time');
}

// 4. findings
const findingsRes = await call('GET', `/api/v1/audits/${id}/findings`);
console.log(`GET  /findings          -> ${findingsRes.status}`);
if (findingsRes.status !== 200) fail(`findings gave ${findingsRes.status}`);

// 5. look for the real key values everywhere
const inResponses = everything.some(hasKey);
let inLog = false;
try {
  inLog = hasKey(readFileSync(logPath, 'utf8'));
} catch {
  fail('could not read the server log file');
}
console.log(`keys in any response    -> ${inResponses ? 'FOUND' : 'none'}`);
console.log(`keys in the server log  -> ${inLog ? 'FOUND' : 'none'}`);
if (inResponses) fail('a key appeared in a response');
if (inLog) fail('a key appeared in the server log');

// 6. save the findings only if they are clean
if (outPath && findingsRes.json && !hasKey(findingsRes.text)) {
  writeFileSync(outPath, JSON.stringify(findingsRes.json, null, 2) + '\n');
  console.log('findings saved          -> yes');
}

// 7. summary
console.log('');
console.log(`status:  ${audit?.status}   progress: ${audit?.modules?.[0]?.progress}%`);
for (const f of findingsRes.json?.findings ?? []) {
  console.log(`  ${f.table}: ${f.verdict}`);
}
console.log(`cleanup: ${audit?.cleanup}`);
if (audit?.status === 'failed') {
  fail(`audit failed: ${audit.error?.code ?? 'unknown'}`);
  console.log(`error:   ${audit.error?.code}: ${audit.error?.message}`);
}
if (audit?.cleanup !== 'ok') {
  fail(`cleanup is ${audit?.cleanup}`);
  if (audit?.cleanupNote) console.log(`note:    ${audit.cleanupNote}`);
}

console.log('');
if (problems.length) {
  console.log('FAIL: ' + problems.join('; '));
  process.exit(1);
}
console.log('PASS');
