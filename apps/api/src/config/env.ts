import { z } from 'zod';

const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:8081'),
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),
    DEV_BYPASS_AUTH: z.enum(['true', 'false']).default('false'),
    DEFAULT_DEV_CLERK_USER_ID: z.string().default('dev_clerk_user'),
    CLERK_SECRET_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_MONTHLY: z.string().optional(),
    STRIPE_PRICE_ID_YEARLY: z.string().optional(),
    MUX_TOKEN_ID: z.string().optional(),
    MUX_TOKEN_SECRET: z.string().optional(),
    DIAZ_INTERNAL_API_KEY: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.DEV_BYPASS_AUTH === 'false' && !value.CLERK_SECRET_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLERK_SECRET_KEY'],
        message: 'required when DEV_BYPASS_AUTH=false',
      });
    }

    if (value.STRIPE_SECRET_KEY && !value.STRIPE_PRICE_ID_MONTHLY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_PRICE_ID_MONTHLY'],
        message: 'required when STRIPE_SECRET_KEY is set',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function validateApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment variables: ${details}`);
  }

  return parsed.data;
}
