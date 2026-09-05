import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ProcessingExecution } from '@/server/domain/entities/processing-execution.entity';
import { TriggerTypeVO } from '@/server/domain/value-objects/trigger-type.vo';
import { BatchIdVO } from '@/server/domain/value-objects/batch-id.vo';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import { RetryPartialProcessingUseCase } from '@/server/application/use-cases/processing/retry-partial-processing.usecase';
import { ExecutionNotFoundError } from 'shared/domain/errors';
import type { IMediaListRepository } from '@/server/application/repositories/media-list.repository.interface';
import type { ISeerrConfigRepository } from '@/server/application/repositories/seerr-config.repository.interface';
import type { IExecutionHistoryRepository } from '@/server/application/repositories/execution-history.repository.interface';
import type { IMediaFetcherFactory } from '@/server/application/services/media-fetcher-factory.service.interface';
import type { IListProcessingService } from '@/server/application/services/list-processing.service.interface';
import type { ILogger } from '@/server/application/services/core/logger.interface';
import { MediaList } from '@/server/domain/entities/media-list.entity';
import type { MediaListWithLastProcessed } from '@/server/application/repositories/media-list.repository.interface';
import type { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import type { ProviderVO } from '@/server/domain/value-objects/provider.vo';
import type { IMediaFetcher } from '@/server/application/services/media-fetcher.service.interface';
import type { ListProcessingResult } from '@/server/application/services/list-processing.service.interface';

const createMockMediaListRepository = (): {
  repo: IMediaListRepository;
  findById: any;
  findAll: any;
  findAllWithLastProcessed: any;
  save: any;
  delete: any;
  enableAll: any;
  exists: any;
} => {
  const findById = vi.fn();
  const findAll = vi.fn();
  const findAllWithLastProcessed = vi.fn();
  const save = vi.fn();
  const delete_ = vi.fn();
  const enableAll = vi.fn();
  const exists = vi.fn();

  return {
    repo: {
      findById,
      findAll,
      findAllWithLastProcessed,
      save,
      delete: delete_,
      enableAll,
      exists,
    },
    findById,
    findAll,
    findAllWithLastProcessed,
    save,
    delete: delete_,
    enableAll,
    exists,
  };
};

const createMockSeerrConfigRepository = (): {
  repo: ISeerrConfigRepository;
  findByUserId: any;
  save: any;
  deleteByUserId: any;
} => {
  const findByUserId = vi.fn();
  const save = vi.fn();
  const deleteByUserId = vi.fn();

  return {
    repo: {
      findByUserId,
      save,
      deleteByUserId,
    },
    findByUserId,
    save,
    deleteByUserId,
  };
};

const createMockExecutionHistoryRepository = (): {
  repo: IExecutionHistoryRepository;
  findById: any;
  save: any;
  findByListId: any;
  findByBatchId: any;
} => {
  const findById = vi.fn();
  const save = vi.fn();
  const findByListId = vi.fn();
  const findByBatchId = vi.fn();

  return {
    repo: {
      findById,
      save,
      findByListId,
      findByBatchId,
    },
    findById,
    save,
    findByListId,
    findByBatchId,
  };
};

const createMockMediaFetcherFactory = (): {
  factory: IMediaFetcherFactory;
  createFetcher: any;
} => {
  const createFetcher = vi.fn();

  return {
    factory: { createFetcher },
    createFetcher,
  };
};

const createMockListProcessingService = (): {
  service: IListProcessingService;
  processItems: any;
} => {
  const processItems = vi.fn();

  return {
    service: { processItems },
    processItems,
  };
};

const createMockLogger = (): {
  logger: ILogger;
  info: any;
  error: any;
  debug: any;
  warn: any;
} => {
  const info = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const warn = vi.fn();

  return {
    logger: { info, error, debug, warn },
    info,
    error,
    debug,
    warn,
  };
};

describe('RetryPartialProcessingUseCase', () => {
  let useCase: RetryPartialProcessingUseCase;
  let mediaListRepo: ReturnType<typeof createMockMediaListRepository>;
  let seerrConfigRepo: ReturnType<typeof createMockSeerrConfigRepository>;
  let executionHistoryRepo: ReturnType<typeof createMockExecutionHistoryRepository>;
  let mediaFetcherFactory: ReturnType<typeof createMockMediaFetcherFactory>;
  let listProcessingService: ReturnType<typeof createMockListProcessingService>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mediaListRepo = createMockMediaListRepository();
    seerrConfigRepo = createMockSeerrConfigRepository();
    executionHistoryRepo = createMockExecutionHistoryRepository();
    mediaFetcherFactory = createMockMediaFetcherFactory();
    listProcessingService = createMockListProcessingService();
    logger = createMockLogger();

    useCase = new RetryPartialProcessingUseCase(
      mediaListRepo.repo,
      seerrConfigRepo.repo,
      executionHistoryRepo.repo,
      mediaFetcherFactory.factory,
      listProcessingService.service,
      logger.logger
    );
  });

  describe('execute', () => {
    const userId = 1;
    const listId = 10;
    const executionId = 100;

    const failedItem = {
      item: MediaItemVO.create({
        title: 'Test Movie',
        year: 2020,
        tmdbId: 123,
        mediaType: MediaTypeVO.movie(),
      }),
      error: 'Network error',
    };

    it('should throw ExecutionNotFoundError when execution does not exist', async () => {
      executionHistoryRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        useCase.execute({
          executionId,
          userId,
        })
      ).rejects.toThrow(ExecutionNotFoundError);
    });

    it('should return success with no items when execution has no failed items', async () => {
      const execution = ProcessingExecution.create({
        listId,
        batchId: BatchIdVO.generate(TriggerTypeVO.create('manual')),
        triggerType: TriggerTypeVO.create('manual'),
      });
      execution.markAsSuccess(10, 8, 0, 2, 0, null);
      executionHistoryRepo.findById = vi.fn().mockResolvedValue(execution);

      const result = await useCase.execute({
        executionId,
        userId,
      });

      expect(result.success).toBe(true);
      expect(result.processedLists).toBe(0);
      expect(result.totalItemsFound).toBe(0);
      expect(result.itemsRequested).toBe(0);
      expect(result.itemsFailed).toBe(0);
    });

    it('should fetch items and retry failed items when execution has failed items', async () => {
      const execution = ProcessingExecution.create({
        listId,
        batchId: BatchIdVO.generate(TriggerTypeVO.create('manual')),
        triggerType: TriggerTypeVO.create('manual'),
      });
      execution.markAsSuccess(10, 8, 2, 0, 0, [failedItem]);
      executionHistoryRepo.findById = vi.fn().mockResolvedValue(execution);

      const mediaList = MediaList.create({
        userId,
        name: 'Test List',
        url: 'http://example.com',
        displayUrl: '',
        provider: 'stevenlu',
        enabled: true,
        maxItems: 50,
        seerrUserIdOverride: null,
      });
      mediaListRepo.findById = vi.fn().mockResolvedValue(mediaList);
      seerrConfigRepo.findByUserId = vi.fn().mockResolvedValue(null);
      mediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
        fetchItems: vi.fn().mockResolvedValue([
          failedItem.item,
          MediaItemVO.create({
            title: 'Other Movie',
            year: 2024,
            tmdbId: 456,
            mediaType: MediaTypeVO.movie(),
          }),
        ]),
      });

      listProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      executionHistoryRepo.save = vi.fn().mockImplementation((exec) => {
        if ((exec as unknown as { id: number }).id === 0) {
          Object.defineProperty(exec as unknown as { id: number }, 'id', {
            value: 200,
            writable: true,
            configurable: true,
          });
        }
        return Promise.resolve(exec);
      });

      const result = await useCase.execute({
        executionId,
        userId,
      });

      expect(mediaFetcherFactory.createFetcher).toHaveBeenCalled();
      expect(listProcessingService.processItems).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.processedLists).toBe(1);
      expect(result.itemsRequested).toBe(1);
    });

    it('should create new execution with retry status', async () => {
      const execution = ProcessingExecution.create({
        listId,
        batchId: BatchIdVO.generate(TriggerTypeVO.create('manual')),
        triggerType: TriggerTypeVO.create('manual'),
      });
      execution.markAsSuccess(10, 8, 2, 0, 0, [failedItem]);
      executionHistoryRepo.findById = vi.fn().mockResolvedValue(execution);

      const mediaList = MediaList.create({
        userId,
        name: 'Test List',
        url: 'http://example.com',
        displayUrl: '',
        provider: 'stevenlu',
        enabled: true,
        maxItems: 50,
        seerrUserIdOverride: null,
      });

      mediaListRepo.findById = vi.fn().mockResolvedValue(mediaList);
      seerrConfigRepo.findByUserId = vi.fn().mockResolvedValue(null);
      mediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
        fetchItems: vi.fn().mockResolvedValue([failedItem.item]),
      });

      listProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      const savedExecutions: ProcessingExecution[] = [];
      executionHistoryRepo.save = vi.fn().mockImplementation((exec) => {
        if ((exec as unknown as { id: number }).id === 0) {
          Object.defineProperty(exec as unknown as { id: number }, 'id', {
            value: 200,
            writable: true,
            configurable: true,
          });
        }
        savedExecutions.push(exec);
        return Promise.resolve(exec);
      });

      await useCase.execute({
        executionId,
        userId,
      });

      expect(savedExecutions.length).toBeGreaterThan(0);
      const newExecution = savedExecutions[savedExecutions.length - 1];
      expect(newExecution!.status.isSuccess()).toBe(true);
      expect(newExecution!.itemsFound).toBe(1);
      expect(newExecution!.itemsRequested).toBe(1);
    });
  });
});
