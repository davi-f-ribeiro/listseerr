import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_PATH: z.string().default('./data/listseerr.db'),
    MIGRATIONS_FOLDER: z.string().default('./packages/server/migrations'),
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('debug'),
    ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required for encrypting API keys'),
    TZ: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
    // When true, skips the in-app login. Intended for running behind a trusted
    // reverse proxy that already enforces authentication. The API is
    // unauthenticated either way, so only enable this on a trusted network.
    AUTH_DISABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    // Service-to-service auth for the skill.* tRPC procedures. Fail-closed:
    // unless BOTH are set, every skill.* request is rejected with UNAUTHORIZED.
    // The service user identity comes exclusively from LISTSEERR_SERVICE_USER_ID
    // (server-side), never from caller input.
    LISTSEERR_SERVICE_TOKEN: z.string().min(16).optional(),
    LISTSEERR_SERVICE_USER_ID: z.coerce.number().int().positive().optional(),
  },

  /**
   * What object holds the environment variables at runtime.
   * This is usually `process.env` in Node.js/Bun environments.
   */
  runtimeEnv: process.env,

  /**
   * Makes it so that empty strings are treated as undefined.
   * `PORT=''` becomes `undefined` instead of `''`.
   * Recommended for new projects.
   */
  emptyStringAsUndefined: true,
});
