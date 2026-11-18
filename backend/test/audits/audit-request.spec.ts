import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/common/api-error.js';
import {
  parseAuditInput,
  parseAuditRequest,
} from '../../src/audits/audit-input.js';

const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co';
const ANON = 'ANON-KEY-VALUE-123456';
const SERVICE = 'SERVICE-KEY-VALUE-654321';
const SITE = 'https://www.example-shop.com';

const supabase = () => ({
  projectUrl: PROJECT,
  anonKey: ANON,
  serviceKey: SERVICE,
});

function fails(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('it did not throw');
}

describe('flag off: websiteUrl is ignored, the old request works exactly as before', () => {
  const old = { label: 'Demo', confirmTestProject: true, ...supabase() };

  it('an old request gives what parseAuditInput gives', () => {
    const request = parseAuditRequest(old, false);
    const input = parseAuditInput(old);
    expect(request).toEqual({
      label: input.label,
      websiteUrl: null,
      supabase: {
        projectUrl: input.projectUrl,
        publishableKey: input.publishableKey,
        secretKey: input.secretKey,
      },
    });
  });

  it('a websiteUrl next to the Supabase details is ignored (as any extra field was)', () => {
    const request = parseAuditRequest({ ...old, websiteUrl: SITE }, false);
    expect(request.websiteUrl).toBeNull();
    expect(request.supabase?.projectUrl).toBe(PROJECT);
  });

  it('a websiteUrl WITHOUT Supabase details is still the same 400 as before', () => {
    const body = { websiteUrl: SITE, confirmSiteAccess: true };
    const before = fails(() => parseAuditInput(body));
    const now = fails(() => parseAuditRequest(body, false));
    expect([now.status, now.message]).toEqual([before.status, before.message]);
  });

  it('confirmTestProject is always required', () => {
    const e = fails(() =>
      parseAuditRequest({ ...old, confirmTestProject: undefined }, false),
    );
    expect(e.message).toMatch(/confirmTestProject/);
  });
});

describe('flag on, no websiteUrl: the old parser, the old messages', () => {
  it('works like before', () => {
    const old = { confirmTestProject: true, ...supabase() };
    expect(parseAuditRequest(old, true)).toEqual(parseAuditRequest(old, false));
  });

  it('every old error is the same text', () => {
    const bodies: unknown[] = [
      {},
      { ...supabase() },
      { confirmTestProject: true },
      {
        confirmTestProject: true,
        projectUrl: 'http://x.supabase.co',
        anonKey: ANON,
        serviceKey: SERVICE,
      },
      { confirmTestProject: true, projectUrl: PROJECT, serviceKey: SERVICE },
      'text',
      null,
    ];
    for (const body of bodies) {
      const before = fails(() => parseAuditInput(body));
      const now = fails(() => parseAuditRequest(body, true));
      expect(now.message).toBe(before.message);
    }
  });
});

