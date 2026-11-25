import { describe, expect, it } from 'vitest';
import type { AgentControl } from '../../src/agents/agent.js';
import { createBundleInspectorAgent } from '../../src/agents/bundle-inspector-agent.js';
import { createRepoInspectorAgent } from '../../src/agents/repo-inspector-agent.js';
import type { RunContext } from '../../src/agents/run-context.js';
import type { SafeFetchResult } from '../../src/net/safe-fetch.js';
import type { RepoTransport } from '../../src/repo/repo-scanner.js';
import { buildCoverage } from '../../src/stages/evidence.js';
import { fixRepoSecretPrompt, fixSiteSecretPrompt } from '../../src/stages/fix-prompts.js';
import { collectResults } from '../../src/stages/inspectors.js';
import { KEY_PROVIDERS } from '../../src/stages/key-providers.js';
import { CHECKS, REPO_CHECK_ID, checksFor } from '../../src/stages/planner-config.js';
import { planChecks } from '../../src/stages/planner.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import {
  looksLikePlaceholder,
  scanForKeyHits,
  scanForKeys,
  type KeyKind,
} from '../../src/stages/site-rules.js';
import { buildZip, type TestEntry } from '../repo/zip-builder.js';

// C1: more provider key formats. Every fake key is built from pieces at run
// time, so no complete key-looking text sits in this source (GitHub's push
// protection and the repo's own scan stay quiet).
const A = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
const up = 'Q7R8S9T0U1V2W3X4'; // 16 characters, as an AWS access key id has
const KEYS: Record<Exclude<KeyKind, 'service-role-jwt'>, string> = {
  'secret-key': 'sb_' + 'secret_' + A.slice(0, 20),
  'sk-key': 'sk' + '-' + 'proj-' + A,
  'stripe-secret-key': 'sk' + '_live_' + A.slice(0, 24),
  'aws-access-key-id': 'AK' + 'IA' + up,
  'github-token': 'gh' + 'p_' + A.slice(0, 36),
  'slack-token': 'xo' + 'xb-' + '1234567890-1234567890-' + A.slice(0, 20),
  'sk-ant-key': 'sk' + '-ant-' + 'api03-' + A.slice(0, 30),
  'gsk-key': 'gs' + 'k_' + A + 'Z9y8',
};
const ALL = Object.keys(KEYS) as (keyof typeof KEYS)[];

describe('scanForKeys: each provider', () => {
  for (const kind of ALL) {
    it(`${kind}: found by its prefix, with the line, and never the key`, () => {
      const text = `a\nconst k = "${KEYS[kind]}";\nb`;
      expect(scanForKeys(text)).toEqual([kind]);
      expect(scanForKeyHits(text)).toEqual([{ kind, line: 2 }]);
      expect(JSON.stringify(scanForKeyHits(text))).not.toContain(KEYS[kind].slice(8));
    });
  }

  it('GitHub fine-grained tokens (github_pat_) are found too', () => {
    const token = 'github' + '_pat_' + A + A.slice(0, 20);
    expect(scanForKeys(`x ${token}`)).toEqual(['github-token']);
  });

  it('Stripe restricted keys (rk_live_) are found too', () => {
    expect(scanForKeys(`x ${'rk' + '_live_' + A.slice(0, 24)}`)).toEqual(['stripe-secret-key']);
  });

  it('an sk-ant- key is an Anthropic key and not also an OpenAI key', () => {
    expect(scanForKeys(KEYS['sk-ant-key'])).toEqual(['sk-ant-key']);
  });

  it('several kinds in one text come out once each, in a fixed order', () => {
    const text = `${KEYS['gsk-key']} ${KEYS['sk-key']} ${KEYS['secret-key']} ${KEYS['github-token']}`;
    expect(scanForKeys(text)).toEqual(['secret-key', 'sk-key', 'github-token', 'gsk-key']);
  });
});

