/**
 * T8: consistencia entre as abas  -  no mesmo escopo, KPIs da Equipe batem com
 * os da Visao geral (mesma fonte `agregadoLoja`/`agregadoPeriodo`, formatos
 * iguais) e os estados da view sao coerentes. EQUIP-01.
 */
import { describe, expect, it } from "vitest";
import { buildTeamView } from "./teamViews";
import { buildStoreView } from "./dashboard";
import type { Scope } from "./dashboard";

function escopo(filialId: string = "f1", periodo: Scope["periodo"] = { tipo: "esteMes" }): Scope {
  return { filialIds: filialId === "todas" ? [] : [filialId], periodo, divisao: null };
}

describe("T8: integração — Equipe e Visão geral concordam (EQUIP-01)", () => {
  it("faturamento da Equipe = faturamento da Visão geral no mesmo escopo (loja e rede)", () => {
    for (const periodo of [{ tipo: "esteMes" }, { tipo: "hoje" }, { tipo: "7dias" }] as const) {
      for (const filialId of ["f1", "f2", "todas"]) {
        const eq = buildTeamView(escopo(filialId, periodo));
        const dash = buildStoreView(escopo(filialId, periodo));
        expect(eq.kpiFaturamento.valor, `${filialId}/${periodo.tipo}`).toBe(dash.kpiFaturamento.valor);
      }
    }
  });

  it("delta do faturamento é o mesmo nas duas abas (mesma comparação do Dashboard)", () => {
    for (const filialId of ["f1", "todas"]) {
      const eq = buildTeamView(escopo(filialId, { tipo: "7dias" }));
      const dash = buildStoreView(escopo(filialId, { tipo: "7dias" }));
      expect(eq.kpiFaturamento.delta?.value).toBe(dash.kpiFaturamento.delta?.value);
      expect(eq.kpiFaturamento.delta?.positive).toBe(dash.kpiFaturamento.delta?.positive);
    }
  });

  it("ticket e P.A. da Equipe batem com os da Visão geral (loja)", () => {
    for (const periodo of [{ tipo: "esteMes" }, { tipo: "hoje" }] as const) {
      const eq = buildTeamView(escopo("f1", periodo));
      const dash = buildStoreView(escopo("f1", periodo));
      expect(eq.kpiTicket.valor).toBe(dash.kpiTicket.valor);
      expect(eq.kpiPA.valor).toBe(dash.kpiPA.valor);
    }
  });

  it("estados coerentes: kpis e desafios disponíveis mesmo com filtro Hoje (AD-046)", () => {
    const dia = buildTeamView(escopo("f1", { tipo: "hoje" }));
    expect(dia.estados.kpis).toBe("disponivel");
    expect(dia.estados.challenges).toBe("disponivel");
    expect(dia.metaAtiva).toBe(true);
    const mes = buildTeamView(escopo("f1", { tipo: "esteMes" }));
    expect(mes.estados.kpis).toBe("disponivel");
    expect(mes.estados.challenges).toBe("disponivel");
  });
});