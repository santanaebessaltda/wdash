import { brlCent, isoToDate, endOfMonth, eachDay, num, dateToIso, addDays } from "./format.ts";
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

function daysBetween(start: string, end: string): number {
  return Math.round((isoToDate(end).getTime() - isoToDate(start).getTime()) / 86_400_000) + 1;
}

/** Fracao do periodo ja decorrida (hoje conta inteiro); 0 antes de comecar, 1 depois de acabar. */
function fracaoDecorrida(g: GoalRecord, today: string): number {
  const status = goalStatus(g, today);
  if (status === "upcoming") return 0;
  if (status === "ended") return 1;
  return daysBetween(g.startsOn, today) / daysBetween(g.startsOn, g.endsOn);
}

/** Dias que faltam (incluindo hoje) na meta em andamento; 0 fora dela. */
function daysRemaining(g: GoalRecord, today: string): number {
  return goalStatus(g, today) === "active" ? daysBetween(today, g.endsOn) : 0;
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
  const ini = isoToDate(startsOn);
  const end = isoToDate(endsOn);
  if (ini.getDate() === 1 && endOfMonth(endsOn) === endsOn) {
    const meses = (end.getFullYear() - ini.getFullYear()) * 12 + end.getMonth() - ini.getMonth() + 1;
    const novoIni = new Date(end.getFullYear(), end.getMonth() + 1, 1);
    return { startsOn: dateToIso(novoIni), endsOn: dateToIso(new Date(novoIni.getFullYear(), novoIni.getMonth() + meses, 0)) };
  }
  const novoIni = addDays(endsOn, 1);
  return { startsOn: novoIni, endsOn: addDays(novoIni, daysBetween(startsOn, endsOn) - 1) };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_NO_NOME = /(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(\s+(?:de\s+)?|\s*\/\s*)?(\d{4})?/giu;

/** Nome da copia: o mes do name (um so) vira o mes do novo period, mantendo maiusculas; senao "{nome} (copia)". */
export function copyGoalName(name: string, newStartsOn: string): string {
  const achados = [...name.matchAll(MES_NO_NOME)];
  if (achados.length !== 1) return `${name} (cópia)`;
  const d = isoToDate(newStartsOn);
  const mes = MESES[d.getMonth()]!;
  return name.replace(MES_NO_NOME, (m: string, nomeMes: string, sep: string | undefined, ano: string | undefined) => {
    const novo =
      nomeMes === nomeMes.toUpperCase() ? mes.toUpperCase() : nomeMes[0] === nomeMes[0]!.toUpperCase() ? mes[0]!.toUpperCase() + mes.slice(1) : mes;
    return ano ? `${novo}${sep ?? " "}${d.getFullYear()}` : `${novo}${m.slice(nomeMes.length)}`;
  });
}

/** Faturamento da store (brand ALL) dentro do period da goal. */
export function goalRealized(g: GoalRecord, dayAggs: SalesDayAgg[]): number {
  let cents = 0;
  for (const a of dayAggs) {
    if (a.brand !== "ALL" || a.storeId !== g.storeId) continue;
    if (a.day < g.startsOn || a.day > g.endsOn) continue;
    cents += a.revenueCents;
  }
  return cents / 100;
}

/** Vendas e itens da filial no período da meta. Itens null = algum dia com venda sem itens. */
function storeSales(g: GoalRecord, dayAggs: SalesDayAgg[]): { sales: number; items: number | null } {
  let sales = 0;
  let items = 0;
  let missing = false;
  for (const a of dayAggs) {
    if (a.brand !== "ALL" || a.storeId !== g.storeId) continue;
    if (a.day < g.startsOn || a.day > g.endsOn) continue;
    sales += a.salesCount;
    if (!a.itemCount && a.salesCount > 0) missing = true;
    else items += a.itemCount ?? 0;
  }
  return { sales, items: missing ? null : items };
}

/** Projecao linear pelo ritmo do periodo (so em andamento); encerrada = o realizado. */
function projectedPct(pct: number, g: GoalRecord, today: string): number {
  const f = fracaoDecorrida(g, today);
  if (f <= 0) return 0;
  return pct / f;
}

export interface GoalSummary {
  goal: GoalRecord;
  status: GoalStatus;
  achieved: number;
  pct: number;
  /** Projecao de fechamento (% da meta)  -  so em andamento e depois de 50% do periodo (igual ao detalhe). */
  projectedPct: number | null;
  daysRemaining: number;
  /** Nivel da loja na escada pelo realizado (null = nenhum ainda). */
  currentLevel: string | null;
  /** Numero do nivel (1 = N1); null = nenhum ainda. */
  nivelNumero: number | null;
}

export function buildGoalSummary(g: GoalRecord, dayAggs: SalesDayAgg[], today: string): GoalSummary {
  const status = goalStatus(g, today);
  const achieved = status === "upcoming" ? 0 : goalRealized(g, dayAggs);
  const pct = g.target > 0 ? (achieved / g.target) * 100 : 0;
  let nivel: string | null = null;
  let nivelNumero: number | null = null;
  for (const [i, t] of g.tiers.entries()) {
    if (pct < t.minAttainmentPct) break;
    nivel = t.name;
    nivelNumero = i + 1;
  }
  return {
    goal: g,
    status,
    achieved,
    pct,
    projectedPct: status === "active" && fracaoDecorrida(g, today) >= 0.5 ? projectedPct(pct, g, today) : null,
    daysRemaining: daysRemaining(g, today),
    currentLevel: nivel,
    nivelNumero,
  };
}

export interface SellerGoalLevel {
  /** Nome do nivel alcancado; null = abaixo do 1 nivel. */
  nivel: string | null;
  nivelNumero: number | null;
  attainmentPct: number;
  /** Niveis da meta (cortes da barra). */
  marcos: { name: string; pct: number; commissionPct: number }[];
  metaNome: string;
  start: string;
  end: string;
  status: GoalStatus;
  /** Dias que faltam (incluindo hoje) com a meta em andamento; 0 encerrada. */
  daysRemaining: number;
  modo: "individual" | "grupo" | "geral";
  /** Grupo de distribuicao da pessoa (null = meta sem grupos). */
  group: string | null;
  /** Meta da pessoa (individual) ou do grupo (modo Grupo). */
  goalAmount: number;
  /** O que conta para a meta: vendas da pessoa (individual) ou do grupo (modo Grupo), do inicio da meta ate hoje. */
  achieved: number;
  proximo: { name: string; numero: number; falta: number; commissionPct: number; bonus: number } | null;
  /** Premiacao do nivel alcancado (no modo Grupo, a parte da pessoa). */
  prizeAmount: number;
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
  const melhor = new Map<string, { level: SellerGoalLevel; startsOn: string; revenue: number }>();
  for (const goal of input.goals) {
    const status = goalStatus(goal, input.today);
    if (status === "upcoming") continue;
    const view = buildGoalCardView({ goal, storeNameValue: "", dayAggs: input.dayAggs, sellerDayAggs: input.sellerDayAggs, team: input.team, today: input.today });
    for (const r of view.sellers) {
      if (r.noGoal) continue;
      const atual = melhor.get(r.employeeId);
      if (atual && (atual.startsOn > goal.startsOn || (atual.startsOn === goal.startsOn && atual.revenue >= r.revenueAmount))) continue;
      melhor.set(r.employeeId, {
        level: {
          nivel: r.currentTierName,
          nivelNumero: r.currentLevel,
          attainmentPct: r.attainmentPct,
          marcos: goal.tiers.map((t) => ({ name: t.name, pct: t.minAttainmentPct, commissionPct: t.commissionPct })),
          metaNome: goal.name,
          start: goal.startsOn,
          end: goal.endsOn,
          status,
          daysRemaining: daysRemaining(goal, input.today),
          modo: goal.tierMode === "INDIVIDUAL" ? "individual" : goal.tierMode === "GENERAL" ? "geral" : "grupo",
          group: goal.tierMode === "GENERAL" || goal.groups.length === 0 ? null : r.group,
          goalAmount: r.individualGoalAmount,
          achieved: (r.attainmentPct * r.individualGoalAmount) / 100,
          proximo: r.nextTier
            ? {
                name: r.nextTier.name,
                numero: (r.currentLevel ?? 0) + 1,
                falta: r.nextTier.gapAmount,
                commissionPct: r.nextTier.prizePct,
                bonus: r.nextTier.bonus,
              }
            : null,
          prizeAmount: r.accruedPrize,
          bonus: r.bonusReached,
        },
        startsOn: goal.startsOn,
        revenue: r.revenueAmount,
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
  prizeAmount: number;
  /** Bonus somados dos niveis alcancados. */
  bonus: number;
  proximo: { name: string; numero: number; falta: number; pct: number; bonus: number } | null;
}

/**
 * Premiacao da gerencia: sobe de nivel pelo faturamento total da loja (inclui vendas sem vendedor identificado e da
 * propria gerencia) contra a meta da loja, e ganha o % do nivel sobre tudo o que a loja vendeu. null = meta sem gerencia.
 */
export function goalManagerPrize(g: GoalRecord, achieved: number): GoalManagerPrize | null {
  if (!g.tiers.some((t) => t.managerPct != null)) return null;
  const storePct = g.target > 0 ? (achieved / g.target) * 100 : 0;
  let idx = -1;
  g.tiers.forEach((t, i) => {
    if (storePct >= t.minAttainmentPct && i === idx + 1) idx = i;
  });
  const tier = idx >= 0 ? g.tiers[idx]! : null;
  const seguinte = idx + 1 < g.tiers.length ? g.tiers[idx + 1]! : null;
  const pct = tier?.managerPct ?? 0;
  return {
    nivel: tier?.name ?? null,
    nivelNumero: tier ? idx + 1 : null,
    pct,
    prizeAmount: (achieved * pct) / 100,
    bonus: g.tiers.slice(0, idx + 1).reduce((s, t) => s + (t.managerBonus ?? 0), 0),
    proximo: seguinte
      ? {
          name: seguinte.name,
          numero: idx + 2,
          falta: Math.max(0, (g.target * seguinte.minAttainmentPct) / 100 - achieved),
          pct: seguinte.managerPct ?? 0,
          bonus: seguinte.managerBonus ?? 0,
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
  name: string;
  employeeId: number | null;
  revenue: number;
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
  storeNameValue: string;
  dayAggs: SalesDayAgg[];
  sellerDayAggs: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  today: string;
}): GoalCardView {
  const { goal: g, storeNameValue, today } = input;
  const status = goalStatus(g, today);
  const achieved = status === "upcoming" ? 0 : goalRealized(g, input.dayAggs);
  const pct = g.target > 0 ? (achieved / g.target) * 100 : 0;
  const frac = fracaoDecorrida(g, today);

  const team = input.team.filter((m) => m.storeId === g.storeId);
  const porNome = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!porNome.has(k)) porNome.set(k, m);
  const porCodigo = new Map(team.map((m) => [m.employeeId, m]));

  const accs = new Map<string, Acc>();
  const acc = (key: string, name: string, employeeId: number | null): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, name, employeeId, revenue: 0, vendas: 0, itens: 0, dias: new Set() };
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
      a.revenue += r.revenueCents / 100;
      a.vendas += r.salesCount;
      a.itens += r.itemCount ?? 0;
      if (r.revenueCents > 0) a.dias.add(r.day);
    }
  }
  for (const m of team) if (m.salesPerson) acc(`e:${m.employeeId}`, m.name, m.employeeId);

  const pessoas = [...accs.values()];
  const n = pessoas.length;
  const general = g.tierMode === "GENERAL";
  const individual = g.tierMode === "INDIVIDUAL";
  const branchSales = status === "upcoming" ? { sales: 0, items: 0 as number | null } : storeSales(g, input.dayAggs);
  const escala = Math.max(100, ...g.tiers.map((t) => t.minAttainmentPct));
  const marcos = g.tiers.map((t) => ({ name: t.name, pct: t.minAttainmentPct, prizePct: t.commissionPct, bonus: t.bonus }));
  const periodDays = eachDay(g.startsOn, g.endsOn).length;
  const equipeTotal = pessoas.reduce((s, p) => s + p.revenue, 0);

  // Sem grupos de distribuicao = um grupo so, com a equipe toda e a meta inteira.
  // Geral ignora grupos: a loja sobe pelo total vendido e a premiacao se divide.
  const groups = general ? [] : g.groups;
  const TODOS = "*";
  const groupGoal = new Map<string, number>(
    groups.length > 0 ? groups.map((x) => [x.shiftId, (g.target * x.pct) / 100]) : [[TODOS, g.target]],
  );
  const grupoDe = (p: Acc): string | null => {
    if (groups.length === 0) return TODOS;
    const sid = p.employeeId != null ? porCodigo.get(p.employeeId)?.shiftId : null;
    return sid && groupGoal.has(sid) ? sid : null;
  };
  const membrosGrupo = new Map<string, number>();
  const vendasGrupo = new Map<string, number>();
  for (const p of pessoas) {
    const k = grupoDe(p);
    if (!k) continue;
    membrosGrupo.set(k, (membrosGrupo.get(k) ?? 0) + 1);
    vendasGrupo.set(k, (vendasGrupo.get(k) ?? 0) + p.revenue);
  }

  const sellers: SellerRow[] = pessoas.map((p) => {
    // Individual: meta do grupo  pessoas, sobre as proprias vendas.
    // Grupo: o grupo sobe junto pela soma das vendas; premiacao dividida igualmente entre as pessoas.
    const k = grupoDe(p);
    const membros = k ? (membrosGrupo.get(k) ?? 0) : 0;
    const goalRecord = k ? (groupGoal.get(k) ?? 0) : 0;
    const individualGoal = membros > 0 ? (individual ? goalRecord / membros : goalRecord) : 0;
    const base = general ? achieved : individual ? p.revenue : k ? (vendasGrupo.get(k) ?? 0) : 0;
    const ating = individualGoal > 0 ? (base / individualGoal) * 100 : 0;
    let idx = -1;
    g.tiers.forEach((t, i) => {
      if (ating >= t.minAttainmentPct && i === idx + 1) idx = i;
    });
    const tier = idx >= 0 ? g.tiers[idx] : null;
    const seguinte = idx + 1 < g.tiers.length ? g.tiers[idx + 1] : null;
    const prizeAmount = tier && individualGoal > 0 ? (base * tier.commissionPct) / 100 / (individual ? 1 : membros) : 0;
    const bonus = individualGoal > 0 ? g.tiers.slice(0, idx + 1).reduce((s, t) => s + t.bonus, 0) : 0;
    const membro = p.employeeId != null ? porCodigo.get(p.employeeId) : undefined;
    // Geral: cada pessoa vê a parte igual da filial (caixa e venda sem vendedor entram no bolo).
    const parte = general && n > 0;
    const revenueToShow = parte ? achieved / n : p.revenue;
    const salesToShow = parte ? branchSales.sales / n : p.vendas;
    const ticket = salesToShow > 0 ? revenueToShow / salesToShow : 0;
    const pa = parte
      ? (branchSales.items == null || branchSales.sales <= 0 ? 0 : branchSales.items / branchSales.sales)
      : (p.vendas > 0 && p.itens > 0 ? p.itens / p.vendas : 0);
    return {
      employeeId: p.key,
      name: p.name,
      storeId: g.storeId,
      storeName: storeNameValue,
      group: membro?.shiftName ?? "Sem grupo definido",
      revenueAmount: revenueToShow,
      revenue: brlCent(revenueToShow),
      salesCount: salesToShow,
      ticketAmount: ticket,
      ticket: brlCent(ticket),
      paAmount: pa,
      pa: pa > 0 ? num(pa, 2) : "—",
      daysWorked: p.dias.size,
      trend: "flat",
      individualGoalAmount: individualGoal,
      proportionalGoal: false,
      eligibleDays: periodDays,
      attainmentPct: ating,
      barPct: Math.min(100, (ating / escala) * 100),
      storeGoalPct: g.target > 0 ? ((parte ? achieved : p.revenue) / g.target) * 100 : 0,
      ladderMarks: marcos,
      currentTierName: tier?.name ?? null,
      currentLevel: tier ? idx + 1 : null,
      nextTier: seguinte
        ? {
            name: seguinte.name,
            gapAmount: Math.max(0, (individualGoal * seguinte.minAttainmentPct) / 100 - base),
            prizePct: seguinte.commissionPct,
            bonus: seguinte.bonus,
            minAttainmentPct: seguinte.minAttainmentPct,
          }
        : null,
      accruedPrize: prizeAmount,
      commissionPct: tier?.commissionPct ?? 0,
      projectedIndividualPrize: null,
      projectedAttainmentPct: status === "active" && frac > 0 ? ating / frac : null,
      bonusReached: bonus,
      attention: null,
      noGoal: individualGoal <= 0,
    };
  });
  sellers.sort((a, b) => b.revenueAmount - a.revenueAmount || a.name.localeCompare(b.name, "pt-BR"));

  const band: NetworkGlobalGoal = {
    competenceText: g.name,
    achieved,
    outsideTeam: general ? 0 : Math.max(0, achieved - equipeTotal),
    total: g.target,
    pct,
    projectedPct: status === "upcoming" ? 0 : projectedPct(pct, g, today),
    daysRemaining: status === "upcoming" ? daysBetween(g.startsOn, g.endsOn) : daysRemaining(g, today),
    start: g.startsOn,
    end: g.endsOn,
  };

  return {
    id: g.id,
    name: g.name,
    kind: general ? "geral" : individual ? "individual" : "grupo",
    storeNameValue,
    brands: [],
    qtdGrupos: groups.length,
    qtdVendedoras: n,
    qtdNiveis: g.tiers.length,
    tiers: g.tiers,
    band,
    sellers,
  };
}
