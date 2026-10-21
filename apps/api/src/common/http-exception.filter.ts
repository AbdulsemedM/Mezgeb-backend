import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error.js';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
  503: 'service_unavailable',
};

/** Renders every error as `{ code, message, details? }` (CLAUDE.md conventions). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toBody(exception);
    if (status >= 500 && !(exception instanceof AppError)) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      const body: ErrorBody = { code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return { status: exception.getStatus(), body };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: { code: CODE_BY_STATUS[status] ?? `http_${status}`, message: exception.message },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'internal_error', message: 'Internal server error' },
    };
  }
}
