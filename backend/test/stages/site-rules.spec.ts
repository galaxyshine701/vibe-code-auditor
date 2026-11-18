import { describe, expect, it } from 'vitest';
import {
  analyzeHeaders,
  extractScriptUrls,
  scanForKeys,
  scriptName,
} from '../../src/stages/site-rules.js';

const GOOD = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const subjects = (items: { subject: string }[]) => items.map((i) => i.subject);
const byName = (items: { subject: string; ok: boolean }[]) =>
  Object.fromEntries(items.map((i) => [i.subject, i.ok]));

describe('analyzeHeaders', () => {
  it('a site with every header: every rule is ok', () => {
    const items = analyzeHeaders(GOOD, 'https://www.example-shop.com/');
    expect(subjects(items)).toEqual([
      'https',
      'strict-transport-security',
      'content-security-policy',
      'x-content-type-options',
      'framing',
      'referrer-policy',
    ]);
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it('a site with no security header: every header rule is not ok (but https is)', () => {
    const items = analyzeHeaders({}, 'https://www.example-shop.com/');
    expect(byName(items)).toEqual({
      https: true,
      'strict-transport-security': false,
      'content-security-policy': false,
      'x-content-type-options': false,
      framing: false,
      'referrer-policy': false,
    });
  });

  it('a site reached over plain http fails the https rule', () => {
    const items = analyzeHeaders(GOOD, 'http://www.example-shop.com/');
    expect(byName(items).https).toBe(false);
  });

  it('a weak HSTS (a short max-age, or none) is not ok', () => {
    for (const value of [
      'max-age=60',
      'includeSubDomains',
      'max-age=abc',
      '',
    ]) {
      const items = analyzeHeaders(
        { ...GOOD, 'strict-transport-security': value },
        'https://x.example.com/',
      );
      expect(byName(items)['strict-transport-security']).toBe(false);
    }
    const ok = analyzeHeaders(
      { ...GOOD, 'strict-transport-security': 'max-age=15552000' },
      'https://x.example.com/',
    );
    expect(byName(ok)['strict-transport-security']).toBe(true);
  });

  it('nosniff must be exactly nosniff', () => {
    const bad = analyzeHeaders(
      { ...GOOD, 'x-content-type-options': 'sniff' },
      'https://x.example.com/',
    );
    expect(byName(bad)['x-content-type-options']).toBe(false);
  });

  it('framing is protected by X-Frame-Options OR by CSP frame-ancestors', () => {
    const { 'x-frame-options': _x, ...withoutXfo } = GOOD;
    const viaCsp = analyzeHeaders(
      {
        ...withoutXfo,
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      },
      'https://x.example.com/',
    );
    expect(byName(viaCsp).framing).toBe(true);
    const neither = analyzeHeaders(withoutXfo, 'https://x.example.com/');
    expect(byName(neither).framing).toBe(false);
  });

  it('a header that comes as a list is read too', () => {
    const items = analyzeHeaders(
      { ...GOOD, 'x-content-type-options': ['nosniff'] },
      'https://x.example.com/',
    );
    expect(byName(items)['x-content-type-options']).toBe(true);
  });

  it('every item has a text in both languages, and no text quotes a header value', () => {
    for (const headers of [GOOD, {}]) {
      for (const item of analyzeHeaders(headers, 'https://x.example.com/')) {
        expect(item.en.length).toBeGreaterThan(0);
        expect(item.ur.length).toBeGreaterThan(0);
        expect(`${item.en} ${item.ur}`).not.toContain('63072000');
        expect(`${item.en} ${item.ur}`).not.toContain('default-src');
      }
    }
  });

  it('never claims the site is secure or safe', () => {
    for (const item of analyzeHeaders(GOOD, 'https://x.example.com/')) {
      expect(`${item.en} ${item.ur}`).not.toMatch(
        /\bsecure\b|\bsafe\b|certif/i,
      );
    }
  });
});

describe('extractScriptUrls', () => {
  const base = 'https://www.example-shop.com/shop/index.html';

  it('finds src in every quoting style, resolved against the page', () => {
    const html = `
      <script src="/assets/app.js"></script>
      <script src='vendor.js'></script>
      <script src=chunk.js defer></script>
      <SCRIPT SRC="//cdn.example.net/lib.js"></SCRIPT>
      <script type="module" src="https://www.example-shop.com/main.mjs"></script>`;
    expect(extractScriptUrls(html, base).srcs).toEqual([
      'https://www.example-shop.com/assets/app.js',
      'https://www.example-shop.com/shop/vendor.js',
      'https://www.example-shop.com/shop/chunk.js',
      'https://cdn.example.net/lib.js',
      'https://www.example-shop.com/main.mjs',
    ]);
  });

  it('also takes a module preload of a script', () => {
    const html = `<link rel="modulepreload" href="/assets/chunk-a1.js">
      <link rel="preload" as="script" href="/assets/chunk-b2.js">
      <link rel="stylesheet" href="/assets/app.css">
      <link rel="preload" as="font" href="/assets/f.woff2">`;
    expect(extractScriptUrls(html, base).srcs).toEqual([
      'https://www.example-shop.com/assets/chunk-a1.js',
      'https://www.example-shop.com/assets/chunk-b2.js',
    ]);
  });

  it('ignores anything that is not http(s), and a script that is listed twice is taken once', () => {
    const html = `
      <script src="data:text/javascript,alert(1)"></script>
      <script src="javascript:alert(1)"></script>
      <script src="/a.js"></script><script src="/a.js#again"></script>`;
    expect(extractScriptUrls(html, base).srcs).toEqual([
      'https://www.example-shop.com/a.js',
    ]);
  });

  it('keeps the text of inline scripts, so a key written into the page is found too', () => {
    const html = `<script>window.__CFG = {a: 1}</script><script src="/a.js"></script><script>  </script>`;
    const found = extractScriptUrls(html, base);
    expect(found.inline).toEqual(['window.__CFG = {a: 1}']);
    expect(found.srcs).toHaveLength(1);
  });

  it('does not throw on broken html', () => {
    for (const html of [
      '',
      '<script',
      '<script src=>',
      '<<<>>>',
      '<script src="http://[bad">',
    ]) {
      expect(() => extractScriptUrls(html, base)).not.toThrow();
    }
  });
});

describe('scanForKeys', () => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (payload: unknown) =>
    `eyJhbGciOiJIUzI1NiJ9.${b64(payload)}.c2lnbmF0dXJlLXZhbHVlLWhlcmU`;

  it('finds a new-style Supabase secret key', () => {
    expect(scanForKeys('const k="sb_secret_AbCdEfGhIjKlMnOp123456";')).toEqual([
      'secret-key',
    ]);
  });

  it('finds a service_role JWT, but not an anon one', () => {
    expect(
      scanForKeys(`x="${jwt({ role: 'service_role', iss: 'supabase' })}"`),
    ).toEqual(['service-role-jwt']);
    expect(
      scanForKeys(`x="${jwt({ role: 'anon', iss: 'supabase' })}"`),
    ).toEqual([]);
    expect(scanForKeys(`x="${jwt({ role: 'authenticated' })}"`)).toEqual([]);
  });

  it('the publishable key (sb_publishable_) is public and is not reported', () => {
    expect(scanForKeys('k="sb_publishable_AbCdEfGhIjKlMnOp123456"')).toEqual(
      [],
    );
  });

  it('reports each kind once, however often it appears', () => {
    const text = `${'sb_secret_AbCdEfGhIjKlMnOp123456 '.repeat(5)} ${jwt({ role: 'service_role' })}`;
    expect(scanForKeys(text).sort()).toEqual([
      'secret-key',
      'service-role-jwt',
    ]);
  });

  it('junk that only looks like a token is ignored, and nothing throws', () => {
    expect(scanForKeys('eyJabcdefghijk.eyJnotjsonnotjson.abcdefghijk')).toEqual(
      [],
    );
    expect(
      scanForKeys(`eyJabcdefghijk.${b64('plain string')}.abcdefghijk`),
    ).toEqual([]);
    expect(scanForKeys('sb_secret_short')).toEqual([]);
    expect(scanForKeys('')).toEqual([]);
  });

  it('a big file is scanned fast', () => {
    const big = 'a'.repeat(2 * 1024 * 1024);
    const start = Date.now();
    expect(scanForKeys(big)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1_500);
  });

  it('returns kinds only, never the key itself', () => {
    const out = JSON.stringify(scanForKeys('sb_secret_AbCdEfGhIjKlMnOp123456'));
    expect(out).not.toContain('AbCdEf');
  });
});

describe('scriptName', () => {
  it('is host and path: no query, no hash, nothing after', () => {
    expect(
      scriptName(
        'https://www.example-shop.com/assets/app.js?token=SECRET123#x',
      ),
    ).toBe('www.example-shop.com/assets/app.js');
  });

  it('is cut at 120 characters', () => {
    expect(
      scriptName(`https://a.example.com/${'x'.repeat(300)}.js`).length,
    ).toBeLessThanOrEqual(120);
  });

  it('does not throw on a bad address', () => {
    expect(() => scriptName('not a url')).not.toThrow();
  });
});
