import { describe, expect, it } from "vitest";
import {
  PURCHASE_FILE_HEADER,
  PURCHASE_FILE_TEXT_COLUMNS,
  buildPurchaseOrderView,
  filterPurchaseRows,
  purchaseMinImportNotice,
  purchaseMinTemplateFileName,
  purchaseMinTemplateRows,
  purchaseOrderFileName,
  purchaseOrderFileRows,
  parsePurchaseMinSheet,
  isEligible,
  isNewProduct,
  parseMinInput,
  purchaseQuantity,
  soldHistoryCovers,
  type PurchaseStockRow,
} from "./purchaseOrder";

const TODAY = "2026-10-03";

const stock = (over: Partial<PurchaseStockRow> = {}): PurchaseStockRow => ({
  code: "BSPPAR-ATH-001",
  color: "000",
  print: "000",
  size: "U",
  description: "BODY SPLASH PARIS 200ML",
  balance: 2,
  openOrder: 0,
  total: 2,
  multiple: 24,
  blocked: false,
  registeredAt: "2024-06-05",
  position: 0,
  ...over,
});

const view = (rows: PurchaseStockRow[], mins: Record<string, number> = {}, factor = 1, sold: Record<string, number> = {}) =>
  buildPurchaseOrderView({
    stock: rows,
    mins: new Map(Object.entries(mins)),
    sold30: new Map(Object.entries(sold)),
    factor,
    todayIso: TODAY,
  });

describe("isEligible (PC-01: código sem WP, não bloqueado, múltipla > 0)", () => {
  it("aceita produto liberado com múltipla", () => {
    expect(isEligible(stock())).toBe(true);
  });
  it("recusa código com WP em qualquer caixa", () => {
    expect(isEligible(stock({ code: "WP014" }))).toBe(false);
    expect(isEligible(stock({ code: "wp-ultra" }))).toBe(false);
  });
  it("recusa bloqueado para compra", () => {
    expect(isEligible(stock({ blocked: true }))).toBe(false);
  });
  it("recusa múltipla nula ou 0", () => {
    expect(isEligible(stock({ multiple: null }))).toBe(false);
    expect(isEligible(stock({ multiple: 0 }))).toBe(false);
  });
});

describe("isNewProduct (PC-02: cadastro entre hoje e 29 dias atrás)", () => {
  it("é novo cadastrado hoje e há 29 dias", () => {
    expect(isNewProduct("2026-10-03", TODAY)).toBe(true);
    expect(isNewProduct("2026-09-04", TODAY)).toBe(true);
  });
  it("não é novo há 30 dias, sem data ou com data futura", () => {
    expect(isNewProduct("2026-09-03", TODAY)).toBe(false);
    expect(isNewProduct(null, TODAY)).toBe(false);
    expect(isNewProduct("2026-10-04", TODAY)).toBe(false);
  });
});

describe("soldHistoryCovers (PC-02: 'nunca vendeu' só com 12 meses de histórico ou desde a inauguração)", () => {
  it("cobre com histórico de 365 dias ou mais", () => {
    expect(soldHistoryCovers("2025-10-03", null, TODAY)).toBe(true);
    expect(soldHistoryCovers("2024-10-01", "2020-01-01", TODAY)).toBe(true);
  });
  it("não cobre com histórico de 364 dias e inauguração anterior", () => {
    expect(soldHistoryCovers("2025-10-04", null, TODAY)).toBe(false);
    expect(soldHistoryCovers("2025-10-04", "2025-10-03", TODAY)).toBe(false);
  });
  it("cobre quando o histórico começa na inauguração ou antes", () => {
    expect(soldHistoryCovers("2026-05-01", "2026-05-01", TODAY)).toBe(true);
    expect(soldHistoryCovers("2026-05-01", "2026-05-12", TODAY)).toBe(true);
  });
  it("sem histórico não cobre", () => {
    expect(soldHistoryCovers(null, "2026-05-01", TODAY)).toBe(false);
  });
});

