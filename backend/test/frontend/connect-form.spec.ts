import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The rules of the Connect form (frontend/src/lib/form.ts, R76). The request
// bodies are compared with docs/frontend-mock/*/request.json.
const FRONTEND = join(__dirname, '..', '..', '..', 'frontend');
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'frontend-mock');

interface Fields {
  label: string;
  websiteUrl: string;
  confirmSiteAccess: boolean;
  projectUrl: string;
  anonKey: string;
  serviceKey: string;
  confirmTestProject: boolean;
}
interface Group {
  state: 'empty' | 'partial' | 'complete';
  missing: string[];
}
const form = (await import(
  /* @vite-ignore */ pathToFileURL(join(FRONTEND, 'src', 'lib', 'form.ts')).href
)) as {
  EMPTY_FIELDS: Fields;
  checkConnect: (f: Fields) => {
    website: Group;
    supabase: Group;
    canStart: boolean;
  };
  buildStartBody: (f: Fields) => Record<string, unknown>;
  startNote: (c: ReturnType<typeof form.checkConnect>) => string;
  startHintOf: (
    c: ReturnType<typeof form.checkConnect>,
    hasCode: boolean,
  ) => string;
  clearKeys: (f: Fields) => Fields;
};

const KEYS = {
  anonKey: 'PUBLISHABLE-PLACEHOLDER',
  serviceKey: 'SECRET-PLACEHOLDER',
};
const WEBSITE: Partial<Fields> = {
  websiteUrl: 'https://www.example-shop.com',
  confirmSiteAccess: true,
};
const SUPABASE: Partial<Fields> = {
  projectUrl: 'https://example-project.supabase.co',
  ...KEYS,
  confirmTestProject: true,
};
const fields = (...parts: Partial<Fields>[]): Fields =>
  Object.assign({}, form.EMPTY_FIELDS, ...parts);

function request(bundle: string): Record<string, unknown> {
  const body = JSON.parse(
    readFileSync(join(DOCS, bundle, 'request.json'), 'utf8'),
  ) as Record<string, unknown>;
  // the files hold a placeholder text instead of each key
  if (body.anonKey) body.anonKey = KEYS.anonKey;
  if (body.serviceKey) body.serviceKey = KEYS.serviceKey;
  return body;
}

describe('the request body is exactly what the backend contract shows', () => {
  it('Supabase only (the old request, R5)', () => {
    const body = form.buildStartBody(
      fields({ label: 'Hotel booking (test project)' }, SUPABASE),
    );
    expect(body).toEqual(request('supabase-only'));
    expect(body).not.toHaveProperty('websiteUrl');
    expect(body).not.toHaveProperty('confirmSiteAccess');
  });

  it('website only: confirmSiteAccess true, and no confirmTestProject or keys', () => {
    const body = form.buildStartBody(
      fields({ label: 'Example shop' }, WEBSITE),
    );
    expect(body).toEqual(request('url-only'));
    expect(body).not.toHaveProperty('confirmTestProject');
    expect(body).not.toHaveProperty('anonKey');
    expect(body).not.toHaveProperty('projectUrl');
  });

  it('both groups: all the fields', () => {
    const body = form.buildStartBody(
      fields({ label: 'Example shop and its database' }, WEBSITE, SUPABASE),
    );
    expect(body).toEqual(request('both'));
  });

  it('a blank label is not sent, a label is trimmed, addresses are trimmed, keys are not', () => {
    const body = form.buildStartBody(
      fields(WEBSITE, { label: '   ' }, { websiteUrl: '  https://a.test  ' }),
    );
    expect(body).not.toHaveProperty('label');
    expect(body.websiteUrl).toBe('https://a.test');
    const keyed = form.buildStartBody(
      fields(SUPABASE, { label: ' x ', serviceKey: ' KEY ' }),
    );
    expect(keyed.label).toBe('x');
    expect(keyed.serviceKey).toBe(' KEY ');
  });

  it('a half-filled group is never sent', () => {
    const body = form.buildStartBody(
      fields(SUPABASE, { websiteUrl: 'https://a.test' }),
    );
    expect(body).not.toHaveProperty('websiteUrl');
    expect(body).not.toHaveProperty('confirmSiteAccess');
    const body2 = form.buildStartBody(
      fields(WEBSITE, { projectUrl: 'https://p' }),
    );
    expect(body2).not.toHaveProperty('projectUrl');
    expect(body2).not.toHaveProperty('confirmTestProject');
  });
});

