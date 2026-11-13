import { isIP, isIPv4, isIPv6 } from 'node:net';

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

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The address that identifies the client. With no header name it is
 * request.ip, exactly as before. With a header name (for example x-real-ip)
 * the first value of that header is used, but only when it is a real IP
 * address. A missing, empty or unusable header falls back to request.ip.
 */
export function resolveClientIp(
  request: RequestLike,
  headerName: string | null,
): string | undefined {
  if (!headerName) return request.ip;
  const raw = request.headers[headerName];
  const first = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
  if (first && isIP(first) !== 0) return first;
  return request.ip;
}
