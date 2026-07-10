import { ZodError } from 'zod';

/**
 * Renders a ZodError as a readable, multi-line message so config/DTO
 * validation failures are actionable in logs instead of a raw stack trace.
 */
export function formatZodError(error: ZodError): string {
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return `Invalid configuration:\n${issues}`;
}
