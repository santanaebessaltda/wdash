/**
 * Camada de visoes da aba Equipe (EQUIP-01..07). Mesma arquitetura da Visao
 * geral: `montarEquipeView(escopo)` calcula tudo e a pagina so monta blocos.
 * Fica em arquivo proprio porque vendas.ts consome o cadastro de colaboradores
 * (equipe.ts) no boot  -  importar a camada de views daqui evita ciclo.
 *
 * Regra AD-046: meta, escada, premiacao e desafios sao SEMPRE do mes da
 * competencia (mes corrente, ou mes passado se o filtro for "Mes passado") e
 * permanecem visiveis. Os 4 KPIs de desempenho obedecem ao periodo filtrado.
 * Quando o periodo = competencia, um aviso deixa o recorte explicito.
 */
import { eligibleSeller, collaboratorsOfStore, collaboratorById, type Collaborator } from "./team";
import { goalOfStore, goalsOfStore, type Tier, type GoalBrand } from "./goals";
import {
  challengeManagerTarget,
  challengeIsIndex,
  challengesInScope,
  averageProgress,
  challengeFloor,
  cappedManagerProgress,
  individualProgress,
  type Challenge,
} from "./challenges";
import { TODAY_ISO, CURRENT_HOUR } from "./clock";
import { dayAggregate, salesDay, storeOpen, sumAggregates, type Aggregate } from "./sales";
import { storeById, stores, grupos, type Store } from "./stores";
import { brlK, revenueCurve, seriesAxisForPeriod, kpiDelta, previousPeriod, resolvePeriod, seriesAxisLabel, type Scope, type ResolvedPeriod, type BlockState } from "./dashboard";
import { brl, dataCurta, deIso, fimDoMes, horaCurta, intervaloDias, mesAno, num, rotuloDias, somarDias } from "@/lib/format";
import type { TintKey } from "@/pages/dashboards/icons";
import type { GoalCardView, NetworkGlobalGoal, SellerRow } from "./engine/goalTypes";

export type { GoalCardView, NetworkGlobalGoal, SellerRow } from "./engine/goalTypes";

const PALETA_LOJAS: TintKey[] = ["acc", "ok", "info", "warn", "bad"];

