# millennium-sync (Brazil worker)

Polls `sync_job` and talks to Millennium from a **Brazilian IP**.

**Guia em português (passo a passo):** [HOW-TO-RUN.md](./HOW-TO-RUN.md)

## Quick start

```bash
cd workers/millennium-sync
cp .env.example .env   # fill SUPABASE_* + ERP_SECRET_KEY
npm install
npm start
```

## Environment

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Bypass RLS for upserts / claim |
| `MILLENNIUM_API_BASE` | yes | e.g. `http://host:6017/api` |
| `ERP_SECRET_KEY` | yes | Decrypt `erp_credential.password_ciphertext` |
| `SYNC_ONBOARDING` | no | O que entra depois do onboarding: `off` nada automático (só o Atualizar manual) · `Nd` N dias contando hoje (`1d` só hoje, `2d` hoje e ontem) · `Nm` N meses contando o atual (`1m` padrão) |
| `DEEP_HISTORY` | no | Histórico antigo na madrugada até a inauguração: `off` (padrão) · `Nm` N meses contando o atual (ex.: `24m`) |
| `CLOSE_HOUR` | no | Hora local (1ª loja) em que começa o fechamento de ontem (janela de 6h). Padrão `3`; `off` desliga |
| `SYNC_LOG_VERBOSE` | no | `1` = mostra cada etapa do sync no terminal |

Ajustes finos com padrão já bom (não precisam estar no `.env`): `POLL_INTERVAL_MS` (5000), `MILLENNIUM_FETCH_TIMEOUT_MS` (300000), `DET_MOV_CONCURRENCY` (5), `STORE_CONCURRENCY` (todas as lojas).

A saída do terminal é só ASCII (sem acento/símbolo), para não quebrar no console do Windows.

Also reads the repo-root `.env` (maps `VITE_SUPABASE_URL` → `SUPABASE_URL` if needed).

## Job kinds

| `sync_job.kind` | Window | Notes |
| --------------- | ------ | ----- |
| `SEED` | hoje | Onboarding (= Atualizar de hoje). Ao terminar enfileira a carga do histórico (`CLOSE` com `fillUntil`), de ontem até o início de `SYNC_ONBOARDING` (`off` = termina sem ir ao ERP) |
| `HISTORY` | 1 mês fechado atrás do mais antigo no banco | Só manual (`scripts/history-months.ts`); na fila é descartado |
| `CLOSE` | ontem (+ anteontem se a noite anterior não fechou) ou 1 dia da carga do histórico | Fechamento: 1×/dia na janela `CLOSE_HOUR`…+6h. Mesmo fluxo do FORCE, dia a dia, relógio em 23:59 do dia; não mexe em "Atualizado às…" |
| `LIGHT` | hoje (calendário da loja) | Cron quando `light_interval_min` venceu |
| `FORCE` | buracos do período no payload + sempre hoje | Botão Atualizar (OWNER/MANAGER, 1×/5 min) |
| `RANGE` | só dias faltantes no payload | Ao expandir o filtro de período |
| `FORCE_LIGHT` | hoje (sem payload) | Compat |

EVENTO whitelist: `S-X`, `S-03`, `S-{COD_FILIAL}` — **sem S-100**.

Concurrency: **one `RUNNING` job per `credential_id`**. Sessão ERP reusada (logout só em Desconectar).

Logs do worker em **português**.

## Related

- Schema: `supabase/migrations/20260922120000_erp_sync_sales.sql`
- Kinds SEED/RANGE/FORCE: `supabase/migrations/20260922150000_sync_job_kinds_seed_range.sql`
- Enqueue Edge: `supabase/functions/erp-sync-enqueue`
- Aggregation: `src/data/wedash/salesAggregate.ts`
