/**
 * Pedido de compra (Gestão > Pedido de compra), mesma regra da planilha do dono.
 * Fonte = Saldo Atual e Futuro do Millennium (ESTOQUEEMCOMPRA): Total = saldo + pedidos em aberto.
 * Na lista = todo o Saldo Atual e Futuro, para o rodape bater com o Millennium.
 * Elegivel para o arquivo = codigo sem "WP", nao bloqueado e multipla > 0.
 * O que nao e elegivel (bloqueado, WPINK ou sem multipla) mostra o minimo gravado, sem editar, e fica fora do pedido.
 * A pedir = (minimo x multiplicador  Total) arredondado para cima ate a multipla; Total negativo conta como 0.
 * Novo = cadastrado ha menos de 30 dias ou nunca vendido pela loja (so quando o historico cobre 12 meses ou a inauguracao).
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
  /** YYYY-MM-DD (DATA_CADASTRO no fuso de Brasilia). */
  registeredAt: string | null;
  /** Ordem em que o relatorio devolveu a linha. */
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
  /** Bloqueado para compra: aparece na lista, minimo so leitura, fora do arquivo. */
  bloqueado: boolean;
  /** Uma variante elegivel: da para gravar o minimo e entrar no arquivo. */
  podePedir: boolean;
  /** null = " - " (sem minimo, bloqueado ou varias variantes). */
  aPedir: number | null;
  noPedido: boolean;
};

export type PurchaseOrderView = {
  rows: PurchaseOrderRow[];
  contagens: { noPedido: number; semMinimo: number; novos: number };
  /** Produtos e itens que vao para o arquivo no multiplicador atual. */
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

/** "A loja nunca vendeu" so vale com historico de 12 meses ou desde a inauguracao (`firstDay` = 1 dia gravado da loja). */
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
  /** Codigos que a loja ja vendeu; `null` = historico ainda nao cobre (Novo so pela data de cadastro). */
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

/** Colunas gravadas como texto no XLSX (indices de PURCHASE_FILE_HEADER): Cod_Cor, Cod_Estampa, Tamanho. */
export const PURCHASE_FILE_TEXT_COLUMNS = [1, 2, 3];

export type PurchaseFileRow = [string | number, string, string, string, number, number, string];

/** Linhas do arquivo de importacao, na ordem do relatorio; COD numerico sem zero a esquerda vai como numero (igual ao exemplo). */
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

export const PURCHASE_MIN_TEMPLATE_HEADER = ["COD_PRODUTO", "Descrição", "Quantidade mínima"] as const;

export const PURCHASE_MIN_SHEET_COLUMNS = "A planilha precisa das colunas COD_PRODUTO e Quantidade mínima.";

export type PurchaseMinUpdate = { code: string; value: number };

export type PurchaseMinSheet =
  | { ok: true; updates: PurchaseMinUpdate[]; unknown: string[]; invalid: string[] }
  | { ok: false; message: string };

const codeCell = (code: string): string | number => (/^[1-9]\d*$/.test(code) ? Number(code) : code);

function compareCode(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true });
}

/** Modelo para preencher o mínimo: código, descrição e o mínimo já salvo (vazio quando não tem). */
export function purchaseMinTemplateRows(view: PurchaseOrderView): Array<Array<string | number>> {
  const body = [...view.rows]
    .filter((r) => r.podePedir)
    .sort((a, b) => compareCode(a.code, b.code))
    .map((r) => [codeCell(r.code), r.nome, r.minimo ?? ""]);
  return [[...PURCHASE_MIN_TEMPLATE_HEADER], ...body];
}

export function purchaseMinTemplateFileName(codFilial: string): string {
  const safe = codFilial.replace(/[^\w.-]+/g, "") || "loja";
  return `minimos-${safe}.xlsx`;
}

const headerKind = (cell: string): "code" | "min" | null => {
  const h = fold(cell)
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (h === "cod produto" || h === "codigo" || h === "codigo produto") return "code";
  if (h === "minimo" || h === "qtd minima" || h === "qtde minima" || h.startsWith("quantidade min")) return "min";
  return null;
};

function parseMinCell(raw: string): { ok: true; value: number } | { ok: false } | { ok: true; value: null } {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return { ok: true, value: null };
  const normalized = /^\d+([.,]0+)?$/.test(t) ? t.replace(/[.,]0+$/, "") : t;
  const parsed = parseMinInput(normalized);
  if (!parsed.ok) return { ok: false };
  return parsed.value == null ? { ok: true, value: null } : { ok: true, value: parsed.value };
}