describe("purchaseQuantity (PC-09 AC 2)", () => {
  it("Total 2, mínimo 72, múltipla 24 → 72 (70 arredondado para cima)", () => {
    expect(purchaseQuantity(2, 72, 24, 1)).toBe(72);
  });
  it("multiplicador 2x dobra o alvo: Total 2, mínimo 72 → 144", () => {
    expect(purchaseQuantity(2, 72, 24, 2)).toBe(144);
  });
  it("Total negativo conta como 0", () => {
    expect(purchaseQuantity(-10, 12, 12, 1)).toBe(12);
  });
  it("nada a pedir quando Total ≥ alvo", () => {
    expect(purchaseQuantity(72, 72, 24, 1)).toBe(0);
    expect(purchaseQuantity(100, 72, 24, 1)).toBe(0);
  });
  it("nada a pedir com mínimo 0 ou vazio", () => {
    expect(purchaseQuantity(0, 0, 24, 1)).toBe(0);
    expect(purchaseQuantity(0, null, 24, 1)).toBe(0);
  });
  it("múltipla 1 → exatamente alvo − Total", () => {
    expect(purchaseQuantity(3, 10, 1, 1)).toBe(7);
  });
});

describe("parseMinInput (PC-06 AC 3, 4)", () => {
  it("vazio = sem mínimo", () => {
    expect(parseMinInput("  ")).toEqual({ ok: true, value: null });
  });
  it("inteiro de 0 a 99999", () => {
    expect(parseMinInput("0")).toEqual({ ok: true, value: 0 });
    expect(parseMinInput(" 72 ")).toEqual({ ok: true, value: 72 });
    expect(parseMinInput("99999")).toEqual({ ok: true, value: 99999 });
  });
  it("recusa decimal, negativo, texto e acima de 99999", () => {
    for (const raw of ["1,5", "1.5", "-1", "abc", "100000"]) expect(parseMinInput(raw)).toEqual({ ok: false });
  });
});

