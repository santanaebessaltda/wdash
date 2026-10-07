import { brlCent, deIso, fimDoMes, intervaloDias, num, paraIso, somarDias } from "./format.ts";
import type {
  GoalCardView,
  GoalRecord,
  GoalTeamMember,
  NetworkGlobalGoal,
  SalesDayAgg,
  SalesSellerDayAgg,
  SellerRow,
} from "./goalTypes.ts";

export type GoalStatus = "active" | "upcoming" | "ended";

export function goalStatus(g: Pick<GoalRecord, "startsOn" | "endsOn">, today: string): GoalStatus {
  if (today < g.startsOn) return "upcoming";
  if (today > g.endsOn) return "ended";
  return "active";
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Em andamento",
  upcoming: "A começar",
  ended: "Encerrada",
};

function diasEntre(inicio: string, fim: string): number {
  return Math.round((deIso(fim).getTime() - deIso(inicio).getTime()) / 86_400_000) + 1;
}

/** Fracao do periodo ja decorrida (hoje conta inteiro); 0 antes de comecar, 1 depois de acabar. */
function fracaoDecorrida(g: GoalRecord, today: string): number {
  const status = goalStatus(g, today);
  if (status === "upcoming") return 0;
  if (status === "ended") return 1;
  return diasEntre(g.startsOn, today) / diasEntre(g.startsOn, g.endsOn);
}

/** Dias que faltam (incluindo hoje) na meta em andamento; 0 fora dela. */
function diasRestantes(g: GoalRecord, today: string): number {
  return goalStatus(g, today) === "active" ? diasEntre(today, g.endsOn) : 0;
}

/** Prazo da meta em andamento ("12 dias restantes"); `dias` inclui hoje, entao 1 = "Ultimo dia". */
export function prazoRestante(dias: number): string {
  if (dias <= 1) return "Último dia";
  return `${dias} dias restantes`;
}

/**
 * Periodo da copia de uma meta: meta de meses fechados (dia 1 ao ultimo dia) = os meses seguintes,
 * com a mesma quantidade de meses; senao comeca no dia seguinte ao fim, com a mesma duracao.
 */