describe('scanForKeys: what is NOT a key', () => {
  it('a key that is too short for its format', () => {
    for (const short of [
      'sk' + '-' + 'proj-' + A.slice(0, 10),
      'sk' + '_live_' + A.slice(0, 10),
      'AK' + 'IA' + up.slice(0, 10),
      'gh' + 'p_' + A.slice(0, 20),
      'xo' + 'xb-' + '123-456',
      'gs' + 'k_' + A.slice(0, 20),
      'sk' + '-ant-' + 'abc',
    ]) {
      expect(scanForKeys(short), short.slice(0, 6)).toEqual([]);
    }
  });

  it('the public keys: Google (AIza), Stripe publishable (pk_live_), Stripe test, Supabase publishable', () => {
    for (const publicKey of [
      'AI' + 'za' + A.slice(0, 35),
      'pk' + '_live_' + A.slice(0, 24),
      'sk' + '_test_' + A.slice(0, 24),
      'sb_' + 'publishable_' + A.slice(0, 24),
    ]) {
      expect(scanForKeys(publicKey)).toEqual([]);
    }
  });

  it('the tail of a longer word is not a key', () => {
    expect(scanForKeys('risk' + '-' + A)).toEqual([]);
    expect(scanForKeys('task' + '-' + 'proj-' + A)).toEqual([]);
    expect(scanForKeys('x' + 'AK' + 'IA' + up)).toEqual([]);
    expect(scanForKeys('AK' + 'IA' + up + 'Q')).toEqual([]); // 17 characters: not a key id
  });

  it('a long hyphenated word (no mix of digits and capitals) is not an OpenAI key', () => {
    expect(scanForKeys('sk' + '-learn-pipeline-options-for-large-data-sets')).toEqual([]);
    expect(scanForKeys('sk' + '-' + 'a'.repeat(40))).toEqual([]);
  });

  it('obvious placeholders are skipped', () => {
    for (const fake of [
      'sk' + '-' + 'x'.repeat(40),
      'sk' + '-' + 'proj-' + 'your_key_here_' + A,
      'sk' + '_live_' + 'x'.repeat(24),
      'sk' + '_live_' + 'exampleexampleexample1',
      'gs' + 'k_' + 'changeme'.repeat(6),
      'AK' + 'IA' + 'IOSFODNN7EXAMPLE',
      'gh' + 'p_' + '1'.repeat(36),
      'sb_' + 'secret_' + 'x'.repeat(20),
    ]) {
      expect(scanForKeys(fake), fake.slice(0, 8)).toEqual([]);
    }
    expect(looksLikePlaceholder('your_key')).toBe(true);
    expect(looksLikePlaceholder(KEYS['sk-key'])).toBe(false);
  });

  it('a placeholder next to a real key does not hide the real one', () => {
    const text = `${'sk' + '-' + 'x'.repeat(40)} ${KEYS['sk-key']}`;
    expect(scanForKeys(text)).toEqual(['sk-key']);
  });
});

describe('the repo scan', () => {
  const REPO = { owner: 'someone', repo: 'app' };
  const provided = { website: false, supabase: false, repo: true };
  const control = (): AgentControl => ({
    shouldStop: () => false,
    redact: (t) => t,
    states: () => [],
    failure: () => null,
  });
  const run = async (...entries: TestEntry[]) => {
    const transport: RepoTransport = {
      fetchArchive: () => Promise.resolve(buildZip(entries)),
    };
    const context: RunContext = { repoRef: REPO, siteResults: {}, provided };
    await createRepoInspectorAgent({ transport }).run(context, () => {}, control());
    return context;
  };

  for (const kind of ALL) {
    it(`${kind}: LEAKED in a normal file, with its provider in the words, and no key anywhere`, async () => {
      const context = await run({ name: 'o-r-1/src/a.ts', data: `const k = "${KEYS[kind]}"` });
      const [item] = context.siteEvidence!;
      expect(item).toMatchObject({
        kind: 'repo-file',
        keyKind: kind,
        verdict: 'LEAKED',
        proof: 'PROVEN',
        subject: 'src/a.ts',
        line: 1,
      });
      expect(item.summary.en).toContain(KEY_PROVIDERS[kind].label.en.slice(2));
      expect(item.summary.ur).toContain(KEY_PROVIDERS[kind].label.ur);
      expect(JSON.stringify(context)).not.toContain(KEYS[kind].slice(8));
    });
  }

  it('the same key in a test path is INCONCLUSIVE and names the provider', async () => {
    const context = await run({ name: 'o-r-1/test/a.ts', data: `const k = "${KEYS['gsk-key']}"` });
    expect(context.siteEvidence![0]).toMatchObject({
      kind: 'repo-test-key',
      keyKind: 'gsk-key',
      verdict: 'INCONCLUSIVE',
    });
    expect(context.siteEvidence![0].summary.en).toContain('Groq');
  });

  it('a key in a committed .env file is reported by the key rule, not as an env-file warning', async () => {
    const context = await run({ name: 'o-r-1/.env', data: `OPENAI_API_KEY=${KEYS['sk-key']}\n` });
    expect(context.siteEvidence!.map((i) => [i.kind, i.keyKind, i.verdict])).toEqual([
      ['repo-file', 'sk-key', 'LEAKED'],
    ]);
  });
});