function resolveCode(raw: string, byExact: Map<string, string>, byUpper: Map<string, string>): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (byExact.has(t)) return byExact.get(t)!;
  const numeric = /^\d+\.0+$/.test(t) ? String(Number(t)) : t;
  if (byExact.has(numeric)) return byExact.get(numeric)!;
  return byUpper.get(numeric.toUpperCase()) ?? byUpper.get(t.toUpperCase()) ?? null;
}

/**
 * Lê COD_PRODUTO + quantidade mínima. Célula vazia não entra (não apaga o que já está salvo).
 * Código fora da lista da loja e valor que não é inteiro de 0 a 99.999 ficam de fora.
 */
export function parsePurchaseMinSheet(rows: string[][], known: ReadonlySet<string>): PurchaseMinSheet {
  let headerAt = -1;
  let codeCol = -1;
  let minCol = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    let code = -1;
    let min = -1;
    rows[i].forEach((cell, c) => {
      const kind = headerKind(cell);
      if (kind === "code" && code < 0) code = c;
      if (kind === "min" && min < 0) min = c;
    });
    if (code >= 0 && min >= 0) {
      headerAt = i;
      codeCol = code;
      minCol = min;
      break;
    }
  }
  if (headerAt < 0) return { ok: false, message: PURCHASE_MIN_SHEET_COLUMNS };

  const byExact = new Map<string, string>();
  const upperCount = new Map<string, number>();
  for (const code of known) {
    byExact.set(code, code);
    const key = code.toUpperCase();
    upperCount.set(key, (upperCount.get(key) ?? 0) + 1);
  }
  const byUpper = new Map<string, string>();
  for (const code of known) {
    const key = code.toUpperCase();
    if (upperCount.get(key) === 1) byUpper.set(key, code);
  }

  const updates = new Map<string, number>();
  const unknown: string[] = [];
  const invalid: string[] = [];
  const seenUnknown = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const row of rows.slice(headerAt + 1)) {
    const rawCode = (row[codeCol] ?? "").trim();
    if (!rawCode) continue;
    const cell = parseMinCell(row[minCol] ?? "");
    if (cell.ok && cell.value == null) continue;
    const code = resolveCode(rawCode, byExact, byUpper);
    if (!code) {
      if (!seenUnknown.has(rawCode)) {
        seenUnknown.add(rawCode);
        unknown.push(rawCode);
      }
      continue;
    }
    if (!cell.ok) {
      updates.delete(code);
      if (!seenInvalid.has(code)) {
        seenInvalid.add(code);
        invalid.push(code);
      }
      continue;
    }
    const invalidAt = invalid.indexOf(code);
    if (invalidAt >= 0) invalid.splice(invalidAt, 1);
    seenInvalid.delete(code);
    updates.set(code, cell.value);
  }

  return { ok: true, updates: [...updates.entries()].map(([code, value]) => ({ code, value })), unknown, invalid };
}

function listaCurta(items: string[]): string {
  const shown = items.slice(0, 12);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` e mais ${more}` : "");
}

/** Texto do aviso depois da importação. `unchanged` = a planilha tinha mínimos, mas nenhum diferia do que já está salvo. */
export function purchaseMinImportNotice(input: {
  saved: number;
  unknown: string[];
  invalid: string[];
  unchanged: boolean;
}): { variant: "success" | "warning"; title: string; detail: string | null } {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const partes: string[] = [];
  if (input.unknown.length) partes.push(`Não estão nesta loja: ${listaCurta(input.unknown)}.`);
  if (input.invalid.length) partes.push(`Valor inválido: ${listaCurta(input.invalid)}.`);
  const detail = partes.length ? partes.join(" ") : null;
  if (input.saved > 0) {
    return {
      variant: input.unknown.length || input.invalid.length ? "warning" : "success",
      title: `Mínimos atualizados em ${n(input.saved, "produto", "produtos")}.`,
      detail,
    };
  }
  if (!input.unknown.length && !input.invalid.length) {
    return {
      variant: input.unchanged ? "success" : "warning",
      title: input.unchanged ? "Os mínimos desta loja já estão iguais à planilha." : "Nenhum mínimo para importar.",
      detail: null,
    };
  }
  return { variant: "warning", title: "Nenhum mínimo foi importado.", detail };
}
