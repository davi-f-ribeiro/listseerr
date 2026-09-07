# ISSUES — dívidas técnicas conhecidas

Registro de achados que exigem decisão do mantenedor antes da correção.
(Issues do GitHub estão desabilitadas neste repositório — API retorna
`410 Issues has been disabled` — então este arquivo é o registro.)

---

## 2026-09-07 — domainErrorMiddleware inoperante para throws no corpo da procedure (tRPC v11)

**Status:** aberto · **Severidade:** média (contrato de erro do cliente) · **Escopo:** todas as ~11 rotas de `app.router.ts`

### Achado

O `domainErrorMiddleware` em `packages/server/src/presentation/trpc/context.ts`
(linhas ~131–148) nunca captura erros lançados no corpo de procedures, e o
`errorCodeMap` (~30 entradas: `SeerrConfigNotFoundError→NOT_FOUND`,
`UserNotFoundError→NOT_FOUND`, `InvalidCredentialsError→UNAUTHORIZED`, …)
nunca dispara.

### Evidência (probe executado, não inferência)

Router mínimo usando o `publicProcedure` real do contexto, com
`throw new SeerrConfigNotFoundError(42)` no corpo da procedure, chamado via
`router.createCaller(...)`:

- Código observado no caller: `INTERNAL_SERVER_ERROR` (não `NOT_FOUND`).
- O bloco `catch` do `domainErrorMiddleware` nunca executou (sonda de estado
  dentro do catch permaneceu vazia), enquanto uma variante que lança dentro do
  `try` do próprio middleware funciona.

### Causa

No tRPC v11, `await next()` não lança erros da procedure — retorna
`{ ok: false, error }`. O `try/catch` do middleware só veria erros lançados
pelo próprio middleware.

### Impacto

- Pré-existente (anterior ao skill.router; descoberto na sessão de 2026-09).
- DomainErrors viram `INTERNAL_SERVER_ERROR` para o cliente em vez do código
  semântico (NOT_FOUND/FORBIDDEN/…) em ~30 caminhos de ~11 rotas.
- Nenhum teste cobria o caminho antes de `skill.router.test.ts` (primeiro uso
  de `createCaller` na suíte).

### Workaround atual (apenas skill.router)

`skill.router.ts` lança `TRPCError` explícito (`NOT_FOUND`, DomainError
preservada em `cause`) em vez de depender do mapeamento. Coberto pelo caso 6
de `skill.router.test.ts`. Nenhuma outra rota alterada.

### Correção sugerida (a discutir)

Checar o resultado de `next()` em vez de try/catch:

```ts
const result = await next();
if (!result.ok && result.error.cause instanceof DomainError) {
  throw new TRPCError({
    code: errorCodeMap[result.error.cause.name] ?? 'BAD_REQUEST',
    /* … */
  });
}
return result;
```

Muda o código percebido pelo **cliente** em ~30 caminhos (ex.: 500→404).
Auditar o frontend que consome esses códigos antes de aplicar.
