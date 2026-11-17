import {
  isBlockedAddress,
  isBlockedHostName,
  parseIPv6,
} from '../../src/net/ip-rules.js';

describe('isBlockedAddress', () => {
  const blocked = [
    // loopback, "this" network
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '0.1.2.3',
    // private
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    // link-local, cloud metadata
    '169.254.169.254',
    '169.254.0.1',
    // carrier-grade NAT (some clouds keep metadata here)
    '100.64.0.1',
    '100.100.100.200',
    '100.127.255.255',
    // other special ranges
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    // IPv6
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456:789a::1',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '100::1',
    // IPv4 inside IPv6
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe', // 169.254.169.254
    '::127.0.0.1',
    '64:ff9b::7f00:1', // NAT64 of 127.0.0.1
    '64:ff9b::a9fe:a9fe', // NAT64 of 169.254.169.254
    '2002:7f00:1::', // 6to4 of 127.0.0.1
    '2002:a9fe:a9fe::1', // 6to4 of 169.254.169.254
  ];
  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255', // just below 172.16/12
    '172.32.0.1', // just above 172.16/12
    '100.63.255.255', // just below 100.64/10
    '100.128.0.1', // just above 100.64/10
    '169.253.1.1',
    '11.0.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808', // NAT64 of 8.8.8.8
    '2002:808:808::1', // 6to4 of 8.8.8.8
  ];
  it.each(allowed)('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('blocks what it cannot understand', () => {
    for (const text of ['', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '::g']) {
      expect(isBlockedAddress(text)).toBe(true);
    }
  });
});

describe('parseIPv6', () => {
  it('reads compressed, full and dotted forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x102, 0x304,
    ]);
    expect(parseIPv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('refuses broken text', () => {
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7')).toBeNull();
    expect(parseIPv6('12345::1')).toBeNull();
  });
});

describe('isBlockedHostName', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'localhost.',
    'foo.localhost',
    'printer.local',
    'db.internal',
    'metadata.google.internal',
    'METADATA.GOOGLE.INTERNAL.',
    'host.localdomain',
    'router.home.arpa',
  ])('blocks %s', (name) => {
    expect(isBlockedHostName(name)).toBe(true);
  });
  it.each([
    'example.com',
    'my-app.vercel.app',
    'internal.example.com',
    'localhost.example.com',
  ])('allows %s', (name) => {
    expect(isBlockedHostName(name)).toBe(false);
  });
});
