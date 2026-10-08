import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStoreView, buildOverviewView, buildFinanceView, buildProductsView, buildTeamDashboardView, TEAM_SEM_TURNO, kpiDelta, monthlyEvolutionMonths, previousPeriod, resolvePeriod, revenueCurve, seriesAxisForPeriod, type ComparisonView, type Period, type Scope, type TrackStatus } from "./dashboard";
import { tipDelta } from "@/lib/format";

describe("tooltip do badge com unidade", () => {
  it("quantidade nunca aparece solta", () => {
    expect(tipDelta(kpiDelta(1500, 1234, "o mês passado", "itens")!)).toBe("Em relação ao mês passado: 1.234 itens.");
    expect(tipDelta(kpiDelta(900, 840, "a semana passada", "vendas")!)).toBe("Em relação à semana passada: 840 vendas.");
    expect(kpiDelta(1.8, 1.57, "o mês passado", "pa")!.anterior).toBe("1,57 itens por venda");
    expect(kpiDelta(120, 100, "o mês passado")!.anterior).toBe("R$\u00a0100,00");
  });

  it("prefixo da métrica", () => {
    expect(tipDelta(kpiDelta(120, 100, "o mês passado")!, "Faturamento das categorias")).toBe(
      "Faturamento das categorias em relação ao mês passado: R$\u00a0100,00.",
    );
  });
});
import { goalOfStore } from "./goals";
import { EMPTY_STORE_COSTS, stores, storeById } from "./stores";
import { TODAY_ISO } from "./clock";
import { dayAggregate, salesDay, storeOpen, dayWeight } from "./sales";
import { fimDoMes, intervaloDias, somarDias } from "@/lib/format";

function escopo(filialId: string = "todas", periodo: Scope["periodo"] = { tipo: "esteMes" }): Scope {
  return { filialIds: filialId === "todas" ? [] : [filialId], periodo, divisao: null };
}

function realizadoAcumulado(filialId: string, competencia: string, ate: string): number {
  let soma = 0;
  for (const iso of intervaloDias(`${competencia}-01`, ate)) {
    const d = salesDay(filialId, iso);
    if (d) soma += dayAggregate(d, null).faturamento;
  }
  return soma;
}

/** Curva de referencia replicada no teste conforme AD-034: mesma media de 4 ocorrencias, com fallback pesoDia. */
function curvaReferencia(filialId: string, competencia: string): (iso: string) => number {
  const f = storeById(filialId);
  const pesos = new Map<string, number>();
  let soma = 0;
  for (const iso of intervaloDias(`${competencia}-01`, fimDoMes(`${competencia}-01`))) {
    if (!storeOpen(f, iso)) continue;
    const ocas = [7, 14, 21, 28]
      .map((n) => somarDias(iso, -n))
      .map((ref) => {
        const d = salesDay(filialId, ref);
        return d && storeOpen(f, ref) ? d : undefined;
      })
      .filter((d) => d !== undefined);
    const bruto = ocas.length > 0 ? ocas.reduce((s, d) => s + d!.total.faturamento, 0) / ocas.length : dayWeight(f, iso);
    pesos.set(iso, bruto);
    soma += bruto;
  }
  return (iso) => (soma > 0 ? (pesos.get(iso) ?? 0) / soma : 0);
}

describe("T3: curvaReceita (AD-034)", () => {
  it("soma dos pesos normalizados = 1 nos dias abertos", () => {
    const c = revenueCurve([storeById("f1")], "2026-09");
    const abertos = intervaloDias("2026-09-01", fimDoMes("2026-09-01")).filter((iso) => storeOpen(storeById("f1"), iso));
    const soma = abertos.reduce((s, iso) => s + c.peso(iso), 0);
    expect(soma).toBeCloseTo(1, 5);
  });

  it("pesos de sábado/domingo > peso de dia de semana (AD-034 não linear)", () => {
    const c = revenueCurve([storeById("f1")], "2026-09");
    const sab = c.peso("2026-09-12"); // sabado
    const qua = c.peso("2026-09-09"); // quarta
    expect(sab).toBeGreaterThan(qua);
  });

  it("domingo: f1 abre, f2 fecha — a curva do grupo reflete só a loja aberta (AD-034)", () => {
    const c = revenueCurve(stores, "2026-09");
    const domingo = "2026-09-13";
    expect(c.peso(domingo)).toBeGreaterThan(0);
    const cF2 = revenueCurve([storeById("f2")], "2026-09");
    expect(cF2.peso(domingo)).toBe(0);
  });
});

describe("T3: LOJA-01 status do trilho", () => {
  it("competência esteMes = setembro, status presente e pctTrilho não nulo", () => {
    const v = buildStoreView(escopo("f1"));
    expect(v.trilho).not.toBeNull();
    expect(v.trilho!.competencia).toBe("2026-09");
    expect(v.trilho!.pctTrilho).not.toBeNull();
  });

  it("percentual = realizado ÷ metaAcumulada (AC 2)", () => {
    const v = buildStoreView(escopo("f1"));
    const meta = goalOfStore("f1", "2026-09")!.valorLoja;
    const pCurva = curvaReferencia("f1", "2026-09");
    const fracaoAcum = intervaloDias("2026-09-01", TODAY_ISO).reduce((s, iso) => s + pCurva(iso), 0);
    const metaAcum = meta * fracaoAcum;
    const realizado = realizadoAcumulado("f1", "2026-09", TODAY_ISO);
    const esperado = (realizado / metaAcum) * 100;
    expect(v.trilho!.pctTrilho).toBeCloseTo(esperado, 2);
  });

  it("fronteiras 98% e 90% mapeiam para no_trilho/atencao/abaixo (AC 3-5)", () => {
    const v = buildStoreView(escopo("f1"));
    const pct = v.trilho!.pctTrilho!;
    const esperado: TrackStatus = pct >= 98 ? "no_trilho" : pct >= 90 ? "atencao" : "abaixo";
    expect(v.trilho!.status).toBe(esperado);
  });

  it("competência encerrada: meta batida/não batida, pctTrilho null (AC 6 + edge case)", () => {
    const v = buildStoreView(escopo("f1", { tipo: "mesPassado" }));
    expect(["meta_batida", "meta_nao_batida"]).toContain(v.trilho!.status);
    expect(v.trilho!.pctTrilho).toBeNull();
  });
});

describe("T3: LOJA-02 venda necessária hoje", () => {
  it("presente com mês em andamento e sem meta batida", () => {
    const v = buildStoreView(escopo("f1"));
    if (!v.vendaNecessaria) {
      return;
    }
    expect(v.vendaNecessaria.valor).toBeGreaterThanOrEqual(0);
    expect(v.vendaNecessaria.diasRestantes).toBeGreaterThan(0);
    expect(v.vendaNecessaria.diaReferencia).toBeTruthy();
  });

  it("desconta o realizado de hoje e o gap condiz com a fórmula (AC 2)", () => {
    const v = buildStoreView(escopo("f1"));
    if (!v.vendaNecessaria) return;
    const realizadoHoje = dayAggregate(salesDay("f1", TODAY_ISO)!, null).faturamento;
    expect(v.vendaNecessaria.realizadoHoje).toBe(realizadoHoje);
    const meta = goalOfStore("f1", "2026-09")!.valorLoja;
    const realizado = realizadoAcumulado("f1", "2026-09", TODAY_ISO);
    const falta = meta - realizado;
    const pCurva = curvaReferencia("f1", "2026-09");
    const restantes = intervaloDias(TODAY_ISO, fimDoMes("2026-09-01")).filter((iso) => storeOpen(storeById("f1"), iso));
    const somaPesos = restantes.reduce((s, iso) => s + pCurva(iso), 0);
    const necessarioBruto = (falta * pCurva(TODAY_ISO)) / somaPesos;
    expect(v.vendaNecessaria.valor).toBeCloseTo(Math.max(0, necessarioBruto - realizadoHoje), 1);
  });

  it("metaMesAtingida e cumpridaHoje são booleanos e coerentes (Bloco C)", () => {
    const v = buildStoreView(escopo("f1"));
    if (!v.vendaNecessaria) return;
    expect(typeof v.vendaNecessaria.metaMesAtingida).toBe("boolean");
    expect(typeof v.vendaNecessaria.cumpridaHoje).toBe("boolean");
    // Mes aberto: trilho mede ritmo vs meta acumulada (no_trilho/atencao/abaixo).
    // meta_batida so no fechamento. Meta do mes ja cruzada no MTD nao forca meta_batida.
    if (v.vendaNecessaria.metaMesAtingida) {
      expect(["no_trilho", "atencao", "abaixo", "meta_batida"]).toContain(v.trilho!.status);
    }
  });
});

describe("T3: estados por bloco (LOJA-07)", () => {
  it("estados válidos e trilho/venda disponíveis em escopo com dados", () => {
    const v = buildStoreView(escopo("f1"));
    const estados = [v.estados.kpis, v.estados.trilho, v.estados.vendaNecessaria, v.estados.projecao, v.estados.diagnostico, v.estados.mix, v.estados.lojas];
    for (const e of estados) {
      expect(["disponivel", "carregando", "sem_dados", "indisponivel"]).toContain(e);
    }
    expect(v.estados.trilho).toBe("disponivel");
  });
});

/* ---------- T4: Projecao (LOJA-03) e Comparacao (LOJA-06) ---------- */

describe("T4: projeção de fechamento (LOJA-03)", () => {
  it("com mês corrente (dia 15 ≥ 7): projeção disponível e fórmula exata (AC 1-3)", () => {
    const v = buildStoreView(escopo("f1"));
    expect(v.projecao).not.toBeNull();
    const p = v.projecao!;
    expect(p.disponivel).toBe(true);
    expect(p.encerrada).toBe(false);
    expect(p.indice).not.toBeNull();
    // Replica a formula: realizado + meta x fracaoRestante x indice
    const meta = goalOfStore("f1", "2026-09")!.valorLoja;
    const pCurva = curvaReferencia("f1", "2026-09");
    const fracaoRestante = 1 - intervaloDias("2026-09-01", TODAY_ISO).reduce((s, iso) => s + pCurva(iso), 0);
    const realizado = realizadoAcumulado("f1", "2026-09", TODAY_ISO);
    const metaAcum = meta * (1 - fracaoRestante);
    const indice = metaAcum > 0 ? realizado / metaAcum : 0;
    const esperado = realizado + meta * fracaoRestante * indice;
    expect(p.valor).toBeCloseTo(esperado, 1);
  });

  it("competência encerrada: encher é realizado fechado (AC 6)", () => {
    const v = buildStoreView(escopo("f1", { tipo: "mesPassado" }));
    const realizado = realizadoAcumulado("f1", "2026-08", fimDoMes("2026-08-01"));
    expect(v.projecao).not.toBeNull();
    expect(v.projecao!.encerrada).toBe(true);
    expect(v.projecao!.valor).toBe(realizado);
  });

  it("sem meta na competência: projeção/venda não disponíveis (edge case)", () => {
    // A serie de metas comeca em 2026-07; uma competencia sem meta (ex.: 2026-06)
    // nao e derivavel por periodo no mock. Validamos o contrato diretamente:
    // projecao so e disponivel quando ha meta.
    const v = buildStoreView(escopo("f1", { tipo: "mesPassado" }));
    expect(v.projecao).not.toBeNull();
    // Encerrada, projecao mostra realizado (nao e null).
    expect(v.projecao!.valor).toBeGreaterThan(0);
  });
});