describe("buildPurchaseOrderView", () => {
  it("lista o relatório inteiro; WPINK e bloqueado aparecem e ficam fora do pedido (PC-01)", () => {
    const v = view(
      [stock({ balance: 1, openOrder: 1, total: 2 }), stock({ code: "WP014", balance: 8, total: 8, position: 1 }), stock({ code: "X1", blocked: true, balance: 4, total: 4, position: 2 }), stock({ code: "SEM", multiple: null, balance: 3, total: 3, position: 3 })],
      { "BSPPAR-ATH-001": 72, X1: 12, WP014: 24 },
      1,
      { "BSPPAR-ATH-001": 15 },
    );
    expect(v.rows.map((r) => r.code)).toEqual(["BSPPAR-ATH-001", "WP014", "X1", "SEM"]);
    expect(v.rows[1]).toMatchObject({ bloqueado: false, podePedir: false, minimo: 24, saldo: 8, aPedir: null, noPedido: false });
    expect(v.rows[2]).toMatchObject({ bloqueado: true, podePedir: false, minimo: 12, saldo: 4, aPedir: null, noPedido: false });
    expect(v.rows[3]).toMatchObject({ podePedir: false, saldo: 3, aPedir: null, noPedido: false });
    expect(purchaseOrderFileRows(v).map((r) => r[0])).toEqual(["BSPPAR-ATH-001"]);
    expect(v.rows[0]).toMatchObject({
      code: "BSPPAR-ATH-001",
      nome: "BODY SPLASH PARIS 200ML",
      saldo: 1,
      pedidosAbertos: 1,
      total: 2,
      vendidos30: 15,
      multipla: 24,
      minimo: 72,
    });
  });

  it("abaixo do mínimo: destaca e mostra A pedir da regra (PC-03 AC 4)", () => {
    const r = view([stock()], { "BSPPAR-ATH-001": 72 }).rows[0];
    expect(r.noPedido).toBe(true);
    expect(r.aPedir).toBe(72);
  });

  it("mínimo vazio ou 0: A pedir '—' (null) e sem destaque (PC-03 AC 5)", () => {
    const [semMin, zero] = view([stock(), stock({ code: "B2", position: 1 })], { B2: 0 }).rows;
    expect(semMin.aPedir).toBeNull();
    expect(semMin.noPedido).toBe(false);
    expect(zero.aPedir).toBeNull();
    expect(zero.noPedido).toBe(false);
  });

  it("com estoque suficiente: A pedir 0 e sem destaque", () => {
    const r = view([stock({ total: 80 })], { "BSPPAR-ATH-001": 72 }).rows[0];
    expect(r.aPedir).toBe(0);
    expect(r.noPedido).toBe(false);
  });

  it("selo Novo pela data de cadastro (PC-02)", () => {
    const [velho, novo] = view([stock(), stock({ code: "N1", registeredAt: "2026-09-20", position: 1 })]).rows;
    expect(velho.novo).toBe(false);
    expect(novo.novo).toBe(true);
  });

  it("Novo também quando a loja nunca vendeu, com histórico que cobre (PC-02)", () => {
    const rows = [stock(), stock({ code: "V1", position: 1 }), stock({ code: "N1", registeredAt: "2026-09-20", position: 2 })];
    const v = buildPurchaseOrderView({
      stock: rows,
      mins: new Map(),
      sold30: new Map(),
      soldEver: new Set(["V1", "N1"]),
      factor: 1,
      todayIso: TODAY,
    });
    expect(v.rows.map((r) => [r.code, r.novo])).toEqual([
      ["BSPPAR-ATH-001", true],
      ["V1", false],
      ["N1", true],
    ]);
    expect(v.contagens.novos).toBe(2);
  });

  it("sem histórico que cobre (soldEver null), Novo só pela data de cadastro (PC-02)", () => {
    const v = buildPurchaseOrderView({ stock: [stock()], mins: new Map(), sold30: new Map(), soldEver: null, factor: 1, todayIso: TODAY });
    expect(v.rows[0].novo).toBe(false);
  });

  it("bloqueado para compra aparece, nunca vira Novo e não entra no pedido (PC-01, PC-02)", () => {
    const v = buildPurchaseOrderView({
      stock: [stock({ blocked: true, registeredAt: "2026-09-20" })],
      mins: new Map([["BSPPAR-ATH-001", 24]]),
      sold30: new Map(),
      soldEver: new Set(),
      factor: 1,
      todayIso: TODAY,
    });
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0]).toMatchObject({ bloqueado: true, novo: false, minimo: 24, aPedir: null, noPedido: false });
    expect(v.contagens.semMinimo).toBe(0);
    expect(purchaseOrderFileRows(v)).toEqual([]);
  });

  it("produto com mais de uma variante elegível: aviso, A pedir '—' e fora do pedido (PC-05 AC 9)", () => {
    const v = view(
      [stock({ code: "41228", size: "P", total: 0 }), stock({ code: "41228", size: "M", total: 0, position: 1 })],
      { "41228": 12 },
    );
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].variasVariantes).toBe(true);
    expect(v.rows[0].aPedir).toBeNull();
    expect(v.rows[0].noPedido).toBe(false);
    expect(v.resumo).toEqual({ produtos: 0, itens: 0 });
  });

  it("uma variante bloqueada não conta como variante elegível", () => {
    const v = view([stock({ code: "41228", size: "P" }), stock({ code: "41228", size: "M", blocked: true, position: 1 })], { "41228": 72 });
    expect(v.rows[0].variasVariantes).toBe(false);
    expect(v.rows[0].aPedir).toBe(72);
  });

  it("mínimo de produto que não veio no relatório não gera linha", () => {
    expect(view([stock()], { SUMIU: 10 }).rows.map((r) => r.code)).toEqual(["BSPPAR-ATH-001"]);
  });

  it("resumo e contagens seguem o multiplicador (PC-12 AC 1)", () => {
    const rows = [
      stock({ code: "A", total: 2, position: 0 }),
      stock({ code: "B", total: 30, multiple: 12, position: 1 }),
      stock({ code: "C", total: 0, position: 2, registeredAt: "2026-10-01" }),
    ];
    const mins = { A: 72, B: 24 };
    expect(view(rows, mins, 1).resumo).toEqual({ produtos: 1, itens: 72 });
    const dobrado = view(rows, mins, 2);
    expect(dobrado.resumo).toEqual({ produtos: 2, itens: 144 + 24 });
    expect(dobrado.contagens).toEqual({ noPedido: 2, semMinimo: 1, novos: 1 });
  });
});

