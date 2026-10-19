import { brlCent, isoToDate, endOfMonth, eachDay, num, dateToIso, addDays } from "./format.ts";
import { presenceDays } from "./presence.ts";
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
function shareElapsed(g: GoalRecord, today: string): number {
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
export function prazoRemaining(days: number): string {
  if (days <= 1) return "Último dia";
  return `${days} dias restantes`;
}

/**
 * Periodo da copia de uma meta: meta de meses fechados (dia 1 ao ultimo dia) = os meses seguintes,
 * com a mesma quantidade de meses; senao comeca no dia seguinte ao fim, com a mesma duracao.
 */
export function nextGoalPeriod(startsOn: string, endsOn: string): { startsOn: string; endsOn: string } {
  const ini = isoToDate(startsOn);
  const end = isoToDate(endsOn);
  if (ini.getDate() === 1 && endOfMonth(endsOn) === endsOn) {
    const months = (end.getFullYear() - ini.getFullYear()) * 12 + end.getMonth() - ini.getMonth() + 1;
    const newIni = new Date(end.getFullYear(), end.getMonth() + 1, 1);
    return { startsOn: dateToIso(newIni), endsOn: dateToIso(new Date(newIni.getFullYear(), newIni.getMonth() + months, 0)) };
  }
  const newIni = addDays(endsOn, 1);
  return { startsOn: newIni, endsOn: addDays(newIni, daysBetween(startsOn, endsOn) - 1) };
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH_NO_NAME = /(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(\s+(?:de\s+)?|\s*\/\s*)?(\d{4})?/giu;

/** Nome da copia: o mes do name (um so) vira o mes do novo period, mantendo maiusculas; senao "{nome} (copia)". */
export function copyGoalName(name: string, newStartsOn: string): string {
  const achados = [...name.matchAll(MONTH_NO_NAME)];
  if (achados.length !== 1) return `${name} (cópia)`;
  const d = isoToDate(newStartsOn);
  const month = MONTHS[d.getMonth()]!;
  return name.replace(MONTH_NO_NAME, (m: string, nameMonth: string, sep: string | undefined, year: string | undefined) => {
    const isNew =
      nameMonth === nameMonth.toUpperCase() ? month.toUpperCase() : nameMonth[0] === nameMonth[0]!.toUpperCase() ? month[0]!.toUpperCase() + month.slice(1) : month;
    return year ? `${isNew}${sep ?? " "}${d.getFullYear()}` : `${isNew}${m.slice(nameMonth.length)}`;
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
  const f = shareElapsed(g, today);
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
  levelNumber: number | null;
}

export function buildGoalSummary(g: GoalRecord, dayAggs: SalesDayAgg[], today: string): GoalSummary {
  const status = goalStatus(g, today);
  const achieved = status === "upcoming" ? 0 : goalRealized(g, dayAggs);
  const pct = g.target > 0 ? (achieved / g.target) * 100 : 0;
  let level: string | null = null;
  let levelNumber: number | null = null;
  for (const [i, t] of g.tiers.entries()) {
    if (pct < t.minAttainmentPct) break;
    level = t.name;
    levelNumber = i + 1;
  }
  return {
    goal: g,
    status,
    achieved,
    pct,
    projectedPct: status === "active" && shareElapsed(g, today) >= 0.5 ? projectedPct(pct, g, today) : null,
    daysRemaining: daysRemaining(g, today),
    currentLevel: level,
    levelNumber,
  };
}

export interface SellerGoalLevel {
  /** Nome do nivel alcancado; null = abaixo do 1 nivel. */
  level: string | null;
  levelNumber: number | null;
  attainmentPct: number;
  /** Niveis da meta (cortes da barra). */
  marcos: { name: string; pct: number; commissionPct: number; bonus: number }[];
  metaName: string;
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
  next: { name: string; number: number; gap: number; commissionPct: number; bonus: number } | null;
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
  /** Vendas com nome, inclusive usuário da filial e gerência. Sem isto o rateio não separa essas origens. */
  namedSellerDayAggs?: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  today: string;
}): Map<string, SellerGoalLevel> {
  const best = new Map<string, { level: SellerGoalLevel; startsOn: string; revenue: number }>();
  for (const goal of input.goals) {
    const status = goalStatus(goal, input.today);
    if (status === "upcoming") continue;
    const view = buildGoalCardView({
      goal,
      storeNameValue: "",
      dayAggs: input.dayAggs,
      sellerDayAggs: input.sellerDayAggs,
      namedSellerDayAggs: input.namedSellerDayAggs,
      team: input.team,
      today: input.today,
    });
    for (const r of view.sellers) {
      if (r.noGoal) continue;
      const current = best.get(r.employeeId);
      if (current && (current.startsOn > goal.startsOn || (current.startsOn === goal.startsOn && current.revenue >= r.revenueAmount))) continue;
      best.set(r.employeeId, {
        level: {
          level: r.currentTierName,
          levelNumber: r.currentLevel,
          attainmentPct: r.attainmentPct,
          marcos: goal.tiers.map((t) => ({ name: t.name, pct: t.minAttainmentPct, commissionPct: t.commissionPct, bonus: t.bonus })),
          metaName: goal.name,
          start: goal.startsOn,
          end: goal.endsOn,
          status,
          daysRemaining: daysRemaining(goal, input.today),
          modo: goal.tierMode === "INDIVIDUAL" ? "individual" : goal.tierMode === "GENERAL" ? "geral" : "grupo",
          group: goal.tierMode === "GENERAL" || goal.groups.length === 0 ? null : r.group,
          goalAmount: r.individualGoalAmount,
          achieved: (r.attainmentPct * r.individualGoalAmount) / 100,
          next: r.nextTier
            ? {
                name: r.nextTier.name,
                number: (r.currentLevel ?? 0) + 1,
                gap: r.nextTier.gapAmount,
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
  const out = new Map([...best].map(([k, v]) => [k, v.level]));
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
  level: string | null;
  levelNumber: number | null;
  /** % da premiacao da gerencia no nivel alcancado. */
  pct: number;
  /** Premiacao sobre o faturamento total da loja, do inicio da meta ate hoje. */
  prizeAmount: number;
  /** Bonus somados dos niveis alcancados. */
  bonus: number;
  next: { name: string; number: number; gap: number; pct: number; bonus: number } | null;
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
  const following = idx + 1 < g.tiers.length ? g.tiers[idx + 1]! : null;
  const pct = tier?.managerPct ?? 0;
  return {
    level: tier?.name ?? null,
    levelNumber: tier ? idx + 1 : null,
    pct,
    prizeAmount: (achieved * pct) / 100,
    bonus: g.tiers.slice(0, idx + 1).reduce((s, t) => s + (t.managerBonus ?? 0), 0),
    next: following
      ? {
          name: following.name,
          number: idx + 2,
          gap: Math.max(0, (g.target * following.minAttainmentPct) / 100 - achieved),
          pct: following.managerPct ?? 0,
          bonus: following.managerBonus ?? 0,
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

type DayBits = { revenue: number; sales: number; items: number };

type Acc = {
  key: string;
  name: string;
  employeeId: number | null;
  byDay: Map<string, DayBits>;
};

type Person = Acc & {
  revenue: number;
  sales: number;
  items: number;
  days: Set<string>;
  presence: Set<string>;
};

/**
 * Detalhe da meta no formato do card de meta da Equipe (faixa + escada por pessoa).
 * Pessoas = equipe de vendas ativa da loja  quem vendeu no periodo (ex-vendedoras incluidas).
 * Meta do grupo = meta x % do grupo (sem grupos = a meta inteira para a equipe toda). Pessoa fora dos grupos da meta = sem meta.
 * INDIVIDUAL: meta do grupo ÷ pessoas, premiacao sobre as proprias vendas. Quem entrou ou saiu no meio fica com essa
 * parte vezes os dias presentes; quem ficou o periodo inteiro nao aumenta a meta para cobrir os dias dela.
 * GROUP: o grupo sobe pela soma e a meta do grupo nao encolhe; a premiacao e o bonus pesam pelos dias presentes.
 * GENERAL: a loja sobe pelo total; cada dia se divide so entre quem estava naquele dia. Sem data de admissao = periodo cheio.
 */
/** Partes inteiras; o resto vai para as primeiras, para a soma fechar. */
function splitEven(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const safe = Math.max(0, Math.floor(total));
  const base = Math.floor(safe / parts);
  let rest = safe - base * parts;
  return Array.from({ length: parts }, () => base + (rest-- > 0 ? 1 : 0));
}

function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** Frase da faixa da meta. Sem a separação, mantém o texto único de antes. */
export function outsideRankingNote(goal: NetworkGlobalGoal): string | null {
  if (goal.outsideUnidentified == null) {
    return goal.outsideTeam
      ? `Inclui ${brlCent(goal.outsideTeam)} de vendas sem vendedor identificado ou realizadas pela gerência, fora do ranking.`
      : null;
  }
  const unidentified = goal.outsideUnidentified ?? 0;
  const branchUser = goal.outsideBranchUser ?? 0;
  const management = goal.outsideManagement ?? 0;
  const parts: string[] = [];
  if (unidentified > 0) parts.push(`${brlCent(unidentified)} de vendas sem vendedor identificado`);
  if (branchUser > 0) parts.push(`${brlCent(branchUser)} do usuário da filial`);
  if (management > 0) parts.push(`${brlCent(management)} da gerência`);
  const spread = goal.unidentifiedSpread ?? 0;
  const chunks: string[] = [];
  if (spread > 0) chunks.push(`${brlCent(spread)} de vendas sem vendedor identificado foram rateadas entre os vendedores.`);
  if (parts.length > 0) chunks.push(`Inclui ${joinPt(parts)}, fora do ranking.`);
  return chunks.length > 0 ? chunks.join(" ") : null;
}

export function buildGoalCardView(input: {
  goal: GoalRecord;
  storeNameValue: string;
  dayAggs: SalesDayAgg[];
  sellerDayAggs: SalesSellerDayAgg[];
  /** Todas as vendas com vendedor, para separar sem vendedor, usuário da filial e gerência. */
  namedSellerDayAggs?: SalesSellerDayAgg[];
  team: GoalTeamMember[];
  today: string;
}): GoalCardView {
  const { goal: g, storeNameValue, today } = input;
  const status = goalStatus(g, today);
  const achieved = status === "upcoming" ? 0 : goalRealized(g, input.dayAggs);
  const pct = g.target > 0 ? (achieved / g.target) * 100 : 0;
  const frac = shareElapsed(g, today);

  const team = input.team.filter((m) => m.storeId === g.storeId);
  const byName = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!byName.has(k)) byName.set(k, m);
  const byCode = new Map(team.map((m) => [m.employeeId, m]));

  const accs = new Map<string, Acc>();
  const acc = (key: string, name: string, employeeId: number | null): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, name, employeeId, byDay: new Map() };
      accs.set(key, a);
    }
    return a;
  };

  if (status !== "upcoming") {
    for (const r of input.sellerDayAggs) {
      if (r.storeId !== g.storeId || r.day < g.startsOn || r.day > g.endsOn) continue;
      const member = r.sellerEmployeeId != null ? byCode.get(r.sellerEmployeeId) : byName.get(r.sellerKey);
      const employeeId = member?.employeeId ?? r.sellerEmployeeId ?? null;
      const key = employeeId != null ? `e:${employeeId}` : `n:${r.sellerKey}`;
      const a = acc(key, member?.name ?? r.sellerName, employeeId);
      const cur = a.byDay.get(r.day) ?? { revenue: 0, sales: 0, items: 0 };
      cur.revenue += r.revenueCents / 100;
      cur.sales += r.salesCount;
      cur.items += r.itemCount ?? 0;
      a.byDay.set(r.day, cur);
    }
  }
  for (const m of team) if (m.salesPerson) acc(`e:${m.employeeId}`, m.name, m.employeeId);

  const period = eachDay(g.startsOn, g.endsOn);
  const people: Person[] = [];
  for (const a of accs.values()) {
    const member = a.employeeId != null ? byCode.get(a.employeeId) : undefined;
    let lastSale: string | null = null;
    for (const [day, bits] of a.byDay) {
      if ((bits.revenue > 0 || bits.sales > 0) && (!lastSale || day > lastSale)) lastSale = day;
    }
    const window = presenceDays(
      g.startsOn,
      g.endsOn,
      {
        admittedOn: member?.admittedOn ?? null,
        departedOn: member?.departedOn ?? null,
        active: member ? member.salesPerson : true,
      },
      lastSale,
    );
    if (window.length === 0) continue;
    const presence = new Set(window);
    let revenue = 0;
    let sales = 0;
    let items = 0;
    const days = new Set<string>();
    for (const [day, bits] of a.byDay) {
      if (!presence.has(day)) continue;
      revenue += bits.revenue;
      sales += bits.sales;
      items += bits.items;
      if (bits.revenue > 0) days.add(day);
    }
    people.push({ ...a, revenue, sales, items, days, presence });
  }

  const named = input.namedSellerDayAggs;
  let outsideUnidentified: number | undefined;
  let outsideBranchUser: number | undefined;
  let outsideManagement: number | undefined;
  let unidentifiedSpread = 0;
  if (named && status !== "upcoming") {
    const bucketOf = (r: SalesSellerDayAgg): "branch" | "management" | "team" => {
      const member = r.sellerEmployeeId != null ? byCode.get(r.sellerEmployeeId) : byName.get(r.sellerKey);
      if (member?.branchUser) return "branch";
      if (member && !member.salesPerson) return "management";
      return "team";
    };
    const storeDayCents = new Map<string, { revenue: number; sales: number; items: number }>();
    for (const a of input.dayAggs) {
      if (a.brand !== "ALL" || a.storeId !== g.storeId || a.day < g.startsOn || a.day > g.endsOn) continue;
      const cur = storeDayCents.get(a.day) ?? { revenue: 0, sales: 0, items: 0 };
      cur.revenue += a.revenueCents;
      cur.sales += a.salesCount;
      cur.items += a.itemCount ?? 0;
      storeDayCents.set(a.day, cur);
    }
    const namedDay = new Map<string, { revenue: number; sales: number; items: number }>();
    let branchCents = 0;
    let managementCents = 0;
    for (const r of named) {
      if (r.storeId !== g.storeId || r.day < g.startsOn || r.day > g.endsOn) continue;
      const cur = namedDay.get(r.day) ?? { revenue: 0, sales: 0, items: 0 };
      cur.revenue += r.revenueCents;
      cur.sales += r.salesCount;
      cur.items += r.itemCount ?? 0;
      namedDay.set(r.day, cur);
      const bucket = bucketOf(r);
      if (bucket === "branch") branchCents += r.revenueCents;
      else if (bucket === "management") managementCents += r.revenueCents;
    }
    const days = new Set([...storeDayCents.keys(), ...namedDay.keys()]);
    let unidentifiedCents = 0;
    const gaps: { day: string; revenue: number; sales: number; items: number }[] = [];
    for (const day of days) {
      const store = storeDayCents.get(day) ?? { revenue: 0, sales: 0, items: 0 };
      const attributed = namedDay.get(day) ?? { revenue: 0, sales: 0, items: 0 };
      const gap = {
        day,
        revenue: Math.max(0, store.revenue - attributed.revenue),
        sales: Math.max(0, store.sales - attributed.sales),
        items: Math.max(0, store.items - attributed.items),
      };
      unidentifiedCents += gap.revenue;
      gaps.push(gap);
    }
    if (g.spreadUnidentified && g.tierMode !== "GENERAL") {
      for (const gap of gaps) {
        const present = people.filter((p) => p.presence.has(gap.day)).sort((a, b) => a.key.localeCompare(b.key));
        if (present.length === 0) continue;
        const revenue = splitEven(gap.revenue, present.length);
        const sales = splitEven(gap.sales, present.length);
        const items = splitEven(gap.items, present.length);
        present.forEach((p, i) => {
          const share = revenue[i] ?? 0;
          unidentifiedSpread += share;
          unidentifiedCents -= share;
          p.revenue += share / 100;
          p.sales += sales[i] ?? 0;
          p.items += items[i] ?? 0;
          if (share > 0) p.days.add(gap.day);
        });
      }
    }
    outsideUnidentified = unidentifiedCents / 100;
    outsideBranchUser = branchCents / 100;
    outsideManagement = managementCents / 100;
    unidentifiedSpread /= 100;
  }

  const n = people.length;
  const general = g.tierMode === "GENERAL";
  const individual = g.tierMode === "INDIVIDUAL";
  const branchSales = status === "upcoming" ? { sales: 0, items: 0 as number | null } : storeSales(g, input.dayAggs);
  const scale = Math.max(100, ...g.tiers.map((t) => t.minAttainmentPct));
  const marcos = g.tiers.map((t) => ({ name: t.name, pct: t.minAttainmentPct, prizePct: t.commissionPct, bonus: t.bonus }));
  const periodDays = period.length;
  const teamTotal = people.reduce((s, p) => s + p.revenue, 0);

  // Sem grupos de distribuicao = um grupo so, com a equipe toda e a meta inteira.
  // Geral ignora grupos: a loja sobe pelo total vendido e a premiacao se divide.
  const groups = general ? [] : g.groups;
  const ALL = "*";
  const groupGoal = new Map<string, number>(
    groups.length > 0 ? groups.map((x) => [x.shiftId, (g.target * x.pct) / 100]) : [[ALL, g.target]],
  );
  const groupOf = (p: Person): string | null => {
    if (groups.length === 0) return ALL;
    const sid = p.employeeId != null ? byCode.get(p.employeeId)?.shiftId : null;
    return sid && groupGoal.has(sid) ? sid : null;
  };
  const membersGroup = new Map<string, number>();
  const salesGroup = new Map<string, number>();
  const weightGroup = new Map<string, number>();
  for (const p of people) {
    const k = groupOf(p);
    if (!k) continue;
    membersGroup.set(k, (membersGroup.get(k) ?? 0) + 1);
    salesGroup.set(k, (salesGroup.get(k) ?? 0) + p.revenue);
    weightGroup.set(k, (weightGroup.get(k) ?? 0) + p.presence.size);
  }

  const storeDay = new Map<string, { revenue: number; sales: number }>();
  if (general && status !== "upcoming") {
    for (const a of input.dayAggs) {
      if (a.brand !== "ALL" || a.storeId !== g.storeId || a.day < g.startsOn || a.day > g.endsOn) continue;
      const cur = storeDay.get(a.day) ?? { revenue: 0, sales: 0 };
      cur.revenue += a.revenueCents / 100;
      cur.sales += a.salesCount;
      storeDay.set(a.day, cur);
    }
  }
  const dailyShare = new Map<string, { revenue: number; sales: number }>();
  if (general) {
    for (const [day, store] of storeDay) {
      const present = people.filter((p) => p.presence.has(day));
      if (present.length === 0) continue;
      for (const p of present) {
        const cur = dailyShare.get(p.key) ?? { revenue: 0, sales: 0 };
        cur.revenue += store.revenue / present.length;
        cur.sales += store.sales / present.length;
        dailyShare.set(p.key, cur);
      }
    }
  }

  const sellers: SellerRow[] = people.map((p) => {
    // Individual: parte cheia = meta do grupo ÷ pessoas. Parcial = essa parte × dias presentes ÷ dias do período.
    // Grupo: meta do grupo inteira; a premiacao pesa pelos dias. Geral: cada dia se divide entre quem estava.
    const k = groupOf(p);
    const members = k ? (membersGroup.get(k) ?? 0) : 0;
    const goalRecord = k ? (groupGoal.get(k) ?? 0) : 0;
    const fraction = periodDays > 0 ? p.presence.size / periodDays : 1;
    const fullShare = members > 0 ? (individual ? goalRecord / members : goalRecord) : 0;
    const individualGoal = individual ? fullShare * fraction : fullShare;
    const share = dailyShare.get(p.key);
    const base = general ? achieved : individual ? p.revenue : k ? (salesGroup.get(k) ?? 0) : 0;
    const ating = individualGoal > 0 ? (base / individualGoal) * 100 : 0;
    let idx = -1;
    g.tiers.forEach((t, i) => {
      if (ating >= t.minAttainmentPct && i === idx + 1) idx = i;
    });
    const tier = idx >= 0 ? g.tiers[idx] : null;
    const following = idx + 1 < g.tiers.length ? g.tiers[idx + 1] : null;
    const weights = k ? (weightGroup.get(k) ?? 0) : 0;
    const weight = !individual && !general && weights > 0 ? p.presence.size / weights : 1;
    const prizeBase = general ? (share?.revenue ?? 0) : base;
    const prizeAmount = tier && individualGoal > 0 ? ((prizeBase * tier.commissionPct) / 100) * weight : 0;
    const fullBonus = individualGoal > 0 ? g.tiers.slice(0, idx + 1).reduce((s, t) => s + t.bonus, 0) : 0;
    const bonus = individual ? fullBonus : fullBonus * fraction;
    const member = p.employeeId != null ? byCode.get(p.employeeId) : undefined;
    // Geral: faturamento e vendas sao a parte dos dias em que a pessoa estava. Ticket e P.A. continuam os da filial.
    const parte = general && n > 0;
    const revenueToShow = parte ? (share?.revenue ?? 0) : p.revenue;
    const salesToShow = parte ? (share?.sales ?? 0) : p.sales;
    const ticket = salesToShow > 0 ? revenueToShow / salesToShow : 0;
    const pa = parte
      ? (branchSales.items == null || branchSales.sales <= 0 ? 0 : branchSales.items / branchSales.sales)
      : (p.sales > 0 && p.items > 0 ? p.items / p.sales : 0);
    return {
      employeeId: p.key,
      name: p.name,
      storeId: g.storeId,
      storeName: storeNameValue,
      group: member?.shiftName ?? "Sem grupo definido",
      revenueAmount: revenueToShow,
      revenue: brlCent(revenueToShow),
      salesCount: salesToShow,
      ticketAmount: ticket,
      ticket: brlCent(ticket),
      paAmount: pa,
      pa: pa > 0 ? num(pa, 2) : "—",
      daysWorked: p.days.size,
      trend: "flat",
      individualGoalAmount: individualGoal,
      proportionalGoal: p.presence.size < periodDays,
      eligibleDays: p.presence.size,
      periodDays,
      attainmentPct: ating,
      barPct: Math.min(100, (ating / scale) * 100),
      storeGoalPct: g.target > 0 ? ((parte ? achieved : p.revenue) / g.target) * 100 : 0,
      ladderMarks: marcos,
      currentTierName: tier?.name ?? null,
      currentLevel: tier ? idx + 1 : null,
      nextTier: following
        ? {
            name: following.name,
            gapAmount: Math.max(0, (individualGoal * following.minAttainmentPct) / 100 - base),
            prizePct: following.commissionPct,
            bonus: following.bonus,
            minAttainmentPct: following.minAttainmentPct,
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
    outsideTeam: general ? 0 : Math.max(0, achieved - teamTotal),
    ...(outsideUnidentified != null
      ? {
          outsideUnidentified: general ? 0 : outsideUnidentified,
          outsideBranchUser: general ? 0 : outsideBranchUser,
          outsideManagement: general ? 0 : outsideManagement,
          unidentifiedSpread: general ? 0 : unidentifiedSpread,
        }
      : {}),
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
    qtyGroups: groups.length,
    qtySellers: n,
    qtyLevels: g.tiers.length,
    tiers: g.tiers,
    band,
    sellers,
  };
}