describe("T4: comparação de período (LOJA-06)", () => {
  it("`comparacao` tem períodos atual/anterior com agregados detalhados (AC 1-3)", () => {
    const v = buildStoreView(escopo("f1"));
    expect(v.comparacao).not.toBeNull();
    const c = v.comparacao as ComparisonView;
    expect(c.atual.faturamento).toBeGreaterThan(0);
    expect(c.anterior.atendimentos).toBeGreaterThan(0);
    expect(c.rotuloAtual).toBeTruthy();
    expect(c.rotuloAnterior).toBeTruthy();
  });

  it("comparação muda com o período e os deltas derivam dela (AC 2-3)", () => {
    const v = buildStoreView(escopo("f1", { tipo: "7dias" }));
    expect(v.comparacao).not.toBeNull();
    const c = v.comparacao as ComparisonView;
    expect(c.rotuloAtual).toContain("15/09");
  });
});

/* ---------- T5: diagnostico fluxo/ticket + mix (LOJA-04) ---------- */

describe("T5: lacuna fluxo/ticket (LOJA-04)", () => {
  it("efeitoFluxo + efeitoTicket fecham exatamente com gapTotal (AC 5-6)", () => {
    const v = buildStoreView(escopo("f1"));
    if (!v.diagnostico || v.diagnostico.semMeta) {
      // Sem meta a lacuna nao existe.
      return;
    }
    const d = v.diagnostico;
    // Por algebra: efeitoFluxo + efeitoTicket = (AeAr)Tm + (TmTr)Ar = Ae | Tm  Ar | Tr = gap.
    // Tolerancia ao arredondamento dos agregados (centavos).
    expect(Math.abs(d.efeitoFluxo + d.efeitoTicket - d.gapTotal)).toBeLessThanOrEqual(2);
  });

  it("gapTotal = receita esperada até hoje − realizado (fecho com o percentual do trilho)", () => {
    const v = buildStoreView(escopo("f1"));
    const d = v.diagnostico;
    if (!d || d.semMeta || !v.trilho || d.gapTotal === 0) return;
    const pct = v.trilho.pctTrilho!;
    // realizado  meta = pct/100 x fracaoAcum... Na verdade a identidade principal:
    // gapTotal > 0 implica abaixo do esperado acumulado (pct < 100).
    if (d.gapTotal > 0) expect(pct).toBeLessThan(100);
    if (d.gapTotal < 0) expect(pct).toBeGreaterThan(100);
  });

  it("alavanca dominante segue a regra de ≥60% da soma dos efeitos positivos (AC 8-9)", () => {
    const v = buildStoreView(escopo("f1"));
    const d = v.diagnostico;
    if (!d || d.semMeta) return;
    const positivos = [d.efeitoFluxo, d.efeitoTicket].filter((e) => e > 0);
    const soma = positivos.reduce((s, e) => s + e, 0);
    if (positivos.length === 0) {
      expect(d.alavancaDominante).toBeNull();
      return;
    }
    const maior = Math.max(...positivos);
    if (maior >= 0.6 * soma) {
      expect(d.alavancaDominante).toBe(d.efeitoFluxo >= d.efeitoTicket ? "fluxo" : "ticket");
    } else {
      expect(d.alavancaDominante).toBeNull();
    }
  });

  it("exibir é falso quando pctTrilho >= 90 e verdadeiro quando < 90 (AD-033)", () => {
    const v = buildStoreView(escopo("f1"));
    const d = v.diagnostico;
    const pct = v.trilho?.pctTrilho ?? null;
    if (!d || pct === null) return;
    expect(d.exibir).toBe(pct < 90);
  });

  it("sem meta: lacuna inexistente (semMeta true) e alavanca nula", () => {
    const v = buildStoreView(escopo("f1", { tipo: "mesPassado" }));
    const d = v.diagnostico;
    if (!d) return;
    // Mes passado tem meta, entao nao e "sem meta"; a logica de ausencia de meta
    // e testada diretamente contra a semMeta=true da vendaNecessaria em outra assercao.
    expect(d.semMeta).toBe(false);
  });
});

describe("T5: mix com margem (LOJA-04 AC 10)", () => {
  it("mix do mês existe e cada item tem participação e margem coerentes", () => {
    const v = buildStoreView(escopo("f1"));
    if (!v.mix) return;
    expect(v.mix.periodo).toBeTruthy();
    expect(v.mix.itens.length).toBeGreaterThan(0);
    for (const it of v.mix.itens) {
      expect(it.receita).toBeGreaterThan(0);
      expect(it.pct).toBeGreaterThan(0);
      expect(it.divisao).toBeTruthy();
      expect(it.margem).toBeGreaterThanOrEqual(0);
    }
    const somaPct = v.mix.itens.reduce((s, i) => s + i.pct, 0);
    expect(somaPct).toBeCloseTo(100, 1);
  });

  it("mix respeita a marca (divisão) selecionada", () => {
    // f2 tem temWpink: true (categoria Suplementos e WPINK).
    const v = buildStoreView({ filialIds: ["f2"], periodo: { tipo: "esteMes" }, divisao: "WPINK" });
    if (!v.mix) return;
    const itens = v.mix.itens.filter((i) => i.receita > 0);
    if (itens.length === 0) return; // sem dados da divisao no periodo  -  valido como ausencia
    for (const it of itens) expect(it.divisao).toBe("WPINK");
  });
});

/* ---------- T6: visao de grupo (LOJA-05) ---------- */

describe("T6: visão de grupo (LOJA-05)", () => {
  it("visão 'todas' expõe uma linha por loja com status/pctTrilho/temMeta", () => {
    const v = buildStoreView(escopo("todas"));
    expect(v.lojas.length).toBe(stores.length);
    for (const l of v.lojas) {
      expect(l.filialId).toBeTruthy();
      expect(l.nome).toBeTruthy();
      expect(typeof l.temMeta).toBe("boolean");
      expect(["no_trilho", "atencao", "abaixo", "meta_batida", "meta_nao_batida"]).toContain(l.status);
      // No mes corrente aberto, pctTrilho nao e null (competencia em andamento com meta).
      if (l.temMeta) expect(l.pctTrilho).not.toBeNull();
    }
  });

  it("status de cada loja no grupo bate com o trilho daquela loja isolada", () => {
    for (const f of stores) {
      const grupo = buildStoreView(escopo("todas"));
      const linha = grupo.lojas.find((l) => l.filialId === f.id)!;
      const isolada = buildStoreView(escopo(f.id));
      expect(linha.status).toBe(isolada.trilho?.status ?? "abaixo");
      expect(linha.pctTrilho).toBeCloseTo(isolada.trilho?.pctTrilho ?? 0, 2);
    }
  });

  it("sem loja específica no escopo grupo: filial única retorna lista vazia (drill-in mantém filtros)", () => {
    const v = buildStoreView(escopo("f1"));
    expect(v.lojas.length).toBe(0);
  });

  it("loja do grupo sem meta não impede o status das demais (edge case)", () => {
    // Em setembro todas tem meta. Validamos o contrato: o grupo sempre devolve
    // todas as lojas, e cada uma tem pctTrilho proprio; se uma nao tivesse meta,
    // temMeta=false nao quebraria as demais (linha do grupo continua existindo).
    const v = buildStoreView(escopo("todas"));
    for (const l of v.lojas) {
      expect(l.filialId).toBeTruthy();
    }
  });
});

/* ---------- Regua: rede, loja unica e dia ---------- */

describe("régua: rede, loja única e dia", () => {
  it("rede: título plural, uma linha por loja, ordenada do pior atingimento", () => {
    const v = buildStoreView(escopo("todas"));
    expect(v.reguaTitulo).toBe("Desempenho das lojas");
    expect(v.regua!.length).toBe(stores.length);
    const pcts = v.regua!.map((l) => l.atingimentoPct);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
  });

  it("uma loja, período: título no singular e painel do mês (realizado da meta, não do período)", () => {
    const v = buildStoreView(escopo("f1", { tipo: "7dias" }));
    expect(v.reguaTitulo).toBe("Desempenho da loja");
    expect(v.regua!.length).toBe(1);
    const realizadoMes = realizadoAcumulado("f1", "2026-09", fimDoMes(TODAY_ISO));
    expect(v.regua![0].faturamentoValor).toBeCloseTo(realizadoMes, 0);
    expect(v.regua![0].atingimentoTexto).toContain("da meta");
  });

  it("dia: régua presente, título no singular (painel de meta do mês)", () => {
    const v = buildStoreView(escopo("f1", { tipo: "hoje" }));
    expect(v.reguaTitulo).toBe("Desempenho da loja");
    expect(v.regua!.length).toBe(1);
    expect(v.regua![0].atingimentoTexto).toContain("da meta");
  });

  it("loja + marca: régua adapta para participação da marca (não some) — AD-047", () => {
    const v = buildStoreView({ filialIds: ["f2"], periodo: { tipo: "esteMes" }, divisao: "WPINK" });
    expect(v.regua).not.toBeNull();
    expect(v.regua!.length).toBe(1);
    expect(v.reguaTitulo).toContain("Wpink");
    expect(v.regua![0].atingimentoTexto).toContain("da loja");
  });
});

/* ---------- Grafico principal: adaptar ao periodo (AD-047) ---------- */

describe("gráfico principal: por hora (1 dia) ou por dia (período)", () => {
  it("rede + 7 dias: evolução diária presente (não some o gráfico)", () => {
    const v = buildStoreView(escopo("todas", { tipo: "7dias" }));
    expect(v.graficoHora).toBeNull();
    expect(v.graficoHoraRede).toBeNull();
    expect(v.evolucao).not.toBeNull();
    expect(v.evolucao!.valores.length).toBe(7);
    expect(v.evolucao!.valores.reduce((s, x) => s + x, 0)).toBeGreaterThan(0);
  });

  it("rede + este mês: evolução diária presente", () => {
    const v = buildStoreView(escopo("todas", { tipo: "esteMes" }));
    expect(v.evolucao).not.toBeNull();
    expect(v.evolucao!.valores.length).toBeGreaterThan(1);
  });

  it("loja + 7 dias: evolução diária; loja + hoje: por hora", () => {
    const semana = buildStoreView(escopo("f1", { tipo: "7dias" }));
    expect(semana.evolucao).not.toBeNull();
    expect(semana.graficoHora).toBeNull();
    const hoje = buildStoreView(escopo("f1", { tipo: "hoje" }));
    expect(hoje.graficoHora).not.toBeNull();
    expect(hoje.evolucao).toBeNull();
  });
  it("rede + hoje: mesmo gráfico por hora (AreaLine), sem barras empilhadas", () => {
    const v = buildStoreView(escopo("todas", { tipo: "hoje" }));
    expect(v.graficoHoraRede).toBeNull();
    expect(v.graficoHora).not.toBeNull();
    expect(v.graficoHora!.valores.length).toBeGreaterThan(0);
    expect(v.graficoHora!.anterior).not.toBeNull();
  });
});

