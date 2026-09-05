import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { HttpMediaAvailabilityChecker } from './http-media-availability-checker.adapter';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import * as seerrClient from '@/server/infrastructure/services/external/seerr/client';

// Clear cache before each test
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  if (typeof availabilityCache !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access // @ts-expect-error accessing private cache for testing
    availabilityCache.clear();
  }
});

describe('HttpMediaAvailabilityChecker', () => {
  let checker: HttpMediaAvailabilityChecker;
  let logger: LoggerService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getMediaAvailabilitySpy: any;

  beforeEach(() => {
    logger = new LoggerService('test');
    checker = new HttpMediaAvailabilityChecker(logger);
    getMediaAvailabilitySpy = spyOn(seerrClient, 'getMediaAvailability');
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    getMediaAvailabilitySpy.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access // @ts-expect-error accessing private cache for testing
    if (typeof availabilityCache !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access // @ts-expect-error accessing private cache for testing
      availabilityCache.clear();
    }
  });

  describe('N+1 requests problem - cache should reduce calls', () => {
    it('should make only one request per unique item when called multiple times within TTL', async () => {
      const items = [
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }), // Same item
        MediaItemVO.create({ title: 'Movie 2', year: 2021, tmdbId: 2, mediaType: MediaTypeVO.movie() }),
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }), // Same item again
      ];

      const config = {
        id: 1,
        userId: 1,
        url: 'http://seerr:5055',
        externalUrl: null,
        apiKey: 'test-key',
        userIdSeerr: 1,
        tvSeasons: 'first' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock responses - only 2 unique items
      getMediaAvailabilitySpy
        .mockResolvedValueOnce({
          id: 1,
          tmdbId: 1,
          mediaInfo: { id: 1, status: 5, status4k: null, requests: [] }, // AVAILABLE
        })
        .mockResolvedValueOnce({
          id: 2,
          tmdbId: 2,
          mediaInfo: { id: 2, status: 2, status4k: null, requests: [] }, // PENDING
        });

      const result = await checker.checkAndCategorize(items, config);

      // Should still categorize correctly
      expect(result.available).toHaveLength(2); // 2 instances of movie 1 (AVAILABLE)
      expect(result.previouslyRequested).toHaveLength(1); // movie 2 (PENDING)
      expect(result.toBeRequested).toHaveLength(0);
      
      // Should only make 2 requests due to caching (not 4)
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });

    it('should make separate requests after TTL expires', async () => {
      const items = [
        MediaItemVO.create({ title: 'Movie 1', year: 2020, tmdbId: 1, mediaType: MediaTypeVO.movie() }),
      ];

      const config = {
        id: 1,
        userId: 1,
        url: 'http://seerr:5055',
        externalUrl: null,
        apiKey: 'test-key',
        userIdSeerr: 1,
        tvSeasons: 'first' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock first call
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      getMediaAvailabilitySpy.mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 5, status4k: null, requests: [] },
      });

      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(1);

      // Simulate TTL passing by clearing cache manually
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access // @ts-expect-error accessing private cache for testing
      availabilityCache.clear();

      // Mock second call (different status to verify it's a fresh call)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      getMediaAvailabilitySpy.mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 2, status4k: null, requests: [] }, // Now PENDING
      });

      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty items', () => {
    it('should return empty result for empty input', async () => {
      const config = {
        id: 1,
        userId: 1,
        url: 'http://seerr:5055',
        externalUrl: null,
        apiKey: 'test-key',
        userIdSeerr: 1,
        tvSeasons: 'first' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

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

      const config = {
        id: 1,
        userId: 1,
        url: 'http://seerr:5055',
        externalUrl: null,
        apiKey: 'test-key',
        userIdSeerr: 1,
        tvSeasons: 'first' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock one success and one error
      getMediaAvailabilitySpy
        .mockResolvedValueOnce({
          id: 1,
          tmdbId: 1,
          mediaInfo: { id: 1, status: 5, status4k: null, requests: [] }, // AVAILABLE
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
