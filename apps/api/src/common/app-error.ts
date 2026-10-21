import { HttpException, type HttpStatus } from '@nestjs/common';

/** An error with a stable machine-readable `code`, rendered as `{ code, message, details? }`. */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
