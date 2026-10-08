/**
 * Liga a venda a vendedora do cadastro (FUNCIONARIO no Millennium).
 * 1 pelo codigo de gerador (relatorio de cupom {52DE7BBC})  -  trocar o nome no ERP nao mexe na meta/historico.
 * Reserva pelo nome (VENDEDOR_MILLENNIUM da Lista): relatorio indisponivel ou cadastro sem gerador ainda.
 * `nameKeys` = todos os nomes (normalizados) ja vistos para a funcionaria  -  o antigo continua resolvendo.
 * Sincroniza a loja so quando aparece vendedora que nao esta no cadastro (status Ativo/Inativo = botao
 * Atualizar do card da equipe). Na sincronizacao do job, quem ja tem gerador salvo e o mesmo cargo nao e
 * consultado de novo. O cadastro guarda todos os funcionarios da loja (gerencia inclusive), entao venda de
 * gerente/freelancer resolve para o funcionario e nao dispara sincronizacao nem aviso.
 */
import { sellerKeyFromName } from "../../../src/data/wedash/salesAggregate.ts";
import type { SalesSellerDayAgg } from "../../../src/data/wedash/salesTypes.ts";
import type { ErpSeller } from "./millenniumSellers.ts";

export type KnownSeller = {
  storeId: string;
  employeeId: number;
  nameKeys: string[];
  geradorId?: number | null;
  /** CARGO salvo (null = ainda sem cargo). */
  role?: string | null;
};

export type SellerResolution = { employeeId: number } | { ambiguous: true } | null;

/** Vendedora que seguiu sem cadastro apos sincronizar nao re-dispara a sincronizacao por 24h. */
export const SELLER_RESYNC_MS = 24 * 60 * 60 * 1000;

function pickEmployee(hits: KnownSeller[], storeId: string): SellerResolution {
  if (hits.length === 0) return null;
  const local = hits.filter((s) => s.storeId === storeId);
  const pool = local.length > 0 ? local : hits;
  const ids = new Set(pool.map((s) => s.employeeId));
  return ids.size === 1 ? { employeeId: pool[0]!.employeeId } : { ambiguous: true };
}

/** Prefere a loja da venda; senao qualquer loja do tenant (vendedora cobrindo outra filial). */
export function resolveSellerKey(sellers: KnownSeller[], storeId: string, key: string): SellerResolution {
  return pickEmployee(
    sellers.filter((s) => s.nameKeys.includes(key)),
    storeId,
  );
}

export function resolveSellerGerador(sellers: KnownSeller[], storeId: string, geradorId: number): SellerResolution {
  return pickEmployee(
    sellers.filter((s) => s.geradorId === geradorId),
    storeId,
  );
}

/** Gerador primeiro; sem gerador conhecido cai no nome. */
export function resolveSeller(
  sellers: KnownSeller[],
  storeId: string,
  row: Pick<SalesSellerDayAgg, "sellerKey" | "sellerGeradorId">,
): SellerResolution {
  if (row.sellerGeradorId != null) {
    const byGerador = resolveSellerGerador(sellers, storeId, row.sellerGeradorId);
    if (byGerador) return byGerador;
  }
  return resolveSellerKey(sellers, storeId, row.sellerKey);
}

/** Acrescenta o nome atual aos ja conhecidos (sem repetir). */
export function mergeNameKeys(prev: readonly string[] | null | undefined, name: string): string[] {
  const out = [...(prev ?? [])];
  const key = sellerKeyFromName(name);
  if (key && !out.includes(key)) out.push(key);
  return out;
}

export type SellerLinkerDeps = {
  loadSellerDirectory: (tenantId: string) => Promise<{ sellers: KnownSeller[] }>;
  fetchStoreSellers?: (params: {
    session: string;
    millenniumStoreId: number;
    concurrency?: number;
    /** Com gerador salvo  ->  cargo salvo; mesmo cargo na Lista = sem Consulta. */
    known?: ReadonlyMap<number, string | null>;
  }) => Promise<ErpSeller[]>;
  /** Grava e devolve as vendedoras conhecidas da loja (inclui quem saiu do ERP). */
  syncStoreSellers?: (args: { tenantId: string; storeId: string; sellers: ErpSeller[] }) => Promise<KnownSeller[]>;
};

export type LinkerStore = { id: string; code: string; millenniumStoreId: number };

type Log = (level: "WARN", message: string, store: LinkerStore) => void;

/** Vendedoras que seguiram sem cadastro apos sincronizar (por processo). */
const checkedUnknown = new Map<string, number>();

export function resetSellerLinkerMemory(): void {
  checkedUnknown.clear();
}

function unknownMemo(storeId: string, row: Pick<SalesSellerDayAgg, "sellerKey" | "sellerGeradorId">): string {
  return row.sellerGeradorId != null ? `${storeId}|g:${row.sellerGeradorId}` : `${storeId}|n:${row.sellerKey}`;
}

