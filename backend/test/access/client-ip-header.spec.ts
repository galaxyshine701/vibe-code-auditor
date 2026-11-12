import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { resolveClientIpHeader } from '../../src/access/access-config.js';
import {
  ACCESS_CONFIG,
  CLIENT_IP_HEADER,
} from '../../src/access/access-code.guard.js';
import { clientKey, resolveClientIp } from '../../src/access/client-ip.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

// A made-up code that only exists in these tests.
const CODE = 'TEST-ONLY-made-up-code-0123456789';

const req = (
  headers: Record<string, string | string[] | undefined>,
  ip: string | undefined = '10.0.0.1',
) => ({ ip, headers });

describe('resolveClientIp', () => {
  it('uses request.ip when no header name is set, and ignores the header', () => {
    expect(resolveClientIp(req({ 'x-real-ip': '203.0.113.5' }), null)).toBe(
      '10.0.0.1',
    );
  });

  it('uses the header value when it is set', () => {
    expect(
      resolveClientIp(req({ 'x-real-ip': '203.0.113.5' }), 'x-real-ip'),
    ).toBe('203.0.113.5');
  });

  it.each([
    ['missing', {}],
    ['empty', { 'x-real-ip': '' }],
    ['only spaces', { 'x-real-ip': '   ' }],
    ['an empty array', { 'x-real-ip': [] as string[] }],
    ['not an IP', { 'x-real-ip': 'not-an-ip' }],
    ['a wrong IPv4', { 'x-real-ip': '999.1.1.1' }],
    ['an IP with a port', { 'x-real-ip': '203.0.113.5:443' }],
    ['a list that starts with nothing', { 'x-real-ip': ', 203.0.113.5' }],
    [
      'an array whose first item is bad',
      { 'x-real-ip': ['bad', '203.0.113.5'] },
    ],
  ])('falls back to request.ip when the header is %s', (_name, headers) => {
    expect(resolveClientIp(req(headers), 'x-real-ip')).toBe('10.0.0.1');
  });

  it('uses only the first of several values', () => {
    expect(
      resolveClientIp(
        req({ 'x-real-ip': '203.0.113.5, 198.51.100.7' }),
        'x-real-ip',
      ),
    ).toBe('203.0.113.5');
    expect(
      resolveClientIp(
        req({ 'x-real-ip': ['203.0.113.5', '198.51.100.7'] }),
        'x-real-ip',
      ),
    ).toBe('203.0.113.5');
  });

  it('keeps the IPv6 /64 grouping', () => {
    const a = resolveClientIp(
      req({ 'x-real-ip': '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd' }),
      'x-real-ip',
    );
    const b = resolveClientIp(
      req({ 'x-real-ip': '2001:db8:abcd:12::1' }),
      'x-real-ip',
    );
    expect(clientKey(a)).toBe(clientKey(b));
    expect(clientKey(a)).toBe('2001:db8:abcd:12::/64');
  });
});

describe('resolveClientIpHeader', () => {
  it('is null when not set', () => {
    expect(resolveClientIpHeader({})).toBeNull();
    expect(resolveClientIpHeader({ CLIENT_IP_HEADER: '' })).toBeNull();
    expect(resolveClientIpHeader({ CLIENT_IP_HEADER: '  ' })).toBeNull();
  });

  it('cleans the name (trim, lower case)', () => {
    expect(resolveClientIpHeader({ CLIENT_IP_HEADER: ' X-Real-IP ' })).toBe(
      'x-real-ip',
    );
  });

  it.each([
    'bad name',
    'x_ip',
    'a:b',
    'x-real-ip, x-other',
    'ünï',
    'a'.repeat(65),
  ])('refuses a bad name: %s, without repeating it', (name) => {
    let message = '';
    try {
      resolveClientIpHeader({ CLIENT_IP_HEADER: name });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('CLIENT_IP_HEADER');
    expect(message).not.toContain(name);
  });

  it.each([
    'x-access-code',
    'Authorization',
    'cookie',
    'set-cookie',
    'host',
    'content-type',
    'content-length',
    'x-forwarded-for',
    'Forwarded',
  ])('refuses the header %s', (name) => {
    expect(() => resolveClientIpHeader({ CLIENT_IP_HEADER: name })).toThrow(
      /CLIENT_IP_HEADER/,
    );
  });
});

describe('the rate limit with CLIENT_IP_HEADER', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  async function buildApp(header: string | null) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_CONFIG)
      .useValue({ mode: 'code', code: CODE })
      .overrideProvider(CLIENT_IP_HEADER)
      .useValue(header)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, {});
    await app.init();
  }

  const probe = (code: string, realIp?: string) => {
    let r = request(app.getHttpServer())
      .get('/api/v1/audits/aud_unknown')
      .set('X-Access-Code', code);
    if (realIp !== undefined) r = r.set('X-Real-IP', realIp);
    return r;
  };

  it('counts every address in the header separately', async () => {
    await buildApp('x-real-ip');
    for (let i = 0; i < 10; i++) await probe('wrong', '203.0.113.10');
    expect((await probe('wrong', '203.0.113.10')).status).toBe(429);
    expect((await probe(CODE, '203.0.113.10')).status).toBe(429);
    // another address is not locked out
    expect((await probe('wrong', '203.0.113.20')).status).toBe(401);
    expect((await probe(CODE, '203.0.113.20')).status).toBe(404);
  });

  it('cannot be dodged by changing the rest of the list', async () => {
    await buildApp('x-real-ip');
    for (let i = 0; i < 10; i++) {
      await probe('wrong', `203.0.113.10, 9.9.9.${i}`);
    }
    expect((await probe('wrong', '203.0.113.10')).status).toBe(429);
  });

  it('ignores the header when CLIENT_IP_HEADER is not set', async () => {
    await buildApp(null);
    // every request has a different X-Real-IP, but all come from one real address
    for (let i = 0; i < 10; i++) await probe('wrong', `198.51.100.${i}`);
    expect((await probe('wrong', '198.51.100.99')).status).toBe(429);
  });

  it('uses request.ip when the header is set but unusable (known behaviour)', async () => {
    await buildApp('x-real-ip');
    // missing, empty and bad values all count against the same request.ip
    for (let i = 0; i < 3; i++) await probe('wrong');
    for (let i = 0; i < 3; i++) await probe('wrong', 'not-an-ip');
    for (let i = 0; i < 4; i++) await probe('wrong', '999.1.1.1');
    expect((await probe('wrong')).status).toBe(429);
  });
});
