import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from './app-error.js';

/** Validates a request body against a shared zod schema: `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        'validation_failed',
        'Request body is invalid',
        HttpStatus.BAD_REQUEST,
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
