import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ApiError } from './api-error.js';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Turns every error into the contract shape { error: { code, message } }.
 *
 * Only messages we wrote ourselves (ApiError) are sent back. For anything
 * else the message is replaced by a fixed sentence, because errors from the
 * JSON parser or from libraries can quote the request body, and the body
 * holds the keys. The log line has the status and code only, never a message.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side.';

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else {
      const raw = exception as { status?: unknown; statusCode?: unknown };
      const candidate =
        exception instanceof HttpException
          ? exception.getStatus()
          : (raw?.status ?? raw?.statusCode);
      if (
        typeof candidate === 'number' &&
        candidate >= 400 &&
        candidate < 500
      ) {
        status = candidate;
        if (candidate === 404) {
          code = 'NOT_FOUND';
          message = 'Nothing was found at this address.';
        } else {
          code = 'INVALID_INPUT';
          message = 'The request could not be read. Send valid JSON.';
        }
      }
    }

    if (status >= 500) {
      const name =
        exception instanceof Error ? exception.constructor.name : 'unknown';
      this.logger.error(`${status} ${code} (${name})`);
    }
    response.status(status).json({ error: { code, message } });
  }
}