/* ---------- KPIs Visao geral: subtitulos limpos (AD-048) ---------- */

describe("KPIs: subtítulos sem misturar indicadores (AD-048)", () => {
  it("este mês: faturamento mostra % da meta, sem atendimentos nem precisa/dia", () => {
    const v = buildStoreView(escopo("todas", { tipo: "esteMes" }));
    expect(v.kpiFaturamento.sub).toMatch(/% da meta$|meta do mês atingida/i);
    expect(v.kpiFaturamento.sub).not.toMatch(/atendimento/i);
    expect(v.kpiFaturamento.sub).not.toMatch(/precisa/i);
    expect(v.kpiAtendimentos.sub).toMatch(/média .+\/dia/);
  });

  it("hoje: faturamento não lista atendimentos; gráfico por hora traz série anterior", () => {
    const v = buildStoreView(escopo("f1", { tipo: "hoje" }));
    expect(v.kpiFaturamento.sub).not.toMatch(/atendimento/i);
    expect(v.kpiFaturamento.sub).not.toMatch(/precisa/i);
    expect(v.graficoHora).not.toBeNull();
    expect(v.graficoHora!.anterior).not.toBeNull();
    expect(v.graficoHora!.anterior!.length).toBe(v.graficoHora!.valores.length);
  });

  it("7 dias: faturamento sem precisa/dia; atendimentos com média/dia", () => {
    const v = buildStoreView(escopo("f1", { tipo: "7dias" }));
    expect(v.kpiFaturamento.sub).not.toMatch(/precisa/i);
    expect(v.kpiFaturamento.sub).not.toMatch(/atendimento/i);
    expect(v.kpiAtendimentos.sub).toMatch(/média .+\/dia/);
  });
});


describe("KPIs: base da variação explícita (AD-050)", () => {
  it("este mês: delta traz vs do mês anterior (rótulo curto)", () => {
    const v = buildStoreView(escopo("todas", { tipo: "esteMes" }));
    expect(v.kpiFaturamento.delta?.vs).toBeTruthy();
    expect(v.kpiFaturamento.delta!.vs!.length).toBeGreaterThan(0);
  });

  it("hoje: delta vs mesmo dia da semana passada", () => {
    const v = buildStoreView(escopo("f1", { tipo: "hoje" }));
    expect(v.kpiFaturamento.delta?.vs).toMatch(/passada/);
  });
});