describe('flag on, websiteUrl given', () => {
  const urlOnly = { websiteUrl: SITE, confirmSiteAccess: true };

  it('a website only: confirmSiteAccess is enough, confirmTestProject is not needed', () => {
    const request = parseAuditRequest(urlOnly, true);
    expect(request.websiteUrl).toBe(SITE);
    expect(request.supabase).toBeNull();
    expect(request.label).toBe('www.example-shop.com');
  });

  it('a label is kept', () => {
    expect(
      parseAuditRequest({ ...urlOnly, label: ' My shop ' }, true).label,
    ).toBe('My shop');
  });

  it('only the front page counts: a path, a query and a hash are dropped', () => {
    const request = parseAuditRequest(
      { ...urlOnly, websiteUrl: `${SITE}/account/orders?id=7#top` },
      true,
    );
    expect(request.websiteUrl).toBe(SITE);
  });

  it('confirmSiteAccess must be exactly true', () => {
    for (const value of [undefined, false, 'true', 1, null]) {
      const e = fails(() =>
        parseAuditRequest({ ...urlOnly, confirmSiteAccess: value }, true),
      );
      expect(e.message).toMatch(/confirmSiteAccess/);
    }
  });

  it('confirmTestProject does not replace confirmSiteAccess', () => {
    const e = fails(() =>
      parseAuditRequest({ websiteUrl: SITE, confirmTestProject: true }, true),
    );
    expect(e.message).toMatch(/confirmSiteAccess/);
  });

  it('a bad website address is a 400 that names only the field', () => {
    const bad = [
      'http://www.example-shop.com',
      'https://user:pass@www.example-shop.com',
      'https://127.0.0.1',
      'https://[::1]/',
      'https://localhost',
      'https://intranet',
      'ftp://www.example-shop.com',
      'not a url',
      '',
      42,
      null,
      `https://${'a'.repeat(300)}.example.com`,
    ];
    for (const value of bad) {
      const e = fails(() =>
        parseAuditRequest({ ...urlOnly, websiteUrl: value }, true),
      );
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/websiteUrl/);
      if (typeof value === 'string' && value.length > 3) {
        expect(e.message).not.toContain(value);
      }
    }
  });

  it('with the Supabase group too: confirmTestProject is needed as well', () => {
    const both = { ...urlOnly, ...supabase() };
    expect(fails(() => parseAuditRequest(both, true)).message).toMatch(
      /confirmTestProject/,
    );
    const request = parseAuditRequest(
      { ...both, confirmTestProject: true },
      true,
    );
    expect(request.websiteUrl).toBe(SITE);
    expect(request.supabase).toEqual({
      projectUrl: PROJECT,
      publishableKey: ANON,
      secretKey: SERVICE,
    });
  });

  it('with the Supabase group, confirmSiteAccess is still needed', () => {
    const e = fails(() =>
      parseAuditRequest(
        { websiteUrl: SITE, confirmTestProject: true, ...supabase() },
        true,
      ),
    );
    expect(e.message).toMatch(/confirmSiteAccess/);
  });

  it('a half-given Supabase group is a 400 that names only the missing fields', () => {
    const all = ['projectUrl', 'anonKey', 'serviceKey'] as const;
    const full = supabase();
    for (let mask = 1; mask < 7; mask++) {
      const given = all.filter((_f, i) => mask & (1 << i));
      const missing = all.filter((f) => !given.includes(f));
      if (missing.length === 0) continue;
      const body: Record<string, unknown> = {
        ...urlOnly,
        confirmTestProject: true,
      };
      for (const f of given) body[f] = full[f];
      const e = fails(() => parseAuditRequest(body, true));
      expect(e.status).toBe(400);
      for (const f of missing) expect(e.message).toContain(f);
      for (const f of given) expect(e.message).not.toContain(f);
      expect(e.message).not.toContain(ANON);
      expect(e.message).not.toContain(SERVICE);
      expect(e.message).not.toContain('abcdefghijklmnopqrst');
    }
  });

  it('a Supabase address that is not a plain project address is refused, as before', () => {
    const e = fails(() =>
      parseAuditRequest(
        {
          ...urlOnly,
          confirmTestProject: true,
          ...supabase(),
          projectUrl: 'https://example.com',
        },
        true,
      ),
    );
    expect(e.message).toMatch(/projectUrl/);
  });

  it('no error ever contains a key', () => {
    const bodies: Record<string, unknown>[] = [
      { ...urlOnly, anonKey: ANON },
      { ...urlOnly, serviceKey: SERVICE, projectUrl: 'nope' },
      { ...urlOnly, confirmTestProject: true, ...supabase(), websiteUrl: 'x' },
    ];
    for (const body of bodies) {
      const e = fails(() => parseAuditRequest(body, true));
      expect(e.message).not.toContain(ANON);
      expect(e.message).not.toContain(SERVICE);
    }
  });
});
