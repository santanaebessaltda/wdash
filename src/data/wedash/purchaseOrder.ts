/**
 * Pedido de compra, mesma regra da planilha do dono.
 * Fonte = Saldo Atual e Futuro do Millennium (ESTOQUEEMCOMPRA): Total = saldo + pedidos em aberto.
 * Na lista = todo o Saldo Atual e Futuro, para o rodape bater com o Millennium.
 * Elegivel para o arquivo = nao bloqueado e multipla > 0 (WEPINK e WPINK).
 * O que nao e elegivel (bloqueado ou sem multipla) mostra o minimo gravado, sem editar, e fica fora do pedido.
 * Geracao: WEPINK e WPINK nunca misturam no mesmo arquivo (fabricas diferentes); o resumo separa e deixa escolher uma ou as duas.
 * A pedir = (minimo x multiplicador  Total) arredondado para cima ate a multipla; Total negativo conta como 0.
 * Novo = cadastrado ha menos de 30 dias ou nunca vendido pela loja (so quando o historico cobre 12 meses ou a inauguracao).
 */

import { productBrand } from "./stockProducts";

export type PurchaseStockRow = {
  code: string;
  color: string;
  print: string;
  size: string;
  description: string;
  balance: number;
  openOrder: number;
  total: number;
  multiple: number | null;
  blocked: boolean;
  /** YYYY-MM-DD (DATA_CADASTRO no fuso de Brasilia). */
  registeredAt: string | null;
  /** Ordem em que o relatorio devolveu a linha. */
  position: number;
};

export type PurchaseOrderRow = {
  code: string;
  name: string;
  variantes: PurchaseStockRow[];
  position: number;
  saldo: number;
  pedidosAbertos: number;
  total: number;
  vendidos30: number;
  multipla: number;
  minimum: number | null;
  isNew: boolean;
  variasVariantes: boolean;
  /** Bloqueado para compra: aparece na lista, minimo so leitura, fora do arquivo. */
  blocked: boolean;
  /** Uma variante elegivel: da para gravar o minimo e entrar no arquivo. */
  canRequest: boolean;
  /** null = " - " (sem minimo, bloqueado ou varias variantes). */
  aRequest: number | null;
  onOrder: boolean;
  /** Preço de custo unitário da tabela da loja, em centavos. Null = sem preço. */
  costCents: number | null;
};

export type PurchaseOrderView = {
  rows: PurchaseOrderRow[];
  counts: { onOrder: number; withoutMinimum: number; novos: number };
  /** Produtos e itens que vao para o arquivo no multiplicador atual. */
  summary: { products: number; items: number };
};

export type PurchaseFilter = "todos" | "pedido" | "semMinimo" | "novos";

export const PURCHASE_FACTORS = [1, 2, 3, 4, 5] as const;
export const PURCHASE_MIN_MAX = 99_999;
const NEW_PRODUCT_DAYS = 30;

/** Entra na lista: qualquer linha do relatório, para o saldo fechar com o Millennium. */
export function isListed(r: PurchaseStockRow): boolean {
  return r.code.trim().length > 0;
}