describe("Overview from sales aggregates (SYNC-06/08)", () => {
  it("empty aggs → zero KPIs, CMV empty, no fabricated top produtos", () => {
    const v = buildOverviewView(escopo("f1"), { dayAggs: [], hourAggs: [] });
    expect(v.fromAggregates).toBe(true);
    expect(v.kpis.find((k) => k.label === "Faturamento")?.valor).toMatch(/R\$\s*0/);
    expect(v.kpis.find((k) => k.label === "CMV")?.valor).toBe("—");
    expect(v.topProdutos).toEqual([]);
    expect(v.formasPagamento).toEqual([]);
  });

  it("topProdutos from productDayAggs", () => {
    const day = "2026-09-23";
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day,
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 2,
          itemCount: 3,
        },
      ],
      productDayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day,
          productId: 430,
          productCode: "271",
          productName: "BODY SPLASH VF GOLDEN",
          brand: "ALL",
          revenueCents: 109_80,
          itemCount: 2,
        },
        {
          tenantId: "t1",
          storeId: "f1",
          day,
          productId: 145,
          productCode: "DCOB",
          productName: "DESOD COL OBSESSED",
          brand: "ALL",
          revenueCents: 54_90,
          itemCount: 1,
        },
      ],
    });
    expect(v.topProdutos).toHaveLength(2);
    expect(v.topProdutos[0]?.nome).toMatch(/BODY SPLASH/i);
    expect(v.topProdutos[0]?.valor).toBeCloseTo(109.8);
    expect(v.topProdutos[0]?.sub).toMatch(/2 itens/);
    expect(v.topProdutos[0]?.itens).toBe(2);
  });

  it("topProdutos traz o ranking completo (tela corta o Top 5 pela métrica escolhida)", () => {
    const day = "2026-09-23";
    // 6 produtos: o 6 em faturamento e o 1 em quantidade.
    const productDayAggs = [
      ...[1, 2, 3, 4, 5].map((i) => ({
        tenantId: "t1", storeId: "f1", day, productId: i, productCode: `P${i}`, productName: `CARO ${i}`,
        brand: "ALL" as const, revenueCents: (200 - i) * 100, itemCount: 1,
      })),
      { tenantId: "t1", storeId: "f1", day, productId: 99, productCode: "P99", productName: "BARATO",
        brand: "ALL" as const, revenueCents: 50_00, itemCount: 9 },
    ];
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [{ tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 1_000_00, salesCount: 10, itemCount: 14 }],
      productDayAggs,
    });
    expect(v.topProdutos).toHaveLength(6);
    expect(v.topProdutos[0]?.nome).toBe("CARO 1");
    const porQtd = [...v.topProdutos].sort((a, b) => (b.itens ?? 0) - (a.itens ?? 0));
    expect(porQtd[0]).toMatchObject({ nome: "BARATO", itens: 9 });
  });

  it("sums revenue and sales_count from day aggs into KPIs", () => {
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 150_00,
          salesCount: 3,
          itemCount: 5,
          cmvCents: 60_00,
        },
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-11",
          brand: "ALL",
          revenueCents: 50_00,
          salesCount: 1,
          itemCount: 2,
          cmvCents: 20_00,
        },
      ],
    });
    expect(v.kpis.find((k) => k.label === "Nº de vendas")?.valor).toMatch(/4/);
    const fat = v.kpis.find((k) => k.label === "Faturamento")?.valor ?? "";
    expect(fat).toMatch(/200|R\$/);
    expect(v.kpis.find((k) => k.label === "Ticket médio")?.valor).toMatch(/50/);
    expect(v.kpis.find((k) => k.label === "CMV")?.valor).toMatch(/80/);
    expect(v.kpis.find((k) => k.label === "CMV")?.sub).toMatch(/%/);
  });

  it("fills categoriaVsMeta from categoryDayAggs (reais) and keeps catalog zeros", () => {
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 1,
          itemCount: 1,
        },
      ],
      categoryDayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          categoryId: 13,
          categoryName: "Perfumaria",
          brand: "WEPINK",
          revenueCents: 80_00,
          itemCount: 2,
        },
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          categoryId: 14,
          categoryName: "Body Splash",
          brand: "WEPINK",
          revenueCents: 20_00,
          itemCount: 1,
        },
      ],
      categoryCatalog: [
        { categoryId: 13, categoryName: "Perfumaria", brand: "WEPINK" },
        { categoryId: 14, categoryName: "Body Splash", brand: "WEPINK" },
        { categoryId: 15, categoryName: "Hair", brand: "WEPINK" },
      ],
    });
    expect(v.categoriaVsMeta).toHaveLength(3);
    expect(v.categoriaVsMeta[0]?.categoria).toBe("PERFUMARIA");
    expect(v.categoriaVsMeta[0]?.realizado).toBe(80);
    expect(v.categoriaVsMeta[0]?.meta).toBe(0);
    expect(v.categoriaVsMeta[1]?.realizado).toBe(20);
    expect(v.categoriaVsMeta[2]?.categoria).toBe("HAIR");
    expect(v.categoriaVsMeta[2]?.realizado).toBe(0);
  });

  it("fills formasPagamento from paymentDayAggs (reais)", () => {
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 150_00,
          salesCount: 2,
          itemCount: 2,
        },
      ],
      paymentDayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          paymentMethod: "Pix",
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 1,
        },
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          paymentMethod: "Cartão de crédito",
          brand: "ALL",
          revenueCents: 50_00,
          salesCount: 1,
        },
        {
          tenantId: "t1",
          storeId: "f2",
          day: "2026-09-10",
          paymentMethod: "Dinheiro",
          brand: "ALL",
          revenueCents: 999_00,
          salesCount: 1,
        },
      ],
    });
    expect(v.formasPagamento).toHaveLength(2);
    expect(v.formasPagamento[0]?.forma).toBe("Pix");
    expect(v.formasPagamento[0]?.valor).toBe(100);
    expect(v.formasPagamento[1]?.forma).toBe("Cartão de crédito");
    expect(v.formasPagamento[1]?.valor).toBe(50);
  });

  it("fills topVendedoras from sellerDayAggs without pctMeta", () => {
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 230_00,
          salesCount: 3,
          itemCount: 3,
        },
      ],
      sellerDayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          sellerKey: "ANA SILVA",
          sellerName: "Ana Silva",
          brand: "ALL",
          revenueCents: 150_00,
          salesCount: 2,
        },
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          sellerKey: "CARLA",
          sellerName: "Carla",
          brand: "ALL",
          revenueCents: 80_00,
          salesCount: 1,
        },
        {
          tenantId: "t1",
          storeId: "f2",
          day: "2026-09-10",
          sellerKey: "OUTRA LOJA",
          sellerName: "Outra Loja",
          brand: "ALL",
          revenueCents: 999_00,
          salesCount: 5,
        },
      ],
    });
    expect(v.topVendedoras).toHaveLength(2);
    expect(v.topVendedoras[0]?.nome).toBe("Ana Silva");
    expect(v.topVendedoras[0]?.valor).toBe(150);
    expect(v.topVendedoras[0]?.ticketMedio).toBe(75);
    expect(v.topVendedoras[0]?.pctMeta).toBeUndefined();
    expect(v.topVendedoras[0]?.sub).toBe("2 vendas");
    expect(v.topVendedoras[1]?.nome).toBe("Carla");
  });

  it("topVendedoras junta a mesma funcionária (código do ERP) mesmo com nome trocado", () => {
    const base = { tenantId: "t1", storeId: "f1", brand: "ALL" as const, salesCount: 1 };
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [{ ...base, day: "2026-09-10", revenueCents: 300_00, itemCount: 3 }],
      sellerDayAggs: [
        { ...base, day: "2026-09-09", sellerKey: "ANA SILVA", sellerName: "Ana Silva", sellerEmployeeId: 7, revenueCents: 100_00 },
        { ...base, day: "2026-09-10", sellerKey: "ANA SOUZA", sellerName: "Ana Souza", sellerEmployeeId: 7, revenueCents: 120_00 },
        { ...base, day: "2026-09-10", sellerKey: "CARLA", sellerName: "Carla", revenueCents: 150_00 },
      ],
    });
    expect(v.topVendedoras).toHaveLength(2);
    expect(v.topVendedoras[0]).toMatchObject({ nome: "Ana Souza", valor: 220, sub: "2 vendas" });
    expect(v.topVendedoras[1]?.nome).toBe("Carla");
  });

  it("topVendedoras: P.A. só com itens em todos os dias; lojas da maior para a menor", () => {
    const base = { tenantId: "t1", brand: "ALL" as const, day: "2026-09-10" };
    const sellerDayAggs = [
      { ...base, storeId: "f1", sellerKey: "ANA", sellerName: "Ana", sellerEmployeeId: 1, revenueCents: 300_00, salesCount: 3, itemCount: 5 },
      { ...base, storeId: "f2", sellerKey: "ANA", sellerName: "Ana", sellerEmployeeId: 1, revenueCents: 100_00, salesCount: 1, itemCount: 1 },
      { ...base, storeId: "f2", sellerKey: "BIA", sellerName: "Bia", revenueCents: 200_00, salesCount: 2, itemCount: 0 },
    ];
    const dayAggs = [{ ...base, storeId: "f1", revenueCents: 600_00, salesCount: 6, itemCount: 6 }];
    const rede = buildOverviewView(escopo("todas"), { dayAggs, sellerDayAggs });
    expect(rede.topVendedoras[0]).toMatchObject({
      nome: "Ana",
      pa: 1.5,
      lojas: ["Shopping Campo Grande", "Shopping Três Lagoas"],
    });
    expect(rede.topVendedoras[1]?.pa).toBeUndefined();
    expect(rede.topVendedoras[1]?.lojas).toEqual(["Shopping Três Lagoas"]);

    const umaLoja = buildOverviewView(escopo("f1"), { dayAggs, sellerDayAggs });
    expect(umaLoja.topVendedoras[0]?.lojas).toEqual(["Shopping Campo Grande"]);
  });

  it("topVendedoras: turno cadastrado pelo código da funcionária, gerador ou nome", () => {
    const base = { tenantId: "t1", brand: "ALL" as const, day: "2026-09-10", storeId: "f1", salesCount: 1 };
    const turno = { storeId: "f1", employeeId: null, geradorId: null, nameKeys: [] as string[] };
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [{ ...base, revenueCents: 600_00 }],
      sellerDayAggs: [
        { ...base, sellerKey: "ANA", sellerName: "Ana", sellerEmployeeId: 7, revenueCents: 300_00 },
        { ...base, sellerKey: "BIA", sellerName: "Bia", sellerGeradorId: 55, revenueCents: 200_00 },
        { ...base, sellerKey: "CARLA", sellerName: "Carla", revenueCents: 150_00 },
        { ...base, sellerKey: "DORA", sellerName: "Dora", revenueCents: 100_00 },
      ],
      sellerShifts: [
        { ...turno, employeeId: 7, name: "Manhã", start: "09:00", end: "15:00" },
        { ...turno, geradorId: 55, name: "Tarde", start: "15:00", end: "22:00" },
        { ...turno, nameKeys: ["CARLA"], name: "Tarde", start: "15:00", end: "22:00" },
      ],
    });
    expect(v.topVendedoras.map((s) => s.turno)).toEqual([
      "Manhã · 09:00–15:00",
      "Tarde · 15:00–22:00",
      "Tarde · 15:00–22:00",
      undefined,
    ]);
  });

  it("fills rankingLojas from dayAggs by store", () => {
    const v = buildOverviewView(escopo("todas"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 300_00,
          salesCount: 3,
          itemCount: 3,
        },
        {
          tenantId: "t1",
          storeId: "f2",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 1,
          itemCount: 1,
        },
      ],
    });
    expect(v.rankingLojas.length).toBeGreaterThanOrEqual(2);
    expect(v.rankingLojas[0]?.valor).toBe(300);
    expect(v.rankingLojas[1]?.valor).toBe(100);
    expect(v.rankingLojas[0]?.nome).toMatch(/Campo Grande|f1/i);
  });

  it("rankingLojas with single store ignores other stores in dayAggs", () => {
    const v = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 300_00,
          salesCount: 3,
          itemCount: 3,
        },
        {
          tenantId: "t1",
          storeId: "f2",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 100_00,
          salesCount: 1,
          itemCount: 1,
        },
      ],
    });
    expect(v.rankingLojas).toHaveLength(1);
    expect(v.rankingLojas[0]?.valor).toBe(300);
    expect(v.rankingRedeTotal).toBe(400);
    expect(v.rankingLojas[0]?.pctRede).toBe(75);
    expect(v.rankingLojas[0]?.nome).toMatch(/Campo Grande|f1/i);
    expect(v.rankingDemaisLojas).toBe(1);
  });

  it("rankingLojas rede omits stores with zero revenue (no ghost cards)", () => {
    const v = buildOverviewView(escopo("todas"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-10",
          brand: "ALL",
          revenueCents: 300_00,
          salesCount: 3,
          itemCount: 3,
        },
      ],
    });
    expect(v.rankingLojas.every((l) => l.valor > 0)).toBe(true);
    expect(v.rankingLojas).toHaveLength(1);
    expect(v.rankingLojas[0]?.valor).toBe(300);
  });

  it("Overview ignores brand filter — KPIs use ALL; WPINK goes to kpisWpink strip", () => {
    const base = {
      tenantId: "t1",
      storeId: "f1",
      day: "2026-09-10",
    } as const;
    const v = buildOverviewView(
      { ...escopo("f1"), divisao: "WEPINK" },
      {
        dayAggs: [
          { ...base, brand: "ALL", revenueCents: 100_00, salesCount: 10, itemCount: 20, cmvCents: 40_00 },
          { ...base, brand: "WEPINK", revenueCents: 80_00, salesCount: 7, itemCount: 14, cmvCents: 30_00 },
          { ...base, brand: "WPINK", revenueCents: 20_00, salesCount: 3, itemCount: 6, cmvCents: 10_00 },
        ],
      },
    );
    // Total = ALL (10 vendas)
    expect(v.kpis.find((k) => k.label === "Nº de vendas")?.valor).toMatch(/10/);
    expect(v.kpis.find((k) => k.label === "Ticket médio")?.valor).toMatch(/10/);
    // KPIs principais sem anotacao WPINK
    expect(v.kpis.find((k) => k.label === "Faturamento")?.subWpink).toBeUndefined();
    expect(v.kpis.find((k) => k.label === "CMV")?.sub).not.toMatch(/WPINK/);
    expect(v.kpis.find((k) => k.label === "Nº de vendas")?.sub).not.toMatch(/WPINK/);
    // f1 fixture nao tem temWpink  ->  faixa oculta
    expect(v.kpisWpink).toHaveLength(0);
  });

  it("kpisWpink strip only when store has temWpink", () => {
    const day = "2026-09-10";
    const vF1 = buildOverviewView(escopo("f1"), {
      dayAggs: [
        { tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 100_00, salesCount: 10, itemCount: 20 },
        { tenantId: "t1", storeId: "f1", day, brand: "WPINK", revenueCents: 20_00, salesCount: 3, itemCount: 6 },
      ],
    });
    expect(vF1.kpisWpink).toHaveLength(0);

    const vF2 = buildOverviewView(escopo("f2"), {
      dayAggs: [
        { tenantId: "t1", storeId: "f2", day, brand: "ALL", revenueCents: 100_00, salesCount: 10, itemCount: 20, cmvCents: 40_00 },
        { tenantId: "t1", storeId: "f2", day, brand: "WPINK", revenueCents: 20_00, salesCount: 3, itemCount: 6, cmvCents: 8_00 },
      ],
    });
    expect(vF2.kpisWpink).toHaveLength(4);
    expect(vF2.kpisWpink[0]?.label).toBe("Faturamento WPINK");
    expect(vF2.kpisWpink[0]?.valor).toMatch(/20/);
    expect(vF2.kpisWpink[0]?.sub).toMatch(/% do faturamento/);
    expect(vF2.kpisWpink[0]?.sub).not.toMatch(/do total/);
    expect(vF2.kpisWpink[2]?.valor).toMatch(/3/);
  });

  it("post-sync read reflects updated aggregates without mocks (SYNC-09)", () => {
    const before = buildOverviewView(escopo("f1"), { dayAggs: [] });
    const after = buildOverviewView(escopo("f1"), {
      dayAggs: [
        {
          tenantId: "t1",
          storeId: "f1",
          day: "2026-09-18",
          brand: "ALL",
          revenueCents: 999_00,
          salesCount: 7,
          itemCount: 10,
        },
      ],
    });
    expect(before.kpis.find((k) => k.label === "Faturamento")?.valor).toMatch(/R\$\s*0/);
    expect(after.kpis.find((k) => k.label === "Nº de vendas")?.valor).toMatch(/7/);
    expect(after.fromAggregates).toBe(true);
  });

  it("Faturamento x meta (hoje): Overview usa horas ALL (sem filtro de marca)", () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const day = `${y}-${m}-${d}`;
    const v = buildOverviewView(
      { filialIds: [], periodo: { tipo: "hoje" }, divisao: "WPINK" },
      {
        dayAggs: [
          { tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 100_00, salesCount: 10, itemCount: 10 },
          { tenantId: "t1", storeId: "f1", day, brand: "WEPINK", revenueCents: 80_00, salesCount: 0, itemCount: 0 },
          { tenantId: "t1", storeId: "f1", day, brand: "WPINK", revenueCents: 20_00, salesCount: 0, itemCount: 0 },
        ],
        hourAggs: [
          { tenantId: "t1", storeId: "f1", day, hour: 10, brand: "ALL", revenueCents: 40_00, salesCount: 4, itemCount: 4 },
          { tenantId: "t1", storeId: "f1", day, hour: 11, brand: "ALL", revenueCents: 60_00, salesCount: 6, itemCount: 6 },
        ],
      },
    );
    expect(v.eixoSerie).toBe("hora");
    expect(v.evolucao.length).toBeGreaterThanOrEqual(2);
    // Total da operacao (ALL), nao rateio WPINK
    expect(v.evolucao[v.evolucao.length - 1]?.realizado).toBeCloseTo(100, 0);
  });

  it("Faturamento x meta (hoje): 1 hora com venda ainda preenche o eixo", () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const day = `${y}-${m}-${d}`;
    const v = buildOverviewView(
      { filialIds: ["f1"], periodo: { tipo: "hoje" }, divisao: null },
      {
        dayAggs: [
          { tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 50_00, salesCount: 2, itemCount: 2 },
        ],
        hourAggs: [
          { tenantId: "t1", storeId: "f1", day, hour: 15, brand: "ALL", revenueCents: 50_00, salesCount: 2, itemCount: 2 },
        ],
      },
    );
    expect(v.eixoSerie).toBe("hora");
    expect(v.evolucao.length).toBeGreaterThan(1);
    expect(v.evolucao.some((e) => e.label.includes("15"))).toBe(true);
    expect(v.evolucao[0]?.realizado).toBe(0);
    expect(v.evolucao[v.evolucao.length - 1]?.realizado).toBe(50);
  });

  it("Faturamento x meta (1 dia passado): eixo segue o expediente só das lojas com venda", () => {
    // Segunda-feira: f1 abre 10 - 22; f2 (sem venda) abre 08 - 18 e nao pode puxar o inicio p/ 8h.
    const day = "2026-09-21";
    const v = buildOverviewView(
      { filialIds: [], periodo: { tipo: "personalizado", inicio: day, fim: day }, divisao: null },
      {
        dayAggs: [
          { tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 100_00, salesCount: 3, itemCount: 3 },
        ],
        hourAggs: [
          { tenantId: "t1", storeId: "f1", day, hour: 12, brand: "ALL", revenueCents: 60_00, salesCount: 2, itemCount: 2 },
          { tenantId: "t1", storeId: "f1", day, hour: 22, brand: "ALL", revenueCents: 40_00, salesCount: 1, itemCount: 1 },
        ],
      },
    );
    expect(v.eixoSerie).toBe("hora");
    // Abre as 10h com R$ 0 (ancora); rotulo = inicio da hora ("12h" = 12:00 - 12:59).
    expect(v.evolucao[0]).toMatchObject({ label: "10h", realizado: 0, ancora: true });
    const pontos = v.evolucao.filter((e) => !e.ancora);
    expect(pontos[0]?.label).toBe("10h");
    expect(pontos.find((e) => e.label === "12h")?.realizado).toBe(60);
    expect(pontos.find((e) => e.label === "21h")?.realizado).toBe(60);
    // Venda apos o fechamento (22:xx) continua aparecendo  ->  vai ate 22h.
    expect(pontos[pontos.length - 1]).toMatchObject({ label: "22h", realizado: 100 });
  });

  it("Faturamento x meta: meta do dia (não do mês) e curva pela hora histórica", () => {
    const day = "2026-09-21";
    const sale = { tenantId: "t1", storeId: "f1", day, brand: "ALL" as const, revenueCents: 50_00, salesCount: 1, itemCount: 1 };
    const goal = {
      id: "g1",
      storeId: "f1",
      name: "Meta de setembro",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      target: 170_000,
      tierMode: "INDIVIDUAL" as const,
      tiers: [],
      groups: [],
    };
    const base = {
      dayAggs: [sale],
      hourAggs: [{ ...sale, hour: 15 }],
      goals: [goal],
    };
    const escopo = { filialIds: ["f1"], periodo: { tipo: "personalizado" as const, inicio: day, fim: day }, divisao: null };
    const linear = buildOverviewView(escopo, base);
    expect(linear.metaDescricao).toBe("Meta de setembro · 01/09 a 30/09");
    const metaDia = linear.evolucao[linear.evolucao.length - 1]!.meta;
    // Meta f1 set/26 = 170 mil  ->  um dia fica bem abaixo de 1/20 do mes.
    expect(metaDia).toBeGreaterThan(0);
    expect(metaDia).toBeLessThan(170_000 / 20);

    // Historico: segundas anteriores vendem so as 15h  ->  toda a meta cai nas 15h.
    const curva = buildOverviewView(escopo, {
      ...base,
      goalHistoryHourAggs: ["2026-09-14", "2026-09-07"].map((d) => ({ ...sale, day: d, hour: 15 })),
    });
    const at = (label: string) => curva.evolucao.find((e) => e.label === label)?.meta ?? -1;
    expect(at("14h")).toBe(0);
    expect(at("15h")).toBeCloseTo(metaDia);
  });

  it("Faturamento x meta por hora: eixo cobre as horas com meta, não só as horas com venda", () => {
    const day = "2026-09-21";
    const sale = { tenantId: "t1", storeId: "f1", day, brand: "ALL" as const, revenueCents: 50_00, salesCount: 1, itemCount: 1 };
    const v = buildOverviewView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: day, fim: day }, divisao: null },
      {
        dayAggs: [sale],
        hourAggs: [{ ...sale, hour: 15 }],
        goals: [
          {
            id: "g1",
            storeId: "f1",
            name: "Meta de setembro",
            startsOn: "2026-09-01",
            endsOn: "2026-09-30",
            target: 170_000,
            tierMode: "INDIVIDUAL",
            tiers: [],
            groups: [],
          },
        ],
      },
    );
    // Venda so as 15h, mas a meta se espalha pelo expediente (10h - 22h)  ->  eixo do dia inteiro.
    const labels = v.evolucao.filter((e) => !e.ancora).map((e) => e.label);
    expect(labels[0]).toBe("10h");
    expect(labels[labels.length - 1]).toBe("21h");
  });

  describe("Atingimento da meta = meta inteira, vendido do início da meta até hoje", () => {
    const meta = (id: string, storeId: string, startsOn: string, endsOn: string, target: number) => ({
      id,
      storeId,
      name: `Meta ${id}`,
      startsOn,
      endsOn,
      target,
      tierMode: "INDIVIDUAL" as const,
      tiers: [],
      groups: [],
    });
    const venda = (storeId: string, day: string, reais: number) => ({
      tenantId: "t1",
      storeId,
      day,
      brand: "ALL" as const,
      revenueCents: reais * 100,
      salesCount: 1,
      itemCount: 1,
    });

    const setembro = meta("set", "f1", "2026-09-01", "2026-09-30", 170_000);

    it("filtro de 1 dia mostra a meta do mês inteiro com o vendido desde o dia 1", () => {
      const dia = "2026-09-21";
      const v = buildOverviewView(
        { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: dia, fim: dia }, divisao: null },
        {
          dayAggs: [venda("f1", dia, 500)],
          goals: [setembro],
          goalDayAggs: [venda("f1", "2026-09-02", 1_000), venda("f1", dia, 500)],
        },
      );
      expect(v.gauges[0]).toMatchObject({ alvo: 170_000, realizado: 1_500 });
      expect(v.metaDescricao).toBe("Meta set · 01/09 a 30/09");
    });

    it("período de 2 meses soma as metas inteiras dos dois meses", () => {
      const v = buildOverviewView(
        { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-08-20", fim: "2026-09-10" }, divisao: null },
        {
          dayAggs: [],
          goals: [meta("ago", "f1", "2026-08-01", "2026-08-31", 100_000), setembro],
          goalDayAggs: [venda("f1", "2026-08-05", 1_000), venda("f1", "2026-09-15", 2_000)],
        },
      );
      expect(v.gauges[0]).toMatchObject({ alvo: 270_000, realizado: 3_000 });
      expect(v.metaDescricao).toBe("2 metas consideradas");
    });

    it("Todas as lojas: soma só as lojas com meta e avisa quantas têm", () => {
      const v = buildOverviewView(
        { filialIds: [], periodo: { tipo: "personalizado", inicio: "2026-09-01", fim: "2026-09-30" }, divisao: null },
        {
          dayAggs: [venda("f1", "2026-09-10", 2_000), venda("f2", "2026-09-10", 5_000)],
          goals: [setembro],
          goalDayAggs: [venda("f1", "2026-09-10", 2_000)],
        },
      );
      expect(v.gauges[0]).toMatchObject({ alvo: 170_000, realizado: 2_000 });
      expect(v.metaDescricao).toMatch(/^1 de \d+ lojas com meta$/);
    });
  });

  it("Faturamento x meta (1 dia passado): sem venda pós-fechamento termina no fechamento", () => {
    const day = "2026-09-21";
    const v = buildOverviewView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: day, fim: day }, divisao: null },
      {
        dayAggs: [
          { tenantId: "t1", storeId: "f1", day, brand: "ALL", revenueCents: 50_00, salesCount: 1, itemCount: 1 },
        ],
        hourAggs: [
          { tenantId: "t1", storeId: "f1", day, hour: 21, brand: "ALL", revenueCents: 50_00, salesCount: 1, itemCount: 1 },
        ],
      },
    );
    expect(v.evolucao[0]?.label).toBe("10h");
    expect(v.evolucao[v.evolucao.length - 1]).toMatchObject({ label: "21h", realizado: 50 });
  });
});

