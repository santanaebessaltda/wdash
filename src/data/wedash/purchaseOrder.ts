/**
 * Pedido de compra (Estoque > Pedido de compra), mesma regra da planilha do dono.
 * Fonte = Saldo Atual e Futuro do Millennium (ESTOQUEEMCOMPRA): Total = saldo + pedidos em aberto.
 * Na lista = todo o Saldo Atual e Futuro, para o rodapé bater com o Millennium.
 * Elegível para o arquivo = código sem "WP", não bloqueado e múltipla > 0.
 * O que não é elegível (bloqueado, WPINK ou sem múltipla) mostra o mínimo gravado, sem editar, e fica fora do pedido.
 * A pedir = (mínimo × multiplicador − Total) arredondado para cima até a múltipla; Total negativo conta como 0.
 * Novo = cadastrado há menos de 30 dias ou nunca vendido pela loja (só quando o histórico cobre 12 meses ou a inauguração).
 */

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
  /** YYYY-MM-DD (DATA_CADASTRO no fuso de Brasília). */
  registeredAt: string | null;
  /** Ordem em que o relatório devolveu a linha. */
  position: number;
};

export type PurchaseOrderRow = {
  code: string;
  nome: string;
  variantes: PurchaseStockRow[];
  position: number;
  saldo: number;
  pedidosAbertos: number;
  total: number;
  vendidos30: number;
  multipla: number;
  minimo: number | null;
  novo: boolean;
  variasVariantes: boolean;
  /** Bloqueado para compra: aparece na lista, mínimo só leitura, fora do arquivo. */
  bloqueado: boolean;
  /** Uma variante elegível: dá para gravar o mínimo e entrar no arquivo. */
  podePedir: boolean;
  /** null = "—" (sem mínimo, bloqueado ou várias variantes). */
  aPedir: number | null;
  noPedido: boolean;
};

export type PurchaseOrderView = {
  rows: PurchaseOrderRow[];
  contagens: { noPedido: number; semMinimo: number; novos: number };
  /** Produtos e itens que vão para o arquivo no multiplicador atual. */
  resumo: { produtos: number; itens: number };
};

export type PurchaseFilter = "todos" | "pedido" | "semMinimo" | "novos";

export const PURCHASE_FACTORS = [1, 2, 3, 4, 5] as const;
export const PURCHASE_MIN_MAX = 99_999;
const NEW_PRODUCT_DAYS = 30;

/** Entra na lista: qualquer linha do relatório, para o saldo fechar com o Millennium. */
export function isListed(r: PurchaseStockRow): boolean {
  return r.code.trim().length > 0;
}

