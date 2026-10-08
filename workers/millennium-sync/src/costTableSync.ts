/**
 * Escolha automatica da tabela de custo da loja  -  so banco, nenhuma chamada ao ERP.
 * Loja sem tabela escolhida (cost_table_set_at null) recebe a tabela cujo custo unitario mais bate
 * (1 centavo) com o ultimo custo da margem por produto. Roda depois de gravar a margem da loja,
 * no max. 1x por hora por loja. Os precos das tabelas vem da recarga de produtos (productCatalog.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimo de produtos com custo igual (e metade dos comparados) para escolher a tabela sozinho. */
export const COST_TABLE_MIN_MATCHES = 20;
export const COST_TABLE_DETECT_EVERY_MS = 60 * 60 * 1000;

export type CostTableDetectDeps = {
  storeNeedsTable: (storeId: string) => Promise<boolean>;
  /** COD_PRODUTO  ->  custo unitario (centavos) do dia mais recente com custo na margem da loja. */
  margemUnitCosts: (storeId: string) => Promise<Map<string, number>>;
  /** table_id  ->  (COD_PRODUTO  ->  custo unitario em centavos). */
  tablePrices: () => Promise<Map<number, Map<string, number>>>;
  setStoreTable: (storeId: string, tableId: number) => Promise<void>;
};

export type CostTablePick = { tableId: number; matches: number; compared: number };

export function pickCostTable(
  margemUnit: Map<string, number>,
  tables: Map<number, Map<string, number>>,
): CostTablePick | null {
  let best: CostTablePick | null = null;
  for (const [tableId, prices] of tables) {
    let matches = 0;
    let compared = 0;
    for (const [code, unit] of margemUnit) {
      const p = prices.get(code);
      if (p == null) continue;
      compared += 1;
      if (Math.abs(p - unit) <= 1) matches += 1;
    }
    if (!best || matches > best.matches) best = { tableId, matches, compared };
  }
  if (!best || best.matches < COST_TABLE_MIN_MATCHES || best.matches * 2 < best.compared) return null;
  return best;
}

const lastAttempt = new Map<string, number>();

/** Tabela escolhida agora (ou null: loja ja tem tabela, tentou ha pouco ou ainda nao da para decidir). */
export async function detectStoreCostTable(
  deps: CostTableDetectDeps,
  storeId: string,
  now = Date.now(),
): Promise<CostTablePick | null> {
  const prev = lastAttempt.get(storeId);
  if (prev != null && now - prev < COST_TABLE_DETECT_EVERY_MS) return null;
  lastAttempt.set(storeId, now);
  if (!(await deps.storeNeedsTable(storeId))) return null;
  const margem = await deps.margemUnitCosts(storeId);
  if (margem.size < COST_TABLE_MIN_MATCHES) return null;
  const pick = pickCostTable(margem, await deps.tablePrices());
  if (!pick) return null;
  await deps.setStoreTable(storeId, pick.tableId);
  return pick;
}

export function resetCostTableDetectThrottle(): void {
  lastAttempt.clear();
}

export function buildCostTableDetectDeps(sb: SupabaseClient): CostTableDetectDeps {
  return {
    async storeNeedsTable(storeId) {
      const { data, error } = await sb
        .from("store")
        .select("cost_table_set_at")
        .eq("id", storeId)
        .maybeSingle();
      if (error) throw error;
      return data != null && data.cost_table_set_at == null;
    },

    async margemUnitCosts(storeId) {
      const latest = new Map<string, { day: string; unit: number }>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("sales_product_cost_day_agg")
          .select("day, product_code, item_count, cmv_cents")
          .eq("store_id", storeId)
          .gt("cmv_cents", 0)
          .gt("item_count", 0)
          .order("day")
          .order("product_code")
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          const cur = latest.get(r.product_code as string);
          if (!cur || (r.day as string) > cur.day) {
            latest.set(r.product_code as string, {
              day: r.day as string,
              unit: Math.round(Number(r.cmv_cents) / Number(r.item_count)),
            });
          }
        }
        if (!data || data.length < 1000) break;
      }
      return new Map([...latest].map(([code, v]) => [code, v.unit]));
    },

    async tablePrices() {
      const out = new Map<number, Map<string, number>>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("product_cost_table_price")
          .select("table_id, product_code, unit_cost_cents")
          .order("table_id")
          .order("product_code")
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          const id = Number(r.table_id);
          let m = out.get(id);
          if (!m) out.set(id, (m = new Map()));
          m.set(r.product_code as string, Number(r.unit_cost_cents));
        }
        if (!data || data.length < 1000) break;
      }
      return out;
    },

    async setStoreTable(storeId, tableId) {
      const { error } = await sb
        .from("store")
        .update({ cost_table_id: tableId, cost_table_set_at: new Date().toISOString() })
        .eq("id", storeId)
        .is("cost_table_set_at", null);
      if (error) throw error;
    },
  };
}
