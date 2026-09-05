import type { IMediaListRepository } from '@/server/application/repositories/media-list.repository.interface';
import type { ISeerrConfigRepository } from '@/server/application/repositories/seerr-config.repository.interface';
import type { IExecutionHistoryRepository } from '@/server/application/repositories/execution-history.repository.interface';
import type { IMediaFetcherFactory } from '@/server/application/services/media-fetcher-factory.service.interface';
import type { IListProcessingService } from '@/server/application/services/list-processing.service.interface';
import { ProcessingExecutionMapper } from '@/server/application/mappers/processing-execution.mapper';
import type { RetryPartialProcessingCommand } from 'shared/application/dtos';
import type { ProcessBatchResponse } from 'shared/application/dtos';
import type { ILogger } from '@/server/application/services/core/logger.interface';
import type { IUseCase } from '@/server/application/use-cases/use-case.interface';
import { ProcessingExecution } from '@/server/domain/entities/processing-execution.entity';
import { TriggerTypeVO } from '@/server/domain/value-objects/trigger-type.vo';
import { BatchIdVO } from '@/server/domain/value-objects/batch-id.vo';
import type { ProviderVO } from '@/server/domain/value-objects/provider.vo';
import { MediaListNotFoundError, ExecutionNotFoundError } from 'shared/domain/errors';
import { SeerrNotConfiguredError, ProviderNotConfiguredError } from 'shared/domain/errors';
import type { IMediaFetcher } from '@/server/application/services/media-fetcher.service.interface';
import type { FailedItem } from 'shared/application/dtos';

export class RetryPartialProcessingUseCase implements IUseCase<RetryPartialProcessingCommand, ProcessBatchResponse> {
  constructor(
    private readonly mediaListRepository: IMediaListRepository,
    private readonly seerrConfigRepository: ISeerrConfigRepository,
    private readonly executionHistoryRepository: IExecutionHistoryRepository,
    private readonly mediaFetcherFactory: IMediaFetcherFactory,
    private readonly listProcessingService: IListProcessingService,
    private readonly logger: ILogger,
  ) {}

  async execute(command: RetryPartialProcessingCommand): Promise<ProcessBatchResponse> {
    this.logger.info(
      { executionId: command.executionId },
      'Starting partial retry of failed items',
    );

    const previousExecution = await this.executionHistoryRepository.findById(command.executionId);
    if (!previousExecution) {
      throw new ExecutionNotFoundError(command.executionId);
    }

    if (!previousExecution.failedItems || previousExecution.failedItems.length === 0) {
      this.logger.info(
        { executionId: command.executionId },
        'No failed items to retry',
      );
      return {
        success: true,
        processedLists: 0,
        totalItemsFound: 0,
        itemsRequested: 0,
        itemsFailed: 0,
        itemsSkippedPreviouslyRequested: 0,
        itemsSkippedAvailable: 0,
        executions: [],
      };
    }

    const isValidFailedItem = (item: unknown): item is { item: { tmdbId: number } } => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'item' in item &&
        typeof (item as { item: { tmdbId: number } }).item === 'object' &&
        (item as { item: { tmdbId: number } }).item !== null &&
        'tmdbId' in (item as { item: { tmdbId: number } }).item &&
        typeof (item as { item: { tmdbId: number } }).item.tmdbId === 'number'
      );
    };

    const validFailedItems = (previousExecution.failedItems ?? [])
      .filter(isValidFailedItem)
      .map((f) => f as { item: { tmdbId: number } });

    const list = await this.mediaListRepository.findById(
      previousExecution.listId,
      command.userId,
    );
    if (!list) {
      throw new MediaListNotFoundError(previousExecution.listId);
    }

    const fetcher = await this.createFetcherFor(list.provider, command.userId);

    const seerrConfig = await this.loadSeerrConfig(command.userId);
    if (list.seerrUserIdOverride) {
      seerrConfig.changeSeerrUserId(list.seerrUserIdOverride.getValue());
    }

    this.logger.debug(
      { listId: list.id, provider: list.provider.getValue(), url: list.url.getValue() },
      'Fetching items from provider for retry',
    );
    const allItems = await fetcher.fetchItems(list.url.getValue(), list.maxItems);
    this.logger.info({ itemCount: allItems.length }, 'Items fetched from provider for retry');

    const failedTmdbIds = new Set(
      validFailedItems.map((f) => f.item.tmdbId),
    );
    const itemsToRetry = allItems.filter((item) => failedTmdbIds.has(item.tmdbId));

    this.logger.info(
      {
        totalItems: allItems.length,
        failedInPrevious: previousExecution.failedItems.length,
        validFailedItems: validFailedItems.length,
        itemsToRetry: itemsToRetry.length,
      },
      'Failed items filtered for retry',
    );

    if (itemsToRetry.length === 0) {
      this.logger.info(
        { executionId: command.executionId },
        validFailedItems.length === 0
          ? 'No valid failed items to retry (data corruption detected)'
          : 'No items to retry (all failed items may have been removed from source)',
      );
      return {
        success: true,
        processedLists: 0,
        totalItemsFound: 0,
        itemsRequested: 0,
        itemsFailed: 0,
        itemsSkippedPreviouslyRequested: 0,
        itemsSkippedAvailable: 0,
        executions: [],
      };
    }

    const result = await this.listProcessingService.processItems(itemsToRetry, seerrConfig);

    const triggerType = TriggerTypeVO.create('manual');
    const batchId = BatchIdVO.generate(triggerType);
    const execution = ProcessingExecution.create({
      listId: list.id,
      batchId,
      triggerType,
    });
    const savedExecution = await this.executionHistoryRepository.save(execution);

    savedExecution.markAsSuccess(
      itemsToRetry.length,
      result.successful.length,
      result.failed.length,
      result.available.length,
      result.previouslyRequested.length,
      result.failed.length > 0 ? result.failed : null,
    );
    await this.executionHistoryRepository.save(savedExecution);

    this.logger.info(
      { executionId: savedExecution.id, originalExecutionId: command.executionId },
      'Partial retry completed',
    );

    return {
      success: true,
      processedLists: 1,
      totalItemsFound: itemsToRetry.length,
      itemsRequested: result.successful.length,
      itemsFailed: result.failed.length,
      itemsSkippedPreviouslyRequested: result.previouslyRequested.length,
      itemsSkippedAvailable: result.available.length,
      executions: [ProcessingExecutionMapper.toDTO(savedExecution)],
    };
  }

  private async loadSeerrConfig(userId: number) {
    const config = await this.seerrConfigRepository.findByUserId(userId);
    if (!config) {
      throw new SeerrNotConfiguredError();
    }
    return config;
  }

  private async createFetcherFor(provider: ProviderVO, userId: number): Promise<IMediaFetcher> {
    const fetcher = await this.mediaFetcherFactory.createFetcher(provider, userId);
    if (!fetcher) {
      throw new ProviderNotConfiguredError(provider.getValue());
    }
    return fetcher;
  }
}