import { describe, expect, it } from 'vitest';
import {
  fixFindingPrompt,
  fixRepoSecretPrompt,
  fixSiteSecretPrompt,
  improveHeaderPrompt,
  improveRepoPrompt,
  plain,
} from '../../src/stages/fix-prompts.js';
import { buildRoadmap } from '../../src/stages/roadmap.js';
import type { EvidenceItem, RoadmapItem } from '../../src/stages/types.js';
import {
  ALL_FIXTURES,
  BANNED_EN,
  BANNED_UR,
  allStrings,
  bundleItem,
  finding,
  headerItems,
  makeFixture,
  supabaseOnly,
  type StageFixture,
} from './roadmap-fixtures.js';

// Fake keys are built here at run time, so no key shape sits in the source.
const FAKE_SECRET = ['sb', 'secret', 'A1b2C3d4E5f6G7h8I9j0'].join('_');
const FAKE_JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  Buffer.from('{"role":"service_role"}').toString('base64url'),
  'c2lnbmF0dXJlMTIzNDU2',
].join('.');

const inputOf = (f: StageFixture) => ({
  plan: f.plan,
  findings: f.findings,
  evidence: f.evidence,
  coverage: f.coverage,
  cleanup: f.cleanup,
  provided: f.provided,
});

const repoItem = (subject: string): EvidenceItem => ({
  id: 'ev_repo_repo-secrets_1',
  check: 'repo-secrets',
  findingId: null,
  table: null,
  subject,
  line: 3,
  kind: 'repo-file',
  verdict: 'LEAKED',
  proof: 'PROVEN',
  summary: { en: 'A secret key is in a file.', ur: 'File mein secret key hai.' },
});

describe('fix prompts: every prompt', () => {
  const all = [
    fixFindingPrompt('bookings', true),
    fixFindingPrompt('bookings', false),
    fixSiteSecretPrompt('/assets/app.js'),
    fixRepoSecretPrompt('src/lib/supabase.ts'),
    ...[
      'https',
      'strict-transport-security',
      'content-security-policy',
      'x-content-type-options',
      'framing',
      'referrer-policy',
    ].map((h) => improveHeaderPrompt(h)!),
    improveRepoPrompt('migration-rls', 'orders'),
    improveRepoPrompt('public-env-secret', '.env.example'),
  ];

  it('has English and Roman Urdu, and a header gets one', () => {
    for (const p of all) {
      expect(p.en.length).toBeGreaterThan(80);
      expect(p.ur.length).toBeGreaterThan(80);
      expect(p.en).not.toBe(p.ur);
    }
    expect(improveHeaderPrompt('not-a-header')).toBeUndefined();
    expect(improveHeaderPrompt(undefined)).toBeUndefined();
  });

  it('always says: show the plan first, apply only after approval', () => {
    for (const p of all) {
      expect(p.en).toContain('Show me the plan first');
      expect(p.en).toContain('Apply nothing until I approve');
      expect(p.ur).toContain('Pehle mujhe plan dikhao');
      expect(p.ur).toContain('approve na karun');
    }
  });

  it('never asks for a key, never holds one, and keeps the wording rules', () => {
    for (const p of all) {
      for (const text of [p.en, p.ur]) {
        expect(text).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{8,}/);
        expect(text).not.toMatch(
          /\b(send|give|paste|share|tell|enter|provide)\b[^.]{0,30}\b(key|keys|secret|token|password)\b/i,
        );
        expect(text).not.toMatch(/\b(certified|safe to launch|guaranteed)\b/i);
      }
      expect(p.en).not.toMatch(BANNED_EN);
      expect(p.ur).not.toMatch(BANNED_UR);
    }
  });

  it('is the same every time', () => {
    expect(fixFindingPrompt('t', true)).toEqual(fixFindingPrompt('t', true));
  });
});

describe('fix-finding prompt and the owner column', () => {
  it('with an owner column: owner-only policies', () => {
    const p = fixFindingPrompt('bookings', true);
    expect(p.en).toContain('"bookings"');
    expect(p.en).toContain('owner column');
    expect(p.en).not.toContain('ask me who');
  });
  it('without one: it asks who should read and write, and does not guess', () => {
    const p = fixFindingPrompt('bookings', false);
    expect(p.en).toContain('ask me who should be allowed to read');
    expect(p.en).toContain('write');
    expect(p.en).not.toContain('use the owner column');
    expect(p.ur).toContain('poochho');
  });
  it('the roadmap picks by the finding: a fix SQL means there was an owner column', () => {
    const f = supabaseOnly();
    const withOwner = buildRoadmap(inputOf(f)).items.find(
      (i) => i.kind === 'fix-finding',
    )!;
    expect(withOwner.fixPrompt!.en).toContain('owner column');
    const noOwner = {
      ...f,
      findings: f.findings.map((x) => ({ ...x, fix: null })),
    };
    const item = buildRoadmap(inputOf(noOwner)).items.find(
      (i) => i.kind === 'fix-finding',
    )!;
    expect(item.fixPrompt!.en).toContain('ask me who should be allowed to read');
  });
});

