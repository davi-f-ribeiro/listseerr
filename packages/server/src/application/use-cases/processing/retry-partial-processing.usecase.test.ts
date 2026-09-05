import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ProcessingExecution } from '@/server/domain/entities/processing-execution.entity';
import { TriggerTypeVO } from '@/server/domain/value-objects/trigger-type.vo';
import { BatchIdVO } from '@/server/domain/value-objects/batch-id.vo';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { RetryPartialProcessingUseCase } from '@/server/application/use-cases/processing/retry-partial-processing.usecase';
import { ExecutionNotFoundError } from 'shared/domain/errors';

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
  let _mockMediaListRepository: MockMediaListRepository;
  let _mockSeerrConfigRepository: MockSeerrConfigRepository;
  let _mockExecutionHistoryRepository: MockExecutionHistoryRepository;
  let _mockMediaFetcherFactory: MockMediaFetcherFactory;
  let _mockListProcessingService: MockListProcessingService;
  let _mockLogger: MockLogger;

  beforeEach(() => {
    _mockMediaListRepository = {
      findById: vi.fn(),
    };
    _mockSeerrConfigRepository = {
      findByUserId: vi.fn(),
    };
    _mockExecutionHistoryRepository = {
      findById: vi.fn(),
      save: vi.fn(),
    };
    _mockMediaFetcherFactory = {
      createFetcher: vi.fn(),
    };
    _mockListProcessingService = {
      processItems: vi.fn(),
    };
    _mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    useCase = new RetryPartialProcessingUseCase(
      _mockMediaListRepository,
      _mockSeerrConfigRepository,
      _mockExecutionHistoryRepository,
      _mockMediaFetcherFactory,
      _mockListProcessingService,
      _mockLogger
    );
  });

  describe('execute', () => {
    const userId = 1;
    const listId = 10;
    const executionId = 100;

    const _baseExecution = ProcessingExecution.create({
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
      _mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(null);

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
      _mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

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
      _mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

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

      _mockMediaListRepository.findById = vi.fn().mockResolvedValue(list);
      _mockSeerrConfigRepository.findByUserId = vi.fn().mockResolvedValue({});
      _mockMediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
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

      _mockListProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      _mockExecutionHistoryRepository.save = vi.fn().mockImplementation((exec: ProcessingExecution) => {
        Object.defineProperty(exec, 'id', { value: 200, writable: true });
        return Promise.resolve(exec);
      });

      const result = await useCase.execute({
        executionId,
        userId,
      });

      expect(_mockMediaFetcherFactory.createFetcher).toHaveBeenCalled();
      expect(_mockListProcessingService.processItems).toHaveBeenCalled();
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
      _mockExecutionHistoryRepository.findById = vi.fn().mockResolvedValue(execution);

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

      _mockMediaListRepository.findById = vi.fn().mockResolvedValue(list);
      _mockSeerrConfigRepository.findByUserId = vi.fn().mockResolvedValue({});
      _mockMediaFetcherFactory.createFetcher = vi.fn().mockResolvedValue({
        fetchItems: vi.fn().mockResolvedValue([failedItem.item]),
      });

      _mockListProcessingService.processItems = vi.fn().mockResolvedValue({
        successful: [failedItem.item],
        failed: [],
        available: [],
        previouslyRequested: [],
      });

      const savedExecutions: ProcessingExecution[] = [];
      _mockExecutionHistoryRepository.save = vi.fn().mockImplementation((exec: ProcessingExecution) => {
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