/** Vai para o arquivo do pedido. */
export function isEligible(r: PurchaseStockRow): boolean {
  return isListed(r) && !r.code.toUpperCase().includes("WP") && !r.blocked && (r.multiple ?? 0) > 0;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function isNewProduct(registeredAt: string | null, todayIso: string): boolean {
  if (!registeredAt) return false;
  const dias = dayNumber(todayIso) - dayNumber(registeredAt);
  return dias >= 0 && dias < NEW_PRODUCT_DAYS;
}

export const SOLD_HISTORY_DAYS = 365;

/** "A loja nunca vendeu" só vale com histórico de 12 meses ou desde a inauguração (`firstDay` = 1º dia gravado da loja). */
export function soldHistoryCovers(firstDay: string | null, openedAt: string | null, todayIso: string): boolean {
  if (!firstDay) return false;
  if (dayNumber(todayIso) - dayNumber(firstDay) >= SOLD_HISTORY_DAYS) return true;
  return openedAt != null && dayNumber(firstDay) <= dayNumber(openedAt);
}

export function purchaseQuantity(total: number, min: number | null, multiple: number, factor: number): number {
  if (!min || min <= 0 || multiple <= 0) return 0;
  const alvo = min * factor;
  const estoque = Math.max(0, total);
  if (estoque >= alvo) return 0;
  return Math.ceil((alvo - estoque) / multiple) * multiple;
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
  /** Códigos que a loja já vendeu; `null` = histórico ainda não cobre (Novo só pela data de cadastro). */
  soldEver?: Set<string> | null;
  factor: number;
  todayIso: string;
}): PurchaseOrderView {
  const soldEver = input.soldEver ?? null;
  const porCodigo = new Map<string, PurchaseStockRow[]>();
  for (const r of [...input.stock].sort((a, b) => a.position - b.position)) {
    if (!isListed(r)) continue;
    const lista = porCodigo.get(r.code);
    if (lista) lista.push(r);
    else porCodigo.set(r.code, [r]);
  }

  const rows: PurchaseOrderRow[] = [...porCodigo.entries()].map(([code, todas]) => {
    const elegiveis = todas.filter(isEligible);
    const variantes = elegiveis.length > 0 ? elegiveis : todas;
    const bloqueado = elegiveis.length === 0 && todas.every((v) => v.blocked);
    const podePedir = elegiveis.length === 1;
    const first = variantes[0];
    const soma = (f: (v: PurchaseStockRow) => number) => todas.reduce((s, v) => s + f(v), 0);
    const totalPedido = elegiveis.reduce((s, v) => s + v.total, 0);
    const total = soma((v) => v.total);
    const multipla = first.multiple ?? 0;
    const minimo = input.mins.get(code) ?? null;
    const variasVariantes = variantes.length > 1;
    const aPedir = podePedir && minimo ? purchaseQuantity(totalPedido, minimo, multipla, input.factor) : null;
    return {
      code,
      nome: first.description,
      variantes,
      position: first.position,
      saldo: soma((v) => v.balance),
      pedidosAbertos: soma((v) => v.openOrder),
      total,
      vendidos30: input.sold30.get(code) ?? 0,
      multipla,
      minimo,
      novo:
        !bloqueado &&
        (isNewProduct(variantes.find((v) => v.registeredAt)?.registeredAt ?? null, input.todayIso) ||
          (soldEver != null && !soldEver.has(code))),
      variasVariantes,
      bloqueado,
      podePedir,
      aPedir,
      noPedido: (aPedir ?? 0) > 0,
    };
  });

  const noPedido = rows.filter((r) => r.noPedido);
  return {
    rows,
    contagens: {
      noPedido: noPedido.length,
      semMinimo: rows.filter((r) => r.podePedir && !r.minimo).length,
      novos: rows.filter((r) => r.novo).length,
    },
    resumo: { produtos: noPedido.length, itens: noPedido.reduce((s, r) => s + (r.aPedir ?? 0), 0) },
  };
}

export const PURCHASE_FILE_HEADER = ["COD_PRODUTO", "Cod_Cor", "Cod_Estampa", "Tamanho", "Quantidade", "Total em Estoque", "Descricao"] as const;

/** Colunas gravadas como texto no XLSX (índices de PURCHASE_FILE_HEADER): Cod_Cor, Cod_Estampa, Tamanho. */
export const PURCHASE_FILE_TEXT_COLUMNS = [1, 2, 3];

export type PurchaseFileRow = [string | number, string, string, string, number, number, string];

/** Linhas do arquivo de importação, na ordem do relatório; COD numérico sem zero à esquerda vai como número (igual ao exemplo). */
export function purchaseOrderFileRows(view: PurchaseOrderView): PurchaseFileRow[] {
  return view.rows
    .filter((r) => r.noPedido)
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const v = r.variantes[0];
      return [/^[1-9]\d*$/.test(r.code) ? Number(r.code) : r.code, v.color, v.print, v.size, r.aPedir ?? 0, Math.max(0, r.total), v.description];
    });
}

export function purchaseOrderFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.xlsx`;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterPurchaseRows(rows: PurchaseOrderRow[], opts: { busca: string; filtro: PurchaseFilter }): PurchaseOrderRow[] {
  const q = fold(opts.busca.trim());
  return rows.filter((r) => {
    if (opts.filtro === "pedido" && !r.noPedido) return false;
    if (opts.filtro === "semMinimo" && (!r.podePedir || r.minimo)) return false;
    if (opts.filtro === "novos" && !r.novo) return false;
    return !q || fold(r.nome).includes(q) || fold(r.code).includes(q);
  });
}
