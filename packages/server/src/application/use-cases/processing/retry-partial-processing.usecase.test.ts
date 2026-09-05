import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ProcessingExecution } from '@/server/domain/entities/processing-execution.entity';
import { TriggerTypeVO } from '@/server/domain/value-objects/trigger-type.vo';
import { BatchIdVO } from '@/server/domain/value-objects/batch-id.vo';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { RetryPartialProcessingUseCase } from '@/server/application/use-cases/processing/retry-partial-processing.usecase';
import { ExecutionNotFoundError } from 'shared/domain/errors';
import type { IMediaListRepository } from '@/server/application/repositories/media-list.repository.interface';
import type { ISeerrConfigRepository } from '@/server/application/repositories/seerr-config.repository.interface';
import type { IExecutionHistoryRepository } from '@/server/application/repositories/execution-history.repository.interface';
import type { IMediaFetcherFactory } from '@/server/application/services/media-fetcher-factory.service.interface';
import type { IListProcessingService } from '@/server/application/services/list-processing.service.interface';
import type { ILogger } from '@/server/application/services/core/logger.interface';

// Mock types
type MockMediaListRepository = {
  findById: (id: number, userId: number) => Promise<unknown>;
};

type MockSeerrConfigRepository = {
  findByUserId: (userId: number) => Promise<unknown>;
};

type MockExecutionHistoryRepository = {
  findById: (id: number) => Promise<unknown>;
  save: (exec: ProcessingExecution) => Promise<ProcessingExecution>;
};

type MockMediaFetcherFactory = {
  createFetcher: (provider: unknown, userId: number) => Promise<unknown>;
};

type MockListProcessingService = {
  processItems: (items: MediaItemVO[], config: unknown) => Promise<unknown>;
};

type MockLogger = {
  info: (data: unknown, message: string) => void;
  debug: (data: unknown, message: string) => void;
  error: (data: unknown, message: string) => void;
  warn: (data: unknown, message: string) => void;
};

describe('RetryPartialProcessingUseCase', () => {
  let useCase: RetryPartialProcessingUseCase;
  let mockMediaListRepository: MockMediaListRepository;
  let mockSeerrConfigRepository: MockSeerrConfigRepository;
  let mockExecutionHistoryRepository: MockExecutionHistoryRepository;
  let mockMediaFetcherFactory: MockMediaFetcherFactory;
  let mockListProcessingService: MockListProcessingService;
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockMediaListRepository = {
      findById: vi.fn(),
    };
    mockSeerrConfigRepository = {
      findByUserId: vi.fn(),
    };
    mockExecutionHistoryRepository = {
      findById: vi.fn(),
      save: vi.fn(),
    };
    mockMediaFetcherFactory = {
      createFetcher: vi.fn(),
    };
    mockListProcessingService = {
      processItems: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    useCase = new RetryPartialProcessingUseCase(
      mockMediaListRepository,
      mockSeerrConfigRepository,
      mockExecutionHistoryRepository,
      mockMediaFetcherFactory,
      mockListProcessingService,
      mockLogger
    );
  });

  describe('execute', () => {
    const userId = 1;
    const listId = 10;
    const executionId = 100;

    const baseExecution = ProcessingExecution.create({
      listId,
      batchId: BatchIdVO.generate(TriggerTypeVO.create('manual')),
      triggerType: TriggerTypeVO.create('manual'),
    });

    const failedItem: { item: MediaItemVO; error: string } = {
      item: MediaItemVO.create({
        title: 'Test Movie',
        tmdbId: 123,
        type: 'movie',
        releaseDate: new Date('2024-01-01'),
      }),
      error: 'Network error',
    };

    it('should throw ExecutionNotFoundError when execution does not exist', () => {
      mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(null);

      expect(() =>
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
      mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

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
      mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

      const list = {
        id: listId,
        provider: { getValue: () => 'stevenlu' },
        url: { getValue: () => 'http://example.com' },
        maxItems: 50,
        userId,
        enabled: true,
        seerrUserIdOverride: null,
        name: 'Test List',
        displayUrl: null,
      };

      mockMediaListRepository.findById = vi.fn().mockResolvedValue(list);
      mockSeerrConfigRepository.findByUserId = vi.fn().mockResolvedValue({});
      mockMediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
        fetchItems: vi.fn().mockResolvedValue([
          failedItem.item,
          MediaItemVO.create({
            title: 'Other Movie',
            tmdbId: 456,
            type: 'movie',
            releaseDate: new Date('2024-01-01'),
          }),
        ]),
      });

      mockListProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      mockExecutionHistoryRepository.save = vi.fn().mockImplementation((exec: ProcessingExecution) => {
        Object.defineProperty(exec, 'id', { value: 200, writable: true });
        return Promise.resolve(exec);
      });

      const result = await useCase.execute({
        executionId,
        userId,
      });

      expect(mockMediaFetcherFactory.createFetcher).toHaveBeenCalled();
      expect(mockListProcessingService.processItems).toHaveBeenCalled();
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
      mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

      const list = {
        id: listId,
        provider: { getValue: () => 'stevenlu' },
        url: { getValue: () => 'http://example.com' },
        maxItems: 50,
        userId,
        enabled: true,
        seerrUserIdOverride: null,
        name: 'Test List',
        displayUrl: null,
      };

      mockMediaListRepository.findById = vi.fn().mockResolvedValue(list);
      mockSeerrConfigRepository.findByUserId = vi.fn().mockResolvedValue({});
      mockMediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
        fetchItems: vi.fn().mockResolvedValue([failedItem.item]),
      });

      mockListProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      const savedExecutions: ProcessingExecution[] = [];
      mockExecutionHistoryRepository.save = vi.fn().mockImplementation((exec: ProcessingExecution) => {
        Object.defineProperty(exec, 'id', { value: 200, writable: true });
        if (exec.id === 0) {
          savedExecutions.push(exec);
        } else {
          savedExecutions.push(exec);
        }
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
