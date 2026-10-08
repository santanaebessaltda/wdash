import { describe, expect, it } from "vitest";
import {
  cashAccountForStore,
  parseCashAccounts,
  parseCashCloseReport,
  reaisToCents,
} from "./millenniumCashClose";

const accountsPayload = {
  value: [
    { CONTA: 101231, NUMERO: "00386", DESCRICAO: "CAIXA LOJA CAMPO GRANDE - MS" },
    { CONTA: 101232, NUMERO: "00386-1", DESCRICAO: "COMPRAS LOJA CAMPO GRANDE - MS" },
    { CONTA: 12, NUMERO: "00010", DESCRICAO: "QUIOSQUE CAMPO GRANDE" },
    { CONTA: 13, NUMERO: "00010-1", DESCRICAO: "COMPRAS CAMPO GRANDE" },
  ],
};

describe("cashAccountForStore", () => {
  const accounts = parseCashAccounts(accountsPayload);

  it("usa o caixa cujo número é o código da loja", () => {
    expect(cashAccountForStore(accounts, "00386")).toMatchObject({ conta: 101231, numero: "00386" });
    expect(cashAccountForStore(accounts, "00010")).toMatchObject({ conta: 12, numero: "00010" });
  });

  it("não usa a conta de compras", () => {
    expect(cashAccountForStore(accounts, "00386-1")).toMatchObject({ conta: 101232 });
    expect(cashAccountForStore(accounts, "00011")).toBeNull();
  });
});

describe("parseCashCloseReport", () => {
  it("guarda fundo, sangria, fechamento e digitado, com TEF separado", () => {
    const lines = parseCashCloseReport({
      value: [
        {
          FORMA_PAGAMENTO: "DINHEIRO",
          ENTRADA_INICIAL: 447.75,
          VALOR_FECHAMENTO: -102.75,
          VALOR_DIGITADO_FECHAMENTO: 258.5,
          DIFERENCA: -361.25,
          VALOR_SANGRIA: -4850,
        },
        {
          FORMA_PAGAMENTO: "PIX",
          ENTRADA_INICIAL: 0,
          VALOR_FECHAMENTO: 14313.3,
          VALOR_DIGITADO_FECHAMENTO: 14339.3,
          DIFERENCA: -26,
          VALOR_SANGRIA: null,
        },
        {
          FORMA_PAGAMENTO: "TEF CARTÃO DÉBITO",
          ENTRADA_INICIAL: 0,
          VALOR_FECHAMENTO: 661,
          VALOR_DIGITADO_FECHAMENTO: 661,
          DIFERENCA: 0,
          VALOR_SANGRIA: null,
        },
      ],
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      paymentMethod: "DINHEIRO",
      openingReais: 447.75,
      sangriaReais: -4850,
      closingReais: -102.75,
      typedReais: 258.5,
    });
    expect(lines[1]?.sangriaReais).toBeNull();
    expect(lines[2]?.paymentMethod).toBe("TEF CARTÃO DÉBITO");
    expect(reaisToCents(447.75)).toBe(44775);
    expect(reaisToCents(-102.75)).toBe(-10275);
    expect(reaisToCents(14313.3)).toBe(1_431_330);
  });
});