describe('plain: only clean names go into a prompt', () => {
  it('drops a query string, quotes and line breaks', () => {
    expect(plain('/a/app.js?token=abc', 'x')).toBe('/a/app.js');
    expect(plain('a"b\nc', 'x')).toBe('a b c');
  });
  it('replaces a key, a token-like run, an empty or a long name', () => {
    expect(plain(`/x/${FAKE_SECRET}.js`, 'a script')).toBe('a script');
    expect(plain(FAKE_JWT, 'a script')).toBe('a script');
    expect(plain('A'.repeat(40), 'f')).toBe('f');
    expect(plain('', 'f')).toBe('f');
    expect(plain(undefined, 'f')).toBe('f');
    expect(plain('a'.repeat(200), 'f')).toBe('f');
  });
});

describe('the roadmap carries a prompt on the five kinds, and only there', () => {
  const f = makeFixture({
    provided: { website: true, supabase: true, repo: true },
    findings: [finding('fnd_001', 'bookings', 'LEAKED')],
    siteEvidence: [
      ...headerItems(['https', 'framing']),
      bundleItem(1, `/static/${FAKE_SECRET}.js?k=${FAKE_JWT}`),
      repoItem('src/db.ts'),
    ],
  });
  const items = buildRoadmap(inputOf(f)).items;
  const by = (kind: string): RoadmapItem[] =>
    items.filter((i) => i.kind === kind);

  it('fix-finding, fix-site-secret, fix-repo-secret and improve-header have one', () => {
    for (const kind of [
      'fix-finding',
      'fix-site-secret',
      'fix-repo-secret',
      'improve-header',
    ]) {
      expect(by(kind).length, kind).toBeGreaterThan(0);
      for (const item of by(kind)) {
        expect(item.fixPrompt, kind).toBeDefined();
      }
    }
    expect(by('improve-header').map((i) => i.fixPrompt!.en)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('https'),
        expect.stringContaining('frame'),
      ]),
    );
  });

  it('the other kinds have none', () => {
    for (const item of items) {
      if (
        ![
          'fix-finding',
          'fix-site-secret',
          'fix-repo-secret',
          'improve-header',
          'improve-repo',
        ].includes(item.kind)
      ) {
        expect(item, item.kind).not.toHaveProperty('fixPrompt');
      }
    }
  });

  it('no key is in a prompt, even when the script name holds one', () => {
    const text = allStrings(items.map((i) => i.fixPrompt)).join('\n');
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain(FAKE_JWT);
    expect(by('fix-site-secret')[0].fixPrompt!.en).toContain('"a script"');
  });

  it('the title and the prompt of a site secret never hold a key from the script name', () => {
    const item = by('fix-site-secret')[0];
    expect(item.title.en).not.toContain(FAKE_SECRET);
    expect(item.title.ur).not.toContain(FAKE_SECRET);
    expect(item.title.en).not.toContain(FAKE_JWT);
    expect(item.title.en).toContain('"a script"');
  });

  it('the title of a repo secret never holds a key from the file path', () => {
    const f2 = makeFixture({
      provided: { website: false, supabase: true, repo: true },
      siteEvidence: [repoItem(`src/${FAKE_SECRET}.ts`), repoItem('src/ok.ts')].map(
        (e, i) => ({ ...e, id: `ev_repo_${i}` }),
      ),
    });
    const titles = buildRoadmap(inputOf(f2)).items.filter(
      (i) => i.kind === 'fix-repo-secret',
    );
    expect(titles).toHaveLength(2);
    const text = titles.map((i) => `${i.title.en}\n${i.title.ur}`).join('\n');
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).toContain('"a file"');
    expect(text).toContain('"src/ok.ts"');
  });

  it('all fixtures: same input, same roadmap, no key shape', () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const a = buildRoadmap(inputOf(make()));
      expect(buildRoadmap(inputOf(make()))).toEqual(a);
      expect(JSON.stringify(a)).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{8,}/);
    }
  });
});
