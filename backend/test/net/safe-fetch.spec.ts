import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import {
  createPinnedLookup,
  defaultTransport,
  safeFetch,
  SafeFetchError,
  type ResolvedAddress,
  type Resolver,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '../../src/net/safe-fetch.js';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

/** A fake DNS that remembers every question. */
function fakeDns(answers: Record<string, ResolvedAddress[] | Error> = {}) {
  const asked: string[] = [];
  const resolve: Resolver = (hostname) => {
    asked.push(hostname);
    const answer = answers[hostname] ?? [PUBLIC];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { resolve, asked };
}

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  chunks?: (Buffer | string)[];
};

/** A fake network: answers from a list, one request after the other. */
function fakeNet(...replies: (Reply | ((req: TransportRequest) => Reply))[]) {
  const requests: TransportRequest[] = [];
  const transport: Transport = (req) => {
    requests.push(req);
    const next = replies[Math.min(requests.length - 1, replies.length - 1)];
    const reply = typeof next === 'function' ? next(req) : next;
    const chunks = (reply.chunks ?? ['ok']).map((c) => Buffer.from(c));
    const response: TransportResponse = {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
      body: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    };
    return Promise.resolve(response);
  };
  return { transport, requests };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SafeFetchError);
  return (error as SafeFetchError).code;
};