describe('the roadmap and the fix prompts, for each provider', () => {
  const provided = { website: true, supabase: false, repo: true };
  const plan = planChecks(CHECKS, provided);
  const checks = checksFor(CHECKS, provided);
  const coverage = buildCoverage(
    checks,
    collectResults(checks, {
      findings: [],
      cleanup: null,
      dataAccess: { status: 'notProvided' },
      provided,
      siteResults: {},
    }),
  );
  const item = (kind: 'repo-file' | 'site-bundle', keyKind: KeyKind | undefined) => ({
    id: 'ev_1',
    check: kind === 'repo-file' ? REPO_CHECK_ID : 'bundle-secrets',
    findingId: null,
    table: null,
    subject: kind === 'repo-file' ? 'src/a.ts' : 'cdn.example.com/app.js',
    line: 1,
    kind,
    ...(keyKind ? { keyKind } : {}),
    verdict: 'LEAKED' as const,
    proof: 'PROVEN' as const,
    summary: { en: 'x', ur: 'x' },
  });
  const roadmapOf = (evidence: ReturnType<typeof item>[]) =>
    buildRoadmap({ plan, findings: [], evidence, coverage, cleanup: null, provided }).items.filter(
      (i) => i.kind === 'fix-repo-secret' || i.kind === 'fix-site-secret',
    );

  for (const kind of ALL.filter((k) => k !== 'secret-key')) {
    for (const where of ['repo-file', 'site-bundle'] as const) {
      it(`${kind} in ${where}: critical, rotate step of the provider, fix prompt in both languages`, () => {
        const [entry] = roadmapOf([item(where, kind)]);
        expect(entry).toMatchObject({
          kind: where === 'repo-file' ? 'fix-repo-secret' : 'fix-site-secret',
          severity: 'critical',
        });
        const provider = KEY_PROVIDERS[kind];
        expect(entry.steps[0].en).toBe(`Rotate the key now: ${provider.rotateWhere.en}.`);
        expect(entry.steps[0].ur).toContain(provider.rotateWhere.ur);
        expect(entry.steps[0].en).not.toContain('Supabase');
        expect(entry.why.en).toContain(provider.label.en.slice(2));
        expect(entry.fixPrompt!.en).toContain(provider.label.en.slice(2));
        expect(entry.fixPrompt!.en).toContain('Show me the plan first');
        expect(entry.fixPrompt!.ur).toContain(provider.label.ur);
        expect(entry.fixPrompt!.ur).toContain('Pehle mujhe plan dikhao');
        expect(entry.steps.length).toBeLessThanOrEqual(4);
        for (const text of [entry.fixPrompt!.en, entry.fixPrompt!.ur, entry.why.en]) {
          expect(text).not.toContain(KEYS[kind].slice(8));
        }
      });
    }
  }

  it('an item without keyKind (made before) is still the Supabase text', () => {
    const [repo] = roadmapOf([item('repo-file', undefined)]);
    expect(repo.steps[0].en).toBe(
      'Rotate the key now: in Supabase go to API keys, create a new secret key and delete the old one.',
    );
    expect(repo.why.en).toContain('A Supabase secret key was found in a file');
    expect(fixRepoSecretPrompt('a.ts').en).toContain('A Supabase secret key was found');
    expect(fixSiteSecretPrompt('a.js').en).toContain('A Supabase secret key was found');
  });
});

describe('the site audit (bundle scan shares the scanner)', () => {
  const SITE = 'https://www.example-shop.com';
  const control = (): AgentControl => ({
    shouldStop: () => false,
    redact: (t) => t,
    states: () => [],
    failure: () => null,
  });
  const reply = (url: string, body: string): SafeFetchResult => ({
    url,
    status: 200,
    headers: {},
    body: Buffer.from(body),
  });
  const runSite = async (script: string) => {
    const fetcher = (url: string) =>
      Promise.resolve(
        url === SITE
          ? reply(url, `<html><head><script src="/app.js"></script></head></html>`)
          : reply(url, script),
      );
    const context: RunContext = { websiteUrl: SITE, siteResults: {}, siteEvidence: [] };
    await createBundleInspectorAgent({ fetcher }).run(context, () => {}, control());
    return context;
  };

  it('a key of another provider in a script is now LEAKED, with the provider named and no key', async () => {
    const context = await runSite(`var k="${KEYS['stripe-secret-key']}";`);
    expect(context.siteEvidence).toMatchObject([
      { kind: 'site-bundle', keyKind: 'stripe-secret-key', verdict: 'LEAKED', proof: 'PROVEN' },
    ]);
    expect(context.siteEvidence![0].summary.en).toContain('Stripe');
    expect(JSON.stringify(context)).not.toContain(KEYS['stripe-secret-key'].slice(8));
  });

  it('public keys in a script are still not reported (Google, Stripe publishable)', async () => {
    const context = await runSite(
      `var a="${'AI' + 'za' + A.slice(0, 35)}",b="${'pk' + '_live_' + A.slice(0, 24)}";`,
    );
    expect(context.siteEvidence).toEqual([]);
    expect(context.siteResults!['bundle-secrets'].status).toBe('completed');
  });

  it('a Supabase key is reported as before', async () => {
    const context = await runSite(`var k="${KEYS['secret-key']}";`);
    expect(context.siteEvidence![0]).toMatchObject({ keyKind: 'secret-key', verdict: 'LEAKED' });
    expect(context.siteEvidence![0].summary.en).toBe(
      'A Supabase secret key (sb_secret_...) is in this script. Anyone who opens the site can read it. Remove it from the site and create a new key.',
    );
  });
});
