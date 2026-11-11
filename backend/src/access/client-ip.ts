import { isIPv4, isIPv6 } from 'node:net';

/**
 * The key that counts one client. IPv4 stays as it is. A whole IPv6 /64 is one
 * client, because one person normally owns a whole /64 and could otherwise
 * switch between millions of addresses to get around the limit.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const value = ip.trim().toLowerCase().split('%')[0];
  if (value.startsWith('::ffff:') && isIPv4(value.slice(7))) {
    return value.slice(7); // IPv4 written the IPv6 way
  }
  if (!isIPv6(value) || value.includes('.')) return value;

  const [head, tail] = value.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const missing = value.includes('::') ? 8 - first.length - last.length : 0;
  const groups = [...first, ...Array<string>(missing).fill('0'), ...last];
  const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}
