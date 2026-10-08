/**
 * Impressao digital da VENDAS.Lista de hoje por loja  -  o Atualizar compara com a da ultima rodada
 * completa e, se nada mudou, pula Produtos por cupom e Marca/CMV (1 chamada ao ERP em vez de 3).
 * Fica em memoria: reiniciar o worker = proxima rodada de cada loja completa.
 */
import { createHash } from "node:crypto";
import type { SaleRow } from "../../../src/data/wedash/salesTypes.ts";

type ListaRow = SaleRow & { nf?: unknown; tipoOperacao?: unknown };

/** `dia:n de linhas:hash`  -  muda com venda nova, cancelada, valor, itens, forma de pagamento ou vendedora. */
export function listaFingerprint(day: string, rows: ListaRow[]): string {
  const lines = rows
    .map((r) =>
      [
        r.operationCode,
        String(r.nf ?? ""),
        String(r.tipoOperacao ?? ""),
        r.occurredAt.toISOString(),
        r.revenueCents,
        r.itemQty,
        r.paymentMethod ?? "",
        r.sellerName ?? "",
      ].join("|"),
    )
    .sort();
  const hash = createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 16);
  return `${day}:${rows.length}:${hash}`;
}

export type ListaMemo = {
  get: (storeId: string) => string | undefined;
  set: (storeId: string, fingerprint: string) => void;
  forget: (storeId: string) => void;
  /** Ultima Lista vista da loja no dia (qualquer rodada sem falha)  -  decide se a rodada trouxe venda nova. */
  seen: (storeId: string, day: string) => string | undefined;
  setSeen: (storeId: string, day: string, fingerprint: string) => void;
};

const SEEN_DAYS_PER_STORE = 3;

export function createListaMemo(): ListaMemo {
  const map = new Map<string, string>();
  const seen = new Map<string, Map<string, string>>();
  return {
    get: (id) => map.get(id),
    set: (id, fp) => void map.set(id, fp),
    forget: (id) => void map.delete(id),
    seen: (id, day) => seen.get(id)?.get(day),
    setSeen: (id, day, fp) => {
      const byDay = seen.get(id) ?? new Map<string, string>();
      byDay.set(day, fp);
      for (const old of [...byDay.keys()].sort().slice(0, -SEEN_DAYS_PER_STORE)) byDay.delete(old);
      seen.set(id, byDay);
    },
  };
}

/** A Lista mudou desde a ultima vista? Dia sem Lista vista (dia novo, worker reiniciado) = mudou so se tem venda. */
export function listaChanged(prev: string | undefined, fingerprint: string, rowCount: number): boolean {
  return prev ? prev !== fingerprint : rowCount > 0;
}
