import { describe, expect, it } from "vitest";
import {
  challengeFormToInput,
  challengeToForm,
  emptyChallengeForm,
  validateChallengeForm,
  type ChallengeForm,
} from "./challengeForm";
import type { ChallengeRecord } from "./challengesRepo";

const d = (iso: string) => {
  const [a, m, dia] = iso.split("-").map(Number);
  return new Date(a, m - 1, dia);
};

const valid = (over: Partial<ChallengeForm> = {}): ChallengeForm => ({
  ...emptyChallengeForm("s1"),
  name: "Body Splash — quem vender mais",
  startsOn: d("2026-10-05"),
  endsOn: d("2026-10-11"),
  products: [{ code: "BS1", name: "BODY SPLASH 1" }],
  prizes: [{ kind: "MONEY", amount: "100,00", label: "" }],
  ...over,
});

describe("emptyChallengeForm", () => {
  it("novo desafio começa em Quantidade de produtos escolhidos · Quem fizer mais, 10 vendas e 1 prêmio em R$ vazio", () => {
    const f = emptyChallengeForm("s1");
    expect(f).toMatchObject({ storeId: "s1", metric: "QUANTITY", scope: "PRODUCTS", mode: "CONTEST", minSales: "", managerOn: false });
    expect(f.prizes).toEqual([{ kind: "MONEY", amount: "", label: "" }]);
  });
});

