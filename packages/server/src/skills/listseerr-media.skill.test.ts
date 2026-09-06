import { describe, it, expect, vi } from 'bun:test';
import { ListseerrMediaSkill } from './listseerr-media.skill';
import { HttpMediaAvailabilityChecker } from '@/server/infrastructure/services/adapters/http-media-availability-checker.adapter';
import type { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import type { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';

describe('ListseerrMediaSkill', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockConfig = {
    id: 1,
    userId: 1,
    url: { getValue: () => 'http://localhost:8123' },
    externalUrl: null,
    apiKey: { getValue: () => 'test-key' },
    userIdSeerr: { getValue: () => 123 },
    tvSeasons: 'all',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SeerrConfig;

  const mockItems: MediaItemVO[] = [
    { tmdbId: 123, mediaType: { getValue: () => 'movie' } } as any,
  ];

  it('should return ok: true and preserved data on success', async () => {
    const skill = new ListseerrMediaSkill(mockLogger);
    
    // Mock the adapter implementation to avoid real network calls
    const mockResult = {
      toBeRequested: [],
      previouslyRequested: [],
      available: [],
      errored: [],
    };
    
    vi.spyOn(HttpMediaAvailabilityChecker.prototype, 'checkAndCategorize')
      .mockResolvedValue(mockResult);

    const response = await skill.checkMediaAvailabilitySkill(mockItems, mockConfig);

    expect(response.ok).toBe(true);
    expect(response.data).toEqual(mockResult);
    expect(response.error).toBeUndefined();
  });

  it('should return ok: true even if some items errored (partial error)', async () => {
    const skill = new ListseerrMediaSkill(mockLogger);
    
    const mockResultWithPartialErrors = {
      toBeRequested: [],
      previouslyRequested: [],
      available: [],
      errored: [{ item: mockItems[0], error: 'API Timeout for item' }],
    };
    
    vi.spyOn(HttpMediaAvailabilityChecker.prototype, 'checkAndCategorize')
      .mockResolvedValue(mockResultWithPartialErrors);

    const response = await skill.checkMediaAvailabilitySkill(mockItems, mockConfig);

    expect(response.ok).toBe(true);
    expect(response.data?.errored.length).toBe(1);
    expect(response.error).toBeUndefined();
  });

  it('should return ok: false and a SkillError when the entire operation fails', async () => {
    const skill = new ListseerrMediaSkill(mockLogger);
    
    vi.spyOn(HttpMediaAvailabilityChecker.prototype, 'checkAndCategorize')
      .mockRejectedValue(new Error('Network Connection Lost'));

    const response = await skill.checkMediaAvailabilitySkill(mockItems, mockConfig);

    expect(response.ok).toBe(false);
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe('INTERNAL_ERROR');
    expect(response.error?.message).toBe('Network Connection Lost');
    expect(response.error?.origin).toBe('internal');
  });

  it('should map timeout errors to retryable status', async () => {
    const skill = new ListseerrMediaSkill(mockLogger);
    
    vi.spyOn(HttpMediaAvailabilityChecker.prototype, 'checkAndCategorize')
      .mockRejectedValue(new Error('request timeout'));

    const response = await skill.checkMediaAvailabilitySkill(mockItems, mockConfig);

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('UPSTREAM_TIMEOUT');
    expect(response.error?.retryable).toBe(true);
    expect(response.error?.origin).toBe('timeout');
  });

  it('should map auth errors to non-retryable validation status', async () => {
    const skill = new ListseerrMediaSkill(mockLogger);
    
    vi.spyOn(HttpMediaAvailabilityChecker.prototype, 'checkAndCategorize')
      .mockRejectedValue(new Error('401 Unauthorized'));

    const response = await skill.checkMediaAvailabilitySkill(mockItems, mockConfig);

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('INVALID_CONFIG');
    expect(response.error?.retryable).toBe(false);
    expect(response.error?.origin).toBe('upstream');
  });
});
