import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** A plain `schema.parse` throws a ZodError, which Nest answers as a 500. */
export function parseOr400<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join('; '));
  }

  return result.data;
}
