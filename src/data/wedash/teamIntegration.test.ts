/**
 * T8: consistencia entre as abas  -  no mesmo escopo, KPIs da Equipe batem com
 * os da Visao geral (mesma fonte `agregadoLoja`/`agregadoPeriodo`, formatos
 * iguais) e os estados da view sao coerentes. EQUIP-01.
 */
import { describe, expect, it } from "vitest";
import { buildTeamView } from "./teamViews";
import { buildStoreView } from "./dashboard";
import type { Scope } from "./dashboard";

function scope(storeId: string = "f1", period: Scope["period"] = { kind: "thisMonth" }): Scope {
  return { storeIds: storeId === "todas" ? [] : [storeId], period, division: null };
}

describe("T8: integração — Equipe e Visão geral concordam (EQUIP-01)", () => {
  it("faturamento da Equipe = faturamento da Visão geral no mesmo escopo (loja e rede)", () => {
    for (const period of [{ kind: "thisMonth" }, { kind: "today" }, { kind: "last7Days" }] as const) {
      for (const storeId of ["f1", "f2", "todas"]) {
        const eq = buildTeamView(scope(storeId, period));
        const dash = buildStoreView(scope(storeId, period));
        expect(eq.kpiRevenue.amount, `${storeId}/${period.kind}`).toBe(dash.kpiRevenue.amount);
      }
    }
  });

  it("delta do faturamento é o mesmo nas duas abas (mesma comparação do Dashboard)", () => {
    for (const storeId of ["f1", "todas"]) {
      const eq = buildTeamView(scope(storeId, { kind: "last7Days" }));
      const dash = buildStoreView(scope(storeId, { kind: "last7Days" }));
      expect(eq.kpiRevenue.delta?.value).toBe(dash.kpiRevenue.delta?.value);
      expect(eq.kpiRevenue.delta?.positive).toBe(dash.kpiRevenue.delta?.positive);
    }
  });

  it("ticket e P.A. da Equipe batem com os da Visão geral (loja)", () => {
    for (const period of [{ kind: "thisMonth" }, { kind: "today" }] as const) {
      const eq = buildTeamView(scope("f1", period));
      const dash = buildStoreView(scope("f1", period));
      expect(eq.kpiTicket.amount).toBe(dash.kpiTicket.amount);
      expect(eq.kpiPA.amount).toBe(dash.kpiPA.amount);
    }
  });

  it("estados coerentes: kpis e desafios disponíveis mesmo com filtro Hoje (AD-046)", () => {
    const day = buildTeamView(scope("f1", { kind: "today" }));
    expect(day.states.kpis).toBe("available");
    expect(day.states.challenges).toBe("available");
    expect(day.activeGoal).toBe(true);
    const month = buildTeamView(scope("f1", { kind: "thisMonth" }));
    expect(month.states.kpis).toBe("available");
    expect(month.states.challenges).toBe("available");
  });
});