describe('safeFetch: the address is judged before any connection', () => {
  it.each([
    ['file:///etc/passwd', 'BLOCKED_SCHEME'],
    ['ftp://example.com/', 'BLOCKED_SCHEME'],
    ['gopher://example.com/', 'BLOCKED_SCHEME'],
    ['data:text/plain,hello', 'BLOCKED_SCHEME'],
    ['javascript:alert(1)', 'BLOCKED_SCHEME'],
    ['ws://example.com/', 'BLOCKED_SCHEME'],
    ['not a url', 'BAD_URL'],
    ['', 'BAD_URL'],
    ['http://user:pass@example.com/', 'BAD_URL'],
    ['http://user@example.com/', 'BAD_URL'],
    ['http://example.com:8080/', 'BLOCKED_PORT'],
    ['https://example.com:22/', 'BLOCKED_PORT'],
    ['http://example.com:6379/', 'BLOCKED_PORT'],
  ])('refuses %s before DNS and before any connection', async (url, code) => {
    const dns = fakeDns();
    const net = fakeNet({});
    expect(
      await codeOf(
        safeFetch(url, { resolve: dns.resolve, transport: net.transport }),
      ),
    ).toBe(code);
    expect(dns.asked).toEqual([]);
    expect(net.requests).toHaveLength(0);
  });

  it('allows the standard ports, written or not', async () => {
    for (const url of [
      'http://example.com/',
      'http://example.com:80/',
      'https://example.com/',
      'https://example.com:443/',
    ]) {
      const dns = fakeDns();
      const net = fakeNet({});
      const res = await safeFetch(url, {
        resolve: dns.resolve,
        transport: net.transport,
      });
      expect(res.status).toBe(200);
    }
  });

  // localhost and every spelling of an IP that means "this machine"
  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://localhost./',
    'https://localhost:443/',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://127.1/', // the URL parser turns this into 127.0.0.1
    'http://127.0.0.1.:80/',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://0.0.0.0/',
    'http://0/', // 0.0.0.0
    'http://[::]/',
    // decimal, hex and octal spellings of 127.0.0.1
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0x7f.0.0.1/',
    'http://017700000001/',
    'http://0177.0.0.1/',
    // IPv4 inside IPv6
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
    // private networks and cloud metadata
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2852039166/', // decimal 169.254.169.254
    'http://[fd00:ec2::254]/', // AWS metadata over IPv6
    'http://100.100.100.200/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://db.internal/',
  ])('refuses %s without opening a connection', async (url) => {
    const dns = fakeDns();
    const net = fakeNet({});
    const code = await codeOf(
      safeFetch(url, { resolve: dns.resolve, transport: net.transport }),
    );
    expect(['BLOCKED_ADDRESS', 'BLOCKED_HOST']).toContain(code);
    expect(net.requests).toHaveLength(0);
    // an IP literal or a known inside name needs no DNS question at all
    expect(dns.asked).toEqual([]);
  });

  it('refuses a name whose DNS answer is a private address', async () => {
    const dns = fakeDns({
      'evil.example': [{ address: '10.0.0.7', family: 4 }],
    });
    const net = fakeNet({});
    expect(
      await codeOf(
        safeFetch('https://evil.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('BLOCKED_ADDRESS');
    expect(net.requests).toHaveLength(0);
  });

  it('refuses when ANY answer is private, even if the first one is public', async () => {
    const dns = fakeDns({
      'mixed.example': [PUBLIC, { address: '127.0.0.1', family: 4 }],
    });
    const net = fakeNet({});
    expect(
      await codeOf(
        safeFetch('https://mixed.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('BLOCKED_ADDRESS');
    expect(net.requests).toHaveLength(0);
  });

  it('refuses an IPv6 private answer, also the IPv4-mapped form', async () => {
    for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      const dns = fakeDns({ 'v6.example': [{ address, family: 6 }] });
      const net = fakeNet({});
      expect(
        await codeOf(
          safeFetch('https://v6.example/', {
            resolve: dns.resolve,
            transport: net.transport,
          }),
        ),
      ).toBe('BLOCKED_ADDRESS');
    }
  });

  it('DNS errors and empty answers are DNS_FAILED', async () => {
    const dns = fakeDns({
      'gone.example': new Error('ENOTFOUND gone.example'),
      'empty.example': [],
    });
    const net = fakeNet({});
    expect(
      await codeOf(
        safeFetch('https://gone.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('DNS_FAILED');
    expect(
      await codeOf(
        safeFetch('https://empty.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('DNS_FAILED');
  });

  it('the error message is a fixed sentence: it never contains the address', async () => {
    const dns = fakeDns();
    const net = fakeNet({});
    const error = (await safeFetch('http://10.1.2.3/secret-path?token=abc', {
      resolve: dns.resolve,
      transport: net.transport,
    }).catch((e: unknown) => e)) as SafeFetchError;
    expect(error.message).not.toContain('10.1.2.3');
    expect(error.message).not.toContain('secret-path');
    expect(error.message).not.toContain('abc');
  });
});

describe('safeFetch: the connection goes to the address that was checked', () => {
  it('uses exactly the checked address and leaves the URL (the host name) alone', async () => {
    const dns = fakeDns({
      'site.example': [{ address: '93.184.216.34', family: 4 }],
    });
    const net = fakeNet({});
    await safeFetch('https://site.example/page?a=1', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0].address).toBe('93.184.216.34');
    expect(net.requests[0].family).toBe(4);
    // not rewritten to the IP: Host header and TLS name stay the original name
    expect(net.requests[0].url.href).toBe('https://site.example/page?a=1');
  });

  it('asks DNS once per address: a second, different answer (rebinding) is never used', async () => {
    let calls = 0;
    const resolve: Resolver = () => {
      calls += 1;
      // first answer is public, any later answer would be the metadata address
      return Promise.resolve([
        calls === 1 ? PUBLIC : { address: '169.254.169.254', family: 4 },
      ]);
    };
    const net = fakeNet({});
    await safeFetch('https://rebind.example/', {
      resolve,
      transport: net.transport,
    });
    expect(calls).toBe(1);
    expect(net.requests[0].address).toBe('93.184.216.34');
  });

  it('connects to the first answer only after ALL answers were judged', async () => {
    const dns = fakeDns({
      'multi.example': [PUBLIC, { address: '8.8.8.8', family: 4 }],
    });
    const net = fakeNet({});
    await safeFetch('https://multi.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(net.requests[0].address).toBe(PUBLIC.address);
  });

  it('an IP literal that is public is allowed and used as it is', async () => {
    const dns = fakeDns();
    const net = fakeNet({});
    await safeFetch('http://93.184.216.34/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(net.requests[0].address).toBe('93.184.216.34');
    expect(dns.asked).toEqual([]);
  });

  it('sends only the fixed request headers: no cookie, no credentials, identity encoding', async () => {
    const dns = fakeDns();
    const net = fakeNet({});
    await safeFetch('https://site.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(Object.keys(net.requests[0].headers).sort()).toEqual(
      ['accept', 'accept-encoding', 'connection', 'user-agent'].sort(),
    );
    expect(net.requests[0].headers['accept-encoding']).toBe('identity');
  });

  describe('the pinned lookup of the real transport', () => {
    it('answers with the checked address, in both call styles of Node', () => {
      const lookup = createPinnedLookup('93.184.216.34', 4);
      let single: unknown[] = [];
      lookup('whatever.example', {}, (...args) => (single = args));
      expect(single).toEqual([null, '93.184.216.34', 4]);
      let all: unknown[] = [];
      lookup('whatever.example', { all: true }, (...args) => (all = args));
      expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
    });

    it('really connects to the pinned address, not to what the name would resolve to', async () => {
      const seen: {
        host: string | undefined;
        url: string | undefined;
        accept: string | undefined;
      }[] = [];
      const server = http.createServer((req, res) => {
        seen.push({
          host: req.headers.host,
          url: req.url,
          accept: req.headers['accept-encoding'],
        });
        res.end('pinned-ok');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as AddressInfo;
      try {
        const controller = new AbortController();
        // "pinned.test" does not exist in DNS; only the pin can make this work.
        const res = await defaultTransport({
          url: new URL(`http://pinned.test:${port}/x?y=1`),
          address: '127.0.0.1',
          family: 4,
          headers: { 'accept-encoding': 'identity', connection: 'close' },
          signal: controller.signal,
        });
        const body: Buffer[] = [];
        for await (const chunk of res.body) body.push(Buffer.from(chunk));
        expect(Buffer.concat(body).toString()).toBe('pinned-ok');
        // the Host header keeps the original name
        expect(seen[0].host).toBe(`pinned.test:${port}`);
        expect(seen[0].url).toBe('/x?y=1');
        expect(seen[0].accept).toBe('identity');
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });

  it('safeFetch with the REAL transport and resolver refuses a local server and never touches it', async () => {
    let touched = 0;
    const server = http.createServer((_req, res) => {
      touched += 1;
      res.end('secret');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      // port is not 80/443, and the address is loopback: refused twice over
      expect(await codeOf(safeFetch(`http://127.0.0.1:${port}/`))).toBe(
        'BLOCKED_PORT',
      );
      expect(await codeOf(safeFetch('http://127.0.0.1/'))).toBe(
        'BLOCKED_ADDRESS',
      );
      expect(await codeOf(safeFetch('http://localhost/'))).toBe('BLOCKED_HOST');
      expect(touched).toBe(0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('safeFetch: redirects are judged again, one by one', () => {
  const redirect = (location: string, status = 302): Reply => ({
    status,
    headers: { location },
    chunks: [''],
  });

  it('follows a redirect to another public address', async () => {
    const dns = fakeDns();
    const net = fakeNet(redirect('https://other.example/next'), {
      chunks: ['final'],
    });
    const res = await safeFetch('https://site.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(res.url).toBe('https://other.example/next');
    expect(res.body.toString()).toBe('final');
    expect(dns.asked).toEqual(['site.example', 'other.example']);
  });

  it('resolves a relative Location against the current address', async () => {
    const dns = fakeDns();
    const net = fakeNet(redirect('/login?x=1', 301), { chunks: ['final'] });
    const res = await safeFetch('https://site.example/start', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(res.url).toBe('https://site.example/login?x=1');
  });

  it.each([
    ['a private IP', 'http://10.0.0.5/admin', 'BLOCKED_ADDRESS'],
    [
      'cloud metadata',
      'http://169.254.169.254/latest/meta-data/',
      'BLOCKED_ADDRESS',
    ],
    ['metadata by decimal IP', 'http://2852039166/', 'BLOCKED_ADDRESS'],
    ['loopback', 'http://127.0.0.1/', 'BLOCKED_ADDRESS'],
    ['localhost', 'http://localhost/', 'BLOCKED_HOST'],
    ['localhost with a port', 'http://localhost:80/', 'BLOCKED_HOST'],
    ['IPv6 loopback', 'http://[::1]/', 'BLOCKED_ADDRESS'],
    ['IPv4-mapped IPv6', 'http://[::ffff:10.0.0.1]/', 'BLOCKED_ADDRESS'],
    [
      'an internal host name',
      'http://metadata.google.internal/',
      'BLOCKED_HOST',
    ],
    ['file:', 'file:///etc/passwd', 'BLOCKED_SCHEME'],
    ['ftp:', 'ftp://example.com/', 'BLOCKED_SCHEME'],
    ['a forbidden port', 'http://site.example:8080/', 'BLOCKED_PORT'],
    ['user:password@', 'http://user:pass@other.example/', 'BAD_URL'],
  ])(
    'a redirect to %s is refused, and only the first request was made',
    async (_name, location, code) => {
      const dns = fakeDns();
      const net = fakeNet(redirect(location), {
        chunks: ['must not be reached'],
      });
      expect(
        await codeOf(
          safeFetch('https://site.example/', {
            resolve: dns.resolve,
            transport: net.transport,
          }),
        ),
      ).toBe(code);
      expect(net.requests).toHaveLength(1);
    },
  );

  it('a redirect to a name that resolves to a private address is refused', async () => {
    const dns = fakeDns({
      'inner.example': [{ address: '192.168.0.9', family: 4 }],
    });
    const net = fakeNet(redirect('https://inner.example/'), { chunks: ['no'] });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('BLOCKED_ADDRESS');
    expect(net.requests).toHaveLength(1);
  });

  it('refuses a redirect chain that ends in the metadata address, hop by hop', async () => {
    const dns = fakeDns();
    const net = fakeNet(
      redirect('https://b.example/'),
      redirect('https://c.example/'),
      redirect('http://169.254.169.254/latest/'),
      { chunks: ['no'] },
    );
    expect(
      await codeOf(
        safeFetch('https://a.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('BLOCKED_ADDRESS');
    expect(net.requests).toHaveLength(3);
  });

  it('stops after 5 redirects', async () => {
    const dns = fakeDns();
    const net = fakeNet(redirect('https://loop.example/again'));
    expect(
      await codeOf(
        safeFetch('https://loop.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('TOO_MANY_REDIRECTS');
    expect(net.requests).toHaveLength(6); // the first request and 5 redirects
  });

  it('a redirect without a Location is returned as an answer', async () => {
    const dns = fakeDns();
    const net = fakeNet({ status: 302, chunks: ['moved'] });
    const res = await safeFetch('https://site.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(res.status).toBe(302);
  });

  it('a Location that is not an address is BAD_REDIRECT', async () => {
    const dns = fakeDns();
    const net = fakeNet(redirect('http://[bad'));
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: net.transport,
        }),
      ),
    ).toBe('BAD_REDIRECT');
  });
});

describe('safeFetch: size cap on the bytes after decompression', () => {
  const dns = fakeDns();

  it('returns a body that fits', async () => {
    const net = fakeNet({ chunks: ['hello ', 'world'] });
    const res = await safeFetch('https://site.example/', {
      resolve: dns.resolve,
      transport: net.transport,
      maxBytes: 100,
    });
    expect(res.body.toString()).toBe('hello world');
  });

  it('refuses a body that grows past the cap', async () => {
    const net = fakeNet({ chunks: ['x'.repeat(60), 'x'.repeat(60)] });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: net.transport,
          maxBytes: 100,
        }),
      ),
    ).toBe('TOO_LARGE');
  });

  it('refuses early when Content-Length already says too much', async () => {
    let read = 0;
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: { 'content-length': '5000' },
        body: (async function* () {
          read += 1;
          yield Buffer.from('x');
        })(),
      });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport,
          maxBytes: 100,
        }),
      ),
    ).toBe('TOO_LARGE');
    expect(read).toBe(0);
  });

  it('a gzip body is counted AFTER decompression: a small download of a huge file is refused', async () => {
    const huge = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 'a')); // ~20 KB on the wire
    expect(huge.length).toBeLessThan(100 * 1024);
    const net = fakeNet({
      headers: { 'content-encoding': 'gzip' },
      chunks: [huge],
    });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: net.transport,
          maxBytes: 1024 * 1024,
        }),
      ),
    ).toBe('TOO_LARGE');
  });

  it('a gzip body that fits after decompression is decoded', async () => {
    const net = fakeNet({
      headers: { 'content-encoding': 'gzip' },
      chunks: [zlib.gzipSync('compressed hello')],
    });
    const res = await safeFetch('https://site.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });
    expect(res.body.toString()).toBe('compressed hello');
  });

  it('decodes deflate and brotli too', async () => {
    for (const [encoding, data] of [
      ['deflate', zlib.deflateSync('deflated')],
      ['br', zlib.brotliCompressSync('brotlied')],
    ] as const) {
      const net = fakeNet({
        headers: { 'content-encoding': encoding },
        chunks: [data],
      });
      const res = await safeFetch('https://site.example/', {
        resolve: dns.resolve,
        transport: net.transport,
      });
      expect(res.body.toString()).toBe(
        encoding === 'deflate' ? 'deflated' : 'brotlied',
      );
    }
  });

  it('an unknown encoding is refused, and a broken compressed body too', async () => {
    const unknown = fakeNet({
      headers: { 'content-encoding': 'zstd' },
      chunks: ['x'],
    });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: unknown.transport,
        }),
      ),
    ).toBe('BAD_ENCODING');
    const broken = fakeNet({
      headers: { 'content-encoding': 'gzip' },
      chunks: ['this is not gzip'],
    });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: broken.transport,
        }),
      ),
    ).toBe('BAD_ENCODING');
  });

  it('a connection that drops while the body is read is NETWORK', async () => {
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: (async function* () {
          yield Buffer.from('part');
          throw new Error('socket hang up');
        })(),
      });
    expect(
      await codeOf(
        safeFetch('https://site.example/', { resolve: dns.resolve, transport }),
      ),
    ).toBe('NETWORK');
  });
});

describe('safeFetch: one deadline for the whole call', () => {
  it('a request that never answers is TIMEOUT', async () => {
    const dns = fakeDns();
    const transport: Transport = () =>
      new Promise<TransportResponse>(() => undefined);
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport,
          timeoutMs: 40,
        }),
      ),
    ).toBe('TIMEOUT');
  });

  it('a DNS lookup that never answers is TIMEOUT', async () => {
    const resolve: Resolver = () =>
      new Promise<ResolvedAddress[]>(() => undefined);
    const net = fakeNet({});
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve,
          transport: net.transport,
          timeoutMs: 40,
        }),
      ),
    ).toBe('TIMEOUT');
    expect(net.requests).toHaveLength(0);
  });

  it('a body that drips for ever is TIMEOUT', async () => {
    const dns = fakeDns();
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: (async function* () {
          for (;;) {
            await new Promise((r) => setTimeout(r, 10));
            yield Buffer.from('.');
          }
        })(),
      });
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport,
          timeoutMs: 80,
        }),
      ),
    ).toBe('TIMEOUT');
  });

  it('the deadline covers the redirects together, not each one separately', async () => {
    const dns = fakeDns();
    const slowRedirect: Transport = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return {
        status: 302,
        headers: { location: 'https://site.example/next' },
        body: (async function* () {})(),
      };
    };
    expect(
      await codeOf(
        safeFetch('https://site.example/', {
          resolve: dns.resolve,
          transport: slowRedirect,
          timeoutMs: 100,
        }),
      ),
    ).toBe('TIMEOUT');
  });
});
