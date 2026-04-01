import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Sentry }            from '../infra/observability';
import { isSentryEnabled }   from '../infra/observability';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx       = host.switchToHttp();
    const request   = ctx.getRequest<Request>();
    const response  = ctx.getResponse<Response>();
    const requestId = request.headers['x-request-id'] as string | undefined;

    // ── Determine status + message ────────────────────────
    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let code    = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      status  = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string'
        ? body
        : (body as any)?.message ?? exception.message;
      code = this.statusToCode(status);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // ── Log ───────────────────────────────────────────────
    const logMeta = {
      requestId,
      method:  request.method,
      url:     request.url,
      status,
      message,
    };

    if (status >= 500) {
      this.logger.error(`[${code}] ${message}`, JSON.stringify(logMeta));

      // ── Sentry — 500s only ────────────────────────────
      if (isSentryEnabled() && exception instanceof Error) {
        Sentry.withScope(scope => {
          scope.setTag('requestId', requestId ?? 'unknown');
          scope.setTag('method',    request.method);
          scope.setTag('url',       request.url);
          Sentry.captureException(exception);
        });
      }
    } else if (status >= 400) {
      this.logger.warn(`[${code}] ${message}`, JSON.stringify(logMeta));
    }

    // ── Response ─────────────────────────────────────────
    if (response.headersSent) return;

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'UNKNOWN_ERROR';
  }
}