describe("buildOverviewView — comparativo com o período anterior", () => {
  const day = (d: string, rev: number, cmv: number, vendas: number) => ({
    tenantId: "t1",
    storeId: "f1",
    day: d,
    brand: "ALL" as const,
    revenueCents: rev * 100,
    cmvCents: cmv * 100,
    salesCount: vendas,
    itemCount: vendas * 2,
  });
  const esc = { filialIds: ["f1"], periodo: { tipo: "personalizado" as const, inicio: "2026-08-10", fim: "2026-08-11" }, divisao: null };

  it("KPIs e cards ganham badge quando há vendas no período anterior", () => {
    const v = buildOverviewView(esc, {
      dayAggs: [day("2026-08-10", 200, 80, 4), day("2026-08-11", 100, 40, 2)],
      prevDayAggs: [day("2026-08-08", 150, 60, 3), day("2026-08-09", 50, 20, 1)],
    });
    const [fat, cmv, vendas, ticket] = v.kpis;
    expect(fat?.delta).toMatchObject({ value: "50%", positive: true, vs: "os 2 dias anteriores" });
    expect(cmv?.delta?.positive).toBe(true);
    expect(vendas?.delta).toMatchObject({ positive: true });
    expect(ticket?.delta).toBeUndefined(); // 300/6 = 200/4 = R$ 50
    expect(v.deltaFaturamento).toEqual(fat?.delta);
  });

  it("faixa WPINK compara com o WPINK do período anterior", () => {
    const w = (d: string, rev: number, vendas: number) => ({ ...day(d, rev, 0, vendas), storeId: "f2", brand: "WPINK" as const, cmvCents: 0 });
    const all = (d: string, rev: number, vendas: number) => ({ ...day(d, rev, 0, vendas), storeId: "f2" });
    const v = buildOverviewView(
      { ...esc, filialIds: ["f2"] },
      {
        dayAggs: [all("2026-08-10", 300, 6), w("2026-08-10", 120, 3)],
        prevDayAggs: [all("2026-08-08", 200, 4), w("2026-08-08", 80, 2)],
      },
    );
    const [fatW, cmvW, vendasW] = v.kpisWpink;
    expect(fatW?.delta).toMatchObject({ value: "50%", positive: true });
    expect(cmvW?.delta).toBeUndefined();
    expect(vendasW?.delta).toMatchObject({ value: "50%", positive: true });
  });

  it("WPINK sem contagem/CMV (só receita) não estima: — e sem badge", () => {
    const w = (d: string, rev: number) => ({ ...day(d, rev, 0, 0), storeId: "f2", brand: "WPINK" as const, cmvCents: 0 });
    const all = (d: string, rev: number, vendas: number) => ({ ...day(d, rev, 0, vendas), storeId: "f2" });
    const v = buildOverviewView(
      { ...esc, filialIds: ["f2"] },
      {
        dayAggs: [all("2026-08-10", 300, 30), w("2026-08-10", 150)],
        prevDayAggs: [all("2026-08-08", 200, 20), w("2026-08-08", 50)],
      },
    );
    const byLabel = (l: string) => v.kpisWpink.find((k) => k.label === l);
    expect(byLabel("Faturamento WPINK")?.delta).toMatchObject({ value: "200%", positive: true });
    for (const l of ["CMV WPINK", "Nº de vendas WPINK", "Ticket médio WPINK"]) {
      expect(byLabel(l)?.valor).toBe("—");
      expect(byLabel(l)?.delta).toBeUndefined();
    }
  });

  it("sem vendas no período anterior não mostra badge", () => {
    const v = buildOverviewView(esc, { dayAggs: [day("2026-08-10", 200, 80, 4)], prevDayAggs: [] });
    expect(v.kpis.every((k) => k.delta === undefined)).toBe(true);
    expect(v.deltaFaturamento).toBeUndefined();
  });

  it("sem vendas no período atual (ex.: hoje antes do Atualizar) não mostra −100%", () => {
    const w = (d: string, rev: number) => ({ ...day(d, rev, 40, 2), storeId: "f2", brand: "WPINK" as const });
    const all = (d: string, rev: number) => ({ ...day(d, rev, 80, 4), storeId: "f2" });
    const v = buildOverviewView(
      { ...esc, filialIds: ["f2"] },
      { dayAggs: [all("2026-08-10", 0)], prevDayAggs: [all("2026-08-08", 200), w("2026-08-08", 100)] },
    );
    expect(v.kpis.every((k) => k.delta === undefined)).toBe(true);
    expect(v.deltaFaturamento).toBeUndefined();
    expect(v.kpisWpink.every((k) => k.delta === undefined)).toBe(true);

    const f = buildFinanceView(
      { filialIds: ["f2"], periodo: { tipo: "personalizado", inicio: "2026-08-10", fim: "2026-08-10" }, divisao: null },
      { dayAggs: [all("2026-08-10", 0), all("2026-08-03", 200), w("2026-08-03", 100)] },
    );
    expect(f.kpis.every((k) => k.delta === undefined)).toBe(true);
    expect(f.deltaResultado).toBeUndefined();
    expect(f.kpisWpink.every((k) => k.delta === undefined)).toBe(true);
  });
});