describe("validateChallengeForm", () => {
  it("formulário válido não tem erro", () => {
    expect(validateChallengeForm(valid())).toEqual({});
  });

  it("obrigatórios: nome, datas e loja", () => {
    const e = validateChallengeForm(valid({ name: "  ", startsOn: null, endsOn: null, storeId: "" }));
    expect(e).toMatchObject({ name: "Campo obrigatório.", startsOn: "Campo obrigatório.", endsOn: "Campo obrigatório.", storeId: "Campo obrigatório." });
  });

  it("nome com mais de 80 caracteres", () => {
    expect(validateChallengeForm(valid({ name: "x".repeat(81) })).name).toBe("Use até 80 caracteres.");
  });

  it("data de fim antes do início (mesmo dia pode)", () => {
    expect(validateChallengeForm(valid({ endsOn: d("2026-10-04") })).endsOn).toBe("A data de fim precisa ser depois da data de início.");
    expect(validateChallengeForm(valid({ endsOn: d("2026-10-05") })).endsOn).toBeUndefined();
  });

  it("Produtos exige pelo menos 1 produto; Categorias, pelo menos 1 categoria; Tudo não exige nada", () => {
    expect(validateChallengeForm(valid({ products: [] })).products).toBe("Escolha pelo menos 1 produto.");
    const cat = validateChallengeForm(valid({ scope: "CATEGORIES", products: [], categories: [] }));
    expect(cat.categories).toBe("Escolha pelo menos 1 categoria.");
    expect(cat.products).toBeUndefined();
    expect(validateChallengeForm(valid({ scope: "ALL", products: [] }))).toEqual({});
    expect(validateChallengeForm(valid({ metric: "VALUE", scope: "PRODUCTS", products: [] })).products).toBe(
      "Escolha pelo menos 1 produto.",
    );
  });

  it("Valor aceita centavos no mínimo", () => {
    expect(validateChallengeForm(valid({ metric: "VALUE", mode: "MINIMUM", target: "1.500,50" })).target).toBeUndefined();
    expect(challengeFormToInput(valid({ metric: "VALUE", mode: "MINIMUM", target: "1.500,50" })).target).toBe(1500.5);
  });

  it("P.A. e ticket: vendas mínimas são opcionais; 0/vazio = sem piso; se ≥ 1, inteiro", () => {
    expect(validateChallengeForm(valid({ metric: "PA", products: [], minSales: "" })).minSales).toBeUndefined();
    expect(challengeFormToInput(valid({ metric: "PA", products: [], minSales: "" })).minSales).toBeNull();
    expect(validateChallengeForm(valid({ metric: "TICKET", products: [], minSales: "0" })).minSales).toBeUndefined();
    expect(challengeFormToInput(valid({ metric: "TICKET", products: [], minSales: "0" })).minSales).toBeNull();
    expect(validateChallengeForm(valid({ metric: "PA", products: [], minSales: "2,5" })).minSales).toBe(
      "Informe um número inteiro a partir de 1 (ou deixe em branco / 0).",
    );
    expect(validateChallengeForm(valid({ metric: "PA", products: [], minSales: "10" })).minSales).toBeUndefined();
  });

  it("Mínimo exige alvo válido pela métrica", () => {
    expect(validateChallengeForm(valid({ mode: "MINIMUM", target: "" })).target).toBe("Campo obrigatório.");
    expect(validateChallengeForm(valid({ mode: "MINIMUM", target: "2,5" })).target).toBe("Informe um número inteiro de itens maior que 0.");
    expect(validateChallengeForm(valid({ mode: "MINIMUM", target: "15" })).target).toBeUndefined();
    expect(validateChallengeForm(valid({ mode: "MINIMUM", metric: "PA", products: [], target: "0" })).target).toBe(
      "Informe um valor maior que 0.",
    );
    expect(validateChallengeForm(valid({ mode: "MINIMUM", metric: "PA", products: [], target: "1,9" })).target).toBeUndefined();
    expect(validateChallengeForm(valid({ mode: "MINIMUM", metric: "TICKET", products: [], target: "" })).target).toBe(
      "Campo obrigatório.",
    );
  });

  it("piso da Disputa é opcional, mas se preenchido precisa ser válido", () => {
    expect(validateChallengeForm(valid({ target: "" })).target).toBeUndefined();
    expect(validateChallengeForm(valid({ target: "abc" })).target).toBe("Informe um número inteiro de itens maior que 0.");
  });

  it("prêmio: R$ > 0 ou descrição de 1 a 60 caracteres; vazio = obrigatório", () => {
    expect(validateChallengeForm(valid({ prizes: [{ kind: "MONEY", amount: "", label: "" }] })).prizes).toEqual({ 0: "Campo obrigatório." });
    expect(validateChallengeForm(valid({ prizes: [{ kind: "MONEY", amount: "0,00", label: "" }] })).prizes).toEqual({
      0: "Informe um valor maior que 0.",
    });
    expect(validateChallengeForm(valid({ prizes: [{ kind: "ITEM", amount: "", label: "   " }] })).prizes).toEqual({ 0: "Campo obrigatório." });
    expect(validateChallengeForm(valid({ prizes: [{ kind: "ITEM", amount: "", label: "x".repeat(61) }] })).prizes).toEqual({
      0: "Use até 60 caracteres.",
    });
    expect(validateChallengeForm(valid({ prizes: [{ kind: "ITEM", amount: "", label: "Combo KFC" }] })).prizes).toBeUndefined();
  });

  it("2º e 3º lugar adicionados precisam de prêmio", () => {
    const e = validateChallengeForm(
      valid({
        prizes: [
          { kind: "MONEY", amount: "100,00", label: "" },
          { kind: "ITEM", amount: "", label: "Combo KFC" },
          { kind: "MONEY", amount: "", label: "" },
        ],
      }),
    );
    expect(e.prizes).toEqual({ 2: "Campo obrigatório." });
  });

  it("gerência ligada exige prêmio e meta própria, mesmo na Disputa sem piso", () => {
    const vazio = { kind: "MONEY" as const, amount: "", label: "" };
    const e = validateChallengeForm(valid({ target: "", managerOn: true, managerPrize: vazio, managerTarget: "" }));
    expect([e.managerPrize, e.managerTarget, e.target]).toEqual(["Campo obrigatório.", "Campo obrigatório.", undefined]);
    expect(validateChallengeForm(valid({ managerOn: true, managerPrize: vazio, managerTarget: "0" })).managerTarget).toBe(
      "Informe um número inteiro de itens maior que 0.",
    );
    expect(validateChallengeForm(valid({ managerOn: false, managerPrize: vazio, managerTarget: "" }))).toEqual({});
  });
});

