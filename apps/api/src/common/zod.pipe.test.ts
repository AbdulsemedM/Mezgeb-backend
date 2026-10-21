import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { ZodValidationPipe } from './zod.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ a: z.string(), b: z.object({ c: z.number() }) }));

  it('returns parsed data', () => {
    expect(pipe.transform({ a: 'x', b: { c: 1 } })).toEqual({ a: 'x', b: { c: 1 } });
  });

  it('throws validation_failed with a path per issue', () => {
    try {
      pipe.transform({ a: 1, b: { c: 'no' } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe('validation_failed');
      expect(e.getStatus()).toBe(400);
      expect((e.details as { path: string }[]).map((d) => d.path)).toEqual(['a', 'b.c']);
    }
  });
});
