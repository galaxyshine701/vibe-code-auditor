import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Report of the agent pipeline (R73 to R83): the words of the UI, and how the
// Report page uses the helpers. The frontend has no test runner of its own, so the
// files are read and the pure ones are loaded by path.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const read = (...parts: string[]) =>
  readFileSync(join(FRONTEND, 'src', ...parts), 'utf8');

type Pair = { en: string; ur: string };
const copy = (await import(
  /* @vite-ignore */ pathToFileURL(
    join(FRONTEND, 'src', 'lib', 'stage-copy.ts'),
  ).href
)) as {
  COPY: Record<string, Pair>;
  t: (lang: 'en' | 'ur', key: string) => string;
  moreSteps: (n: number, lang: 'en' | 'ur') => string;
};

describe('the words of the Report, in two languages (R82)', () => {
  const keys = Object.keys(copy.COPY);

  it('every text has an English and a Roman Urdu version', () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(copy.COPY[key].en.trim(), key).not.toBe('');
      expect(copy.COPY[key].ur.trim(), key).not.toBe('');
    }
  });

  it('almost every text is really translated (a name that is the same in both is the exception)', () => {
    const same = keys.filter((k) => copy.COPY[k].en === copy.COPY[k].ur);
    // "Tables", "Website"
    expect(same.length).toBeLessThanOrEqual(4);
  });

  it('t() gives the language asked for', () => {
    expect(copy.t('en', 'gateReady')).toBe('No leak found by these checks.');
    expect(copy.t('ur', 'gateReady')).toMatch(/^In checks se/);
    expect(copy.t('en', 'gateNotReady')).toBe('Not ready: see why');
  });

  it('the gate texts say "by these checks" and the not-ready text has no claim', () => {
    expect(copy.COPY.gateReady.en).toContain('by these checks');
    expect(copy.COPY.gateEyebrow.en).toContain('by these checks');
    expect(copy.COPY.gateNotReady.en).not.toMatch(/ready to|safe|secure/i);
  });

  it('"N more steps are not shown." in both languages, singular and plural', () => {
    expect(copy.moreSteps(5, 'en')).toBe('5 more steps are not shown.');
    expect(copy.moreSteps(1, 'en')).toBe('1 more step is not shown.');
    expect(copy.moreSteps(5, 'ur')).toMatch(/^5 aur qadam/);
  });

  it('the "Not provided" and "Not implemented yet" labels are the ones of the brief (R78)', () => {
    expect(copy.COPY.bucketNotProvided.en).toBe('Not provided');
    expect(copy.COPY.bucketNotImplemented.en).toBe('Not implemented yet');
    expect(copy.COPY.requiredCheck.en).toBe('Required check');
    expect(copy.COPY.roadmapEmpty.en).toBe('No next steps from these checks.');
    expect(copy.COPY.noTables.en).toBe(
      'No Supabase details were given, so no table was checked.',
    );
    expect(copy.COPY.inviteWebsite.en).toBe(
      'Add a website address to check the site too.',
    );
  });
});

describe('the Report page reads the stages and follows the rules', () => {
  const page = read('app', 'audits', '[id]', 'report', 'page.tsx');

  it('reads the three routes after a finished or failed run, only from schemaVersion 2 (R72, R86)', () => {
    expect(page).toContain('getStageBundle(audit, accessCode, signal)');
    expect(page).toContain('hasStages(audit)');
    // a failed run reads them too
    expect(page.indexOf("status.status === 'failed'")).toBeGreaterThan(
      page.indexOf('readStage(status'),
    );
  });

  it('reads them again after a Re-test, and keeps the rest of the report when a part fails (R84)', () => {
    expect(page.match(/readStage\(status/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('setStageError');
  });

  it('shows the gate, the summary and the scope at the top, from the data', () => {
    for (const part of ['<GateBanner', '<ClientSummary', '<ScopeBuckets']) {
      expect(page).toContain(part);
    }
    expect(page.indexOf('<GateBanner')).toBeLessThan(
      page.indexOf('<ClientSummary'),
    );
    expect(page.indexOf('<ClientSummary')).toBeLessThan(
      page.indexOf('<ScopeBuckets'),
    );
  });

  it('the headline is never summary.leaked alone: a leak is tables + site (R73)', () => {
    expect(page).toContain('const leakedCount = leakCount(audit?.summary)');
    expect(page).toContain('leaked: leakCount(audit.summary)');
    expect(page).not.toMatch(/leaked: audit\??\.summary\.leaked/);
    expect(page).toContain('headlineOf(audit, stage?.clientReport ?? null)');
  });

  it('the old "No leak found" line is only for an answer without stages', () => {
    expect(page).toContain('!stages && leakedCount === 0 && blockedCount >= 1');
  });

  it('the language is shared with the Progress screen', () => {
    expect(page).toContain('useLang()');
    expect(page).not.toContain("useState<'en' | 'ur'>");
  });
});

describe('the components do not show an API title or decide anything', () => {
  const files = [
    'gate-banner.tsx',
    'client-summary.tsx',
    'scope-buckets.tsx',
  ].map((f) => [f, read('components', f)] as const);

  it('no component shows plan[].title or scope[].title (R87)', () => {
    for (const [name, source] of files) {
      // a roadmap item has its own title; a check never shows one
      expect(source, name).not.toMatch(/\b(plan|scope|check|c)\w*\.title\b/);
    }
    expect(read('components', 'scope-buckets.tsx')).toContain('checkLabel(');
  });

  it('the gate banner takes the decision from the API, it computes none', () => {
    const banner = read('components', 'gate-banner.tsx');
    expect(banner).toContain("gate.decision === 'ready_by_these_checks'");
    expect(banner).not.toMatch(/summary\.|leaked|blocked/);
  });

  it('a missing gate shows no banner; a null count is "not checked", never zero', () => {
    expect(read('components', 'gate-banner.tsx')).toContain(
      'if (!gate) return null;',
    );
    expect(read('components', 'client-summary.tsx')).toContain("'notChecked'");
  });

  it('"Not provided" has the way to add it, "Not implemented yet" has not', () => {
    const scope = read('components', 'scope-buckets.tsx');
    expect(scope).toMatch(/key: 'notProvided'[\s\S]*?addable: true/);
    expect(scope).not.toMatch(/key: 'notImplemented'[^}]*addable/);
  });

  it('the buckets are never merged: each has its own heading', () => {
    const scope = read('components', 'scope-buckets.tsx');
    for (const key of [
      'bucketChecked',
      'bucketPartial',
      'bucketNotProvided',
      'bucketNotImplemented',
      'bucketFailed',
      'bucketOutOfScope',
    ]) {
      expect(scope, key).toContain(key);
    }
  });

  it('the report styles reduce motion', () => {
    const css = read('app', 'report.css');
    const block = css.slice(
      css.lastIndexOf('@media (prefers-reduced-motion: reduce)'),
    );
    for (const selector of [
      '.gate-mark',
      '.gate-reasons li',
      '.stat-tile',
      '.bucket',
    ]) {
      expect(block, selector).toContain(selector);
    }
    expect(block).toContain('animation: none');
  });

  it('the report styles use the tokens of the theme, no colour of their own', () => {
    const css = read('app', 'report.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});
