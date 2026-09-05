import { describe, it, expect, beforeEach, vi, type Mock } from 'bun:test';
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
import type { MediaList } from '@/server/domain/entities/media-list.entity';
import type { MediaListWithLastProcessed } from '@/server/application/repositories/media-list.repository.interface';
import type { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import type { ProviderVO } from '@/server/domain/value-objects/provider.vo';
import type { IMediaFetcher } from '@/server/application/services/media-fetcher.service.interface';
import type { ListProcessingResult } from '@/server/application/services/list-processing.service.interface';

const createMockMediaListRepository = (): {
  repo: IMediaListRepository;
  findById: Mock<[number, number], Promise<MediaList | null>>;
  findAll: Mock<[number], Promise<MediaList[]>>;
  findAllWithLastProcessed: Mock<[number], Promise<MediaListWithLastProcessed[]>>;
  save: Mock<[MediaList], Promise<MediaList>>;
  delete: Mock<[MediaList], Promise<void>>;
  enableAll: Mock<[number], Promise<void>>;
  exists: Mock<[number, number], Promise<boolean>>;
} => {
  const findById = vi.fn<[number, number], Promise<MediaList | null>>();
  const findAll = vi.fn<[number], Promise<MediaList[]>>();
  const findAllWithLastProcessed = vi.fn<[number], Promise<MediaListWithLastProcessed[]>>();
  const save = vi.fn<[MediaList], Promise<MediaList>>();
  const delete_ = vi.fn<[MediaList], Promise<void>>();
  const enableAll = vi.fn<[number], Promise<void>>();
  const exists = vi.fn<[number, number], Promise<boolean>>();

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
  findByUserId: Mock<[number], Promise<SeerrConfig | null>>;
  save: Mock<[SeerrConfig], Promise<SeerrConfig>>;
  deleteByUserId: Mock<[number], Promise<void>>;
} => {
  const findByUserId = vi.fn<[number], Promise<SeerrConfig | null>>();
  const save = vi.fn<[SeerrConfig], Promise<SeerrConfig>>();
  const deleteByUserId = vi.fn<[number], Promise<void>>();

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
  findById: Mock<[number], Promise<ProcessingExecution | null>>;
  save: Mock<[ProcessingExecution], Promise<ProcessingExecution>>;
  findByListId: Mock<[number, number, number], Promise<ProcessingExecution[]>>;
  findByBatchId: Mock<[string], Promise<ProcessingExecution[]>>;
} => {
  const findById = vi.fn<[number], Promise<ProcessingExecution | null>>();
  const save = vi.fn<[ProcessingExecution], Promise<ProcessingExecution>>();
  const findByListId = vi.fn<[number, number, number], Promise<ProcessingExecution[]>>();
  const findByBatchId = vi.fn<[string], Promise<ProcessingExecution[]>>();

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
  createFetcher: Mock<[ProviderVO, number], Promise<IMediaFetcher | null>>;
} => {
  const createFetcher = vi.fn<[ProviderVO, number], Promise<IMediaFetcher | null>>();

  return {
    factory: { createFetcher },
    createFetcher,
  };
};

const createMockListProcessingService = (): {
  service: IListProcessingService;
  processItems: Mock<[MediaItemVO[], SeerrConfig], Promise<ListProcessingResult>>;
} => {
  const processItems = vi.fn<[MediaItemVO[], SeerrConfig], Promise<ListProcessingResult>>();

  return {
    service: { processItems },
    processItems,
  };
};

const createMockLogger = (): {
  logger: ILogger;
  info: Mock<[string | object, string?], void>;
  error: Mock<[string | object, string?], void>;
  debug: Mock<[string | object, string?], void>;
  warn: Mock<[string | object, string?], void>;
} => {
  const info = vi.fn<[string | object, string?], void>();
  const error = vi.fn<[string | object, string?], void>();
  const debug = vi.fn<[string | object, string?], void>();
  const warn = vi.fn<[string | object, string?], void>();

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
      logger.logger,
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
      executionHistoryRepo.findById = vi.fn<[number], Promise<ProcessingExecution | null>>()
        .mockResolvedValue(null);

      await expect(
        useCase.execute({
          executionId,
          userId,
        }),
      ).rejects.toThrow(ExecutionNotFoundError);
    });

    it('should return success with no items when execution has no failed items', async () => {
      const execution = ProcessingExecution.create({
        listId,
        batchId: BatchIdVO.generate(TriggerTypeVO.create('manual')),
        triggerType: TriggerTypeVO.create('manual'),
      });
      execution.markAsSuccess(10, 8, 0, 2, 0, null);
      executionHistoryRepo.findById = vi.fn<[number], Promise<ProcessingExecution | null>>()
        .mockResolvedValue(execution);

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
      executionHistoryRepo.findById = vi.fn<[number], Promise<ProcessingExecution | null>>()
        .mockResolvedValue(execution);

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
      mediaListRepo.findById = vi.fn<[number, number], Promise<MediaList | null>>()
        .mockResolvedValue(mediaList);
      seerrConfigRepo.findByUserId = vi.fn<[number], Promise<SeerrConfig | null>>()
        .mockResolvedValue(null);
      mediaFetcherFactory.createFetcher = vi.fn<[ProviderVO, number], Promise<IMediaFetcher | null>>()
        .mockResolvedValue({
          fetchItems: vi.fn<[string, number], Promise<MediaItemVO[]>>()
            .mockResolvedValue([
              failedItem.item,
              MediaItemVO.create({
                title: 'Other Movie',
                year: 2024,
                tmdbId: 456,
                mediaType: MediaTypeVO.movie(),
              }),
            ]),
        });

      listProcessingService.processItems = vi.fn<[MediaItemVO[], SeerrConfig], Promise<ListProcessingResult>>()
        .mockResolvedValue({
          successful: [failedItem.item],
          failed: [],
          available: [],
          previouslyRequested: [],
        });

      executionHistoryRepo.save = vi.fn<[ProcessingExecution], Promise<ProcessingExecution>>()
        .mockImplementation((exec) => {
          if ((exec as unknown as { id: number }).id === 0) {
            Object.defineProperty((exec as unknown as { id: number }), 'id', { value: 200, writable: true, configurable: true });
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
      executionHistoryRepo.findById = vi.fn<[number], Promise<ProcessingExecution | null>>()
        .mockResolvedValue(execution);

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

      mediaListRepo.findById = vi.fn<[number, number], Promise<MediaList | null>>()
        .mockResolvedValue(mediaList);
      seerrConfigRepo.findByUserId = vi.fn<[number], Promise<SeerrConfig | null>>()
        .mockResolvedValue(null);
      mediaFetcherFactory.createFetcher = vi.fn<[ProviderVO, number], Promise<IMediaFetcher | null>>()
        .mockResolvedValue({
          fetchItems: vi.fn<[string, number], Promise<MediaItemVO[]>>()
            .mockResolvedValue([failedItem.item]),
        });

      listProcessingService.processItems = vi.fn<[MediaItemVO[], SeerrConfig], Promise<ListProcessingResult>>()
        .mockResolvedValue({
          successful: [failedItem.item],
          failed: [],
          available: [],
          previouslyRequested: [],
        });

      const savedExecutions: ProcessingExecution[] = [];
      executionHistoryRepo.save = vi.fn<[ProcessingExecution], Promise<ProcessingExecution>>()
        .mockImplementation((exec) => {
          if ((exec as unknown as { id: number }).id === 0) {
            Object.defineProperty((exec as unknown as { id: number }), 'id', { value: 200, writable: true, configurable: true });
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
      expect(newExecution.status.isSuccess()).toBe(true);
      expect(newExecution.itemsFound).toBe(1);
      expect(newExecution.itemsRequested).toBe(1);
    });
  });
});