export function nextGoalPeriod(startsOn: string, endsOn: string): { startsOn: string; endsOn: string } {
  const ini = deIso(startsOn);
  const fim = deIso(endsOn);
  if (ini.getDate() === 1 && fimDoMes(endsOn) === endsOn) {
    const meses = (fim.getFullYear() - ini.getFullYear()) * 12 + fim.getMonth() - ini.getMonth() + 1;
    const novoIni = new Date(fim.getFullYear(), fim.getMonth() + 1, 1);
    return { startsOn: paraIso(novoIni), endsOn: paraIso(new Date(novoIni.getFullYear(), novoIni.getMonth() + meses, 0)) };
  }
  const novoIni = somarDias(endsOn, 1);
  return { startsOn: novoIni, endsOn: somarDias(novoIni, diasEntre(startsOn, endsOn) - 1) };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_NO_NOME = /(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(\s+(?:de\s+)?|\s*\/\s*)?(\d{4})?/giu;

/** Nome da copia: o mes do nome (um so) vira o mes do novo periodo, mantendo maiusculas; senao "{nome} (copia)". */
export function copyGoalName(name: string, newStartsOn: string): string {
  const achados = [...name.matchAll(MES_NO_NOME)];
  if (achados.length !== 1) return `${name} (cópia)`;
  const d = deIso(newStartsOn);
  const mes = MESES[d.getMonth()]!;
  return name.replace(MES_NO_NOME, (m: string, nomeMes: string, sep: string | undefined, ano: string | undefined) => {
    const novo =
      nomeMes === nomeMes.toUpperCase() ? mes.toUpperCase() : nomeMes[0] === nomeMes[0]!.toUpperCase() ? mes[0]!.toUpperCase() + mes.slice(1) : mes;
    return ano ? `${novo}${sep ?? " "}${d.getFullYear()}` : `${novo}${m.slice(nomeMes.length)}`;
  });
}

/** Faturamento da loja (brand ALL) dentro do periodo da meta. */
export function goalRealized(g: GoalRecord, dayAggs: SalesDayAgg[]): number {
  let cents = 0;
  for (const a of dayAggs) {
    if (a.brand !== "ALL" || a.storeId !== g.storeId) continue;
    if (a.day < g.startsOn || a.day > g.endsOn) continue;
    cents += a.revenueCents;
  }
  return cents / 100;
}

/** Projecao linear pelo ritmo do periodo (so em andamento); encerrada = o realizado. */
function projetadoPct(pct: number, g: GoalRecord, today: string): number {
  const f = fracaoDecorrida(g, today);
  if (f <= 0) return 0;
  return pct / f;
}

export interface GoalSummary {
  goal: GoalRecord;
  status: GoalStatus;
  realizado: number;
  pct: number;
  /** Projecao de fechamento (% da meta)  -  so em andamento e depois de 50% do periodo (igual ao detalhe). */
  projetadoPct: number | null;
  diasRestantes: number;
  /** Nivel da loja na escada pelo realizado (null = nenhum ainda). */
  nivelAtual: string | null;
  /** Numero do nivel (1 = N1); null = nenhum ainda. */
  nivelNumero: number | null;
}

export function buildGoalSummary(g: GoalRecord, dayAggs: SalesDayAgg[], today: string): GoalSummary {
  const status = goalStatus(g, today);
  const realizado = status === "upcoming" ? 0 : goalRealized(g, dayAggs);
  const pct = g.target > 0 ? (realizado / g.target) * 100 : 0;
  let nivel: string | null = null;
  let nivelNumero: number | null = null;
  for (const [i, t] of g.tiers.entries()) {
    if (pct < t.atingimentoMinPct) break;
    nivel = t.nome;
    nivelNumero = i + 1;
  }
  return {
    goal: g,
    status,
    realizado,
    pct,
    projetadoPct: status === "active" && fracaoDecorrida(g, today) >= 0.5 ? projetadoPct(pct, g, today) : null,
    diasRestantes: diasRestantes(g, today),
    nivelAtual: nivel,
    nivelNumero,
  };
}

export interface SellerGoalLevel {
  /** Nome do nivel alcancado; null = abaixo do 1 nivel. */
  nivel: string | null;
  nivelNumero: number | null;
  atingimentoPct: number;
  /** Niveis da meta (cortes da barra). */
  marcos: { nome: string; pct: number; comissaoPct: number }[];
  metaNome: string;
  inicio: string;
  fim: string;
  status: GoalStatus;
  /** Dias que faltam (incluindo hoje) com a meta em andamento; 0 encerrada. */
  diasRestantes: number;
  modo: "individual" | "grupo";
  /** Grupo de distribuicao da pessoa (null = meta sem grupos). */
  grupo: string | null;
  /** Meta da pessoa (individual) ou do grupo (modo Grupo). */
  metaValor: number;
  /** O que conta para a meta: vendas da pessoa (individual) ou do grupo (modo Grupo), do inicio da meta ate hoje. */
  realizado: number;
  proximo: { nome: string; numero: number; falta: number; comissaoPct: number; bonus: number } | null;
  /** Premiacao do nivel alcancado (no modo Grupo, a parte da pessoa). */
  premiacao: number;
  /** Bonus somados dos niveis alcancados. */
  bonus: number;
}

/**
 * Nivel de meta de cada pessoa, com a mesma conta do detalhe da meta (do inicio da meta ate hoje).
 * Chave = `e:{codigo}` / `n:{nome normalizado}` (a mesma do Destaques da equipe). So metas que ja comecaram;
 * pessoa em mais de uma meta = a que comecou por ultimo (mesmo inicio = a loja onde mais vendeu). Sem meta = fora do mapa.
 */
export function sellerGoalLevels(input: {
  goals: GoalRecord[];
  dayAggs: SalesDayAgg[];
  sellerDayAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  today: string;
}): Map<string, SellerGoalLevel> {
  const melhor = new Map<string, { level: SellerGoalLevel; startsOn: string; faturamento: number }>();
  for (const goal of input.goals) {
    const status = goalStatus(goal, input.today);
    if (status === "upcoming") continue;
    const view = buildGoalCardView({ goal, lojaNome: "", dayAggs: input.dayAggs, sellerDayAggs: input.sellerDayAggs, team: input.team, today: input.today });
    for (const r of view.vendedoras) {
      if (r.semMeta) continue;
      const atual = melhor.get(r.colaboradorId);
      if (atual && (atual.startsOn > goal.startsOn || (atual.startsOn === goal.startsOn && atual.faturamento >= r.faturamentoValor))) continue;
      melhor.set(r.colaboradorId, {
        level: {
          nivel: r.degrauAtual,
          nivelNumero: r.nivelAtual,
          atingimentoPct: r.atingimentoPct,
          marcos: goal.tiers.map((t) => ({ nome: t.nome, pct: t.atingimentoMinPct, comissaoPct: t.comissaoPct })),
          metaNome: goal.name,
          inicio: goal.startsOn,
          fim: goal.endsOn,
          status,
          diasRestantes: diasRestantes(goal, input.today),
          modo: goal.tierMode === "INDIVIDUAL" ? "individual" : "grupo",
          grupo: goal.groups.length > 0 ? r.grupo : null,
          metaValor: r.metaIndividualValor,
          realizado: (r.atingimentoPct * r.metaIndividualValor) / 100,
          proximo: r.proximoDegrau
            ? {
                nome: r.proximoDegrau.nome,
                numero: (r.nivelAtual ?? 0) + 1,
                falta: r.proximoDegrau.faltaValor,
                comissaoPct: r.proximoDegrau.pctPremiacao,
                bonus: r.proximoDegrau.bonus,
              }
            : null,
          premiacao: r.premiacaoAcumulada,
          bonus: r.bonusAlcancado,
        },
        startsOn: goal.startsOn,
        faturamento: r.faturamentoValor,
      });
    }
  }
  const out = new Map([...melhor].map(([k, v]) => [k, v.level]));
  // Venda gravada so pelo nome: a meta liga pelo cadastro (`e:`), o Destaques agrupa pelo nome (`n:`).
  for (const m of input.team) {
    const level = out.get(`e:${m.employeeId}`);
    if (!level) continue;
    for (const k of m.nameKeys) if (!out.has(`n:${k}`)) out.set(`n:${k}`, level);
  }
  return out;
}

export interface GoalManagerPrize {
  /** Nivel alcancado pela loja (null = abaixo do 1). */
  nivel: string | null;
  nivelNumero: number | null;
  /** % da premiacao da gerencia no nivel alcancado. */
  pct: number;
  /** Premiacao sobre o faturamento total da loja, do inicio da meta ate hoje. */
  premiacao: number;
  /** Bonus somados dos niveis alcancados. */
  bonus: number;
  proximo: { nome: string; numero: number; falta: number; pct: number; bonus: number } | null;
}

/**
 * Premiacao da gerencia: sobe de nivel pelo faturamento total da loja (inclui vendas sem vendedor identificado e da
 * propria gerencia) contra a meta da loja, e ganha o % do nivel sobre tudo o que a loja vendeu. null = meta sem gerencia.
 */
export function goalManagerPrize(g: GoalRecord, realizado: number): GoalManagerPrize | null {
  if (!g.tiers.some((t) => t.gerenciaPct != null)) return null;
  const pctLoja = g.target > 0 ? (realizado / g.target) * 100 : 0;
  let idx = -1;
  g.tiers.forEach((t, i) => {
    if (pctLoja >= t.atingimentoMinPct && i === idx + 1) idx = i;
  });
  const degrau = idx >= 0 ? g.tiers[idx]! : null;
  const seguinte = idx + 1 < g.tiers.length ? g.tiers[idx + 1]! : null;
  const pct = degrau?.gerenciaPct ?? 0;
  return {
    nivel: degrau?.nome ?? null,
    nivelNumero: degrau ? idx + 1 : null,
    pct,
    premiacao: (realizado * pct) / 100,
    bonus: g.tiers.slice(0, idx + 1).reduce((s, t) => s + (t.gerenciaBonus ?? 0), 0),
    proximo: seguinte
      ? {
          nome: seguinte.nome,
          numero: idx + 2,
          falta: Math.max(0, (g.target * seguinte.atingimentoMinPct) / 100 - realizado),
          pct: seguinte.gerenciaPct ?? 0,
          bonus: seguinte.gerenciaBonus ?? 0,
        }
      : null,
  };
}

/** Pessoas da equipe de vendas da loja agora (para o card da listagem). */
export function goalTeamNames(storeId: string, team: GoalTeamMember[]): string[] {
  return team
    .filter((m) => m.storeId === storeId && m.salesPerson)
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

type Acc = {
  key: string;
  nome: string;
  employeeId: number | null;
  faturamento: number;
  vendas: number;
  itens: number;
  dias: Set<string>;
};

/**
 * Detalhe da meta no formato do card de meta da Equipe (faixa + escada por pessoa).
 * Pessoas = equipe de vendas ativa da loja  quem vendeu no periodo (ex-vendedoras incluidas).
 * Meta do grupo = meta x % do grupo (sem grupos = a meta inteira para a equipe toda). Pessoa fora dos grupos da meta = sem meta.
 * INDIVIDUAL: meta do grupo  pessoas, premiacao sobre as proprias vendas. GROUP: o grupo sobe pela soma das vendas e a
 * premiacao e dividida igualmente. Bonus soma os niveis alcancados (bateu o 2 = bonus do 1 + do 2), para cada pessoa.
 */
export function buildGoalCardView(input: {
  goal: GoalRecord;
  lojaNome: string;
  dayAggs: SalesDayAgg[];
  sellerDayAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  today: string;
}): GoalCardView {
  const { goal: g, lojaNome, today } = input;
  const status = goalStatus(g, today);
  const realizado = status === "upcoming" ? 0 : goalRealized(g, input.dayAggs);
  const pct = g.target > 0 ? (realizado / g.target) * 100 : 0;
  const frac = fracaoDecorrida(g, today);

  const team = input.team.filter((m) => m.storeId === g.storeId);
  const porNome = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!porNome.has(k)) porNome.set(k, m);
  const porCodigo = new Map(team.map((m) => [m.employeeId, m]));

  const accs = new Map<string, Acc>();
  const acc = (key: string, nome: string, employeeId: number | null): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, nome, employeeId, faturamento: 0, vendas: 0, itens: 0, dias: new Set() };
      accs.set(key, a);
    }
    return a;
  };

  if (status !== "upcoming") {
    for (const r of input.sellerDayAggs) {
      if (r.storeId !== g.storeId || r.day < g.startsOn || r.day > g.endsOn) continue;
      const membro = r.sellerEmployeeId != null ? porCodigo.get(r.sellerEmployeeId) : porNome.get(r.sellerKey);
      const employeeId = membro?.employeeId ?? r.sellerEmployeeId ?? null;
      const key = employeeId != null ? `e:${employeeId}` : `n:${r.sellerKey}`;
      const a = acc(key, membro?.name ?? r.sellerName, employeeId);
      a.faturamento += r.revenueCents / 100;
      a.vendas += r.salesCount;
      a.itens += r.itemCount ?? 0;
      if (r.revenueCents > 0) a.dias.add(r.day);
    }
  }
  for (const m of team) if (m.salesPerson) acc(`e:${m.employeeId}`, m.name, m.employeeId);

  const pessoas = [...accs.values()];
  const n = pessoas.length;
  const individual = g.tierMode === "INDIVIDUAL";
  const escala = Math.max(100, ...g.tiers.map((t) => t.atingimentoMinPct));
  const marcos = g.tiers.map((t) => ({ nome: t.nome, pct: t.atingimentoMinPct, pctPremiacao: t.comissaoPct, bonus: t.bonus }));
  const diasPeriodo = intervaloDias(g.startsOn, g.endsOn).length;
  const equipeTotal = pessoas.reduce((s, p) => s + p.faturamento, 0);

  // Sem grupos de distribuicao = um grupo so, com a equipe toda e a meta inteira.
  const TODOS = "*";
  const metaGrupo = new Map<string, number>(
    g.groups.length > 0 ? g.groups.map((x) => [x.shiftId, (g.target * x.pct) / 100]) : [[TODOS, g.target]],
  );
  const grupoDe = (p: Acc): string | null => {
    if (g.groups.length === 0) return TODOS;
    const sid = p.employeeId != null ? porCodigo.get(p.employeeId)?.shiftId : null;
    return sid && metaGrupo.has(sid) ? sid : null;
  };
  const membrosGrupo = new Map<string, number>();
  const vendasGrupo = new Map<string, number>();
  for (const p of pessoas) {
    const k = grupoDe(p);
    if (!k) continue;
    membrosGrupo.set(k, (membrosGrupo.get(k) ?? 0) + 1);
    vendasGrupo.set(k, (vendasGrupo.get(k) ?? 0) + p.faturamento);
  }

  const vendedoras: SellerRow[] = pessoas.map((p) => {
    // Individual: meta do grupo  pessoas, sobre as proprias vendas.
    // Grupo: o grupo sobe junto pela soma das vendas; premiacao dividida igualmente entre as pessoas.
    const k = grupoDe(p);
    const membros = k ? (membrosGrupo.get(k) ?? 0) : 0;
    const metaG = k ? (metaGrupo.get(k) ?? 0) : 0;
    const metaInd = membros > 0 ? (individual ? metaG / membros : metaG) : 0;
    const base = individual ? p.faturamento : k ? (vendasGrupo.get(k) ?? 0) : 0;
    const ating = metaInd > 0 ? (base / metaInd) * 100 : 0;
    let idx = -1;
    g.tiers.forEach((t, i) => {
      if (ating >= t.atingimentoMinPct && i === idx + 1) idx = i;
    });
    const degrau = idx >= 0 ? g.tiers[idx] : null;
    const seguinte = idx + 1 < g.tiers.length ? g.tiers[idx + 1] : null;
    const premiacao = degrau && metaInd > 0 ? (base * degrau.comissaoPct) / 100 / (individual ? 1 : membros) : 0;
    const bonus = metaInd > 0 ? g.tiers.slice(0, idx + 1).reduce((s, t) => s + t.bonus, 0) : 0;
    const membro = p.employeeId != null ? porCodigo.get(p.employeeId) : undefined;
    const ticket = p.vendas > 0 ? p.faturamento / p.vendas : 0;
    const pa = p.vendas > 0 && p.itens > 0 ? p.itens / p.vendas : 0;
    return {
      colaboradorId: p.key,
      nome: p.nome,
      filialId: g.storeId,
      filialNome: lojaNome,
      grupo: membro?.shiftName ?? "Sem grupo definido",
      faturamentoValor: p.faturamento,
      faturamento: brlCent(p.faturamento),
      atendimentos: p.vendas,
      ticketValor: ticket,
      ticket: brlCent(ticket),
      paValor: pa,
      pa: pa > 0 ? num(pa, 2) : "—",
      diasTrabalhados: p.dias.size,
      tendencia: "estavel",
      metaIndividualValor: metaInd,
      metaProporcional: false,
      diasElegiveis: diasPeriodo,
      atingimentoPct: ating,
      barraPct: Math.min(100, (ating / escala) * 100),
      pctMetaGeral: g.target > 0 ? (p.faturamento / g.target) * 100 : 0,
      marcosEscada: marcos,
      degrauAtual: degrau?.nome ?? null,
      nivelAtual: degrau ? idx + 1 : null,
      proximoDegrau: seguinte
        ? {
            nome: seguinte.nome,
            faltaValor: Math.max(0, (metaInd * seguinte.atingimentoMinPct) / 100 - base),
            pctPremiacao: seguinte.comissaoPct,
            bonus: seguinte.bonus,
            atingMinPct: seguinte.atingimentoMinPct,
          }
        : null,
      premiacaoAcumulada: premiacao,
      comissaoPct: degrau?.comissaoPct ?? 0,
      premiacaoProjetadaIndividual: null,
      atingimentoProjetadoPct: status === "active" && frac > 0 ? ating / frac : null,
      bonusAlcancado: bonus,
      atencao: null,
      semMeta: metaInd <= 0,
    };
  });
  vendedoras.sort((a, b) => b.faturamentoValor - a.faturamentoValor || a.nome.localeCompare(b.nome, "pt-BR"));

  const faixa: NetworkGlobalGoal = {
    competTexto: g.name,
    realizado,
    foraDaEquipe: Math.max(0, realizado - equipeTotal),
    total: g.target,
    pct,
    projetadoPct: status === "upcoming" ? 0 : projetadoPct(pct, g, today),
    diasRestantes: status === "upcoming" ? diasEntre(g.startsOn, g.endsOn) : diasRestantes(g, today),
    inicio: g.startsOn,
    fim: g.endsOn,
  };

  return {
    id: g.id,
    nome: g.name,
    tipo: individual ? "individual" : "grupo",
    lojaNome,
    marcas: [],
    qtdGrupos: g.groups.length,
    qtdVendedoras: n,
    qtdNiveis: g.tiers.length,
    degraus: g.tiers,
    faixa,
    vendedoras,
  };
}