/** Vai para o arquivo do pedido (WEPINK e WPINK). */
export function isEligible(r: PurchaseStockRow): boolean {
  return isListed(r) && !r.blocked && (r.multiple ?? 0) > 0;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function isNewProduct(registeredAt: string | null, todayIso: string): boolean {
  if (!registeredAt) return false;
  const days = dayNumber(todayIso) - dayNumber(registeredAt);
  return days >= 0 && days < NEW_PRODUCT_DAYS;
}

export const SOLD_HISTORY_DAYS = 365;

/** "A loja nunca vendeu" so vale com historico de 12 meses ou desde a inauguracao (`firstDay` = 1 dia gravado da loja). */
export function soldHistoryCovers(firstDay: string | null, openedAt: string | null, todayIso: string): boolean {
  if (!firstDay) return false;
  if (dayNumber(todayIso) - dayNumber(firstDay) >= SOLD_HISTORY_DAYS) return true;
  return openedAt != null && dayNumber(firstDay) <= dayNumber(openedAt);
}

/** Barra da linha: ruptura (no pedido e total ≤ 0), reposição (no pedido com saldo) ou sem marca. */
export type PurchaseOrderTone = "bad" | "warn" | null;

/** Sem mínimo, coberto, bloqueado ou com várias variantes não marca. Zerado sem mínimo fica sem cor. */
export function purchaseOrderTone(row: Pick<PurchaseOrderRow, "onOrder" | "total">): PurchaseOrderTone {
  if (!row.onOrder) return null;
  return row.total <= 0 ? "bad" : "warn";
}

/** A linha do produto usa a cor mais grave entre as filiais: vermelho antes do amarelo. */
export function purchaseOrderGroupTone(rows: Array<Pick<PurchaseOrderRow, "onOrder" | "total">>): PurchaseOrderTone {
  let tone: PurchaseOrderTone = null;
  for (const row of rows) {
    const next = purchaseOrderTone(row);
    if (next === "bad") return "bad";
    if (next === "warn") tone = "warn";
  }
  return tone;
}

export function purchaseQuantity(total: number, min: number | null, multiple: number, factor: number): number {
  if (!min || min <= 0 || multiple <= 0) return 0;
  const target = min * factor;
  const stock = Math.max(0, total);
  if (stock >= target) return 0;
  return Math.ceil((target - stock) / multiple) * multiple;
}

export function parseMinInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return n <= PURCHASE_MIN_MAX ? { ok: true, value: n } : { ok: false };
}

export function buildPurchaseOrderView(input: {
  stock: PurchaseStockRow[];
  mins: Map<string, number>;
  sold30: Map<string, number>;
  /** Codigos que a loja ja vendeu; `null` = historico ainda nao cobre (Novo so pela data de cadastro). */
  soldEver?: Set<string> | null;
  factor: number;
  todayIso: string;
  /** COD_PRODUTO → custo unitário em centavos (tabela de custo da loja). */
  costs?: Map<string, number>;
}): PurchaseOrderView {
  const soldEver = input.soldEver ?? null;
  const byCode = new Map<string, PurchaseStockRow[]>();
  for (const r of [...input.stock].sort((a, b) => a.position - b.position)) {
    if (!isListed(r)) continue;
    const list = byCode.get(r.code);
    if (list) list.push(r);
    else byCode.set(r.code, [r]);
  }

  const rows: PurchaseOrderRow[] = [...byCode.entries()].map(([code, all]) => {
    const eligible = all.filter(isEligible);
    const variantes = eligible.length > 0 ? eligible : all;
    const blocked = eligible.length === 0 && all.every((v) => v.blocked);
    const canRequest = eligible.length === 1;
    const first = variantes[0];
    const sum = (f: (v: PurchaseStockRow) => number) => all.reduce((s, v) => s + f(v), 0);
    const totalOrder = eligible.reduce((s, v) => s + v.total, 0);
    const total = sum((v) => v.total);
    const multipla = first.multiple ?? 0;
    const minimum = input.mins.get(code) ?? null;
    const variasVariantes = variantes.length > 1;
    const aRequest = canRequest && minimum ? purchaseQuantity(totalOrder, minimum, multipla, input.factor) : null;
    const cost = input.costs?.get(code);
    return {
      code,
      name: first.description,
      variantes,
      position: first.position,
      saldo: sum((v) => v.balance),
      pedidosAbertos: sum((v) => v.openOrder),
      total,
      vendidos30: input.sold30.get(code) ?? 0,
      multipla,
      minimum,
      isNew:
        !blocked &&
        (isNewProduct(variantes.find((v) => v.registeredAt)?.registeredAt ?? null, input.todayIso) ||
          (soldEver != null && !soldEver.has(code))),
      variasVariantes,
      blocked,
      canRequest,
      aRequest,
      onOrder: (aRequest ?? 0) > 0,
      costCents: cost != null && cost > 0 ? cost : null,
    };
  });

  const onOrder = rows.filter((r) => r.onOrder);
  return {
    rows,
    counts: {
      onOrder: onOrder.length,
      withoutMinimum: rows.filter((r) => r.canRequest && !r.minimum).length,
      novos: rows.filter((r) => r.isNew).length,
    },
    summary: { products: onOrder.length, items: onOrder.reduce((s, r) => s + (r.aRequest ?? 0), 0) },
  };
}

export const PURCHASE_FILE_HEADER = ["COD_PRODUTO", "Cod_Cor", "Cod_Estampa", "Tamanho", "Quantidade", "Total em Estoque", "Descricao"] as const;

