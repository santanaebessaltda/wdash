import { describe, expect, it, vi } from "vitest";
import { addDaysIso, syncStoreCashClose, ymdInTz } from "./runSyncJob.ts";

const store = {
  id: "s1",
  code: "00386",
  millenniumStoreId: 1,
  timezone: "America/Sao_Paulo",
};

const line = { paymentMethod: "DINHEIRO", openingReais: 0, sangriaReais: null, closingReais: 10, typedReais: 10 };

describe("syncStoreCashClose", () => {
  it("relê o dia já gravado quando o Atualizar pede o mês", async () => {
    const today = ymdInTz(new Date(), store.timezone);
    const day = addDaysIso(today, -10);
    const fetchCashCloseReport = vi.fn(async () => [line]);
    const replaceCashCloseDays = vi.fn(async () => {});
    const listFilledCloseDays = vi.fn(async () => [day]);
    await syncStoreCashClose(
      { fetchCashCloseReport, replaceCashCloseDays, listFilledCloseDays },
      {
        session: "s",
        tenantId: "t",
        store,
        from: day,
        to: day,
        accounts: [{ conta: 1, numero: "00386", descricao: "caixa" }],
        accountsOk: true,
        rewrite: true,
      },
    );
    expect(listFilledCloseDays).not.toHaveBeenCalled();
    expect(fetchCashCloseReport).toHaveBeenCalledWith({ session: "s", conta: 1, day });
    expect(replaceCashCloseDays).toHaveBeenCalled();
  });

  it("pula o dia já gravado fora da janela de três dias", async () => {
    const today = ymdInTz(new Date(), store.timezone);
    const day = addDaysIso(today, -10);
    const fetchCashCloseReport = vi.fn(async () => [line]);
    await syncStoreCashClose(
      { fetchCashCloseReport, replaceCashCloseDays: vi.fn(), listFilledCloseDays: vi.fn(async () => [day]) },
      {
        session: "s",
        tenantId: "t",
        store,
        from: day,
        to: day,
        accounts: [{ conta: 1, numero: "00386", descricao: "caixa" }],
        accountsOk: true,
      },
    );
    expect(fetchCashCloseReport).not.toHaveBeenCalled();
  });
});
