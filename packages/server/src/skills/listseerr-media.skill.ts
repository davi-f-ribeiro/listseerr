import { 
  HttpMediaAvailabilityChecker 
} from '@/server/infrastructure/services/adapters/http-media-availability-checker.adapter';
import type { 
  CategorizedMediaItems 
} from '@/server/application/services/media-availability-checker.service.interface';
import type { 
  MediaItemVO 
} from '@/server/domain/value-objects/media-item.vo';
import type { 
  SeerrConfig 
} from '@/server/domain/entities/seerr-config.entity';
import type { 
  SkillResult, 
  SkillError 
} from 'shared/src/integration/skill.types';
import type { ILogger } from '@/server/application/services/core/logger.interface';

export class ListseerrMediaSkill {
  constructor(private readonly logger: ILogger) {}

  /**
   * Wrapper for checking media availability.
   * Ensures that the result follows the SkillResult contract.
   */
  async checkMediaAvailabilitySkill(
    items: MediaItemVO[],
    config: SeerrConfig
  ): Promise<SkillResult<CategorizedMediaItems>> {
    try {
      // The checker itself handles partial item failures via data.errored.
      // Only catastrophic failures (config, network total loss) reach the catch block.
      const checker = new HttpMediaAvailabilityChecker(this.logger);
      const result = await checker.checkAndCategorize(items, config);

      return {
        ok: true,
        data: result
      };
    } catch (error: any) {
      this.logger.error({ error }, 'Skill error occurred while checking media availability');

      return {
        ok: false,
        error: this.mapErrorToSkillError(error)
      };
    }
  }

  private mapErrorToSkillError(error: any): SkillError {
    // If the error is already a known domain error, we can use its properties.
    // Otherwise, we map generic JS errors to the contract.
    
    const message = error instanceof Error ? error.message : String(error);
    
    // Simple heuristic for origin and retryable based on common error patterns
    // since the project doesn't have a global error taxonomy yet.
    let origin: SkillError['origin'] = 'internal';
    let retryable = false;
    let code = 'INTERNAL_ERROR';

    if (message.toLowerCase().includes('timeout')) {
      origin = 'timeout';
      retryable = true;
      code = 'UPSTREAM_TIMEOUT';
    } else if (message.toLowerCase().includes('401') || message.toLowerCase().includes('403')) {
      origin = 'upstream';
      retryable = false;
      code = 'INVALID_CONFIG';
    } else if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('validation')) {
      origin = 'validation';
      retryable = false;
      code = 'VALIDATION_ERROR';
    }

    return {
      code,
      message,
      retryable,
      origin
    };
  }
}
