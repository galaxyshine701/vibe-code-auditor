import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type { AccessConfig } from './access-config.js';
import { AttemptLimiter } from './attempt-limiter.js';
import { clientKey, resolveClientIp } from './client-ip.js';

export const ACCESS_CONFIG = Symbol('ACCESS_CONFIG');
export const ATTEMPT_LIMITER = Symbol('ATTEMPT_LIMITER');
export const CLIENT_IP_HEADER = Symbol('CLIENT_IP_HEADER');
export const ACCESS_HEADER = 'x-access-code';

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

/**
 * Compares two texts without leaking where they differ, and without
 * crashing when the lengths differ: both are hashed to 32 bytes first.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Checks the X-Access-Code header. This method is fully synchronous, so
 * "check the counter, compare, count the failure" can never interleave with
 * another request, even when many arrive at once.
 *
 * A blocked client is refused BEFORE the code is compared. Otherwise the
 * difference between 401 and "success" would let an attacker keep guessing.
 * The code (and whatever was sent) is never logged or put in a message.
 */
@Injectable()
export class AccessCodeGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_CONFIG) private readonly config: AccessConfig,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(CLIENT_IP_HEADER) private readonly ipHeader: string | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.mode === 'open') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const client = clientKey(resolveClientIp(request, this.ipHeader));

    const wait = this.limiter.retryAfterSeconds(client);
    if (wait > 0) {
      http.getResponse<ResponseLike>().setHeader('Retry-After', String(wait));
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many wrong attempts. Try again later.',
      );
    }

    const sent = request.headers[ACCESS_HEADER];
    const correct =
      typeof sent === 'string' && safeEqual(sent, this.config.code);
    if (!correct) {
      // Only a code that was sent and is wrong counts. A missing header does
      // not, so a client that forgot the header cannot lock itself out.
      if (sent !== undefined) this.limiter.recordFailure(client);
      throw new ApiError(401, 'ACCESS_DENIED', 'Access denied.');
    }
    return true;
  }
}
