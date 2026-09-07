/**
 * Skill Router — service-to-service boundary for Hermes-Agent (and any
 * programmatic caller holding the service token).
 *
 * Auth model (approved design, fail-closed):
 * - BOTH LISTSEERR_SERVICE_TOKEN and LISTSEERR_SERVICE_USER_ID must be set by
 *   the server operator, otherwise every skill.* call is UNAUTHORIZED.
 * - The caller must send header `x-listseerr-service-token` equal to the
 *   configured token (compared with crypto.timingSafeEqual).
 * - The identity this procedure acts as comes EXCLUSIVELY from the server-side
 *   env var LISTSEERR_SERVICE_USER_ID. userId is never accepted from the
 *   caller (input, query param, header or session cookie are all ignored).
 * - Leaked token ⇒ access to the ONE operator-chosen service account, never
 *   to arbitrary users' SeerrConfig (which contains the Seerr apiKey).
 */
import { timingSafeEqual } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, publicProcedure } from '@/server/presentation/trpc/context';
import { ListseerrMediaSkill } from '@/server/skills/listseerr-media.skill';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import { SeerrConfigNotFoundError } from 'shared/domain/errors';
import type { ISeerrConfigRepository } from '@/server/application/repositories/seerr-config.repository.interface';
import type { IUserRepository } from '@/server/application/repositories/user.repository.interface';
import type { ILogger } from '@/server/application/services/core/logger.interface';
import type { CategorizedMediaItems } from '@/server/application/services/media-availability-checker.service.interface';
import type { SkillResult } from 'shared/integration/skill';

export const SERVICE_TOKEN_HEADER = 'x-listseerr-service-token';

/** Clean wire shape for a media item (no VO internals leak into JSON). */
const mediaItemInputSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string().min(1),
  year: z.number().int().nullable().optional(),
});

type MediaItemInput = z.infer<typeof mediaItemInputSchema>;

interface MediaItemDTO {
  title: string;
  year: number | null;
  tmdbId: number;
  mediaType: string;
}

interface CategorizedMediaItemsDTO {
  toBeRequested: MediaItemDTO[];
  previouslyRequested: MediaItemDTO[];
  available: MediaItemDTO[];
  errored: Array<{ item: MediaItemDTO; error: string }>;
}

export interface SkillRouterDeps {
  /** Reads LISTSEERR_SERVICE_TOKEN at call time (injected for testability). */
  getAuthToken: () => string | undefined;
  /** Reads LISTSEERR_SERVICE_USER_ID — the ONLY identity skill.* can act as. */
  getServiceUserId: () => number | undefined;
  seerrConfigRepository: ISeerrConfigRepository;
  userRepository: IUserRepository;
  logger: ILogger;
}

function tokensMatch(provided: string | null, configured: string): boolean {
  if (!provided) {
    return false;
  }
  const providedBytes = Buffer.from(provided, 'utf8');
  const configuredBytes = Buffer.from(configured, 'utf8');
  if (providedBytes.length !== configuredBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, configuredBytes);
}

function toMediaItemDTO(item: MediaItemVO): MediaItemDTO {
  return {
    title: item.title,
    year: item.year,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType.getValue(),
  };
}

function toCategorizedDTO(result: CategorizedMediaItems): CategorizedMediaItemsDTO {
  return {
    toBeRequested: result.toBeRequested.map(toMediaItemDTO),
    previouslyRequested: result.previouslyRequested.map(toMediaItemDTO),
    available: result.available.map(toMediaItemDTO),
    errored: result.errored.map(({ item, error }) => ({ item: toMediaItemDTO(item), error })),
  };
}

export function createSkillRouter(deps: SkillRouterDeps) {
  const skill = new ListseerrMediaSkill(deps.logger);

  // Reuses publicProcedure so DomainError→TRPCError mapping stays intact;
  // adds service auth on top. This middleware NEVER reads ctx.userId:
  // the legacy cookie-session identity (including its userId=1 fallback)
  // has no effect on skill.* procedures.
  const serviceProcedure = publicProcedure.use(async ({ ctx, next }) => {
    const configuredToken = deps.getAuthToken();
    const serviceUserId = deps.getServiceUserId();

    // 1. Fail-closed: feature does not exist unless BOTH env vars are set.
    if (!configuredToken || serviceUserId === undefined) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Skill API is disabled (server not configured for service auth)',
      });
    }

    // 2. Token check, constant-time.
    const providedToken = ctx.req.headers.get(SERVICE_TOKEN_HEADER);
    if (!tokensMatch(providedToken, configuredToken)) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid service token' });
    }

    return next();
  });

  return router({
    checkMediaAvailability: serviceProcedure
      .input(z.object({ items: z.array(mediaItemInputSchema).min(1) }))
      .mutation(async ({ input }): Promise<SkillResult<CategorizedMediaItemsDTO>> => {
        const serviceUserId = deps.getServiceUserId();
        // Re-checked defensively: identity only ever comes from server env.
        if (serviceUserId === undefined) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Skill API is disabled (server not configured for service auth)',
          });
        }

        // Operator-fixed identity must exist; explicit error, never a fallback.
        const serviceUser = await deps.userRepository.findById(serviceUserId);
        if (!serviceUser) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Service user ${serviceUserId} is not provisioned`,
          });
        }

        // Scope: ONLY the service user's own Seerr config is ever read.
        const seerrConfig = await deps.seerrConfigRepository.findByUserId(serviceUserId);
        if (!seerrConfig) {
          // Explicit NOT_FOUND with the domain error preserved as cause: the
          // context's domainErrorMiddleware cannot catch procedure-body throws
          // under tRPC v11 (next() returns {ok:false} instead of throwing), so
          // relying on errorCodeMap here would surface INTERNAL_SERVER_ERROR.
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Seerr configuration not found for service user ${serviceUserId}`,
            cause: new SeerrConfigNotFoundError(serviceUserId),
          });
        }

        const items: MediaItemVO[] = input.items.map((item: MediaItemInput) =>
          MediaItemVO.create({
            title: item.title,
            year: item.year ?? null,
            tmdbId: item.tmdbId,
            mediaType: MediaTypeVO.create(item.mediaType),
          })
        );

        const result = await skill.checkMediaAvailabilitySkill(items, seerrConfig);

        if (result.ok && result.data) {
          return { ok: true, data: toCategorizedDTO(result.data), meta: result.meta };
        }
        if (!result.ok && result.error) {
          return { ok: false, error: result.error, meta: result.meta };
        }
        // Should be unreachable given SkillResult contract; fail loudly, not silently.
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Skill returned a malformed SkillResult',
        });
      }),
  });
}