describe("challengeFormToInput / challengeToForm", () => {
  it("converte o formulário (Disputa de produtos com piso e gerência)", () => {
    const input = challengeFormToInput(
      valid({
        name: "  Body Splash  ",
        target: "5",
        minSales: "10",
        categories: [{ typeId: 14, name: "BODY SPLASH" }],
        prizes: [
          { kind: "MONEY", amount: "1.234,50", label: "" },
          { kind: "ITEM", amount: "", label: " Combo KFC " },
        ],
        managerOn: true,
        managerPrize: { kind: "ITEM", amount: "", label: "Spa" },
        managerTarget: "8",
      }),
    );
    expect(input).toEqual({
      storeId: "s1",
      name: "Body Splash",
      startsOn: "2026-10-05",
      endsOn: "2026-10-11",
      metric: "QUANTITY",
      scope: "PRODUCTS",
      mode: "CONTEST",
      products: [{ code: "BS1", name: "BODY SPLASH 1" }],
      categories: [],
      target: 5,
      minSales: null,
      prizes: [
        { kind: "MONEY", amount: 1234.5 },
        { kind: "ITEM", label: "Combo KFC" },
      ],
      managerPrize: { kind: "ITEM", label: "Spa" },
      managerTarget: 8,
    });
  });

  it("Mínimo grava só 1 prêmio; gerência desligada vira null; ticket com R$", () => {
    const input = challengeFormToInput(
      valid({
        metric: "TICKET",
        mode: "MINIMUM",
        products: [],
        target: "120,00",
        minSales: "10",
        prizes: [
          { kind: "MONEY", amount: "50,00", label: "" },
          { kind: "MONEY", amount: "30,00", label: "" },
        ],
      }),
    );
    expect(input).toMatchObject({
      target: 120,
      minSales: 10,
      prizes: [{ kind: "MONEY", amount: 50 }],
      managerPrize: null,
      managerTarget: null,
      products: [],
    });
    const desligada = challengeFormToInput(
      valid({ managerOn: false, managerPrize: { kind: "MONEY", amount: "10,00", label: "" }, managerTarget: "5" }),
    );
    expect([desligada.managerPrize, desligada.managerTarget]).toEqual([null, null]);
  });

  it("Índice de desempenho é sempre Quem fizer mais; gerência exige o índice mínimo da gerência", () => {
    const f = valid({
      metric: "INDEX",
      mode: "MINIMUM",
      products: [],
      target: "",
      minSales: "10",
      managerOn: true,
      managerPrize: { kind: "MONEY", amount: "", label: "" },
      managerTarget: "",
    });
    expect(validateChallengeForm(f)).toEqual({ managerPrize: "Campo obrigatório.", managerTarget: "Campo obrigatório." });
    const ok = { ...f, target: "110,5", managerPrize: { kind: "MONEY" as const, amount: "80", label: "" }, managerTarget: "105" };
    expect(validateChallengeForm(ok)).toEqual({});
    expect(challengeFormToInput(ok)).toMatchObject({
      metric: "INDEX",
      scope: "ALL",
      mode: "CONTEST",
      target: 110.5,
      minSales: 10,
      managerPrize: { kind: "MONEY", amount: 80 },
      managerTarget: 105,
      products: [],
    });
  });

  it("ida e volta: registro → formulário → input", () => {
    const rec: ChallengeRecord = {
      id: "c1",
      storeId: "s1",
      name: "P.A. da semana",
      startsOn: "2026-10-05",
      endsOn: "2026-10-11",
      metric: "PA",
      scope: "ALL",
      mode: "MINIMUM",
      products: [],
      categories: [],
      target: 1.9,
      minSales: 10,
      prizes: [{ kind: "MONEY", amount: 50 }],
      managerPrize: { kind: "ITEM", label: "Spa" },
      managerTarget: 2.1,
    };
    const form = challengeToForm(rec);
    expect(form.target).toBe("1,9");
    expect(form.managerTarget).toBe("2,1");
    expect(form.prizes[0].amount).toBe("50,00");
    expect(form.managerOn).toBe(true);
    const { id: _id, ...rest } = rec;
    expect(challengeFormToInput(form)).toEqual(rest);
  });
});
