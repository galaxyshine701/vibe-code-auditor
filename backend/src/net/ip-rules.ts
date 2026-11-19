import { isIP } from 'node:net';

/**
 * Which addresses and host names an inspector may NOT connect to: the machine
 * itself, private networks, link-local (cloud metadata), and other special
 * ranges. Used by safe-fetch before every connection.
 */

/** Host names that always mean "inside": blocked without any DNS lookup. */
const BLOCKED_NAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
];

/** [first address, prefix length] of every blocked IPv4 range. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT (also 100.100.100.200 of some clouds)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255
];

export function parseIPv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const inRangeV4 = (value: number, base: string, bits: number): boolean => {
  const start = parseIPv4(base)!;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
};

export function isBlockedIPv4(value: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => inRangeV4(value, base, bits));
}

/** The 8 groups (16 bits each) of an IPv6 address, or null if it is not valid. */
export function parseIPv6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // an IPv4 tail, as in ::ffff:127.0.0.1
  const lastColon = text.lastIndexOf(':');
  if (lastColon !== -1 && text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    const high = Math.floor(v4 / 65536).toString(16);
    const low = (v4 % 65536).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]);
  if (!tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

const v4From = (high: number, low: number): number => high * 65536 + low;

export function isBlockedIPv6(groups: number[]): boolean {
  const [a, b, c, d, e, f, g, h] = groups;
  const firstFiveZero = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  // :: (unspecified) and ::1 (loopback)
  if (firstFiveZero && f === 0 && g === 0 && (h === 0 || h === 1)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped): judged as the IPv4 address inside
  if (firstFiveZero && f === 0xffff) return isBlockedIPv4(v4From(g, h));
  // ::a.b.c.d (IPv4-compatible, old): judged as the IPv4 address inside
  if (firstFiveZero && f === 0) return isBlockedIPv4(v4From(g, h));
  // 64:ff9b::/96 (NAT64): judged as the IPv4 address inside
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isBlockedIPv4(v4From(g, h));
  }
  // 64:ff9b:1::/48 (local-use NAT64)
  if (a === 0x64 && b === 0xff9b && c === 1) return true;
  // 2002::/16 (6to4): the IPv4 address is in groups 2 and 3
  if (a === 0x2002) return isBlockedIPv4(v4From(b, c));
  // 2001::/32 (Teredo) and 2001:db8::/32 (documentation)
  if (a === 0x2001 && (b === 0 || b === 0xdb8)) return true;
  // 100::/64 (discard only)
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true;
  // fc00::/7 (unique local), fe80::/10 (link-local), fec0::/10 (site-local)
  if ((a & 0xfe00) === 0xfc00) return true;
  if ((a & 0xffc0) === 0xfe80) return true;
  if ((a & 0xffc0) === 0xfec0) return true;
  // ff00::/8 (multicast)
  if ((a & 0xff00) === 0xff00) return true;
  return false;
}

/**
 * true = do not connect. An address that cannot be understood is blocked too.
 * `address` is an IP literal (v4 or v6, without square brackets).
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address.split('%')[0]);
  if (kind === 4) {
    const value = parseIPv4(address);
    return value === null || isBlockedIPv4(value);
  }
  if (kind === 6) {
    const groups = parseIPv6(address);
    return groups === null || isBlockedIPv6(groups);
  }
  return true;
}

/** true = a host name that means "inside" (localhost, *.internal, ...). */
export function isBlockedHostName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.+$/, '');
  if (BLOCKED_NAMES.has(name)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