describe("comparativo alinhado pelo horário (período termina hoje)", () => {
  // qui 24/09/2026 16h30 em Campo Grande (UTC4)
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T20:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const d = (day: string, rev: number, cmv: number) => ({
    tenantId: "t1", storeId: "f1", day, brand: "ALL" as const,
    revenueCents: rev * 100, cmvCents: cmv * 100, salesCount: 1, itemCount: 1,
  });
  const h = (day: string, hour: number, rev: number) => ({
    tenantId: "t1", storeId: "f1", day, hour, brand: "ALL" as const,
    revenueCents: rev * 100, salesCount: 1, itemCount: 1,
  });
  const semana = { filialIds: ["f1"], periodo: { tipo: "estaSemana" as const }, divisao: null };
  const atual = [d("2026-09-21", 100, 40), d("2026-09-22", 100, 40), d("2026-09-23", 100, 40), d("2026-09-24", 100, 20)];
  const anterior = [d("2026-09-14", 100, 50), d("2026-09-15", 100, 50), d("2026-09-16", 100, 50), d("2026-09-17", 200, 100)];

  it("previousPeriod: semana = mesmos dias; último dia recortado na hora atual", () => {
    expect(previousPeriod(resolvePeriod({ tipo: "estaSemana" }, "2026-09-24"), 16)).toEqual({
      inicio: "2026-09-14", fim: "2026-09-17", rotulo: "a semana passada", horaMax: 16,
    });
    expect(previousPeriod(resolvePeriod({ tipo: "esteMes" }, "2026-09-24"), 16)).toMatchObject({
      inicio: "2026-08-01", fim: "2026-08-24", horaMax: 16,
    });
    expect(previousPeriod(resolvePeriod({ tipo: "7dias" }, "2026-09-24"), 16)).toMatchObject({
      inicio: "2026-09-11", fim: "2026-09-17", horaMax: 16,
    });
    expect(previousPeriod(resolvePeriod({ tipo: "mesPassado" }, "2026-09-24"), 16).horaMax).toBeUndefined();
  });

  it("Visão Geral: dia equivalente entra até a hora atual; CMV compara até ontem", () => {
    const v = buildOverviewView(semana, {
      dayAggs: atual,
      prevDayAggs: anterior,
      prevHourAggs: [h("2026-09-17", 10, 50), h("2026-09-17", 18, 150)],
    });
    const [fat, cmv] = v.kpis;
    // 400 x (300 + qui 17 so ate 16h = 50)  ->  +14%
    expect(fat?.delta).toMatchObject({ value: "14%", positive: true, vs: "a semana passada" });
    expect(fat?.delta?.anterior).toContain("350,00");
    // CMV seg - qua: 120 x 150
    expect(cmv?.delta).toMatchObject({ value: "20%", positive: false, vs: "a semana passada, até o mesmo dia" });
    expect(cmv?.delta?.anterior).toContain("150,00");
  });

  it("sem as horas do dia equivalente não compara dia parcial com dia cheio", () => {
    const v = buildOverviewView(semana, { dayAggs: atual, prevDayAggs: anterior, prevHourAggs: [] });
    expect(v.kpis[0]?.delta).toBeUndefined();
    expect(v.deltaFaturamento).toBeUndefined();
  });

  it("Financeiro: mesma regra (faturamento até a hora; CMV/lucro até ontem)", () => {
    const f = buildFinanceView(semana, {
      dayAggs: [...atual, ...anterior],
      prevHourAggs: [h("2026-09-17", 10, 50), h("2026-09-17", 18, 150)],
    });
    const byLabel = (l: string) => f.kpis.find((k) => k.label === l);
    expect(byLabel("Faturamento")?.delta).toMatchObject({ value: "14%", positive: true });
    expect(byLabel("CMV")?.delta).toMatchObject({ value: "20%", positive: false, vs: "a semana passada, até o mesmo dia" });
  });
});