describe('at least one group complete, none half filled (R76)', () => {
  const can = (f: Fields) => form.checkConnect(f).canStart;

  it('an empty form cannot start', () => {
    expect(can(fields())).toBe(false);
    expect(form.checkConnect(fields()).website.state).toBe('empty');
    expect(form.checkConnect(fields()).supabase.state).toBe('empty');
  });

  it('each complete group alone, and both, can start', () => {
    expect(can(fields(WEBSITE))).toBe(true);
    expect(can(fields(SUPABASE))).toBe(true);
    expect(can(fields(WEBSITE, SUPABASE))).toBe(true);
  });

  it('a website without its box is half filled; so is a box without a website', () => {
    const noBox = form.checkConnect(fields({ websiteUrl: 'https://a.test' }));
    expect(noBox.website.state).toBe('partial');
    expect(noBox.website.missing).toEqual(['the box "I may test this site"']);
    expect(noBox.canStart).toBe(false);
    const noUrl = form.checkConnect(fields({ confirmSiteAccess: true }));
    expect(noUrl.website.state).toBe('partial');
    expect(noUrl.website.missing).toEqual(['Website address']);
  });

  it('the three Supabase fields come together, with the TEST box', () => {
    for (const missing of ['projectUrl', 'anonKey', 'serviceKey'] as const) {
      const f = fields(SUPABASE, { [missing]: '' });
      expect(form.checkConnect(f).supabase.state).toBe('partial');
      expect(can(f)).toBe(false);
    }
    const noBox = fields(SUPABASE, { confirmTestProject: false });
    expect(form.checkConnect(noBox).supabase.missing).toEqual([
      'the TEST project box',
    ]);
    expect(can(noBox)).toBe(false);
  });

  it('a complete group does not make up for a half filled one', () => {
    expect(can(fields(WEBSITE, { projectUrl: 'https://p' }))).toBe(false);
    expect(can(fields(SUPABASE, { websiteUrl: 'https://a.test' }))).toBe(false);
  });

  it('spaces alone are nothing', () => {
    expect(form.checkConnect(fields({ websiteUrl: '   ' })).website.state).toBe(
      'empty',
    );
  });
});

describe('the notes name fields, never values', () => {
  it('names what a group still needs', () => {
    const check = form.checkConnect(
      fields({
        projectUrl: 'https://secret-ref.supabase.co',
        anonKey: 'KEYVALUE',
      }),
    );
    const note = form.startNote(check);
    expect(note).toContain('Supabase: Secret key, the TEST project box');
    expect(note).not.toContain('secret-ref');
    expect(note).not.toContain('KEYVALUE');
  });

  it('the hint under the start button: access code first, then the groups', () => {
    const empty = form.checkConnect(fields());
    expect(form.startHintOf(empty, false)).toBe(
      'To start: enter the access code. Complete the website group, the Supabase group, the repository group, or more than one.',
    );
    const ready = form.checkConnect(fields(WEBSITE));
    expect(form.startHintOf(ready, true)).toBe('');
    expect(form.startHintOf(ready, false)).toBe(
      'To start: enter the access code.',
    );
  });
});

describe('after a 202 (R29, R76)', () => {
  it('the keys are cleared; the website address and the boxes stay', () => {
    const cleared = form.clearKeys(fields(WEBSITE, SUPABASE));
    expect(cleared.anonKey).toBe('');
    expect(cleared.serviceKey).toBe('');
    expect(cleared.websiteUrl).toBe('https://www.example-shop.com');
    expect(cleared.confirmSiteAccess).toBe(true);
  });
});

describe('the Connect screen wires the groups', () => {
  const page = readFileSync(join(FRONTEND, 'src', 'app', 'page.tsx'), 'utf8');
  it('uses the group component, the rules of form.ts and shows the 400 message as given', () => {
    expect(page).toContain('<ConnectGroups');
    expect(page).toContain('buildStartBody(fields)');
    expect(page).toContain('setError(handleApiError(caught))');
    // the old single-group state is gone
    expect(page).not.toMatch(/setProjectUrl|setConfirmed/);
  });
});