function divSeguro(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

/* ------------------------- Elegibilidade e meta individual (EQUIP-03) ------------------------- */

/** Vendedora elegivel presente na loja no dia (admissao  dia < inatividade). */
export function presentOnDay(c: Collaborator, iso: string): boolean {
  if (!eligibleSeller(c)) return false;
  if (c.dataAdmissao > iso) return false;
  if (c.dataInatividade && c.dataInatividade <= iso) return false;
  return true;
}

/** Dias abertos da loja em que a vendedora estava presente, dentro do intervalo. */
function diasElegiveis(c: Collaborator, filial: Store, inicio: string, fim: string): string[] {
  const primeiro = c.dataAdmissao > inicio ? c.dataAdmissao : inicio;
  const ultimo = c.dataInatividade && c.dataInatividade <= fim ? somarDias(c.dataInatividade, -1) : fim;
  if (primeiro > ultimo) return [];
  return intervaloDias(primeiro, ultimo).filter((iso) => storeOpen(filial, iso));
}

/** Vendedoras elegiveis presentes na loja no mes (base de listas e somas). */
export function sellersOfStore(filialId: string, competencia: string): Collaborator[] {
  const primeiroMes = `${competencia}-01`;
  return collaboratorsOfStore(filialId).filter((c) => presentOnDay(c, primeiroMes) || presentOnDay(c, TODAY_ISO));
}

export interface IndividualGoal {
  valor: number;
  /** Admissao ou inatividade no meio do mes: meta proporcional aos dias elegiveis. */
  proporcional: boolean;
  diasElegiveis: number;
  /** Dias abertos da loja no mes inteiro  -  base da proporcionalidade. */
  diasAbertosMes: number;
}

/**
 * Meta individual derivada: meta da loja distribuida pelo peso de venda das
 * elegiveis. Periodo parcial (admissao/inatividade no meio do mes): o peso
 * fica proporcional aos dias elegiveis e a meta e redistribuida entre todas  - 
 * a soma das individuais fecha com a meta da loja em qualquer composicao.
 */
export function individualGoal(c: Collaborator, filialId: string, competencia: string): IndividualGoal | null {
  const meta = goalOfStore(filialId, competencia);
  if (!meta) return null;
  const filial = storeById(filialId);
  const primeiroMes = `${competencia}-01`;
  const ultimoMes = fimDoMes(primeiroMes);
  const elegiveisMes = sellersOfStore(filialId, competencia);
  if (elegiveisMes.length === 0) return null;

  const diasAbertosMes = intervaloDias(primeiroMes, ultimoMes).filter((iso) => storeOpen(filial, iso)).length;
  const dias = diasElegiveis(c, filial, primeiroMes, ultimoMes);
  const pesoAjustado = c.pesoVenda * (diasAbertosMes > 0 ? dias.length / diasAbertosMes : 0);
  const somaPesosAjustados = elegiveisMes.reduce((s, x) => {
    const d = diasElegiveis(x, filial, primeiroMes, ultimoMes);
    return s + x.pesoVenda * (diasAbertosMes > 0 ? d.length / diasAbertosMes : 0);
  }, 0);
  if (somaPesosAjustados <= 0) return null;
  const valor = (meta.valorLoja * pesoAjustado) / somaPesosAjustados;
  return { valor, proporcional: dias.length < diasAbertosMes, diasElegiveis: dias.length, diasAbertosMes };
}

/* ------------------------- Agregado por vendedora (EQUIP-02) ------------------------- */

export interface SellerAggregate {
  colaboradorId: string;
  faturamento: number;
  atendimentos: number;
  itens: number;
  diasTrabalhados: number;
}

/** Agregado da vendedora no periodo (respeitando a fracao do dia de hoje). */
export function sellerAggregateForPeriod(c: Collaborator, filialId: string, inicio: string, fim: string): SellerAggregate {
  const out = { colaboradorId: c.id, faturamento: 0, atendimentos: 0, itens: 0, diasTrabalhados: 0 };
  for (const iso of intervaloDias(inicio, fim)) {
    if (!presentOnDay(c, iso)) continue;
    const dia = salesDay(filialId, iso);
    if (!dia) continue;
    // Hoje incompleto: o gerador ja trunca porHora na hora atual; o total do
    // dia, nao. Recorte a fatia da vendedora pela fracao do dia realizada.
    const horaMax = iso === TODAY_ISO ? CURRENT_HOUR : undefined;
    const totalDia = dayAggregate(dia, null, horaMax);
    const doDia = dia.porVendedora[c.id];
    if (!doDia || totalDia.faturamento <= 0) continue;
    const fr = totalDia.faturamento / dia.total.faturamento;
    const faturamento = Math.round(doDia.faturamento * fr);
    const atendimentos = Math.round(doDia.atendimentos * fr);
    const itens = Math.round(doDia.itens * fr);
    if (faturamento > 0 || atendimentos > 0) out.diasTrabalhados += 1;
    out.faturamento += faturamento;
    out.atendimentos += atendimentos;
    out.itens += itens;
  }
  return out;
}

/* ------------------------- Escada de degraus (EQUIP-04) ------------------------- */

export interface LadderRow {
  /** Degrau alcancado (maior minPct  atingimento); null antes do primeiro. */
  degrau: Tier | null;
  /** Premiacao da escada: realizado x pct do degrau  100 (paga como premiacao, AD-041). */
  premiacao: number;
  /** Bonus do degrau  -  so entra quando o degrau e alcancado. */
  bonus: number;
  /** Proximo degrau, quanto falta e o que ele passa a pagar; null no ultimo. */
  proximo: { nome: string; faltaValor: number; pctPremiacao: number; bonus: number; atingMinPct: number } | null;
}

/** Escada de degraus da Meta customizada da filial (nao a padrao global). */
export function tiersOfStore(filialId: string, competencia: string): Tier[] {
  return goalOfStore(filialId, competencia)?.degraus ?? [];
}

/**
 * Posicao na escada: degrau alcancado pelo atingimento individual, premiacao
 * acumulada e bonus, e quanto falta pro proximo degrau. Sem degrau a
 * premiacao e 0  -  a vendedora so premia ao entrar no primeiro degrau.
 * (O usuario paga tudo como premiacao, nao como comissao  -  AD-041.)
 */
export function sellerLadder(
  realizado: number,
  metaInd: IndividualGoal | null,
  degraus: Tier[],
): LadderRow | null {
  if (!metaInd || metaInd.valor <= 0) return null;
  const atingPct = (realizado / metaInd.valor) * 100;
  let degrau: Tier | null = null;
  for (const d of degraus) {
    if (atingPct >= d.atingimentoMinPct) degrau = d;
    else break;
  }
  const idx = degrau ? degraus.indexOf(degrau) : -1;
  const premiacao = degrau ? (realizado * degrau.comissaoPct) / 100 : 0;
  const bonus = degrau ? degrau.bonus : 0;
  const seguinte = idx + 1 < degraus.length ? degraus[idx + 1] : null;
  const proximo = seguinte
    ? {
        nome: seguinte.nome,
        faltaValor: Math.max(0, (metaInd.valor * seguinte.atingimentoMinPct) / 100 - realizado),
        pctPremiacao: seguinte.comissaoPct,
        bonus: seguinte.bonus,
        atingMinPct: seguinte.atingimentoMinPct,
      }
    : null;
  return { degrau, premiacao, bonus, proximo };
}

/* ------------------------- Tipos da visao ------------------------- */

export interface TeamKpiValue {
  valor: string;
  delta: { value: string; positive: boolean; vs?: string } | undefined;
  /** Linha auxiliar sob o valor (mesmo padrao VG/Fin/Prod). */
  sub?: string;
  /** Serie diaria (reservada; KPIs da Equipe nao renderizam sparkline). */
  serie?: number[];
}

export interface ChallengeParticipantView {
  colaboradorId: string;
  nome: string;
  /** Fantasia da loja  -  util na visao rede. */
  loja: string;
  /** Nome do grupo (Grupo 1/Grupo 2) ou " - " se sem grupo. */
  grupo: string;
  progresso: number;
  /** Piso/alvo contra o qual a barra e medida. */
  alvo: number;
  progressoPct: number;
  /** Ex.: "8/15 un"  |  "1,85/1,90"  |  "R$ 178/R$ 185". */
  progressoRotulo: string;
  status: "atingiu" | "quase" | "abaixo" | "nao_comecou";
}

export interface ChallengeView {
  id: string;
  nome: string;
  /** Objetivo + meta + minimo + premio concatenados (estilo Projects.desc). */
  descricao: string;
  objetivo: string;
  /** Ex.: "15 un" / "1,90" / "R$ 185"  -  so o valor (o verbo fica no objetivo). */
  metaRotulo: string;
  /** Valor minimo configurado (null = sem piso explicito). */
  minimo: number | null;
  /** Se ha minimo discriminado no card (minimo != null). */
  temMinimo: boolean;
  tipo: Challenge["tipo"];
  /** Cor do icone de fogo no card (CSS color / token). */
  corIcone: string;
  alvoIndividual: number;
  unidade: Challenge["unidade"];
  /** Premio da vendedora que fechar. */
  premio: number;
  /** Premio do gerente se a regra de N vendedoras fechar. */
  premioGerente: number;
  /** Quantas vendedoras precisam atingir (parametrizacao do gerente). */
  minimoVendedorasAtingindo: number;
  participantes: number;
  engajadas: number;
  /**
   * Progresso agregado: un/R$ = soma capped (regra A); pa/ticket = media da equipe.
   */
  progressoAgregado: number;
  /**
   * Alvo agregado: un/R$ = piso x N gerente; pa/ticket = o proprio piso (ex.: 1,90).
   */
  alvoAgregado: number;
  progressoPct: number;
  /** Ex.: "6/9 un"  -  progresso da meta do gerente. */
  progressoAgregadoRotulo: string;
  /** Quantas participantes ja atingiram o alvo individual. */
  atingiram: number;
  projetadoAgregado: number;
  fechaNoRitmo: boolean;
  semEngajamento: boolean;
  tipoTexto: string;
  /** Dias restantes (ativo), dias ate comecar (agendado) ou 0 (encerrado). */
  diasRestantes: number;
  /** Rotulo do badge de prazo: "15d"  |  "Em 5d"  |  "Encerrado". */
  prazoRotulo: string;
  /** Janela do desafio, ex.: "01/09  -  15/09". */
  janelaRotulo: string;
  /** Tom do prazo: ok=ativo, muted=a comecar, bad=encerrado. */
  prazoTom: "ok" | "bad" | "muted";
  /** Status temporal do desafio. */
  statusLabel: "Ativo" | "Encerrado" | "A começar";
  statusVariant: "success" | "danger" | "neutral" | "warning" | "info";
  /** Loja dona (`null` = rede). */
  filialId: string | null;
  /** Rotulo curto da loja (ex.: "Campo Grande") ou "Rede". */
  lojaRotulo: string;
  /** Exibir loja no card (visao Todas as lojas). */
  exibirLoja: boolean;
  /** Todos os participantes, ordenados: atingiu  ->  quase  ->  abaixo  ->  nao comecou. */
  ranking: ChallengeParticipantView[];
}

export interface StoreTeamSummary {
  filialId: string;
  nome: string;
  tint: TintKey;
  faturamento: string;
  ticket: string;
  pa: string;
  premiacaoProjetada: string;
  /** Meta da loja na competencia (0 se sem meta). */
  metaValor: number;
  /** Realizado da loja no periodo. */
  realizadoValor: number;
  /** Meta da loja / meta global x 100 (0 se meta global = 0). */
  pctMetaGlobal: number;
  melhor: { nome: string; atingimentoPct: number } | null;
  pior: { nome: string; atingimentoPct: number } | null;
}

export interface TeamBlockStates {
  kpis: BlockState;
  leitura: BlockState;
  vendedoras: BlockState;
  challenges: BlockState;
}

export interface TeamView {
  escopo: Scope;
  periodo: ResolvedPeriod;
  visao: "loja" | "rede";
  competencia: string;
  /** Ha meta na competencia: escada/premiacao/desafios entram (AD-046  -  independente do filtro de periodo). */
  metaAtiva: boolean;
  avisoCompetencia: string | null;
  avisos: string[];
  kpiFaturamento: TeamKpiValue;
  kpiAtendimentos: TeamKpiValue;
  kpiTicket: TeamKpiValue;
  kpiPA: TeamKpiValue;
  /**
   * Premiacao projetada  -  VERBA UNICA (decisao do usuario: paga tudo como
   * premiacao, nunca como comissao): escada de metas + premios dos desafios
   * que fecham. null sem meta ativa (vira 4 KPIs).
   */
  kpiPremiacao: TeamKpiValue | null;
  metaGlobal: NetworkGlobalGoal | null;
  /** Uma entrada por meta ativa no escopo (loja principal + metas de marca, etc.). */
  metasCards: GoalCardView[];
  leitura: string | null;
  /** Serie acumulada Realizado x Meta (mesmo padrao da Visao Geral). */
  evolucaoFaturamento?: { label: string; realizado: number; meta: number }[];
  /** Subtitulo do eixo (ex.: "Este mes  |  por dia"). */
  seriesLabel?: string;
  /** Grupos da loja/rede (ex.: Grupo 1, Grupo 2) para o filtro do header. */
  gruposDisponiveis: { id: string; nome: string }[];
  vendedoras: SellerRow[] | null;
  lojas: StoreTeamSummary[] | null;
  challenges: ChallengeView[] | null;
  estados: TeamBlockStates;
}

/* ------------------------- Loja: KPIs e lista ------------------------- */

/** Agregado da loja no periodo, com o dia de hoje truncado na hora atual. */
function agregadoLoja(filialId: string, inicio: string, fim: string): Aggregate {
  return sumAggregates(
    intervaloDias(inicio, fim).map((iso) => {
      const dia = salesDay(filialId, iso);
      if (!dia) return { faturamento: 0, atendimentos: 0, itens: 0 };
      return dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    }),
  );
}

/** Tendencia: ultimos 7 dias vs. 7 anteriores da vendedora; 5% = estavel. */
function tendenciaVendedora(c: Collaborator, filialId: string, fimIso: string): SellerRow["tendencia"] {
  const soma = (inicio: string, fim: string) =>
    intervaloDias(inicio, fim).reduce((s, iso) => s + sellerAggregateForPeriod(c, filialId, iso, iso).faturamento, 0);
  const ultimos = soma(somarDias(fimIso, -6), fimIso);
  const anteriores = soma(somarDias(fimIso, -13), somarDias(fimIso, -7));
  if (anteriores <= 0 || ultimos <= 0) return "estavel";
  const v = ((ultimos - anteriores) / anteriores) * 100;
  if (v > 5) return "subindo";
  if (v < -5) return "caindo";
  return "estavel";
}

/**
 * Fatores relativos de ritmo entre vendedoras (demo do ranking).
 * So redistribuem o faturamento **ja gerado**  -  a soma das linhas permanece
 * igual a soma bruta, entao Progresso da Meta ( linhas) fecha com o ranking.
 * f1 (Shopping CG) no mock de set/26 esta no Hiper (N3 100% da meta);
 * fatores espalham vendedoras entre N1 - N4 (Desafio = 110%).
 */
const DEMO_FATOR_RITMO: Record<string, number> = {
  // f1  -  Campo Grande (loja no Hiper / N3)
  c01: 1.25,
  c02: 1.15,
  c03: 1.08,
  c04: 1.0,
  c05: 0.9,
  c07: 0.8,
  c08: 0.55,
  // f2  -  Tres Lagoas (ritmo normal)
  c11: 1.65,
  c12: 1.4,
  c13: 1.2,
  c14: 1.0,
  c15: 0.8,
  c16: 0.9,
  c17: 0.65,
  c18: 0.45,
};

function visaoVendedoras(filialId: string, periodo: ResolvedPeriod, metaAtiva: boolean, competencia: string): SellerRow[] {
  const filial = storeById(filialId);
  const agLoja = agregadoLoja(filialId, periodo.inicio, periodo.fim);
  const paMedioLoja = divSeguro(agLoja.itens, agLoja.atendimentos);
  const degraus = tiersOfStore(filialId, competencia);
  const elegiveis = sellersOfStore(filialId, competencia);

  // 1 passagem: agregado real por vendedora (fonte unica de R$).
  const brutos = elegiveis.map((c) => {
    const ag = sellerAggregateForPeriod(c, filialId, periodo.inicio, periodo.fim);
    return { c, ag };
  });
  const somaBruta = brutos.reduce((s, x) => s + x.ag.faturamento, 0);
  const somaPeso = brutos.reduce((s, x) => {
    const fat = Math.max(0, x.ag.faturamento);
    const fator = DEMO_FATOR_RITMO[x.c.id] ?? 1;
    return s + fat * fator;
  }, 0);

  return brutos
    .map(({ c, ag: agRaw }) => {
    const metaInd = metaAtiva ? individualGoal(c, filialId, competencia) : null;

    // Redistribui o mesmo bolo: fat_i = soma x (fat_bruta x fator) / (...).
    let faturamento = agRaw.faturamento;
    let atendimentos = agRaw.atendimentos;
    let itens = agRaw.itens;
    if (somaBruta > 0 && somaPeso > 0) {
      const fator = DEMO_FATOR_RITMO[c.id] ?? 1;
      const fatAlvo = Math.round((somaBruta * Math.max(0, agRaw.faturamento) * fator) / somaPeso);
      if (agRaw.faturamento > 0 && fatAlvo !== agRaw.faturamento) {
        const escala = fatAlvo / agRaw.faturamento;
        faturamento = fatAlvo;
        atendimentos = Math.max(fatAlvo > 0 ? 1 : 0, Math.round(agRaw.atendimentos * escala));
        itens = Math.max(atendimentos, Math.round(agRaw.itens * escala));
      } else if (agRaw.faturamento === 0 && fatAlvo > 0) {
        faturamento = fatAlvo;
        atendimentos = Math.max(1, Math.round(fatAlvo / 120));
        itens = Math.round(atendimentos * 1.5);
      }
    }

    const ticket = divSeguro(faturamento, atendimentos);
    const pa = divSeguro(itens, atendimentos);
    const tendencia = tendenciaVendedora(c, filialId, periodo.fim);

    // Projecao do fechamento individual: realizado escalado pela fracao da
    // curva de receita ja decorrida da competencia (mesma base do Dashboard).
    const fechado = fimDoMes(`${competencia}-01`) < TODAY_ISO;
    let projecaoFinal = 0;
    if (metaInd && metaInd.valor > 0 && !fechado) {
      const curva = revenueCurve([filial], competencia);
      let fracaoAcum = 0;
      for (const iso of intervaloDias(`${competencia}-01`, TODAY_ISO)) fracaoAcum += curva.peso(iso);
      if (fracaoAcum > 0) projecaoFinal = faturamento / fracaoAcum;
    }
    const atingProjPct = metaInd && metaInd.valor > 0 ? (projecaoFinal / metaInd.valor) * 100 : 0;

    // Escada no MTD = o que ja garantiu (mesma base do Progresso da Meta).
    // Projecao alimenta so premiacao projetada / atingimentoProjetadoPct.
    const escadaMtd = metaInd ? sellerLadder(faturamento, metaInd, degraus) : null;
    const escadaRitmo =
      metaInd && !fechado && projecaoFinal > 0 ? sellerLadder(projecaoFinal, metaInd, degraus) : null;
    const escadaUi = escadaMtd;

    const degrauProjetado = escadaRitmo?.degrau ?? null;

    // Premiacao projetada individual (EQUIP-04): projecao x pct do degrau
    // projetado + bonus ja garantido. Mes fechado: o que de fato veio.
    const premiacaoProjetadaIndividual =
      metaInd && metaInd.valor > 0
        ? fechado
          ? (escadaMtd?.premiacao ?? 0) + (escadaMtd?.bonus ?? 0)
          : projecaoFinal > 0
            ? (projecaoFinal * (degrauProjetado?.comissaoPct ?? 0)) / 100 + (escadaMtd?.bonus ?? 0)
            : null
        : null;

    // Ponto de atencao  -  um por vendedora, prioridade do mockup: P.A. 5%
    // abaixo da media da loja  ->  tendencia caindo (com leitura de ritmo).
    let atencao: SellerRow["atencao"] = null;
    if (metaInd && metaInd.valor > 0) {
      const paAbaixoPct = paMedioLoja > 0 && pa > 0 && pa < paMedioLoja * 0.95 ? (pa / paMedioLoja - 1) * 100 : null;
      if (paAbaixoPct !== null) {
        atencao = { tipo: "pa", texto: `P.A. ${num(pa, 2)}`, detalhe: `${num(Math.abs(paAbaixoPct), 0)}% abaixo` };
      } else if (tendencia === "caindo") {
        atencao =
          atingProjPct < 100
            ? { tipo: "ritmo", texto: "Ritmo", detalhe: `projeta ${num(atingProjPct, 0)}% da meta` }
            : { tipo: "ritmo", texto: "Ritmo", detalhe: "caindo, mas fecha no ritmo" };
      }
    }

    const metaLoja = metaAtiva ? goalOfStore(filialId, competencia)?.valorLoja ?? 0 : 0;
    const nivelIdx = escadaUi?.degrau ? degraus.indexOf(escadaUi.degrau) : -1;

    return {
      colaboradorId: c.id,
      nome: c.nome,
      filialId,
      filialNome: filial.fantasia,
      grupo: c.grupoId ? grupos.find((t) => t.id === c.grupoId)?.nome ?? "Sem grupo" : "Sem grupo",
      faturamentoValor: faturamento,
      faturamento: brl(faturamento),
      atendimentos,
      ticketValor: ticket,
      ticket: brl(ticket),
      paValor: pa,
      pa: num(pa, 2),
      diasTrabalhados: agRaw.diasTrabalhados,
      tendencia,
      metaIndividualValor: metaInd?.valor ?? 0,
      metaProporcional: metaInd?.proporcional ?? false,
      diasElegiveis: metaInd?.diasElegiveis ?? 0,
      atingimentoPct: metaInd && metaInd.valor > 0 ? (faturamento / metaInd.valor) * 100 : 0,
      barraPct:
        metaInd && metaInd.valor > 0
          ? Math.min(100, (faturamento / metaInd.valor) * 100 / Math.max(...degraus.map((d) => d.atingimentoMinPct), 100) * 100)
          : 0,
      pctMetaGeral: metaLoja > 0 ? (faturamento / metaLoja) * 100 : 0,
      // Marcos da escada para a barra segmentada do mockup (posicao % de cada
      // degrau + % de premiacao que ele paga acima dele).
      marcosEscada: degraus.map((d) => ({ nome: d.nome, pct: d.atingimentoMinPct, pctPremiacao: d.comissaoPct, bonus: d.bonus })),
      degrauAtual: escadaUi?.degrau?.nome ?? null,
      nivelAtual: nivelIdx >= 0 ? nivelIdx + 1 : null,
      proximoDegrau: escadaUi?.proximo ?? null,
      premiacaoAcumulada: escadaMtd?.premiacao ?? 0,
      comissaoPct: escadaUi?.degrau?.comissaoPct ?? 0,
      premiacaoProjetadaIndividual,
      /** Atingimento projetado pelo ritmo da competencia (100 = fecha). */
      atingimentoProjetadoPct: metaInd && metaInd.valor > 0 && !fechado && projecaoFinal > 0 ? atingProjPct : null,
      bonusAlcancado: escadaMtd?.bonus ?? 0,
      atencao,
      semMeta: !metaInd || metaInd.valor <= 0,
    };
    })
    // Ordena por atingimento (meta ativa) ou faturamento; zeros no fim.
    .sort((a, b) => {
      const ka = metaAtiva && !a.semMeta ? a.atingimentoPct : a.faturamentoValor;
      const kb = metaAtiva && !b.semMeta ? b.atingimentoPct : b.faturamentoValor;
      return kb - ka;
    });
}

/* ------------------------- Desafios (EQUIP-05) ------------------------- */

const TIPO_TEXTO: Record<Challenge["tipo"], string> = {
  produto: "Produto",
  quantidade: "Quantidade",
  faturamento: "Faturamento",
  pa: "P.A.",
  ticket: "Ticket médio",
};

/** Icone de fogo em todos os cards  -  so a cor muda (por desafio ou tipo). */
const COR_ICONE_DESAFIO: Record<string, string> = {
  "d-perfumaria": "var(--acc)",
  "d-bodycream": "var(--warn)",
  "d-pa": "var(--info)",
  "d-ticket": "var(--ok)",
};

const COR_ICONE_TIPO: Record<Challenge["tipo"], string> = {
  produto: "var(--acc)",
  quantidade: "var(--warn)",
  faturamento: "#9d86ff",
  pa: "var(--info)",
  ticket: "var(--ok)",
};

function fmtValorDesafio(v: number, d: Challenge): string {
  if (d.tipo === "ticket" || d.tipo === "faturamento" || d.unidade === "R$") return brlK(v);
  if (d.tipo === "pa" || d.unidade === "x") return num(v, v % 1 !== 0 ? 2 : 0);
  return num(Math.round(v), 0);
}

function fmtProgressoRotulo(progresso: number, piso: number, d: Challenge): string {
  const a = fmtValorDesafio(progresso, d);
  const b = fmtValorDesafio(piso, d);
  if (d.unidade === "un") return `${a}/${b} un`;
  return `${a}/${b}`;
}

function statusParticipante(progresso: number, alvo: number): ChallengeParticipantView["status"] {
  if (progresso <= 0) return "nao_comecou";
  if (progresso >= alvo) return "atingiu";
  if (alvo > 0 && progresso / alvo >= 0.8) return "quase";
  return "abaixo";
}

const ORDEM_STATUS: Record<ChallengeParticipantView["status"], number> = {
  atingiu: 0,
  quase: 1,
  abaixo: 2,
  nao_comecou: 3,
};

/** Veredito de ritmo + status temporal pela janela inicio/fim do desafio. */
function desafioView(
  d: Challenge,
  diasDecorridos: number,
  diasTotais: number,
  filiaisIds: string[],
  exibirLoja: boolean,
): ChallengeView {
  const ids = d.participantes.filter((id) => {
    const c = collaboratorById(id);
    return c && filiaisIds.includes(c.filialId);
  });
  const linhas: ChallengeParticipantView[] = ids.map((id) => {
    const c = collaboratorById(id);
    const progresso = individualProgress(d, id);
    const piso = challengeFloor(d);
    const grupoNome = c?.grupoId ? grupos.find((t) => t.id === c.grupoId)?.nome ?? "—" : "—";
    const lojaNome = c ? storeById(c.filialId).fantasia : "—";
    return {
      colaboradorId: id,
      nome: c?.nome ?? id,
      loja: lojaNome,
      grupo: grupoNome,
      progresso,
      alvo: piso,
      progressoPct: piso > 0 ? Math.min(100, (progresso / piso) * 100) : 0,
      progressoRotulo: fmtProgressoRotulo(progresso, piso, d),
      status: statusParticipante(progresso, piso),
    };
  });
  const piso = challengeFloor(d);
  const atingiram = linhas.filter((p) => p.status === "atingiu").length;
  const minimoGerente = Math.min(d.minimoVendedorasAtingindo, ids.length);
  const progressos = linhas.map((p) => p.progresso);
  /** Indices (P.A./ticket): media vs piso. Un/R$: soma capped (regra A). */
  const progressoAgregado = challengeIsIndex(d)
    ? averageProgress(progressos)
    : cappedManagerProgress(progressos, piso);
  const alvoAgregado = challengeManagerTarget(d, ids.length);
  const projetado = diasDecorridos > 0 ? (progressoAgregado / diasDecorridos) * diasTotais : 0;
  const semEngajamento = progressoAgregado <= 0;
  const ranking = [...linhas].sort(
    (a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || b.progresso - a.progresso || b.progressoPct - a.progressoPct,
  );
  const metaRotulo =
    d.tipo === "pa"
      ? num(d.alvoIndividual, 2)
      : d.tipo === "ticket" || d.unidade === "R$" || d.tipo === "faturamento"
        ? brlK(d.alvoIndividual)
        : `${num(d.tipo === "produto" ? piso : d.alvoIndividual, 0)} un`;
  const minimoRotulo =
    d.minimo == null
      ? null
      : d.unidade === "un"
        ? `${num(d.minimo, 0)} un`
        : d.tipo === "ticket" || d.unidade === "R$"
          ? brlK(d.minimo)
          : num(d.minimo, d.minimo % 1 !== 0 ? 2 : 0);

  let statusLabel: ChallengeView["statusLabel"];
  let statusVariant: ChallengeView["statusVariant"];
  let prazoTom: ChallengeView["prazoTom"];
  let diasRestantes: number;
  let prazoRotulo: string;
  if (TODAY_ISO < d.inicio) {
    statusLabel = "A começar";
    statusVariant = "info";
    prazoTom = "muted";
    diasRestantes = intervaloDias(TODAY_ISO, d.inicio).length - 1;
    prazoRotulo = diasRestantes <= 0 ? "Hoje" : `Em ${rotuloDias(diasRestantes)}`;
  } else if (TODAY_ISO > d.fim) {
    statusLabel = "Encerrado";
    statusVariant = "neutral";
    prazoTom = "bad";
    diasRestantes = 0;
    prazoRotulo = "Encerrado";
  } else {
    statusLabel = "Ativo";
    statusVariant = "success";
    prazoTom = "ok";
    diasRestantes = intervaloDias(TODAY_ISO, d.fim).length;
    prazoRotulo = rotuloDias(diasRestantes);
  }

  const fechaNoRitmo =
    semEngajamento || statusLabel !== "Ativo"
      ? false
      : atingiram >= minimoGerente || projetado >= alvoAgregado;
  const descricao =
    minimoRotulo != null
      ? `Meta: ${metaRotulo} · Mínimo: ${minimoRotulo} · Prêmio: ${brl(d.premio)}`
      : `Meta: ${metaRotulo} · Prêmio: ${brl(d.premio)}`;
  const lojaRotulo = d.filialId
    ? storeById(d.filialId).fantasia.replace(/^Shopping\s+/i, "")
    : "Rede";
  return {
    id: d.id,
    nome: d.nome,
    descricao,
    objetivo: d.objetivo,
    metaRotulo,
    minimo: d.minimo,
    temMinimo: d.minimo != null,
    tipo: d.tipo,
    corIcone: COR_ICONE_DESAFIO[d.id] ?? COR_ICONE_TIPO[d.tipo],
    alvoIndividual: d.alvoIndividual,
    unidade: d.unidade,
    premio: d.premio,
    premioGerente: d.premioGerente,
    minimoVendedorasAtingindo: minimoGerente,
    participantes: ids.length,
    engajadas: linhas.filter((p) => p.status !== "nao_comecou").length,
    progressoAgregado,
    alvoAgregado,
    progressoPct: alvoAgregado > 0 ? (progressoAgregado / alvoAgregado) * 100 : 0,
    progressoAgregadoRotulo: fmtProgressoRotulo(progressoAgregado, alvoAgregado, d),
    atingiram,
    projetadoAgregado: projetado,
    fechaNoRitmo,
    semEngajamento,
    tipoTexto: TIPO_TEXTO[d.tipo],
    diasRestantes,
    prazoRotulo,
    janelaRotulo: `${dataCurta(d.inicio)} – ${dataCurta(d.fim)}`,
    prazoTom,
    statusLabel,
    statusVariant,
    filialId: d.filialId,
    lojaRotulo,
    exibirLoja,
    ranking,
  };
}

function diasAbertosDaCompetencia(competencia: string, filiaisIds: string[]): { decorridos: number; totais: number } {
  const primeiro = `${competencia}-01`;
  const ultimo = fimDoMes(primeiro);
  const abertos = intervaloDias(primeiro, ultimo).filter((iso) => filiaisIds.some((id) => storeOpen(storeById(id), iso)));
  const decorridos = abertos.filter((iso) => iso <= TODAY_ISO).length;
  return { decorridos, totais: abertos.length };
}

/** Lista da Equipe/Ao vivo: so desafios vigentes (status Ativo). Encerrados e "a comecar" ficam de fora. */
function desafiosViewDaCompetencia(competencia: string, filiaisIds: string[]): ChallengeView[] {
  const { decorridos, totais } = diasAbertosDaCompetencia(competencia, filiaisIds);
  const exibirLoja = filiaisIds.length > 1;
  return challengesInScope(competencia, filiaisIds)
    .map((d) => desafioView(d, decorridos, totais, filiaisIds, exibirLoja))
    .filter((d) => d.statusLabel === "Ativo")
    .sort(
      (a, b) =>
        a.diasRestantes - b.diasRestantes ||
        a.lojaRotulo.localeCompare(b.lojaRotulo, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/**
 * Fonte 1  -  escada de metas da filial (EQUIP-04): realizado de cada vendedora
 * escalado pelo ritmo da loja ate o fim do mes (fracao acumulada da curva  - 
 * equivale a "realizado + restante x indice de desempenho"), pago pelo degrau
 * que a projecao alcanca. Bonus entra uma unica vez, so de degrau ja alcancado
 * (risco D4). Competencia encerrada: premiacao final do mes.
 * null quando nao ha meta na competencia (a escada nao paga nada).
 */
function premiacaoEscada(filialId: string, competencia: string, vendedoras: SellerRow[]): number | null {
  const meta = goalOfStore(filialId, competencia);
  if (!meta) return null;
  const filial = storeById(filialId);
  const primeiro = `${competencia}-01`;
  const fechado = fimDoMes(primeiro) < TODAY_ISO;

  if (fechado) {
    return vendedoras.reduce((s, l) => s + l.premiacaoAcumulada + l.bonusAlcancado, 0);
  }

  const curva = revenueCurve([filial], competencia);
  let fracaoAcum = 0;
  for (const iso of intervaloDias(primeiro, TODAY_ISO)) fracaoAcum += curva.peso(iso);
  if (fracaoAcum <= 0) return null;

  let total = 0;
  for (const l of vendedoras) {
    if (l.semMeta || l.metaIndividualValor <= 0) continue;
    // Realizado escalado: hoje esta em fracaoAcum do mes  ->  projecao linear
    // pelo mesmo indice de desempenho acumulado do Dashboard (LOJA-03).
    const projecaoFinal = l.faturamentoValor / fracaoAcum;
    const atingPct = (projecaoFinal / l.metaIndividualValor) * 100;
    let degrau: Tier | null = null;
    for (const d of meta.degraus) {
      if (atingPct >= d.atingimentoMinPct) degrau = d;
      else break;
    }
    const pctDegrau = degrau?.comissaoPct ?? 0;
    total += (projecaoFinal * pctDegrau) / 100 + l.bonusAlcancado;
  }
  return total;
}

/**
 * Fonte 2  -  desafios (EQUIP-05): premio de cada participante cuja projecao
 * linear do progresso fecha o alvo individual (mesma projecao do
 * `desafioView`). Cada desafio e da loja (ou rede); na visao rede entra
 * uma vez por desafio. Competencia encerrada: premio dos que de fato fecharam.
 */
function premiacaoDesafios(competencia: string, filiaisIds: string[]): number {
  const { decorridos, totais } = diasAbertosDaCompetencia(competencia, filiaisIds);
  let total = 0;
  const fechado = fimDoMes(`${competencia}-01`) < TODAY_ISO;
  for (const d of challengesInScope(competencia, filiaisIds)) {
    for (const id of d.participantes) {
      const p = individualProgress(d, id);
      if (p <= 0) continue;
      const venceAgora = p >= d.alvoIndividual;
      if (fechado) {
        total += venceAgora ? d.premio : 0;
      } else if (decorridos > 0) {
        const projetado = (p / decorridos) * totais;
        if (projetado >= d.alvoIndividual) total += d.premio;
      }
    }
  }
  return total;
}

/**
 * KPI da visao loja: escada da loja + desafios. Os desafios sao da
 * competencia inteira; a visao rede soma a escada de todas e os desafios uma
 * unica vez (ver visaoRede).
 */
function premiacaoProjetada(filialId: string, competencia: string, vendedoras: SellerRow[]): number | null {
  const escada = premiacaoEscada(filialId, competencia, vendedoras);
  const challenges = premiacaoDesafios(competencia, [filialId]);
  if (escada === null) return challenges > 0 ? challenges : null;
  return escada + challenges;
}

/* ------------------------- Leitura da IA (EQUIP-06) ------------------------- */

/**
 * Leitura da aba: no produto o LLM redige a partir dos numeros; aqui a frase
 * e montada por regra. Desativada na UI por enquanto (EQUIP-06)  -  mantida
 * exportada para reativar sem reescrever a logica.
 */
export function buildTeamInsight(v: TeamView): string | null {
  const partes: string[] = [];
  const linhas = v.vendedoras ?? [];

  // Linha (a): efeito de ticket/P.A.  -  so quando o delta diz algo.
  const pa = v.kpiPA.delta;
  const ticket = v.kpiTicket.delta;
  if (pa && !pa.positive && ticket && !ticket.positive) {
    partes.push(`A equipe está vendendo menos peças por atendimento (P.A. ${pa.value}): o segundo produto está ficando na prateleira — reforçar a oferta de segunda peça e kit no caixa.`);
  } else if (pa && !pa.positive) {
    partes.push(`P.A. da equipe caiu ${pa.value} contra o período anterior: menos peças por venda, mesmo com o ticket segurando.`);
  }

  // Linha (b): quem esta abaixo da meta e caindo (omitida quando ninguem).
  // So com meta ativa: sem meta no periodo nao existe "abaixo da meta".
  if (v.metaAtiva) {
    const emRisco = linhas.filter((l) => l.atingimentoPct < 100 && l.tendencia === "caindo");
    if (emRisco.length > 0) {
      const nomes = emRisco.map((l) => primeiroNome(l.nome)).join(", ");
      const acao = emRisco.length === 1 ? `Vale uma conversa hoje com ${primeiroNome(emRisco[0].nome)}` : "Vale conversar com cada pessoa hoje";
      partes.push(`${nomes} ${emRisco.length === 1 ? "está" : "estão"} abaixo da meta individual e caindo. ${acao}.`);
    }
  }
  return partes.length > 0 ? partes.join(" ") : null;
}

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.split(" ")[0];
}

function montarMetaFaixa(realizado: number, total: number, competencia: string, filiaisEscopo: Store[]): NetworkGlobalGoal | null {
  if (total <= 0) return null;
  const primeiro = `${competencia}-01`;
  const ultimo = fimDoMes(primeiro);
  const pct = (realizado / total) * 100;
  const fechado = ultimo < TODAY_ISO;
  let projetadoPct = pct;
  if (!fechado) {
    const curva = revenueCurve(filiaisEscopo, competencia);
    let fracaoAcum = 0;
    for (const iso of intervaloDias(primeiro, TODAY_ISO)) fracaoAcum += curva.peso(iso);
    if (fracaoAcum > 0) projetadoPct = (realizado / fracaoAcum / total) * 100;
  }
  const abertosRestantes = intervaloDias(TODAY_ISO, ultimo).filter((iso) => filiaisEscopo.some((f) => storeOpen(f, iso)));
  const nomeMeta =
    filiaisEscopo.map((f) => goalOfStore(f.id, competencia)?.nome).find((n): n is string => Boolean(n)) ?? mesAno(primeiro);
  return {
    competTexto: nomeMeta,
    realizado,
    total,
    pct,
    projetadoPct,
    diasRestantes: fechado ? 0 : abertosRestantes.length,
    inicio: primeiro,
    fim: ultimo,
  };
}

/**
 * Faixa da meta com o faturamento da loja (inclui venda sem vendedora e gerencia, que ficam fora do
 * ranking) + quanto disso nao esta na equipe.
 */
function faixaComForaDaEquipe(
  faixa: NetworkGlobalGoal | null,
  somaEquipe: number,
): NetworkGlobalGoal | null {
  if (!faixa) return null;
  const fora = Math.round((faixa.realizado - somaEquipe) * 100) / 100;
  return fora > 0 ? { ...faixa, foraDaEquipe: fora } : faixa;
}

/** Faturamento da competencia filtrado por marca (1 marca) ou total (null). */
function realizadoCompetencia(filialId: string, competencia: string, marca: GoalBrand | null): number {
  const primeiro = `${competencia}-01`;
  const ultimo = fimDoMes(primeiro);
  const fimReal = ultimo < TODAY_ISO ? ultimo : TODAY_ISO;
  return sumAggregates(
    intervaloDias(primeiro, fimReal).map((iso) => {
      const dia = salesDay(filialId, iso);
      if (!dia) return { faturamento: 0, atendimentos: 0, itens: 0 };
      return dayAggregate(dia, marca, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    }),
  ).faturamento;
}

/**
 * Cards de meta do escopo: uma entrada por meta cadastrada (loja + marca).
 * Escada reusa as vendedoras da loja; realizado da faixa respeita marcas da meta.
 */
function montarMetasCards(
  filialIds: string[],
  competencia: string,
  vendedorasPorFilial: Map<string, SellerRow[]>,
): GoalCardView[] {
  const cards: GoalCardView[] = [];
  for (const filialId of filialIds) {
    const filial = storeById(filialId);
    if (!filial) continue;
    const lista = vendedorasPorFilial.get(filialId) ?? [];
    const nGrupos = gruposDaFilial(filialId).length;
    for (const m of goalsOfStore(filialId, competencia)) {
      const marcaUnica = m.marcas.length === 1 ? m.marcas[0] : null;
      const realizado = realizadoCompetencia(filialId, competencia, marcaUnica);
      const faixa = marcaUnica
        ? montarMetaFaixa(realizado, m.valorLoja, competencia, [filial])
        : faixaComForaDaEquipe(
            montarMetaFaixa(realizado, m.valorLoja, competencia, [filial]),
            lista.reduce((s, l) => s + l.faturamentoValor, 0),
          );
      if (!faixa) continue;
      faixa.competTexto = m.nome;
      cards.push({
        id: m.id,
        nome: m.nome,
        tipo: m.tipo,
        lojaNome: filial.fantasia,
        marcas: m.marcas,
        qtdGrupos: nGrupos,
        qtdVendedoras: lista.length,
        qtdNiveis: m.degraus.length,
        degraus: m.degraus,
        faixa,
        vendedoras: lista,
      });
    }
  }
  return cards;
}

/* ------------------------- Evolucao Fat vs Meta (padrao Visao Geral) ------------------------- */

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fatDiaFiliais(filialIds: string[], iso: string): number {
  return sumAggregates(
    filialIds.map((id) => {
      const dia = salesDay(id, iso);
      return dia ? dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { faturamento: 0, atendimentos: 0, itens: 0 };
    }),
  ).faturamento;
}

function fatHoraFiliais(filialIds: string[], iso: string, h: number): number {
  let fat = 0;
  for (const id of filialIds) {
    const a = salesDay(id, iso)?.porHora[h];
    if (a) fat += a.faturamento;
  }
  return fat;
}

function mesesEntre(inicio: string, fim: string): string[] {
  const out: string[] = [];
  let y = Number(inicio.slice(0, 4));
  let m = Number(inicio.slice(5, 7));
  const yF = Number(fim.slice(0, 4));
  const mF = Number(fim.slice(5, 7));
  while (y < yF || (y === yF && m <= mF)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Serie acumulada Realizado x Meta  -  mesmo rateio da Visao Geral. */
function montarEvolucaoFatVsMeta(
  filialIds: string[],
  periodo: ResolvedPeriod,
  metaTotal: number,
): { pontos: { label: string; realizado: number; meta: number }[]; seriesLabel: string } | undefined {
  const eixo = seriesAxisForPeriod(periodo);
  const seriesLabel = seriesAxisLabel(periodo, eixo);
  const pontos: { label: string; realizado: number; meta: number }[] = [];

  if (eixo === "hora") {
    const fs = filialIds.map((id) => storeById(id)).filter((f): f is Store => Boolean(f));
    if (fs.length === 0) return undefined;
    const abertura = Math.min(...fs.map((f) => f.abertura));
    const fechamento = Math.max(...fs.map((f) => f.fechamento));
    const horas: number[] = [];
    for (let h = abertura; h < fechamento; h++) horas.push(h);
    const horasVisiveis = periodo.ehHoje ? horas.filter((h) => h <= CURRENT_HOUR) : horas;
    if (horasVisiveis.length < 2) return undefined;
    const metaPorHora = metaTotal > 0 && horas.length > 0 ? metaTotal / horas.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const h of horasVisiveis) {
      acumR += fatHoraFiliais(filialIds, periodo.inicio, h);
      acumM += metaPorHora;
      pontos.push({ label: horaCurta(h), realizado: acumR, meta: acumM });
    }
  } else if (eixo === "mes") {
    const meses = mesesEntre(periodo.inicio, periodo.fim);
    if (meses.length < 2) return undefined;
    const metaPorMes = metaTotal > 0 ? metaTotal / meses.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const mes of meses) {
      const inicioMes = `${mes}-01`;
      const fimMes = fimDoMes(inicioMes);
      const ini = inicioMes < periodo.inicio ? periodo.inicio : inicioMes;
      const fim = fimMes > periodo.fim ? periodo.fim : fimMes;
      for (const iso of intervaloDias(ini, fim)) {
        acumR += fatDiaFiliais(filialIds, iso);
      }
      acumM += metaPorMes;
      pontos.push({ label: mesAno(inicioMes).split(" de ")[0], realizado: acumR, meta: acumM });
    }
  } else {
    const dias = intervaloDias(periodo.inicio, periodo.fim);
    if (dias.length < 2) return undefined;
    const metaPorDia = metaTotal > 0 ? metaTotal / dias.length : 0;
    let acumR = 0;
    let acumM = 0;
    for (const iso of dias) {
      acumR += fatDiaFiliais(filialIds, iso);
      acumM += metaPorDia;
      const d = deIso(iso);
      pontos.push({
        label: `${String(d.getDate()).padStart(2, "0")} ${MESES_CURTOS[d.getMonth()]}`,
        realizado: acumR,
        meta: acumM,
      });
    }
  }

  return pontos.length > 1 ? { pontos, seriesLabel } : undefined;
}

function gruposDaFilial(filialId: string): { id: string; nome: string }[] {
  return grupos.filter((t) => t.filialId === filialId).map((t) => ({ id: t.id, nome: t.nome }));
}

/** Grupos unicos por nome (rede: Grupo 1/Grupo 2 aparecem em varias lojas). */
function gruposDoEscopo(filialIds: string[]): { id: string; nome: string }[] {
  const ids = filialIds.length > 0 ? filialIds : stores.map((f) => f.id);
  const visto = new Map<string, { id: string; nome: string }>();
  for (const id of ids) {
    for (const g of gruposDaFilial(id)) {
      if (!visto.has(g.nome)) visto.set(g.nome, { id: g.nome, nome: g.nome });
    }
  }
  return [...visto.values()];
}

/* ------------------------- Visao loja ------------------------- */

function visaoLoja(escopo: Scope, periodo: ResolvedPeriod, periodoMeta: ResolvedPeriod, competencia: string, metaAtiva: boolean): TeamView {
  const filialId = escopo.filialIds.length === 1 ? escopo.filialIds[0] : stores[0]?.id ?? "";
  const filial = storeById(filialId);
  const ant = previousPeriod(periodo);
  // KPIs de desempenho: periodo filtrado (AD-046).
  const atual = agregadoLoja(filialId, periodo.inicio, periodo.fim);
  const anterior = sumAggregates(
    intervaloDias(ant.inicio, ant.fim).map((iso) => {
      const dia = salesDay(filialId, iso);
      if (!dia) return { faturamento: 0, atendimentos: 0, itens: 0 };
      const horaMax = iso === ant.fim && ant.horaMax !== undefined ? ant.horaMax : undefined;
      return dayAggregate(dia, null, horaMax);
    }),
  );

  const temComparacao = anterior.atendimentos > 0;
  const vsRotulo = temComparacao ? ant.rotulo : undefined;
  const ticket = divSeguro(atual.faturamento, atual.atendimentos);
  const pa = divSeguro(atual.itens, atual.atendimentos);
  const ticketAnt = divSeguro(anterior.faturamento, anterior.atendimentos);
  const paAnt = divSeguro(anterior.itens, anterior.atendimentos);

  // Series diarias para sparklines nos KPIs
  const diasPeriodo = intervaloDias(periodo.inicio, periodo.fim);
  const serieFat: number[] = [];
  const serieAtend: number[] = [];
  const serieTicket: number[] = [];
  const seriePA: number[] = [];
  for (const iso of diasPeriodo) {
    const dia = salesDay(filialId, iso);
    if (!dia) {
      serieFat.push(0);
      serieAtend.push(0);
      serieTicket.push(0);
      seriePA.push(0);
      continue;
    }
    const ag = dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined);
    serieFat.push(ag.faturamento);
    serieAtend.push(ag.atendimentos);
    serieTicket.push(divSeguro(ag.faturamento, ag.atendimentos));
    seriePA.push(divSeguro(ag.itens, ag.atendimentos));
  }

  // Meta/escada/premiacao: sempre janela da competencia (AD-046).
  const vendedoras = visaoVendedoras(filialId, periodoMeta, metaAtiva, competencia);
  const premiacao = metaAtiva ? premiacaoProjetada(filialId, competencia, vendedoras) : null;

  const avisos: string[] = [];
  if (escopo.divisao && metaAtiva) {
    avisos.push("O filtro de marca altera os resultados, mas as metas individuais continuam considerando toda a loja.");
  }

  // Faixa de progresso da meta da loja = faturamento da loja (igual a Visao Geral). O que ficou
  // fora do ranking (venda sem vendedora, gerencia) aparece como "foraDaEquipe".
  let metaGlobal: NetworkGlobalGoal | null = null;
  const metaLojaValor = metaAtiva ? (goalOfStore(filialId, competencia)?.valorLoja ?? 0) : 0;
  if (metaAtiva && metaLojaValor > 0) {
    metaGlobal = faixaComForaDaEquipe(
      montarMetaFaixa(realizadoCompetencia(filialId, competencia, null), metaLojaValor, competencia, [filial]),
      vendedoras.reduce((s, l) => s + l.faturamentoValor, 0),
    );
  }

  const metasCards = metaAtiva
    ? montarMetasCards([filialId], competencia, new Map([[filialId, vendedoras]]))
    : [];

  const nDias = diasPeriodo.length;
  const evolucao = montarEvolucaoFatVsMeta([filialId], periodo, metaLojaValor);
  const challenges = metaAtiva ? desafiosViewDaCompetencia(competencia, [filial.id]) : null;

  return {
    escopo,
    periodo,
    visao: "loja",
    competencia,
    metaAtiva,
    avisoCompetencia: null, // preenchido em montarEquipeView
    avisos,
    kpiFaturamento: {
      valor: brlK(atual.faturamento),
      delta: temComparacao ? kpiDelta(atual.faturamento, anterior.faturamento, vsRotulo) : undefined,
      sub: metaLojaValor > 0 ? `Meta: ${brlK(metaLojaValor)}` : undefined,
      serie: serieFat.length > 1 ? serieFat : undefined,
    },
    kpiAtendimentos: {
      valor: num(atual.atendimentos),
      delta: temComparacao ? kpiDelta(atual.atendimentos, anterior.atendimentos, vsRotulo, "vendas") : undefined,
      sub: nDias > 1 ? `Média de ${num(atual.atendimentos / nDias, 0)}/dia` : undefined,
      serie: serieAtend.length > 1 ? serieAtend : undefined,
    },
    kpiTicket: {
      valor: brl(ticket),
      delta: temComparacao ? kpiDelta(ticket, ticketAnt, vsRotulo) : undefined,
      serie: serieTicket.length > 1 ? serieTicket : undefined,
    },
    kpiPA: {
      valor: num(pa, 2),
      delta: temComparacao ? kpiDelta(pa, paAnt, vsRotulo, "pa") : undefined,
      serie: seriePA.length > 1 ? seriePA : undefined,
    },
    kpiPremiacao: premiacao === null ? null : { valor: brl(premiacao), delta: undefined },
    metaGlobal,
    metasCards,
    leitura: null,
    evolucaoFaturamento: evolucao?.pontos,
    seriesLabel: evolucao?.seriesLabel,
    gruposDisponiveis: gruposDaFilial(filialId),
    vendedoras,
    lojas: null,
    challenges,
    estados: {
      kpis: "disponivel",
      leitura: "sem_dados",
      vendedoras: vendedoras.length > 0 ? "disponivel" : "sem_dados",
      challenges: metaAtiva ? (challenges !== null && challenges.length > 0 ? "disponivel" : "sem_dados") : "indisponivel",
    },
  };
}

/* ------------------------- Visao rede (EQUIP-07) ------------------------- */

function visaoRede(escopo: Scope, periodo: ResolvedPeriod, periodoMeta: ResolvedPeriod, competencia: string, metaAtiva: boolean): TeamView {
  // Meta global = soma das metas das lojas do escopo que tem meta (REDE-08).
  const metaGlobalTotal = stores.reduce((s, f) => s + (goalOfStore(f.id, competencia)?.valorLoja ?? 0), 0);

  const vendedorasFlat: SellerRow[] = [];
  const vendedorasPorFilial = new Map<string, SellerRow[]>();
  const lojas: StoreTeamSummary[] = stores.map((f, i) => {
    const escopoLoja: Scope = { ...escopo, filialIds: [f.id] };
    const vLoja = visaoLoja(escopoLoja, periodo, periodoMeta, competencia, metaAtiva);
    const linhas = vLoja.vendedoras ?? [];
    vendedorasFlat.push(...linhas);
    vendedorasPorFilial.set(f.id, linhas);
    const comMeta = metaAtiva ? linhas.filter((l) => !l.semMeta) : [];
    const ordenadas = [...comMeta].sort((a, b) => b.atingimentoPct - a.atingimentoPct);
    const melhor = ordenadas.length > 0 ? { nome: primeiroNome(ordenadas[0].nome), atingimentoPct: ordenadas[0].atingimentoPct } : null;
    const pior = ordenadas.length > 0 ? { nome: primeiroNome(ordenadas[ordenadas.length - 1].nome), atingimentoPct: ordenadas[ordenadas.length - 1].atingimentoPct } : null;
    const metaValor = goalOfStore(f.id, competencia)?.valorLoja ?? 0;
    const realizadoValor = linhas.reduce((s, l) => s + l.faturamentoValor, 0);
    return {
      filialId: f.id,
      nome: f.fantasia,
      tint: PALETA_LOJAS[i % PALETA_LOJAS.length],
      faturamento: vLoja.kpiFaturamento.valor,
      ticket: vLoja.kpiTicket.valor,
      pa: vLoja.kpiPA.valor,
      // Premiacao da loja = so a escada de metas dela; os desafios sao da rede
      // e entram uma vez no KPI da visao rede (nao dobram por loja).
      premiacaoProjetada: vLoja.kpiPremiacao?.valor ?? "—",
      metaValor,
      realizadoValor,
      pctMetaGlobal: metaGlobalTotal > 0 ? (metaValor / metaGlobalTotal) * 100 : 0,
      melhor,
      pior,
    };
  });

  // Flat da rede: mesma regra de ordenacao da loja (atingimento / faturamento).
  vendedorasFlat.sort((a, b) => {
    const ka = metaAtiva && !a.semMeta ? a.atingimentoPct : a.faturamentoValor;
    const kb = metaAtiva && !b.semMeta ? b.atingimentoPct : b.faturamentoValor;
    return kb - ka;
  });

  // KPIs da rede: soma das lojas (ticket e P.A. recalculados sobre a soma).
  const atual = sumAggregates(stores.map((f) => agregadoLoja(f.id, periodo.inicio, periodo.fim)));
  const ant = previousPeriod(periodo);
  const anterior = sumAggregates(
    intervaloDias(ant.inicio, ant.fim).map((iso) => {
      const horaMax = iso === ant.fim && ant.horaMax !== undefined ? ant.horaMax : undefined;
      return sumAggregates(stores.map((f) => {
        const dia = salesDay(f.id, iso);
        return dia ? dayAggregate(dia, null, horaMax) : { faturamento: 0, atendimentos: 0, itens: 0 };
      }));
    }),
  );
  const temComparacao = anterior.atendimentos > 0;
  const vsRotulo = temComparacao ? ant.rotulo : undefined;

  // Series diarias para sparklines nos KPIs da rede
  const diasPeriodoRede = intervaloDias(periodo.inicio, periodo.fim);
  const serieFatRede: number[] = [];
  const serieAtendRede: number[] = [];
  const serieTicketRede: number[] = [];
  const seriePARede: number[] = [];
  for (const iso of diasPeriodoRede) {
    const agDia = sumAggregates(stores.map((f) => {
      const dia = salesDay(f.id, iso);
      return dia ? dayAggregate(dia, null, iso === TODAY_ISO ? CURRENT_HOUR : undefined) : { faturamento: 0, atendimentos: 0, itens: 0 };
    }));
    serieFatRede.push(agDia.faturamento);
    serieAtendRede.push(agDia.atendimentos);
    serieTicketRede.push(divSeguro(agDia.faturamento, agDia.atendimentos));
    seriePARede.push(divSeguro(agDia.itens, agDia.atendimentos));
  }

  const challenges = metaAtiva ? desafiosViewDaCompetencia(competencia, stores.map((f) => f.id)) : null;
  const semDesafios = metaAtiva && (challenges === null || challenges.length === 0);

// Premiacao da rede = escada de metas de cada loja + desafios uma unica
// vez (desafio e da competencia inteira, nao por loja).
let premiacaoRede: number | null = null;
if (metaAtiva) {
  let parteEscada = 0;
  for (const f of stores) {
    const vLoja = visaoLoja({ ...escopo, filialIds: [f.id] }, periodo, periodoMeta, competencia, metaAtiva);
    const escadaLoja = premiacaoEscada(f.id, competencia, vLoja.vendedoras ?? []);
    if (escadaLoja !== null) parteEscada += escadaLoja;
  }
  const parteDesafios = premiacaoDesafios(competencia, stores.map((f) => f.id));
  premiacaoRede = parteEscada > 0 || parteDesafios > 0 ? parteEscada + parteDesafios : null;
}

  // Faixa de progresso da meta (rede) = faturamento das lojas (mesma base das lojas / Visao Geral).
  let metaGlobal: NetworkGlobalGoal | null = null;
  if (metaAtiva && metaGlobalTotal > 0) {
    const realizado = stores.reduce((s, f) => s + realizadoCompetencia(f.id, competencia, null), 0);
    metaGlobal = faixaComForaDaEquipe(
      montarMetaFaixa(realizado, metaGlobalTotal, competencia, stores),
      vendedorasFlat.reduce((s, l) => s + l.faturamentoValor, 0),
    );
  }

  const metasCards = metaAtiva
    ? montarMetasCards(
        stores.map((f) => f.id),
        competencia,
        vendedorasPorFilial,
      )
    : [];

  const evolucaoRede = montarEvolucaoFatVsMeta(
    stores.map((f) => f.id),
    periodo,
    metaAtiva ? metaGlobalTotal : 0,
  );

  const nDiasRede = diasPeriodoRede.length;
  const paRede = divSeguro(atual.itens, atual.atendimentos);
  const ticketRede = divSeguro(atual.faturamento, atual.atendimentos);
  const paRedeAnt = divSeguro(anterior.itens, anterior.atendimentos);
  const ticketRedeAnt = divSeguro(anterior.faturamento, anterior.atendimentos);

  return {
    escopo,
    periodo,
    visao: "rede",
    competencia,
    metaAtiva,
    avisoCompetencia: null,
    avisos: [],
    kpiFaturamento: {
      valor: brlK(atual.faturamento),
      delta: temComparacao ? kpiDelta(atual.faturamento, anterior.faturamento, vsRotulo) : undefined,
      sub: metaGlobalTotal > 0 ? `Meta: ${brlK(metaGlobalTotal)}` : undefined,
      serie: serieFatRede.length > 1 ? serieFatRede : undefined,
    },
    kpiAtendimentos: {
      valor: num(atual.atendimentos),
      delta: temComparacao ? kpiDelta(atual.atendimentos, anterior.atendimentos, vsRotulo, "vendas") : undefined,
      sub: nDiasRede > 1 ? `Média de ${num(atual.atendimentos / nDiasRede, 0)}/dia` : undefined,
      serie: serieAtendRede.length > 1 ? serieAtendRede : undefined,
    },
    kpiTicket: {
      valor: brl(ticketRede),
      delta: temComparacao ? kpiDelta(ticketRede, ticketRedeAnt, vsRotulo) : undefined,
      serie: serieTicketRede.length > 1 ? serieTicketRede : undefined,
    },
    kpiPA: {
      valor: num(paRede, 2),
      delta: temComparacao ? kpiDelta(paRede, paRedeAnt, vsRotulo, "pa") : undefined,
      serie: seriePARede.length > 1 ? seriePARede : undefined,
    },
    kpiPremiacao: premiacaoRede === null ? null : { valor: brl(premiacaoRede), delta: undefined },
    metaGlobal,
    metasCards,
    leitura: null,
    evolucaoFaturamento: evolucaoRede?.pontos,
    seriesLabel: evolucaoRede?.seriesLabel,
    gruposDisponiveis: gruposDoEscopo([]),
    vendedoras: vendedorasFlat,
    lojas: lojas,
    challenges,
    estados: {
      kpis: "disponivel",
      leitura: "sem_dados",
      vendedoras: vendedorasFlat.length > 0 ? "disponivel" : "sem_dados",
      challenges: metaAtiva ? (semDesafios ? "sem_dados" : "disponivel") : "indisponivel",
    },
  };
}

/* ------------------------- Entrada da aba ------------------------- */

/**
 * Competencia da Equipe (AD-046): mes passado so quando o filtro e
 * "Mes passado"; nos demais casos, mes corrente. Meta/escada/desafios
 * usam essa janela; KPIs usam o periodo filtrado.
 */
function competenciaDaEquipe(periodo: ResolvedPeriod): string {
  return periodo.tipo === "mesPassado" ? periodo.inicio.slice(0, 7) : TODAY_ISO.slice(0, 7);
}

/** Periodo resolvido da competencia (mes inteiro ate hoje ou fechado). */
function periodoDaCompetencia(competencia: string): ResolvedPeriod {
  return resolvePeriod(competencia === TODAY_ISO.slice(0, 7) ? { tipo: "esteMes" } : { tipo: "mesPassado" });
}

/** True quando o filtro ja e exatamente o mes da competencia. */
function periodoBateComCompetencia(periodo: ResolvedPeriod, competencia: string): boolean {
  if (periodo.atravessaMeses) return false;
  if (periodo.tipo === "esteMes") return competencia === TODAY_ISO.slice(0, 7);
  if (periodo.tipo === "mesPassado") return competencia === periodo.inicio.slice(0, 7);
  return false;
}

export function buildTeamView(escopo: Scope): TeamView {
  const periodo = resolvePeriod(escopo.periodo);
  const competencia = competenciaDaEquipe(periodo);
  const periodoMeta = periodoDaCompetencia(competencia);
  const ehRede = escopo.filialIds.length === 0;
  const filiaisEscopo = ehRede ? stores : escopo.filialIds.map((id) => storeById(id)).filter(Boolean) as Store[];
  // Meta ativa = existe meta cadastrada na competencia (nao depende mais do filtro).
  const metaAtiva = filiaisEscopo.some((f) => Boolean(goalOfStore(f.id, competencia)));

  const v = ehRede ? visaoRede(escopo, periodo, periodoMeta, competencia, metaAtiva) : visaoLoja(escopo, periodo, periodoMeta, competencia, metaAtiva);

  if (metaAtiva && !periodoBateComCompetencia(periodo, competencia)) {
    v.avisoCompetencia = `Os indicadores seguem o período selecionado. Metas, premiações e desafios consideram a competência ${mesAno(`${competencia}-01`)}.`;
  } else if (metaAtiva && periodo.tipo === "mesPassado") {
    v.avisoCompetencia = `Metas e premiações referentes à competência ${mesAno(`${competencia}-01`)}.`;
  }

  v.leitura = null;
  v.estados.leitura = "sem_dados";
  return v;
}