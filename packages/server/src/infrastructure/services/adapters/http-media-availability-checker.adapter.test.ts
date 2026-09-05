import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import type { Mock } from 'bun:test';
import { HttpMediaAvailabilityChecker } from './http-media-availability-checker.adapter';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import * as seerrClient from '@/server/infrastructure/services/external/seerr/client';
import { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import { SeerrUrlVO } from '@/server/domain/value-objects/seerr-url.vo';
import { SeerrApiKeyVO } from '@/server/domain/value-objects/seerr-api-key.vo';
import { SeerrUserIdVO } from '@/server/domain/value-objects/seerr-user-id.vo';


describe('HttpMediaAvailabilityChecker', () => {
  let checker: HttpMediaAvailabilityChecker;
  let logger: LoggerService;
  let getMediaAvailabilitySpy: Mock;

  const createConfig = (overrides?: Partial<{
    url: string;
    apiKey: string;
    userIdSeerr: number;
  }>): SeerrConfig => {
    return new SeerrConfig({
      id: 1,
      userId: 1,
      url: SeerrUrlVO.create(overrides?.url ?? 'http://seerr:5055'),
      externalUrl: null,
      apiKey: SeerrApiKeyVO.create(overrides?.apiKey ?? 'test-api-key'),
      userIdSeerr: SeerrUserIdVO.create(overrides?.userIdSeerr ?? 1),
      tvSeasons: 'first' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };

  beforeEach(() => {
    logger = new LoggerService('test');
    checker = new HttpMediaAvailabilityChecker(logger);
    getMediaAvailabilitySpy = vi.spyOn(seerrClient, 'getMediaAvailability');
  });

  afterEach(() => {
    (getMediaAvailabilitySpy as import("bun:test").Mock<any>).mockRestore();
  });

  describe('N+1 requests problem - cache should reduce calls', () => {
    it('should make only one request per unique item when called multiple times within TTL', async () => {
      const items = [
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 2', year: 2021, tmdbId: 2, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
      ];

      const config = createConfig();

      getMediaAvailabilitySpy
        .mockResolvedValueOnce({
          id: 1,
          tmdbId: 1,
          mediaInfo: { id: 1, status: 5, status4k: null, requests: [] },
        })
        .mockResolvedValueOnce({
          id: 2,
          tmdbId: 2,
          mediaInfo: { id: 2, status: 2, status4k: null, requests: [] },
        });

      const result = await checker.checkAndCategorize(items, config);

      expect(result.available).toHaveLength(2);
      expect(result.previouslyRequested).toHaveLength(1);
      expect(result.toBeRequested).toHaveLength(0);

      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });

    it('should make separate requests after TTL expires', async () => {
      const items = [
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
      ];

      const config = createConfig();

      (getMediaAvailabilitySpy as import("bun:test").Mock<any>).mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 5, status4k: null, requests: [] },
      });

      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(1);

      // @ts-expect-error — access to private static cache for test isolation
      HttpMediaAvailabilityChecker.availabilityCache?.clear();

      (getMediaAvailabilitySpy as import("bun:test").Mock<any>).mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 2, status4k: null, requests: [] },
      });

      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty items', () => {
    it('should return empty result for empty input', async () => {
      const config = createConfig();

      const result = await checker.checkAndCategorize([], config);

      expect(result.available).toHaveLength(0);
      expect(result.previouslyRequested).toHaveLength(0);
      expect(result.toBeRequested).toHaveLength(0);
      expect(result.errored).toHaveLength(0);
      expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const items = [
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 2', year: 2021, tmdbId: 2, mediaType: MediaTypeVO.movie() }),
      ];

      const config = createConfig();

      getMediaAvailabilitySpy
        .mockResolvedValueOnce({
          id: 1,
          tmdbId: 1,
          mediaInfo: { id: 1, status: 5, status4k: null, requests: [] },
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await checker.checkAndCategorize(items, config);

      expect(result.available).toHaveLength(1);
      expect(result.errored).toHaveLength(1);
      expect(result.errored[0].error).toBe('Network error');
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });
  });
});
