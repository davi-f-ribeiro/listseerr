/**
 * Trakt Schemas
 *
 * Zod schemas for structural validation, typed against domain types.
 * Used by tRPC routers and frontend forms.
 */

import { z } from 'zod';
import type { TraktClientIdPrimitive, TraktConfigPrimitive } from '../../domain/types/trakt.types';

/**
 * Trakt Client ID schema.
 * Validates: 64 hexadecimal characters (lowercase).
 */
export const traktClientIdSchema: z.ZodType<TraktClientIdPrimitive> = z
  .string()
  .min(1, 'Client ID is required')
  .transform((id) => id.trim())
  .refine((id) => /^[0-9a-f]{64}$/.test(id), {
    message:
      'Trakt Client ID must be exactly 64 hexadecimal characters (0-9, a-f). Get your Client ID from https://trakt.tv/oauth/applications',
  });

/**
 * Trakt config schema.
 * Output type matches TraktConfigPrimitive.
 */
export const traktConfigSchema: z.ZodType<TraktConfigPrimitive> = z.object({
  clientId: traktClientIdSchema,
});