/** Colunas gravadas como texto no XLSX (indices de PURCHASE_FILE_HEADER): Cod_Cor, Cod_Estampa, Tamanho. */
export const PURCHASE_FILE_TEXT_COLUMNS = [1, 2, 3];

export type PurchaseFileRow = [string | number, string, string, string, number, number, string];

/** Linhas do arquivo de importacao, na ordem do relatorio; COD numerico sem zero a esquerda vai como numero (igual ao exemplo). */
export function purchaseOrderFileRows(view: PurchaseOrderView): PurchaseFileRow[] {
  return view.rows
    .filter((r) => r.onOrder)
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const v = r.variantes[0];
      return [/^[1-9]\d*$/.test(r.code) ? Number(r.code) : r.code, v.color, v.print, v.size, r.aRequest ?? 0, Math.max(0, r.total), v.description];
    });
}

/** Quantidade a pedir × custo. Null se o produto não entra no pedido ou está sem custo. */
export function purchaseLineCents(r: PurchaseOrderRow): number | null {
  if (!r.onOrder || r.aRequest == null || r.costCents == null) return null;
  return r.aRequest * r.costCents;
}

/** Total do pedido em centavos. Soma as linhas com custo. Null se nenhuma tiver preço. */
export function purchaseOrderTotalCents(rows: PurchaseOrderRow[]): number | null {
  const order = rows.filter((r) => r.onOrder);
  if (order.length === 0) return 0;
  let total = 0;
  let any = false;
  for (const r of order) {
    const line = purchaseLineCents(r);
    if (line == null) continue;
    any = true;
    total += line;
  }
  return any ? total : null;
}

export type PurchaseOrderBrand = "WEPINK" | "WPINK";

/** Parte as linhas do pedido por marca (ordem WEPINK → WPINK). Marca sem itens some. */
export function purchaseOrderByBrand(rows: PurchaseOrderRow[]): Array<{ brand: PurchaseOrderBrand; rows: PurchaseOrderRow[] }> {
  const buckets: Record<PurchaseOrderBrand, PurchaseOrderRow[]> = { WEPINK: [], WPINK: [] };
  for (const row of rows) buckets[productBrand(row.code)].push(row);
  return (["WEPINK", "WPINK"] as const).filter((brand) => buckets[brand].length > 0).map((brand) => ({ brand, rows: buckets[brand] }));
}

/** Nome do arquivo: carimbo · filial opcional · marca opcional (fabricas diferentes). */
export function purchaseOrderFileName(d: Date, branchCode?: string, brand?: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const parts = [stamp];
  const code = branchCode?.trim().replace(/[^\w.-]+/g, "");
  if (code) parts.push(code);
  const mark = brand?.trim().replace(/[^\w.-]+/g, "").toUpperCase();
  if (mark) parts.push(mark);
  return `${parts.join("-")}.xlsx`;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterPurchaseRows(rows: PurchaseOrderRow[], opts: { search: string; filter: PurchaseFilter }): PurchaseOrderRow[] {
  const q = fold(opts.search.trim());
  return rows.filter((r) => {
    if (opts.filter === "pedido" && !r.onOrder) return false;
    if (opts.filter === "semMinimo" && (!r.canRequest || r.minimum)) return false;
    if (opts.filter === "novos" && !r.isNew) return false;
    return !q || fold(r.name).includes(q) || fold(r.code).includes(q);
  });
}

export type PurchaseMinUpdate = { code: string; value: number };

function compareCode(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true });
}

/**
 * Mínimos da loja aberta que existem na outra. Código que a outra loja não tem no saldo fica de fora.
 * Mínimo que só a outra loja tem não entra aqui (não é apagado).
 */
export function purchaseMinsToCopy(
  source: ReadonlyMap<string, number>,
  destinationCodes: ReadonlySet<string>,
): { updates: PurchaseMinUpdate[]; skipped: number } {
  const updates: PurchaseMinUpdate[] = [];
  let skipped = 0;
  for (const [code, value] of source) {
    if (!destinationCodes.has(code)) {
      skipped += 1;
      continue;
    }
    updates.push({ code, value });
  }
  updates.sort((a, b) => compareCode(a.code, b.code));
  return { updates, skipped };
}