describe("purchaseOrderFileRows (PC-10, PC-11 AC 8)", () => {
  it("cabeçalho igual ao exemplo do Millennium (AC 3)", () => {
    expect(PURCHASE_FILE_HEADER).toEqual(["COD_PRODUTO", "Cod_Cor", "Cod_Estampa", "Tamanho", "Quantidade", "Total em Estoque", "Descricao"]);
  });

  it("colunas gravadas como texto no XLSX = Cod_Cor, Cod_Estampa e Tamanho (AC 5)", () => {
    expect(PURCHASE_FILE_TEXT_COLUMNS.map((i) => PURCHASE_FILE_HEADER[i])).toEqual(["Cod_Cor", "Cod_Estampa", "Tamanho"]);
  });

  it("1 linha por produto com quantidade > 0, com cor/estampa/tamanho, quantidade, total e descrição (AC 3, 6)", () => {
    const v = view([stock({ total: 2 }), stock({ code: "OK", total: 100, position: 1 })], { "BSPPAR-ATH-001": 72, OK: 12 });
    expect(purchaseOrderFileRows(v)).toEqual([["BSPPAR-ATH-001", "000", "000", "U", 72, 2, "BODY SPLASH PARIS 200ML"]]);
  });

  it("Total em Estoque negativo vai como 0 (AC 6)", () => {
    const v = view([stock({ total: -5 })], { "BSPPAR-ATH-001": 24 });
    expect(purchaseOrderFileRows(v)[0][5]).toBe(0);
  });

  it("COD só com dígitos e sem zero à esquerda vira número; o resto fica texto (AC 5)", () => {
    const v = view(
      [stock({ code: "526", total: 0 }), stock({ code: "0526", total: 0, position: 1 }), stock({ code: "BS-1", total: 0, position: 2 })],
      { "526": 1, "0526": 1, "BS-1": 1 },
    );
    expect(purchaseOrderFileRows(v).map((r) => r[0])).toEqual([526, "0526", "BS-1"]);
  });

  it("cor, estampa e tamanho sempre texto, mesmo numéricos (AC 5)", () => {
    const [row] = purchaseOrderFileRows(view([stock({ total: 0 })], { "BSPPAR-ATH-001": 1 }));
    expect(row.slice(1, 4)).toEqual(["000", "000", "U"]);
    expect(typeof row[4]).toBe("number");
  });

  it("segue a ordem do relatório (AC 7)", () => {
    const v = view(
      [stock({ code: "Z", total: 0, position: 0 }), stock({ code: "A", total: 0, position: 1 }), stock({ code: "M", total: 0, position: 2 })],
      { A: 1, M: 1, Z: 1 },
    );
    expect(purchaseOrderFileRows(v).map((r) => r[0])).toEqual(["Z", "A", "M"]);
  });

  it("exclui produto com mais de uma variante elegível (AC 10)", () => {
    const v = view([stock({ code: "41228", size: "P", total: 0 }), stock({ code: "41228", size: "M", total: 0, position: 1 })], { "41228": 12 });
    expect(purchaseOrderFileRows(v)).toEqual([]);
  });

  it("nada abaixo do mínimo → nenhuma linha (PC-11 AC 8)", () => {
    expect(purchaseOrderFileRows(view([stock({ total: 100 })], { "BSPPAR-ATH-001": 12 }))).toEqual([]);
  });

  it("usa o multiplicador do view (AC 2)", () => {
    expect(purchaseOrderFileRows(view([stock({ total: 2 })], { "BSPPAR-ATH-001": 72 }, 2))[0][4]).toBe(144);
  });
});

describe("purchaseOrderFileName (PC-10 AC 4)", () => {
  it("ddMMyyyyHHmmss.xlsx com o horário do aparelho", () => {
    expect(purchaseOrderFileName(new Date(2026, 9, 3, 7, 38, 38))).toBe("03102026073838.xlsx");
  });
  it("completa com zero à esquerda", () => {
    expect(purchaseOrderFileName(new Date(2026, 0, 5, 9, 4, 1))).toBe("05012026090401.xlsx");
  });
});

describe("filterPurchaseRows (PC-04 AC 7, 8)", () => {
  const v = view(
    [
      stock({ code: "A1", description: "DESOD COLÔNIA GOLDEN", total: 0 }),
      stock({ code: "B2", description: "BODY CREAM", position: 1, registeredAt: "2026-10-01" }),
      stock({ code: "C3", description: "SHAMPOO", total: 100, position: 2 }),
    ],
    { A1: 12, C3: 12 },
  );
  const codes = (filtro: Parameters<typeof filterPurchaseRows>[1]["filtro"], busca = "") =>
    filterPurchaseRows(v.rows, { busca, filtro }).map((r) => r.code);

  it("busca no nome sem diferenciar maiúsculas e acentos", () => {
    expect(codes("todos", "colonia")).toEqual(["A1"]);
    expect(codes("todos", "GOLDEN")).toEqual(["A1"]);
  });
  it("busca no código", () => {
    expect(codes("todos", "b2")).toEqual(["B2"]);
  });
  it("Vai para o pedido = só destacados", () => {
    expect(codes("pedido")).toEqual(["A1"]);
  });
  it("Sem mínimo = mínimo vazio ou 0", () => {
    expect(codes("semMinimo")).toEqual(["B2"]);
    const comZero = view([stock({ code: "Z0", total: 0 }), stock({ code: "N1", total: 0, position: 1 }), stock({ code: "M5", total: 0, position: 2 })], { Z0: 0, M5: 5 });
    expect(filterPurchaseRows(comZero.rows, { busca: "", filtro: "semMinimo" }).map((r) => r.code)).toEqual(["Z0", "N1"]);
    expect(comZero.contagens.semMinimo).toBe(2);
  });
  it("Novos = só com selo Novo", () => {
    expect(codes("novos")).toEqual(["B2"]);
  });
});

