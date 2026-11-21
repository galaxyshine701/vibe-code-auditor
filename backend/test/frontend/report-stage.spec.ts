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

  it('the report styles reduce motion, for every animation of the report', () => {
    const css = read('app', 'report.css');
    const blocks = css
      .split('@media (prefers-reduced-motion: reduce)')
      .slice(1)
      .join(' ');
    for (const selector of [
      '.gate-mark',
      '.gate-reasons li',
      '.stat-tile',
      '.bucket',
      '.roadmap-item',
      '.evidence-row',
    ]) {
      expect(blocks, selector).toContain(selector);
    }
    expect(blocks).toContain('animation: none');
    // every animated selector of the file is named in a reduced-motion block
    const animated = [...css.matchAll(/([.\w:-]+)\s*\{[^}]*animation:/g)].map(
      (m) => m[1],
    );
    for (const selector of animated) {
      if (selector.includes('::after')) continue;
      expect(blocks, selector).toContain(selector);
    }
  });

  it('the report styles use the tokens of the theme, no colour of their own', () => {
    const css = read('app', 'report.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});

describe('the roadmap (R81)', () => {
  const roadmap = read('components', 'roadmap-list.tsx');

  it('keeps the order received: no sort, and the helper that does not sort is used', () => {
    expect(roadmap).toContain('roadmapItems(roadmap?.items)');
    expect(roadmap).not.toMatch(/\.sort\(|\.reverse\(/);
  });

  it('steps are a numbered list, and the first three are open', () => {
    expect(roadmap).toContain('<ol className="roadmap-steps">');
    expect(roadmap).toContain('const OPEN_FIRST = 3');
    expect(roadmap).toContain('open={index < OPEN_FIRST}');
  });

  it('"Required check" comes from showsRequiredLabel, which is only fix-* and improve-header', () => {
    expect(roadmap).toContain('showsRequiredLabel(item)');
    expect(roadmap).toContain("'requiredCheck'");
  });

  it('says "N more steps are not shown." when truncated, "No next steps from these checks." when empty, and hides the steps when the roadmap is not available', () => {
    expect(roadmap).toContain('moreSteps(truncated, lang)');
    expect(roadmap).toContain("'roadmapEmpty'");
    expect(roadmap).toContain('roadmapUnavailable(report)');
    // a 404 (no roadmap) hides the section, unless the report says it is not available
    expect(roadmap).toContain('if (!roadmap && !unavailable) return null;');
  });

  it('links to the finding and the evidence only where the screen has them', () => {
    expect(roadmap).toContain('findingIds.has(id)');
    expect(roadmap).toContain('evidenceIds.has(id)');
    expect(read('components', 'finding-card.tsx')).toContain(
      'id={`finding-${finding.id}`}',
    );
    expect(read('components', 'evidence-groups.tsx')).toContain(
      'id={`evidence-${item.id}`}',
    );
  });

  it('never holds SQL: it points at the finding (R32)', () => {
    expect(roadmap).not.toMatch(/\.sql|fix\.sql/);
  });

  it('the page shows it after the scope and before the findings', () => {
    const page = read('app', 'audits', '[id]', 'report', 'page.tsx');
    expect(page.indexOf('<ScopeBuckets')).toBeLessThan(
      page.indexOf('<RoadmapList'),
    );
    expect(page.indexOf('<RoadmapList')).toBeLessThan(
      page.indexOf('<EvidenceGroups'),
    );
    expect(page.indexOf('<EvidenceGroups')).toBeLessThan(
      page.indexOf('<FindingCard'),
    );
  });
});

describe('the evidence (R79)', () => {
  const evidence = read('components', 'evidence-groups.tsx');

  it('is grouped by kind with the helper, and a missing kind is a table', () => {
    expect(evidence).toContain('groupEvidence(evidence.items)');
    expect(evidence).toContain('kindOf(item)');
  });

  it('the three kinds have a title in both languages, an unknown kind is shown as given', () => {
    for (const key of ['kindTable', 'kindHeaders', 'kindBundle']) {
      expect(evidence).toContain(key);
      expect(copy.COPY[key].en).not.toBe('');
    }
    expect(evidence).toContain(': group.kind');
  });

  it('a verdict the UI does not know is plain text; the known ones use the badge of R56', () => {
    expect(evidence).toContain('<VerdictBadge');
    expect(evidence).toContain('className="verdict-badge"');
  });

  it('a site item has no fix, no Approve fix and no Re-test status', () => {
    expect(evidence).not.toMatch(/ApproveFix|retest\./);
    expect(evidence).not.toContain('FindingCard');
  });

  it('shows the subject as the UI labels it (a header) or as given (a script as host/path)', () => {
    expect(evidence).toContain('subjectLabel(item.subject, lang)');
  });

  it('the rows come one after the other', () => {
    expect(evidence).toContain("'--i': index");
    expect(read('app', 'report.css')).toMatch(
      /\.evidence-row \{[^}]*animation: evidenceIn[^}]*animation-delay: calc\([^)]*var\(--i/,
    );
  });
});

describe('the empty and special states (R83), Re-test (R74) and the Re-test result (R87)', () => {
  const page = read('app', 'audits', '[id]', 'report', 'page.tsx');

  it('an audit of a website only has no Re-test and no re-test result action', () => {
    expect(page).toContain(
      'const retestAllowed = audit ? canRetest(audit) : true;',
    );
    expect(page).toContain('{retestAllowed ? (');
    expect(page).toContain('<CertificateAction');
    // the action sits inside the toolbar that is hidden without Supabase details
    expect(page.indexOf('{retestAllowed ? (')).toBeLessThan(
      page.indexOf('<CertificateAction'),
    );
  });

  it('a website only audit says no table was checked, not "No findings"', () => {
    expect(page).toContain(
      'const noTables = audit ? noTableCheck(audit) : false;',
    );
    expect(page).toContain('{noTables ? (');
    expect(page.indexOf('<NoTables')).toBeLessThan(
      page.indexOf('<h3>No findings</h3>'),
    );
  });

  it('a Supabase only audit invites to add a website, in place of the site evidence', () => {
    expect(page).toContain('invitesWebsite(audit) ? <InviteWebsite');
    expect(page.indexOf('<EvidenceGroups')).toBeLessThan(
      page.indexOf('<InviteWebsite'),
    );
  });

  it('the invitations lead to a new audit, where the Connect form has both groups', () => {
    const invites = read('components', 'stage-invites.tsx');
    expect(invites).toContain('href="/"');
    expect(invites).toContain("'inviteWebsite'");
    expect(invites).toContain("'noTables'");
  });

  it('the old Certificate screen is "Re-test result": button, title, loading and access texts', () => {
    expect(read('components', 'certificate-action.tsx')).toContain(
      'Open result view',
    );
    expect(read('components', 'certificate-action.tsx')).not.toMatch(
      /Open certificate/,
    );
    const screen = read('app', 'audits', '[id]', 'certificate', 'page.tsx');
    expect(screen).toContain('Re-test result');
    expect(screen).toContain('Checking the re-test result');
    expect(screen).not.toMatch(/Issued/);
    expect(copy.COPY.retestResult.en).toBe('Re-test result');
    // the route and the code keep their names
    expect(read('components', 'certificate-action.tsx')).toContain(
      '/certificate`',
    );
  });

  it('with the flag off the page is the old one: the old summary and the old line are still there', () => {
    expect(page).toContain('{!stages ? (');
    expect(page).toContain('<h3>No findings</h3>');
    expect(page).toContain('summary-grid-report');
  });
});