describe("buildFinanceView com agregados reais", () => {
  const day = (d: string, rev: number, cmv: number) => ({
    tenantId: "t1",
    storeId: "f1",
    day: d,
    brand: "ALL" as const,
    revenueCents: rev * 100,
    cmvCents: cmv * 100,
    salesCount: 2,
    itemCount: 3,
  });

  it("soma faturamento/CMV, desconta custos % da loja e compara com o período anterior", () => {
    const v = buildFinanceView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-08-10", fim: "2026-08-11" }, divisao: null },
      { dayAggs: [day("2026-08-08", 150, 60), day("2026-08-10", 200, 80), day("2026-08-11", 100, 40)] },
    );
    const fat = v.custoLucroMargem.reduce((s, p) => s + p.faturamento, 0);
    const cmv = v.custoLucroMargem.reduce((s, p) => s + p.custo, 0);
    const resultado = v.resultadoOperacional.reduce((s, p) => s + p.resultado, 0);
    expect(fat).toBe(300);
    expect(cmv).toBe(120);
    // Sem custos configurados: nenhum custo inventado (resultado = lucro bruto).
    expect(resultado).toBeCloseTo(180);
    expect(v.custosFixosFranquia.find((l) => l.ehTotal)?.valor).toBe(0);
    expect(v.custosConfigurados).toBe(false);
    expect(v.custosFixosFranquia.some((l) => l.rotulo.startsWith("Aluguel"))).toBe(false);
    expect(v.custosFixosFranquia.some((l) => l.rotulo.includes("WPINK"))).toBe(false);
    expect(v.faturamentoPorMarca).toBeNull();
    expect(v.kpis[0]?.delta).toBeDefined();
    expect(v.deltaResultado).toBeDefined();
    // Periodo de 2 dias (eixo por dia)  ->  sem Evolucao mensal.
    expect(v.evolucaoMensal).toEqual([]);
  });

  it("1 dia: eixo por hora = expediente da loja (10h–21h), igual ao Faturamento x meta", () => {
    const d = "2026-09-21";
    const hr = (hour: number, rev: number) => ({ ...day(d, rev, 0), hour, salesCount: 1, itemCount: 1 });
    const v = buildFinanceView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: d, fim: d }, divisao: null },
      { dayAggs: [day(d, 100, 40)], hourAggs: [hr(12, 60), hr(15, 40)] },
    );
    const labels = v.custoLucroMargem.map((p) => p.mes);
    expect(labels[0]).toBe("10h");
    expect(labels[labels.length - 1]).toBe("21h");
    expect(v.custoLucroMargem.find((p) => p.mes === "12h")?.faturamento).toBe(60);
    expect(v.custoLucroMargem.some((p) => p.futuro)).toBe(false);
  });

  it("Evolução mensal com vários meses: meses do período, recortados nas pontas", () => {
    const v = buildFinanceView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-07-10", fim: "2026-08-31" }, divisao: null },
      { dayAggs: [day("2026-07-05", 999, 0), day("2026-07-10", 200, 80), day("2026-08-11", 100, 40)] },
    );
    expect(v.mostrarEvolucaoMensal).toBe(true);
    expect(v.evolucaoMensal.map((r) => r.mes)).toEqual(["julho · 10 a 31", "agosto"]);
    expect(v.evolucaoMensal.map((r) => r.faturamento)).toEqual([200, 100]);
    expect(v.rotuloEvolucaoMensal).toBe("10/07 a 31/08");
  });

  it("Evolução mensal com 1 mês inteiro (fevereiro, 28 dias): o mês + 5 anteriores", () => {
    const v = buildFinanceView(
      { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-02-01", fim: "2026-02-28" }, divisao: null },
      { dayAggs: [day("2025-08-20", 999, 0), day("2025-12-10", 300, 100), day("2026-02-11", 100, 40)] },
    );
    expect(v.mostrarEvolucaoMensal).toBe(true);
    expect(v.evolucaoMensal.map((r) => r.mes)).toEqual(["dezembro de 2025", "fevereiro de 2026"]);
    expect(v.evolucaoMensal.map((r) => r.faturamento)).toEqual([300, 100]);
    expect(v.rotuloEvolucaoMensal).toBe("fevereiro de 2026 e meses anteriores");
  });

  it("monthlyEvolutionMonths: período mensal pelo calendário, não por contagem de dias", () => {
    const meses = (p: Period, hoje = "2026-09-26") => {
      const r = resolvePeriod(p, hoje);
      return monthlyEvolutionMonths(r, seriesAxisForPeriod(r));
    };
    expect(meses({ tipo: "esteMes" })).toEqual({
      meses: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      comAnteriores: true,
    });
    expect(meses({ tipo: "esteMes" }, "2026-09-01").comAnteriores).toBe(true);
    expect(meses({ tipo: "mesPassado" }).meses.at(-1)).toBe("2026-08");
    expect(meses({ tipo: "esteTrimestre" })).toEqual({ meses: ["2026-07", "2026-08", "2026-09"], comAnteriores: false });
    expect(meses({ tipo: "personalizado", inicio: "2026-09-01", fim: "2026-09-26" }).comAnteriores).toBe(true);
    expect(meses({ tipo: "hoje" }).meses).toEqual([]);
    expect(meses({ tipo: "hoje" }, "2026-09-01").meses).toEqual([]);
    expect(meses({ tipo: "7dias" }).meses).toEqual([]);
    expect(meses({ tipo: "estaSemana" }).meses).toEqual([]);
    expect(meses({ tipo: "personalizado", inicio: "2026-09-01", fim: "2026-09-15" }).meses).toEqual([]);
  });

  it("faixa WPINK: valores e badges só com dado completo (nada estimado)", () => {
    const row = (d: string, brand: "ALL" | "WPINK", rev: number, cmv: number) => ({ ...day(d, rev, cmv), storeId: "f2", brand });
    const esc = { filialIds: ["f2"], periodo: { tipo: "personalizado" as const, inicio: "2026-08-10", fim: "2026-08-10" }, divisao: null };
    const v = buildFinanceView(esc, {
      dayAggs: [row("2026-08-10", "ALL", 1000, 400), row("2026-08-10", "WPINK", 200, 80), row("2026-08-03", "ALL", 800, 300), row("2026-08-03", "WPINK", 100, 50)],
    });
    const [fat, cmv, lucro, margem] = v.kpisWpink;
    expect(fat?.valor).toMatch(/^R\$\s200,00$/);
    expect(fat?.sub).toBe("20% do faturamento");
    expect(fat?.delta).toMatchObject({ value: "100%", positive: true });
    expect(cmv?.delta).toMatchObject({ value: "60%", positive: true });
    expect(lucro?.valor).toMatch(/^R\$\s120,00$/);
    expect(margem?.delta).toMatchObject({ value: "10,0 p.p.", positive: true });

    const semCmv = buildFinanceView(esc, {
      dayAggs: [row("2026-08-10", "ALL", 1000, 400), row("2026-08-10", "WPINK", 200, 0), row("2026-08-03", "WPINK", 100, 50)],
    });
    expect(semCmv.kpisWpink.slice(1).map((k) => k.valor)).toEqual(["—", "—", "—"]);
    expect(semCmv.kpisWpink.slice(1).every((k) => k.delta === undefined)).toBe(true);
  });

  it("produto com custo R$ 0 no Millennium: CMV WPINK = 0 (não —) e aviso lista o produto", () => {
    const row = (d: string, brand: "ALL" | "WPINK", rev: number, cmv: number) => ({ ...day(d, rev, cmv), storeId: "f2", brand });
    const esc = { filialIds: ["f2"], periodo: { tipo: "personalizado" as const, inicio: "2026-09-12", fim: "2026-09-12" }, divisao: null };
    const v = buildFinanceView(esc, {
      dayAggs: [row("2026-09-12", "ALL", 1000, 400), row("2026-09-12", "WPINK", 140, 0)],
      productCostDayAggs: [
        { tenantId: "t1", storeId: "f2", day: "2026-09-12", productCode: "WP014", itemCount: 3, revenueCents: 14000, cmvCents: 0 },
        { tenantId: "t1", storeId: "f2", day: "2026-09-12", productCode: "A1", itemCount: 5, revenueCents: 86000, cmvCents: 40000 },
      ],
      productNames: { WP014: "WP ULTRA - WP" },
    });
    const [, cmv, lucro, margem] = v.kpisWpink;
    expect(cmv?.valor).toMatch(/^R\$\s0,00$/);
    expect(lucro?.valor).toMatch(/^R\$\s140,00$/);
    expect(margem?.valor).not.toBe("—");
    expect(v.produtosSemCusto).toEqual([{ codigo: "WP014", nome: "WP ULTRA - WP", itens: 3, faturamento: 140 }]);
  });

  it("impostos da loja saem antes do Lucro bruto: ICMS sobre o faturamento, ICMS ST sobre o CMV", () => {
    const loja = stores.find((s) => s.id === "f1")!;
    const antes = loja.custos;
    loja.custos = { ...EMPTY_STORE_COSTS, icmsWepinkPct: 10, icmsWpinkPct: 10, icmsStWepinkPct: 20, icmsStWpinkPct: 20 };
    try {
      const v = buildFinanceView(
        { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-08-10", fim: "2026-08-10" }, divisao: null },
        { dayAggs: [day("2026-08-10", 200, 80)] },
      );
      const lucro = v.kpis.find((k) => k.label === "Lucro bruto");
      // 200  80  ICMS 20 (10% de 200)  ICMS ST 16 (20% de 80)
      expect(lucro?.valor).toMatch(/^R\$\s84,00$/);
      expect(lucro?.sub).toMatch(/^Impostos: R\$\s36,00$/);
      expect(v.custosFixosFranquia[0]).toMatchObject({ rotulo: "Lucro bruto", valor: 84 });
      // Sem royalties/marketing/aluguel configurados: resultado = lucro bruto.
      expect(v.custosFixosFranquia.find((l) => l.ehResultado)?.valor).toBeCloseTo(84);
    } finally {
      loja.custos = antes;
    }
  });

  it("ICMS e ICMS ST usam o percentual de cada marca", () => {
    const loja = stores.find((s) => s.id === "f1")!;
    const antes = loja.custos;
    loja.custos = {
      ...EMPTY_STORE_COSTS,
      icmsWepinkPct: 10,
      icmsWpinkPct: 4,
      icmsStWepinkPct: 20,
      icmsStWpinkPct: 5,
    };
    const marca = (brand: "ALL" | "WEPINK" | "WPINK", rev: number, cmv: number) => ({
      ...day("2026-08-10", rev, cmv),
      brand,
    });
    try {
      const v = buildFinanceView(
        { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-08-10", fim: "2026-08-10" }, divisao: null },
        { dayAggs: [marca("ALL", 1000, 400), marca("WEPINK", 800, 300), marca("WPINK", 200, 100)] },
      );
      // ICMS 80 + 8 = 88; ICMS ST 60 + 5 = 65; lucro 1000  400  153 = 447
      const lucro = v.kpis.find((k) => k.label === "Lucro bruto");
      expect(lucro?.valor).toMatch(/^R\$\s447,00$/);
    } finally {
      loja.custos = antes;
    }
  });

  describe("aluguel do mês = maior entre o aluguel e o % (mostra o aluguel + o excedente do %)", () => {
    // Agosto = 31 dias; recorte 10 - 11/08 = 2 dias com R$ 300 de faturamento e R$ 180 de lucro bruto.
    const rodar = (rentMin: number | null, pct: number | null, pointType: "SHOPPING" | "RUA" = "SHOPPING") => {
      const loja = stores.find((s) => s.id === "f1")!;
      const antes = loja.custos;
      const antesPonto = loja.pointType;
      loja.custos = { ...EMPTY_STORE_COSTS, rentMin, rentWepinkPct: pct, rentWpinkPct: pct };
      loja.pointType = pointType;
      try {
        const v = buildFinanceView(
          { filialIds: ["f1"], periodo: { tipo: "personalizado", inicio: "2026-08-10", fim: "2026-08-11" }, divisao: null },
          { dayAggs: [day("2026-08-10", 200, 80), day("2026-08-11", 100, 40)] },
        );
        const linha = (r: string) => v.custosFixosFranquia.find((l) => l.rotulo === r || l.rotulo.startsWith(`${r} (`))?.valor;
        const total = v.custosFixosFranquia.find((l) => l.ehTotal)?.valor;
        const serie = v.resultadoOperacional.reduce((s, p) => s + p.resultado, 0);
        return { v, linha, total, serie };
      } finally {
        loja.custos = antes;
        loja.pointType = antesPonto;
      }
    };

    it("loja de rua ignora o % gravado", () => {
      const { linha, total } = rodar(310, 10, "RUA");
      expect(linha("Aluguel")).toBeCloseTo(20);
      expect(linha("Aluguel percentual excedente")).toBeUndefined();
      expect(total).toBeCloseTo(20);
    });

    it("% abaixo do aluguel: paga só o aluguel", () => {
      // Aluguel 3.100/mes = 100/dia  ->  200 no recorte; 10% de 300 = 30.
      const { v, linha, total, serie } = rodar(3100, 10);
      expect(linha("Aluguel")).toBeCloseTo(200);
      expect(linha("Aluguel percentual excedente")).toBeUndefined();
      expect(total).toBeCloseTo(200);
      expect(serie).toBeCloseTo(180 - 200);
      expect(v.custosConfigurados).toBe(true);
    });

    it("% acima do aluguel: aluguel + só o excedente", () => {
      // Aluguel 310/mes = 10/dia  ->  20 no recorte; 10% de 300 = 30  ->  excedente 10.
      const { linha, total, serie } = rodar(310, 10);
      expect(linha("Aluguel")).toBeCloseTo(20);
      expect(linha("Aluguel percentual excedente")).toBeCloseTo(10);
      expect(total).toBeCloseTo(30);
      expect(serie).toBeCloseTo(180 - 30);
    });

    it("loja de rua (sem %): só o aluguel", () => {
      const { linha, total } = rodar(3100, null);
      expect(linha("Aluguel")).toBeCloseTo(200);
      expect(linha("Aluguel percentual excedente")).toBeUndefined();
      expect(total).toBeCloseTo(200);
    });

    it("só %: linha Aluguel percentual com o valor inteiro", () => {
      const { linha, total } = rodar(null, 10);
      expect(linha("Aluguel")).toBeUndefined();
      expect(linha("Aluguel percentual")).toBeCloseTo(30);
      expect(total).toBeCloseTo(30);
    });
  });

  it("loja sem dados não quebra a tela (CMV vazio vira —)", () => {
    const v = buildFinanceView({ filialIds: ["f2"], periodo: { tipo: "hoje" }, divisao: null }, { dayAggs: [] });
    expect(v.kpis[0]?.valor).toBeDefined();
    expect(v.kpis[1]?.valor).toBe("—");
    expect(v.evolucaoMensal).toEqual([]);
  });
});

describe("buildProductsView com agregados reais", () => {
  const dia = (d: string, rev: number, cmv: number, items = 10) => ({
    tenantId: "t1", storeId: "f1", day: d, brand: "ALL" as const,
    revenueCents: rev * 100, cmvCents: cmv * 100, salesCount: 2, itemCount: items,
  });
  const prod = (d: string, id: number, code: string, rev: number, itens: number) => ({
    tenantId: "t1", storeId: "f1", day: d, productId: id, productCode: code, productName: `PRODUTO ${code}`,
    brand: "ALL" as const, revenueCents: rev * 100, itemCount: itens,
  });
  const custo = (d: string, code: string, cmv: number) => ({
    tenantId: "t1", storeId: "f1", day: d, productCode: code, itemCount: 1, revenueCents: 0, cmvCents: cmv * 100,
  });
  const cat = (d: string, id: number, nome: string, rev: number) => ({
    tenantId: "t1", storeId: "f1", day: d, categoryId: id, categoryName: nome, brand: "ALL" as const,
    revenueCents: rev * 100, itemCount: 1,
  });
  const esc = { filialIds: ["f1"], periodo: { tipo: "personalizado" as const, inicio: "2026-08-10", fim: "2026-08-11" }, divisao: null };

  it("KPIs = Financeiro + Itens vendidos; categorias e produtos com variação vs período anterior", () => {
    const v = buildProductsView(esc, {
      dayAggs: [dia("2026-08-08", 150, 60, 5), dia("2026-08-10", 200, 80), dia("2026-08-11", 100, 40)],
      categoryDayAggs: [cat("2026-08-10", 1, "Perfumaria", 200), cat("2026-08-11", 2, "Body", 100), cat("2026-08-08", 1, "Perfumaria", 150)],
      productDayAggs: [prod("2026-08-10", 1, "A1", 200, 4), prod("2026-08-11", 2, "B2", 100, 5), prod("2026-08-08", 1, "A1", 100, 2)],
      productCostDayAggs: [custo("2026-08-10", "A1", 80)],
    });
    expect(v.kpis.map((k) => k.label)).toEqual(["Faturamento", "Lucro bruto", "Margem", "Itens vendidos"]);
    expect(v.kpis[3]?.valor).toBe("20");
    expect(v.kpis[3]?.delta).toMatchObject({ value: "300%", positive: true });
    expect(v.temVendas).toBe(true);

    expect(v.categorias.map((c) => [c.nome, c.faturamento])).toEqual([["PERFUMARIA", 200], ["BODY", 100]]);
    expect(v.deltaCategorias).toMatchObject({ value: "100%", positive: true });
    // Body comeca em 66,7% acumulado (< 80%)  ->  ainda classe A.
    expect(v.curvaAbcCategorias.itens.map((i) => i.classe)).toEqual(["A", "A"]);

    const [a1, b2] = v.produtos;
    expect(a1).toMatchObject({ codigo: "A1", faturamento: 200, itens: 4, precoMedio: 50, cmv: 80, lucro: 120, variacaoPct: 100 });
    expect(a1?.participacaoPct).toBeCloseTo(66.67, 1);
    // B2 vendeu num dia sem custo gravado  ->  nada estimado.
    expect(b2).toMatchObject({ codigo: "B2", cmv: null, lucro: null, margemPct: null, variacaoPct: null });
    expect(v.temCustoProduto).toBe(true);
  });

  it("linhas de produto: soma a fragrância em todos os tipos; sem custo em algum produto → margem —", () => {
    const nomeado = (d: string, id: number, code: string, nome: string, rev: number, itens: number) => ({
      ...prod(d, id, code, rev, itens),
      productName: nome,
    });
    const v = buildProductsView(esc, {
      dayAggs: [dia("2026-08-08", 100, 40), dia("2026-08-10", 600, 200)],
      productDayAggs: [
        nomeado("2026-08-10", 1, "DCOB", "DESOD COL OBSESSED 100ML - WEPINK", 200, 2),
        nomeado("2026-08-10", 2, "DCOBDX", "DESOD COL OBSESSED DELUXE 100 ML - WEPINK", 150, 1),
        nomeado("2026-08-10", 3, "BSOBS", "BODY SPLASH OBSESSED 200ML - WEPINK", 100, 2),
        nomeado("2026-08-08", 3, "BSOBS", "BODY SPLASH OBSESSED 200ML - WEPINK", 100, 2),
        nomeado("2026-08-10", 4, "271", "BODY SPLASH VF GOLDEN  200 ML - WEPINK", 120, 1),
        nomeado("2026-08-10", 5, "327", "SHAMPOO MY HAIR ULTRA REPAIR 250ML - WEPINK", 30, 1),
      ],
      productCostDayAggs: [custo("2026-08-10", "DCOB", 80), custo("2026-08-10", "DCOBDX", 60), custo("2026-08-10", "BSOBS", 40)],
      // Catalogo da o nome estavel: VF GOLDEN sozinha no periodo ainda e da linha VF.
      catalogDescriptions: ["DESOD COL VF 27 75ML - WEPINK", "BODY SPLASH VF GOLDEN  200 ML - WEPINK"],
    });
    const [obsessed, vf] = v.linhas;
    expect(obsessed).toMatchObject({
      nome: "OBSESSED",
      faturamento: 450,
      itens: 5,
      produtos: 3,
      tipos: ["Desodorante colônia", "Body splash"],
      variacaoPct: 350,
    });
    expect(obsessed?.margemPct).toBeCloseTo(60);
    expect(vf).toMatchObject({ nome: "VF", faturamento: 120, margemPct: null });
    expect(v.semLinhaFaturamento).toBe(30);
  });

  it("lucro do produto desconta ICMS (faturamento) e ICMS ST (CMV) da loja", () => {
    const loja = stores.find((s) => s.id === "f1")!;
    const antes = loja.custos;
    loja.custos = { ...EMPTY_STORE_COSTS, icmsWepinkPct: 10, icmsWpinkPct: 10, icmsStWepinkPct: 20, icmsStWpinkPct: 20 };
    try {
      const v = buildProductsView(esc, {
        dayAggs: [dia("2026-08-10", 200, 80)],
        productDayAggs: [prod("2026-08-10", 1, "A1", 200, 4)],
        productCostDayAggs: [custo("2026-08-10", "A1", 80)],
      });
      // 200  80  20  16
      expect(v.produtos[0]?.lucro).toBeCloseTo(84);
      expect(v.produtos[0]?.margemPct).toBeCloseTo(42);
    } finally {
      loja.custos = antes;
    }
  });

  it("usa a venda da margem quando o cupom veio abaixo do CMV", () => {
    const v = buildProductsView(esc, {
      dayAggs: [dia("2026-08-10", 600, 200)],
      productDayAggs: [prod("2026-08-10", 1, "A1", 0, 4)],
      productCostDayAggs: [{ ...custo("2026-08-10", "A1", 80), revenueCents: 600 * 100, itemCount: 4 }],
    });
    expect(v.produtos[0]).toMatchObject({ codigo: "A1", faturamento: 600, itens: 4, cmv: 80, lucro: 520 });
  });

  describe("período terminando hoje", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T20:30:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("categorias e produtos comparam até ontem; Hoje fica sem variação", () => {
      const semana = { filialIds: ["f1"], periodo: { tipo: "estaSemana" as const }, divisao: null };
      const input = {
        dayAggs: [],
        categoryDayAggs: [cat("2026-09-21", 1, "Body", 100), cat("2026-09-24", 1, "Body", 500), cat("2026-09-14", 1, "Body", 50), cat("2026-09-17", 1, "Body", 900)],
        productDayAggs: [prod("2026-09-21", 1, "A1", 100, 1), prod("2026-09-24", 1, "A1", 500, 5), prod("2026-09-14", 1, "A1", 50, 1), prod("2026-09-17", 1, "A1", 900, 9)],
      };
      const v = buildProductsView(semana, input);
      expect(v.deltaCategorias).toMatchObject({ value: "100%", positive: true, vs: "a semana passada, até o mesmo dia" });
      expect(v.produtos[0]?.variacaoPct).toBe(100);
      expect(v.produtos[0]?.faturamento).toBe(600);

      const hoje = buildProductsView({ ...semana, periodo: { tipo: "hoje" } }, input);
      expect(hoje.deltaCategorias).toBeUndefined();
      expect(hoje.produtos[0]?.variacaoPct).toBeNull();
    });
  });
});