describe("mínimos por planilha", () => {
  const lista = view(
    [
      stock({ code: "210", description: "MYSKIN", position: 2 }),
      stock({ code: "300", description: "BLOQUEADO", blocked: true, position: 3 }),
      stock({ code: "182", description: "BODY SPLASH FATAL ROUGE 200 ML - WEPINK", position: 0 }),
      stock({ code: "185", description: "BODY SPLASH DIVINE 200ML - WEPINK", position: 1 }),
    ],
    { "182": 72 },
  );
  const known = new Set(["182", "185", "186"]);

  it("o modelo traz código, descrição e o mínimo já salvo, em ordem de código", () => {
    expect(purchaseMinTemplateRows(lista)).toEqual([
      ["COD_PRODUTO", "Descrição", "Quantidade mínima"],
      [182, "BODY SPLASH FATAL ROUGE 200 ML - WEPINK", 72],
      [185, "BODY SPLASH DIVINE 200ML - WEPINK", ""],
      [210, "MYSKIN", ""],
    ]);
    expect(purchaseMinTemplateFileName("00010")).toBe("minimos-00010.xlsx");
  });

  it("importa a coluna de mínimo da planilha antiga e ignora saldo e descrição", () => {
    const parsed = parsePurchaseMinSheet(
      [
        ["COD_PRODUTO", "Descricao1", "Quantidade minin", "Saldo", "Quantidade Multip", "Novo"],
        ["182", "BODY SPLASH", "72", "0", "24", "NÃO"],
        ["185", "DIVINE", "", "1", "24", "NÃO"],
        ["186", "DESOD", "0", "4", "12", "NÃO"],
        ["999", "FORA", "4", "0", "24", "NÃO"],
        ["185", "DIVINE", "abc", "1", "24", "NÃO"],
      ],
      known,
    );
    expect(parsed).toEqual({
      ok: true,
      updates: [
        { code: "182", value: 72 },
        { code: "186", value: 0 },
      ],
      unknown: ["999"],
      invalid: ["185"],
    });
  });

  it("célula vazia não apaga, 72,0 conta como 72 e a última linha válida do código vence", () => {
    const parsed = parsePurchaseMinSheet(
      [
        ["Código", "Mínimo"],
        ["182", ""],
        ["182", "72,0"],
        ["182", "10"],
      ],
      known,
    );
    expect(parsed.ok && parsed.updates).toEqual([{ code: "182", value: 10 }]);
  });

  it("sem as duas colunas a planilha é recusada", () => {
    expect(parsePurchaseMinSheet([["Saldo", "Total"]], known)).toEqual({
      ok: false,
      message: "A planilha precisa das colunas COD_PRODUTO e Quantidade mínima.",
    });
  });

  it("o aviso lista código de fora e valor inválido, e diz quando nada mudou", () => {
    expect(purchaseMinImportNotice({ saved: 2, unknown: ["999"], invalid: [], unchanged: false })).toEqual({
      variant: "warning",
      title: "Mínimos atualizados em 2 produtos.",
      detail: "Não estão nesta loja: 999.",
    });
    expect(purchaseMinImportNotice({ saved: 0, unknown: [], invalid: [], unchanged: true }).title).toBe(
      "Os mínimos desta loja já estão iguais à planilha.",
    );
    expect(purchaseMinImportNotice({ saved: 0, unknown: [], invalid: [], unchanged: false }).title).toBe("Nenhum mínimo para importar.");
    expect(purchaseMinImportNotice({ saved: 1, unknown: [], invalid: [], unchanged: false }).variant).toBe("success");
  });
});
