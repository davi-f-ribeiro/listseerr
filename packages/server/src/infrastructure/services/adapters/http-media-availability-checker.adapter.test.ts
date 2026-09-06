import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { HttpMediaAvailabilityChecker } from './http-media-availability-checker.adapter';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import * as seerrClient from '@/server/infrastructure/services/external/seerr/client';

describe('HttpMediaAvailabilityChecker', () => {
  let checker: HttpMediaAvailabilityChecker;
  let logger: LoggerService;
  let getMediaAvailabilitySpy: any;

  const createMockConfig = (): any => ({
    id: 1,
    userId: 1,
    url: { getValue: () => 'http://seerr:5055' },
    externalUrl: null,
    apiKey: { getValue: () => 'test-key' },
    userIdSeerr: 1,
    tvSeasons: 'first',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    logger = new LoggerService('test');
    checker = new HttpMediaAvailabilityChecker(logger);
    getMediaAvailabilitySpy = spyOn(seerrClient, 'getMediaAvailability');
  });

  afterEach(() => {
    getMediaAvailabilitySpy.mockRestore();
  });

  describe('N+1 requests problem - cache should reduce calls', () => {
    it('should make only one request per unique item when called multiple times within TTL', async () => {
      const items = [
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }),
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }),
        MediaItemVO.create({
          title: 'Movie 2',
          year: 2021,
          tmdbId: 2,
          mediaType: MediaTypeVO.movie(),
        }),
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }),
      ];

      const config = createMockConfig();

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

      expect(result.available).toHaveLength(3);
      expect(result.previouslyRequested).toHaveLength(1);
      expect(result.toBeRequested).toHaveLength(0);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });

    it('should make separate requests after TTL expires', async () => {
      const items = [
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }),
      ];

      const config = createMockConfig();

      getMediaAvailabilitySpy.mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 5, status4k: null, requests: [] },
      });

      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(1);

      getMediaAvailabilitySpy.mockResolvedValueOnce({
        id: 1,
        tmdbId: 1,
        mediaInfo: { id: 1, status: 2, status4k: null, requests: [] },
      });

      // Simula uma nova instância ou chamada após expiração do cache
      const freshChecker = new HttpMediaAvailabilityChecker(logger);
      await freshChecker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty items', () => {
    it('should return empty result for empty input', async () => {
      const config = createMockConfig();

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
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }),
        MediaItemVO.create({
          title: 'Movie 2',
          year: 2021,
          tmdbId: 2,
          mediaType: MediaTypeVO.movie(),
        }),
      ];

      const config = createMockConfig();

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
      expect(result.errored[0]!.error).toBe('Network error');
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });
  });
});