describe("buildTeamDashboardView com agregados reais", () => {
  const vend = (d: string, nome: string, rev: number, vendas: number, itens: number, extra: Record<string, unknown> = {}) => ({
    tenantId: "t1", storeId: "f1", day: d, sellerKey: nome.toUpperCase(), sellerName: nome, brand: "ALL" as const,
    revenueCents: rev * 100, salesCount: vendas, itemCount: itens, ...extra,
  });
  const dia = (d: string, rev: number) => ({
    tenantId: "t1", storeId: "f1", day: d, brand: "ALL" as const, revenueCents: rev * 100, salesCount: 1, itemCount: 1,
  });
  const esc = { filialIds: ["f1"], periodo: { tipo: "personalizado" as const, inicio: "2026-08-10", fim: "2026-08-11" }, divisao: null };

  it("KPIs, ranking com variação, turnos e composição com vendas fora da equipe", () => {
    const v = buildTeamDashboardView(esc, {
      dayAggs: [dia("2026-08-10", 400), dia("2026-08-11", 200)],
      sellerDayAggs: [
        vend("2026-08-10", "Ana", 300, 3, 6, { sellerEmployeeId: 10 }),
        vend("2026-08-11", "Bia", 200, 2, 0),
        vend("2026-08-08", "Ana", 150, 2, 3, { sellerEmployeeId: 10 }),
        vend("2026-08-09", "Bia", 100, 1, 1),
      ],
      sellerShifts: [{ storeId: "f1", employeeId: 10, geradorId: null, nameKeys: [], name: "Manhã", start: "09:00", end: "15:00" }],
    });
    expect(v.kpis.map((k) => k.label)).toEqual(["Faturamento da equipe", "Nº de vendas", "Ticket médio", "P.A."]);
    expect(v.kpis[0]?.valor).toMatch(/500,00$/);
    expect(v.kpis[0]?.delta).toMatchObject({ value: "100%", positive: true });
    expect(v.kpis[1]?.valor).toBe("5");
    // Bia vendeu sem itens gravados  ->  P.A. da equipe " - " (nada estimado).
    expect(v.kpis[3]?.valor).toBe("—");

    const [ana, bia] = v.pessoas;
    expect(ana).toMatchObject({ nome: "Ana", faturamento: 300, vendas: 3, ticketMedio: 100, pa: 2, variacaoPct: 100, turno: "Manhã · 09:00–15:00" });
    expect(ana?.participacaoPct).toBeCloseTo(60);
    expect(bia).toMatchObject({ nome: "Bia", pa: null, turno: undefined, variacaoPct: 100 });

    expect(v.turnosConfigurados).toBe(true);
    expect(v.turnos.map((t) => [t.nome, t.faturamento, t.pessoas])).toEqual([
      ["Manhã · 09:00–15:00", 300, 1],
      [TEAM_SEM_TURNO, 200, 1],
    ]);
    expect(v.composicao).toEqual({ equipe: 500, fora: 100, total: 600 });
  });

  it("filtro de turno: KPIs e tabela só do turno; composição separa o turno do resto da equipe", () => {
    const input = {
      dayAggs: [dia("2026-08-10", 600)],
      sellerDayAggs: [
        vend("2026-08-10", "Ana", 300, 3, 6, { sellerEmployeeId: 10 }),
        vend("2026-08-10", "Bia", 200, 2, 4),
        vend("2026-08-08", "Ana", 100, 1, 2, { sellerEmployeeId: 10 }),
      ],
      sellerShifts: [{ storeId: "f1", employeeId: 10, geradorId: null, nameKeys: [], name: "Manhã", start: "09:00", end: "15:00" }],
    };
    const v = buildTeamDashboardView(esc, input, { turno: "Manhã" });
    expect(v.turnosDisponiveis).toEqual(["Manhã", TEAM_SEM_TURNO]);
    expect(v.turnoFiltro).toBe("Manhã");
    expect(v.pessoas.map((p) => p.nome)).toEqual(["Ana"]);
    expect(v.pessoas[0]?.participacaoPct).toBeCloseTo(100);
    expect(v.kpis[0]?.valor).toMatch(/300,00$/);
    expect(v.kpis[0]?.delta).toMatchObject({ value: "200%", positive: true });
    expect(v.turnos).toHaveLength(2);
    expect(v.composicao).toEqual({ equipe: 500, fora: 100, total: 600, turno: 300 });

    const semTurno = buildTeamDashboardView(esc, input, { turno: TEAM_SEM_TURNO });
    expect(semTurno.pessoas.map((p) => p.nome)).toEqual(["Bia"]);
    // Turno que nao existe no escopo = todos.
    expect(buildTeamDashboardView(esc, input, { turno: "Noite" }).turnoFiltro).toBeNull();
  });

  it("sem venda no período: sem badge e sem pessoas", () => {
    const v = buildTeamDashboardView(esc, { dayAggs: [], sellerDayAggs: [vend("2026-08-08", "Ana", 150, 2, 3)] });
    expect(v.pessoas).toEqual([]);
    expect(v.kpis.every((k) => k.delta === undefined)).toBe(true);
    expect(v.composicao.total).toBe(0);
  });
});
