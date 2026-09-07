/**
 * skill.router — autenticação de serviço (fail-closed) e fronteira SkillResult.
 *
 * Cobre os 6 casos da matriz de erro aprovada:
 *  1. env vars ausentes → UNAUTHORIZED mesmo com header correto (fail-closed)
 *  2. header ausente → UNAUTHORIZED
 *  3. header incorreto → UNAUTHORIZED
 *  4. token válido + service user válido → SkillResult ok:true pela cadeia real
 *     (spy apenas na fronteira de rede, mesma convenção dos outros 3 arquivos)
 *  5. token válido + service user inexistente → FORBIDDEN explícito, sem fallback
 *  6. token válido + service user sem SeerrConfig → NOT_FOUND explícito,
 *     com a DomainError preservada como cause
 *
 * Nenhum acesso a rede ou a banco real: repositórios são stubs em memória e
 * getMediaAvailability (cliente Seerr) é spied — exatamente como
 * http-media-availability-checker.adapter.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { TRPCError } from '@trpc/server';
import { createSkillRouter, SERVICE_TOKEN_HEADER } from './routers/skill.router';
import type { SkillRouterDeps } from './routers/skill.router';
import { clearAvailabilityCache } from '@/server/infrastructure/services/adapters/http-media-availability-checker.adapter';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import { SeerrConfig } from '@/server/domain/entities/seerr-config.entity';
import { SeerrUrlVO } from '@/server/domain/value-objects/seerr-url.vo';
import { SeerrApiKeyVO } from '@/server/domain/value-objects/seerr-api-key.vo';
import { SeerrUserIdVO } from '@/server/domain/value-objects/seerr-user-id.vo';
import { User } from '@/server/domain/entities/user.entity';
import { UsernameVO } from '@/server/domain/value-objects/username.vo';
import * as seerrClient from '@/server/infrastructure/services/external/seerr/client';
import type { Context } from '@/server/presentation/trpc/context';
import type { ISeerrConfigRepository } from '@/server/application/repositories/seerr-config.repository.interface';
import type { IUserRepository } from '@/server/application/repositories/user.repository.interface';

const SERVICE_TOKEN = 'unit-test-service-token-0123456789';
const SERVICE_USER_ID = 42;

function makeContext(token?: string): Context {
  const headers = new Headers();
  if (token !== undefined) {
    headers.set(SERVICE_TOKEN_HEADER, token);
  }
  // ctx.userId é deliberadamente um valor errado (1, o fallback legado):
  // prova de que a procedure OBEDECE à env var do servidor, não ao contexto.
  return {
    req: new Request('http://localhost/trpc/skill.checkMediaAvailability', { headers }),
    userId: 1,
  };
}

function makeServiceSeerrConfig(): SeerrConfig {
  return new SeerrConfig({
    id: 1,
    userId: SERVICE_USER_ID,
    url: SeerrUrlVO.fromPersistence('http://seerr:5055'),
    externalUrl: null,
    apiKey: SeerrApiKeyVO.fromPersistence('encrypted-payload'),
    userIdSeerr: SeerrUserIdVO.fromPersistence(123),
    tvSeasons: 'all',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeServiceUser(): User {
  return new User({
    id: SERVICE_USER_ID,
    username: UsernameVO.create('service'),
    passwordHash: 'hash',
    createdAt: new Date(),
  });
}

function makeDeps(overrides: Partial<SkillRouterDeps> = {}): SkillRouterDeps {
  const seerrConfigRepository: Partial<ISeerrConfigRepository> = {
    findByUserId: () => Promise.resolve(makeServiceSeerrConfig()),
  };
  const userRepository: Partial<IUserRepository> = {
    findById: (id: number) => Promise.resolve(id === SERVICE_USER_ID ? makeServiceUser() : null),
  };
  return {
    getAuthToken: () => SERVICE_TOKEN,
    getServiceUserId: () => SERVICE_USER_ID,
    seerrConfigRepository: seerrConfigRepository as ISeerrConfigRepository,
    userRepository: userRepository as IUserRepository,
    logger: new LoggerService('test'),
    ...overrides,
  };
}

const sampleInput = {
  items: [{ tmdbId: 603, mediaType: 'movie' as const, title: 'Available Movie', year: 2020 }],
};

describe('skill.router — service auth (fail-closed) + fronteira SkillResult', () => {
  let getMediaAvailabilitySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearAvailabilityCache();
    getMediaAvailabilitySpy = spyOn(seerrClient, 'getMediaAvailability');
  });

  afterEach(() => {
    getMediaAvailabilitySpy.mockRestore();
  });

  it('1. sem env vars configuradas: UNAUTHORIZED mesmo com header correto (fail-closed)', async () => {
    const router = createSkillRouter(
      makeDeps({ getAuthToken: () => undefined, getServiceUserId: () => undefined })
    );
    const caller = router.createCaller(makeContext(SERVICE_TOKEN));

    await expect(caller.checkMediaAvailability(sampleInput)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });

  it('2. header ausente: UNAUTHORIZED', async () => {
    const router = createSkillRouter(makeDeps());
    const caller = router.createCaller(makeContext());

    let thrown: unknown;
    try {
      await caller.checkMediaAvailability(sampleInput);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('UNAUTHORIZED');
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });

  it('3. header incorreto: UNAUTHORIZED (inclusive com mesmo comprimento, via timingSafeEqual)', async () => {
    const router = createSkillRouter(makeDeps());

    // token errado do MESMO comprimento que o correto — só timingSafeEqual
    // distingue; um `===` ingênuo também distinguiria, um beginsWith não.
    const wrongSameLength = 'X'.repeat(SERVICE_TOKEN.length);
    for (const wrong of ['wrong-token', wrongSameLength, SERVICE_TOKEN.slice(0, -1) + 'X']) {
      const caller = router.createCaller(makeContext(wrong));
      await expect(caller.checkMediaAvailability(sampleInput)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    }
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });

  it('4. token válido + service user da env (NÃO o userId=1 do contexto): SkillResult ok:true pela cadeia real', async () => {
    getMediaAvailabilitySpy.mockResolvedValueOnce({
      id: 603,
      tmdbId: 603,
      mediaInfo: { id: 603, status: 5, status4k: null, requests: [] },
    } as never);

    const repoCalls: number[] = [];
    const seerrConfigRepository: Partial<ISeerrConfigRepository> = {
      findByUserId: (userId: number) => {
        repoCalls.push(userId);
        return Promise.resolve(makeServiceSeerrConfig());
      },
    };
    const router = createSkillRouter(
      makeDeps({ seerrConfigRepository: seerrConfigRepository as ISeerrConfigRepository })
    );
    // contexto carrega userId=1 (o fallback legado); a env fixa SERVICE_USER_ID.
    const caller = router.createCaller(makeContext(SERVICE_TOKEN));

    const response = await caller.checkMediaAvailability(sampleInput);

    expect(response.ok).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.data?.available).toHaveLength(1);
    expect(response.data?.available[0]?.tmdbId).toBe(603);
    expect(response.data?.available[0]?.mediaType).toBe('movie');
    expect(response.data?.errored).toHaveLength(0);

    // identidade saiu EXCLUSIVAMENTE da env do servidor, nunca do caller
    expect(repoCalls).toEqual([SERVICE_USER_ID]);

    // o config real do service user chegou ao cliente Seerr spyado
    const [, , configArg] = getMediaAvailabilitySpy.mock.calls[0] as unknown as [
      number,
      unknown,
      Record<string, unknown>,
    ];
    expect(configArg['url']).toBe('http://seerr:5055');
    // apiKey do Seerr NÃO vaza no payload de resposta (saída só tem itens de mídia)
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('encrypted-payload');
    expect(serialized).not.toContain(SERVICE_TOKEN);
  });

  it('5. token válido + service user inexistente no banco: FORBIDDEN explícito, nunca fallback', async () => {
    const router = createSkillRouter(
      makeDeps({
        userRepository: { findById: () => Promise.resolve(null) } as unknown as IUserRepository,
      })
    );
    const caller = router.createCaller(makeContext(SERVICE_TOKEN));

    let thrown: unknown;
    try {
      await caller.checkMediaAvailability(sampleInput);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('FORBIDDEN');
    expect((thrown as TRPCError).message).toContain(String(SERVICE_USER_ID));
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });

  it('6. token válido + service user existente SEM SeerrConfig: NOT_FOUND (mapeamento de DomainError), nunca fallback', async () => {
    const router = createSkillRouter(
      makeDeps({
        seerrConfigRepository: {
          findByUserId: () => Promise.resolve(null)
        } as unknown as ISeerrConfigRepository,
      })
    );
    const caller = router.createCaller(makeContext(SERVICE_TOKEN));

    let thrown: unknown;
    try {
      await caller.checkMediaAvailability(sampleInput);
    } catch (error) {
      thrown = error;
    }
    // NOT_FOUND é explícito no router (a DomainError original vai como cause):
    // o domainErrorMiddleware do contexto NÃO captura throws do corpo da
    // procedure sob tRPC v11 (evidenciado por probe), então o router da
    // fronteira nova define seu próprio contrato de erro.
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe('NOT_FOUND');
    expect((thrown as TRPCError).cause).toBeInstanceOf(Error);
    expect(((thrown as TRPCError).cause as Error).name).toBe('SeerrConfigNotFoundError');
    expect(getMediaAvailabilitySpy).not.toHaveBeenCalled();
  });
});
