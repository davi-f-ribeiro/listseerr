/**
 * FASE 1.2 — Integração da fronteira Agent/Tool → Skill → adapter → Seerr
 *
 * Diferente dos testes unitários da skill (que mockam o próprio checker)
 * e dos testes do adapter (que não conhecem a skill), este teste exercita a
 * cadeia REAL disponível na arquitetura atual, mockando SOMENTE o ponto de
 * saída de rede — exatamente como http-media-availability-checker.adapter.test.ts
 * faz com spyOn(seerrClient, 'getMediaAvailability'):
 *
 *   fronteira (chamada da skill, como um tool handler faria)
 *     ↓
 *   ListseerrMediaSkill
 *     ↓
 *   HttpMediaAvailabilityChecker (instância real)
 *     ↓
 *   getMediaAvailability (cliente Seerr — único ponto spy, fronteira de rede)
 *
 * Nenhuma camada intermediária é pulada: skill, checker, cache do adapter e
 * conversão de status rodam de verdade. O que se observa na fronteira é sempre
 * um SkillResult<CategorizedMediaItems>: ok:true com data, ou ok:false com
 * SkillError.
 */
import { describe, it, expect, vi, spyOn, beforeEach, afterEach } from 'bun:test';
import { ListseerrMediaSkill } from './listseerr-media.skill';
import { clearAvailabilityCache } from '@/server/infrastructure/services/adapters/http-media-availability-checker.adapter';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import { MediaItemVO } from '@/server/domain/value-objects/media-item.vo';
import { MediaTypeVO } from '@/server/domain/value-objects/media-type.vo';
import * as seerrClient from '@/server/infrastructure/services/external/seerr/client';
import type { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import type { SkillResult } from 'shared/integration/skill';
import type { CategorizedMediaItems } from '@/server/application/services/media-availability-checker.service.interface';

describe('ListseerrMediaSkill — fronteira real (skill → checker → cliente Seerr)', () => {
  const mockConfig = {
    id: 1,
    userId: 1,
    url: { getValue: () => 'http://seerr:5055' },
    externalUrl: null,
    apiKey: { getValue: () => 'test-key' },
    userIdSeerr: { getValue: () => 123 },
    tvSeasons: 'all',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SeerrConfig;

  let getMediaAvailabilitySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // O cache do adapter é module-level (TTL 60s); limpa para isolar cenários.
    clearAvailabilityCache();
    // Único mock da cadeia: a fronteira de rede do cliente Seerr.
    getMediaAvailabilitySpy = spyOn(seerrClient, 'getMediaAvailability');
  });

  afterEach(() => {
    getMediaAvailabilitySpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('sucesso: fronteira devolve SkillResult ok:true com CategorizedMediaItems vindo da cadeia real', async () => {
    // Filme disponível (status 5) e filme não catalogado no Seerr (cliente devolve
    // null no 404 → toBeRequested), mesma convenção do teste do adapter.
    getMediaAvailabilitySpy
      .mockResolvedValueOnce({
        id: 603,
        tmdbId: 603,
        mediaInfo: { id: 603, status: 5, status4k: null, requests: [] },
      } as never)
      .mockResolvedValueOnce(null as never);

    // Instanciação idêntica à do composition root (processing-container)
    const skill = new ListseerrMediaSkill(new LoggerService('availability-checker'));

    const items = [
      MediaItemVO.create({
        title: 'Available Movie',
        year: 2020,
        tmdbId: 603,
        mediaType: MediaTypeVO.movie(),
      }),
      MediaItemVO.create({
        title: 'Unknown Movie',
        year: 2024,
        tmdbId: 999999,
        mediaType: MediaTypeVO.movie(),
      }),
    ];

    const response: SkillResult<CategorizedMediaItems> = await skill.checkMediaAvailabilitySkill(
      items,
      mockConfig
    );

    // Contrato observado na fronteira
    expect(response.ok).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.data).toBeDefined();

    // Dados produzidos pela cadeia real (adapter + cache + conversão de status)
    expect(response.data?.available).toHaveLength(1);
    expect(response.data?.available[0]?.tmdbId).toBe(603);
    expect(response.data?.toBeRequested).toHaveLength(1);
    expect(response.data?.toBeRequested[0]?.tmdbId).toBe(999999);
    expect(response.data?.errored).toHaveLength(0);

    // Prova de que a fronteira passou pelo cliente real do Seerr com o config
    // desmontado corretamente pelo adapter (URL/creds que o cliente usaria na rede)
    expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(2);

    const [firstTmdbId, firstMediaType, firstConfig] = getMediaAvailabilitySpy.mock
      .calls[0] as unknown as [number, MediaTypeVO, Record<string, unknown>];
    expect(firstTmdbId).toBe(603);
    expect(firstMediaType.getValue()).toBe('movie');
    expect(firstConfig['url']).toBe('http://seerr:5055');
    expect(firstConfig['apiKey']).toBe('test-key');
    expect(firstConfig['userIdSeerr']).toBe(123);

    const [secondTmdbId] = getMediaAvailabilitySpy.mock.calls[1] as unknown as [number];
    expect(secondTmdbId).toBe(999999);
  });

  it('falha parcial: erro por item continua ok:true com o item em data.errored (contrato preserva parcial)', async () => {
    // Mesma mensagem que o cliente real produz num 401 do Seerr.
    getMediaAvailabilitySpy.mockRejectedValueOnce(
      new Error('Seerr availability check failed with status 401') as never
    );

    const skill = new ListseerrMediaSkill(new LoggerService('availability-checker'));
    const items = [
      MediaItemVO.create({
        title: 'Failing Movie',
        year: 2019,
        tmdbId: 777,
        mediaType: MediaTypeVO.movie(),
      }),
    ];

    const response = await skill.checkMediaAvailabilitySkill(items, mockConfig);

    expect(response.ok).toBe(true);
    expect(response.data?.errored).toHaveLength(1);
    expect(response.data?.errored[0]?.error).toContain('401');
    expect(getMediaAvailabilitySpy).toHaveBeenCalledTimes(1);
  });

  it('falha catastrófica: fronteira devolve SkillResult ok:false com SkillError (sem lançar exceção ao chamador)', async () => {
    // Rede ainda protegida pelo spy neste cenário (não há chamada, mas garante
    // que nada escapa para a rede mesmo se a cadeia mudar).
    getMediaAvailabilitySpy.mockRejectedValueOnce(new Error('deve ser inalcançável') as never);

    // Config corrompida: url nula quebra a cadeia real dentro do adapter
    // (config.url.getValue()), exatamente como uma falha catastrófica de config
    // chegaria a um tool handler — antes mesmo de qualquer chamada ao cliente.
    const brokenConfig = {
      ...mockConfig,
      url: null,
    } as unknown as SeerrConfig;

    const skill = new ListseerrMediaSkill(new LoggerService('availability-checker'));
    const items = [
      MediaItemVO.create({
        title: 'Any Movie',
        year: 2021,
        tmdbId: 111,
        mediaType: MediaTypeVO.movie(),
      }),
    ];

    const response = await skill.checkMediaAvailabilitySkill(items, brokenConfig);

    expect(response.ok).toBe(false);
    expect(response.data).toBeUndefined();
    expect(response.error?.code).toBeString();
    expect(response.error?.message).toBeString();
    expect(typeof response.error?.retryable).toBe('boolean');
    expect(response.error?.origin).toBeString();
    // A falha catastrófica ocorreu antes da fronteira de rede.
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });
});
