import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { HttpMediaAvailabilityChecker, clearAvailabilityCache } from './http-media-availability-checker.adapter';
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
    userIdSeerr: { getValue: () => 1 },
    tvSeasons: 'first',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    clearAvailabilityCache();
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

      // Simula expiração do cache invalidando-o diretamente,
      // já que o cache é de escopo de módulo (não por instância)
      clearAvailabilityCache();
      await checker.checkAndCategorize(items, config);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);
    });

    it('should reuse cached availability for a duplicate item that crosses a chunk boundary', async () => {
      // CONCURRENCY_LIMIT no adapter é 5, então itens são processados em lotes
      // de 5. Este teste usa 12 itens, com tmdbId 1 aparecendo na posição 1
      // (índice 0, primeiro lote) e novamente na posição 7 (índice 6, segundo
      // lote), forçando a duplicata a cruzar a fronteira entre lotes.
      //
      // Importante: como o adapter processa cada lote com `await
      // Promise.allSettled(...)` antes de iniciar o próximo, o segundo lote só
      // começa depois que o primeiro já terminou por completo — inclusive já
      // tendo populado o `availabilityCache`. Ou seja, este cenário NÃO exercita
      // a deduplicação de requisições em voo (`pendingRequests`), que só entra
      // em jogo para duplicatas DENTRO do mesmo lote (já coberto pelo teste
      // acima). Este teste valida, isso sim, que o cache "normal" (após
      // conclusão) continua funcionando corretamente quando a duplicata está em
      // um lote posterior.
      const uniqueTmdbIds = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const items = [
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }), // índice 0 — posição 1, lote 1
        ...uniqueTmdbIds.slice(0, 4).map((tmdbId) =>
          MediaItemVO.create({
            title: `Movie ${tmdbId}`,
            year: 2020,
            tmdbId,
            mediaType: MediaTypeVO.movie(),
          })
        ), // índices 1-4, completam o lote 1
        ...uniqueTmdbIds.slice(4, 5).map((tmdbId) =>
          MediaItemVO.create({
            title: `Movie ${tmdbId}`,
            year: 2020,
            tmdbId,
            mediaType: MediaTypeVO.movie(),
          })
        ), // índice 5 — abre o lote 2
        MediaItemVO.create({
          title: 'Movie 1',
          year: 2020,
          tmdbId: 1,
          mediaType: MediaTypeVO.movie(),
        }), // índice 6 — posição 7, duplicata no lote 2
        ...uniqueTmdbIds.slice(5).map((tmdbId) =>
          MediaItemVO.create({
            title: `Movie ${tmdbId}`,
            year: 2020,
            tmdbId,
            mediaType: MediaTypeVO.movie(),
          })
        ), // índices 7-11, completam lote 2 e lote 3
      ];

      expect(items).toHaveLength(12);

      const config = createMockConfig();

      getMediaAvailabilitySpy.mockImplementation(async (tmdbId: number) => ({
        id: tmdbId,
        tmdbId,
        mediaInfo: { id: tmdbId, status: 5, status4k: null, requests: [] },
      }));

      const result = await checker.checkAndCategorize(items, config);

      // 12 itens, mas apenas 11 tmdbIds únicos (tmdbId 1 aparece duas vezes)
      expect(result.available).toHaveLength(12);
      expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(11);
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