export type SellerLinker = ((store: LinkerStore, rows: SalesSellerDayAgg[]) => Promise<SalesSellerDayAgg[]>) & {
  /** Sincroniza a equipe da loja agora (carga inicial). 1x por job. */
  syncStore: (store: LinkerStore) => Promise<void>;
};

export function createSellerLinker(opts: {
  deps: SellerLinkerDeps;
  tenantId: string;
  getSession: () => string | null;
  now: () => Date;
  log: Log;
  isSessionDead: (msg: string) => boolean;
}): SellerLinker {
  let loading: Promise<void> | null = null;
  let sellers: KnownSeller[] = [];
  const syncing = new Map<string, Promise<void>>();
  const syncFailed = new Set<string>();

  function ensureDirectory(): Promise<void> {
    loading ??= opts.deps.loadSellerDirectory(opts.tenantId).then(
      (d) => {
        sellers = d.sellers;
      },
      (e: unknown) => {
        console.warn(`vendedoras: cadastro não carregou (${e instanceof Error ? e.message : String(e)})`);
      },
    );
    return loading;
  }

  function syncStore(store: LinkerStore): Promise<void> {
    const running = syncing.get(store.id);
    if (running) return running;
    const task = (async () => {
      const session = opts.getSession();
      const { fetchStoreSellers, syncStoreSellers } = opts.deps;
      if (!session || !fetchStoreSellers || !syncStoreSellers) {
        syncFailed.add(store.id);
        return;
      }
      try {
        const savedRoles = new Map(
          sellers
            .filter((s) => s.storeId === store.id && s.geradorId != null)
            .map((s) => [s.employeeId, s.role ?? null] as const),
        );
        const erp = await fetchStoreSellers({
          session,
          millenniumStoreId: store.millenniumStoreId,
          known: savedRoles,
        });
        const known = await syncStoreSellers({ tenantId: opts.tenantId, storeId: store.id, sellers: erp });
        sellers = [...sellers.filter((s) => s.storeId !== store.id), ...known];
        const consulted = erp.filter((s) => s.active != null);
        console.log(
          `  Equipe sincronizada · ${erp.length} pessoa(s) · ${consulted.length} consultada(s) · ${erp.length - consulted.length} já com gerador`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.isSessionDead(msg)) throw e;
        syncFailed.add(store.id);
        console.warn(`  AVISO equipe de vendas não sincronizou: ${msg}`);
        opts.log("WARN", `Equipe de vendas (FUNCIONARIOS.Lista/Consulta) falhou: ${msg}`, store);
      }
    })();
    syncing.set(store.id, task);
    return task;
  }

  /** Preenche `sellerEmployeeId`; sincroniza a loja 1x por job se aparece vendedora fora do cadastro. */
  async function link(store: LinkerStore, rows: SalesSellerDayAgg[]): Promise<SalesSellerDayAgg[]> {
    await ensureDirectory();
    const nowMs = opts.now().getTime();
    const isKnown = (row: SalesSellerDayAgg) =>
      row.sellerGeradorId != null
        ? resolveSellerGerador(sellers, store.id, row.sellerGeradorId) != null
        : resolveSellerKey(sellers, store.id, row.sellerKey) != null;
    const fresh = rows.filter((row) => {
      if (isKnown(row)) return false;
      const at = checkedUnknown.get(unknownMemo(store.id, row));
      return at == null || nowMs - at > SELLER_RESYNC_MS;
    });
    if (fresh.length > 0) await syncStore(store);
    else await syncing.get(store.id);

    const synced = syncing.has(store.id) && !syncFailed.has(store.id);
    const warned = new Set<string>();
    for (const row of fresh) {
      const memo = unknownMemo(store.id, row);
      // Sem cadastro so vira aviso depois de uma sincronizacao bem-sucedida neste job.
      if (!synced || warned.has(memo) || isKnown(row)) continue;
      warned.add(memo);
      checkedUnknown.set(memo, nowMs);
      const r = resolveSeller(sellers, store.id, row);
      if (r && "employeeId" in r) continue;
      const who = row.sellerGeradorId != null ? `"${row.sellerName}" (gerador ${row.sellerGeradorId})` : `"${row.sellerName}"`;
      opts.log(
        "WARN",
        r
          ? `Pessoa ${who} bate com mais de um cadastro de funcionário no Millennium — vendas ficam só pelo nome`
          : `Pessoa ${who} não está no cadastro de funcionários da loja no Millennium — vendas ficam só pelo nome`,
        store,
      );
    }
    return rows.map((row) => {
      const r = resolveSeller(sellers, store.id, row);
      return { ...row, sellerEmployeeId: r && "employeeId" in r ? r.employeeId : null };
    });
  }

  return Object.assign(link, {
    syncStore: async (store: LinkerStore) => {
      await ensureDirectory();
      await syncStore(store);
    },
  });
}
