import type {
  IMediaAvailabilityChecker,
  CategorizedMediaItems,
} from '@/server/application/services/media-availability-checker.service.interface';
import type { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import type { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaAvailabilityVO } from '@/server/domain/value-objects/media-availability.vo';
import { getMediaAvailability } from '@/server/infrastructure/services/external/seerr/client';
import type { ILogger } from '@/server/application/services/core/logger.interface';

export function clearAvailabilityCache() {
  availabilityCache.clear();
}

const CACHE_TTL_MS = 60 * 1000;

const availabilityCache = new Map<
  string,
  { availability: MediaAvailabilityVO; cachedAt: number }
>();

const CONCURRENCY_LIMIT = 5;

export class HttpMediaAvailabilityChecker implements IMediaAvailabilityChecker {
  constructor(private readonly logger: ILogger) {}

  async checkAndCategorize(
    items: MediaItemVO[],
    config: SeerrConfig
  ): Promise<CategorizedMediaItems> {
    const result: CategorizedMediaItems = {
      toBeRequested: [],
      previouslyRequested: [],
      available: [],
      errored: [],
    };

    if (items.length === 0) {
      return result;
    }

    this.logger.info({ totalItems: items.length }, 'Starting media availability check');
    this.logger.debug({ cacheSize: availabilityCache.size }, 'Current cache size');

    const configDTO = {
      id: config.id,
      userId: config.userId,
      url: config.url.getValue(),
      externalUrl: config.externalUrl?.getValue() ?? null,
      apiKey: config.apiKey.getValue(),
      userIdSeerr: config.userIdSeerr.getValue(),
      tvSeasons: config.tvSeasons,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };

    for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
      const chunk = items.slice(i, i + CONCURRENCY_LIMIT);

      const checkPromises = chunk.map((item) => this.checkSingleItemWithCache(item, configDTO));
      const chunkResults = await Promise.allSettled(checkPromises);

      for (let j = 0; j < chunkResults.length; j++) {
        const settledResult = chunkResults[j];
        const item = chunk[j];

        if (!settledResult || !item) {
          continue;
        }

        if (settledResult.status === 'fulfilled') {
          const availability = settledResult.value;

          if (availability.isToBeRequested()) {
            result.toBeRequested.push(item);
          } else if (availability.isPreviouslyRequested()) {
            result.previouslyRequested.push(item);
          } else {
            result.available.push(item);
          }
        } else {
          const errorMsg =
            settledResult.reason instanceof Error
              ? settledResult.reason.message
              : String(settledResult.reason);
          this.logger.warn(
            { tmdbId: item.tmdbId, error: errorMsg },
            'Availability check failed, treating as errored'
          );
          result.errored.push({ item, error: errorMsg });
        }
      }

      if (items.length > CONCURRENCY_LIMIT) {
        const processed = Math.min(i + CONCURRENCY_LIMIT, items.length);
        this.logger.debug({ processed, total: items.length }, 'Availability check progress');
      }
    }

    this.logger.debug({ cacheSize: availabilityCache.size }, 'Cache size after check');
    return result;
  }

  private async checkSingleItem(
    item: MediaItemVO,
    configDTO: {
      id: number;
      userId: number;
      url: string;
      externalUrl: string | null;
      apiKey: string;
      userIdSeerr: number;
      tvSeasons: 'first' | 'all';
      createdAt: Date;
      updatedAt: Date;
    }
  ): Promise<MediaAvailabilityVO> {
    const response = await getMediaAvailability(item.tmdbId, item.mediaType, configDTO);

    const status = response?.mediaInfo?.status ?? null;
    const status4k = response?.mediaInfo?.status4k ?? null;
    const hasRequests = (response?.mediaInfo?.requests?.length ?? 0) > 0;

    return MediaAvailabilityVO.fromCombinedSeerrStatus(status, status4k, hasRequests);
  }

  private async checkSingleItemWithCache(
    item: MediaItemVO,
    configDTO: {
      id: number;
      userId: number;
      url: string;
      externalUrl: string | null;
      apiKey: string;
      userIdSeerr: number;
      tvSeasons: 'first' | 'all';
      createdAt: Date;
      updatedAt: Date;
    }
  ): Promise<MediaAvailabilityVO> {
    const cacheKey = `${item.tmdbId}:${item.mediaType.getValue()}`;
    const now = Date.now();

    const cached = availabilityCache.get(cacheKey);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      this.logger.debug({ tmdbId: item.tmdbId, cacheKey }, 'Cache hit for availability');
      return cached.availability;
    }

    const availability = await this.checkSingleItem(item, configDTO);
    availabilityCache.set(cacheKey, { availability, cachedAt: now });
    this.logger.debug({ tmdbId: item.tmdbId, cacheKey }, 'Cache miss, fetched from Seerr');

    return availability;
  }
}
