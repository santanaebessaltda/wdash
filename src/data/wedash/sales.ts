/**
 * Gerador deterministico de vendas mockadas, dia a dia e hora a hora, por
 * filial. Faz o papel do sync do ERP: as telas nunca leem daqui diretamente,
 * so atraves da camada de visoes (loja.ts), que devolve numeros prontos.
 */
import { categories, stores, paymentMethods, type Division, type Store, type PaymentMethod } from "./stores";
import { collaboratorsOfStore } from "./team";
import { TODAY_ISO, CURRENT_HOUR } from "./clock";
import { isoToDate, eachDay } from "@/lib/format";

export interface Aggregate {
  revenue: number;
  salesCount: number;
  items: number;
}

export interface SalesDay {
  data: string;
  storeId: string;
  total: Aggregate;
  byHour: Record<number, Aggregate>;
  bySeller: Record<string, Aggregate>;
  byCategory: Record<number, { revenue: number; items: number; cmv: number }>;
  byMethod: Record<PaymentMethod, number>;
  byDivision: Record<Division, Aggregate>;
}

interface BranchParameters {
  baseDay: number;
  ticket: number;
  pa: number;
  /** Peso por dia da semana, indice 0 = domingo. */
  weightsWeek: number[];
  /** Peso por hora de funcionamento, indice 0 = hora de abertura. */
  weightsHour: number[];
  /** Fator por mes (chave "AAAA-MM"). */
  trend: Record<string, number>;
  /** Participacao de cada categoria no faturamento. */
  categories: Record<number, number>;
  methods: Record<PaymentMethod, number>;
}

const PARAMETERS: Record<string, BranchParameters> = {
  f1: {
    baseDay: 6100,
    ticket: 186,
    pa: 2.35,
    weightsWeek: [0.95, 0.72, 0.8, 0.86, 0.92, 1.18, 1.5],
    weightsHour: [0.03, 0.05, 0.09, 0.11, 0.08, 0.07, 0.07, 0.08, 0.1, 0.12, 0.11, 0.09],
    // set/26: levemente acima de 100% (Hiper / N3); Desafio = 110%.
    trend: { "2026-06": 0.93, "2026-07": 0.96, "2026-08": 1.0, "2026-09": 2.1 },
    categories: { 1: 0.38, 2: 0.22, 3: 0.13, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.07 },
    methods: { Pix: 0.34, "Cartão de crédito": 0.41, "Cartão de débito": 0.19, "Dinheiro": 0.06 },
  },
  f2: {
    baseDay: 3450,
    ticket: 158,
    pa: 2.2,
    weightsWeek: [0, 0.85, 0.9, 0.95, 1.0, 1.2, 1.35],
    weightsHour: [0.05, 0.09, 0.11, 0.12, 0.1, 0.07, 0.08, 0.11, 0.13, 0.14],
    trend: { "2026-06": 0.95, "2026-07": 0.98, "2026-08": 1.0, "2026-09": 0.9 },
    categories: { 1: 0.33, 2: 0.2, 3: 0.11, 4: 0.07, 5: 0.05, 6: 0.03, 7: 0.05, 8: 0.16 },
    methods: { Pix: 0.4, "Cartão de crédito": 0.35, "Cartão de débito": 0.17, "Dinheiro": 0.08 },
  },
};

/** Indice de preco relativo por categoria, para derivar itens do faturamento. */
const INDEX_PRICE: Record<number, number> = { 1: 1.6, 2: 0.7, 3: 0.8, 4: 0.9, 5: 1.1, 6: 0.75, 7: 1.9, 8: 1.2 };

/** PRNG deterministico (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Ruido multiplicativo em torno de 1, amplitude amp. */
function noise(r: () => number, amp: number): number {
  return 1 + (r() * 2 - 1) * amp;
}

export function dayWeight(branch: Store, iso: string): number {
  return PARAMETERS[branch.id].weightsWeek[isoToDate(iso).getDay()];
}

export function storeOpen(branch: Store, iso: string): boolean {
  return !branch.daysClosed.includes(isoToDate(iso).getDay());
}

function buildMockDay(branch: Store, iso: string): SalesDay {
  const p = PARAMETERS[branch.id];
  const r = prng(hash(`${branch.id}|${iso}`));
  const empty: SalesDay = {
    data: iso,
    storeId: branch.id,
    total: { revenue: 0, salesCount: 0, items: 0 },
    byHour: {},
    bySeller: {},
    byCategory: {},
    byMethod: { Pix: 0, "Cartão de crédito": 0, "Cartão de débito": 0, "Dinheiro": 0 },
    byDivision: { WEPINK: { revenue: 0, salesCount: 0, items: 0 }, WPINK: { revenue: 0, salesCount: 0, items: 0 } },
  };
  if (!storeOpen(branch, iso)) return empty;

  const month = iso.slice(0, 7);
  const trend = p.trend[month] ?? 1;
  const totalDayFull = p.baseDay * dayWeight(branch, iso) * trend * noise(r, 0.14);
  const ticketDay = p.ticket * noise(r, 0.06);
  const paDay = p.pa * noise(r, 0.05);

  // Distribui por hora e trunca o dia de hoje na hora atual.
  const hours = hourRange(branch);
  const sumWeights = p.weightsHour.reduce((s, x) => s + x, 0);
  const byHour: Record<number, Aggregate> = {};
  let revenue = 0;
  let salesCount = 0;
  let items = 0;
  hours.forEach((h, i) => {
    if (iso === TODAY_ISO && h > CURRENT_HOUR) return;
    let share = (p.weightsHour[i] / sumWeights) * noise(r, 0.25);
    if (iso === TODAY_ISO && h === CURRENT_HOUR) share *= 0.55;
    const hourRevenue = Math.round(totalDayFull * share);
    const visits = Math.max(hourRevenue > 0 ? 1 : 0, Math.round(hourRevenue / (ticketDay * noise(r, 0.1))));
    const it = Math.max(visits, Math.round(visits * paDay * noise(r, 0.08)));
    byHour[h] = { revenue: hourRevenue, salesCount: visits, items: it };
    revenue += hourRevenue;
    salesCount += visits;
    items += it;
  });
  const total: Aggregate = { revenue, salesCount, items };

  // Categorias: faturamento por participacao, itens pelo indice de preco, CMV pela categoria.
  const byCategory: Record<number, { revenue: number; items: number; cmv: number }> = {};
  const entradas = Object.entries(p.categories).map(([id, share]) => ({ id: Number(id), share: share * noise(r, 0.12) }));
  const sumShare = entradas.reduce((s, e) => s + e.share, 0);
  const weightsItems = entradas.map((e) => e.share / INDEX_PRICE[e.id]);
  const sumWeightsItems = weightsItems.reduce((s, x) => s + x, 0);
  entradas.forEach((e, i) => {
    const cat = categories.find((c) => c.id === e.id)!;
    const categoryRevenue = Math.round((revenue * e.share) / sumShare);
    byCategory[e.id] = {
      revenue: categoryRevenue,
      items: Math.round((items * weightsItems[i]) / sumWeightsItems),
      cmv: Math.round(categoryRevenue * cat.cmvPct * noise(r, 0.03)),
    };
  });

  // Divisao: WPINK = categorias da divisao WPINK; o resto e WEPINK.
  const byDivision: Record<Division, Aggregate> = {
    WEPINK: { revenue: 0, salesCount: 0, items: 0 },
    WPINK: { revenue: 0, salesCount: 0, items: 0 },
  };
  for (const cat of categories) {
    const c = byCategory[cat.id];
    if (!c) continue;
    byDivision[cat.division].revenue += c.revenue;
    byDivision[cat.division].items += c.items;
  }
  for (const d of ["WEPINK", "WPINK"] as Division[]) {
    const fr = revenue > 0 ? byDivision[d].revenue / revenue : 0;
    byDivision[d].salesCount = Math.round(salesCount * fr);
  }

  // Meios de pagamento.
  const byMethod = { ...empty.byMethod };
  const methodsNoise = paymentMethods.map((m) => p.methods[m] * noise(r, 0.15));
  const sumMethods = methodsNoise.reduce((s, x) => s + x, 0);
  paymentMethods.forEach((m, i) => {
    byMethod[m] = Math.round((revenue * methodsNoise[i]) / sumMethods);
  });

  // Vendedoras: peso relativo, respeitando admissao e inatividade.
  const bySeller: Record<string, Aggregate> = {};
  const team = collaboratorsOfStore(branch.id).filter((c) => {
    if (c.hiredAt > iso) return false;
    if (c.inactiveAt && c.inactiveAt <= iso) return false;
    return true;
  });
  const weights = team.map((c) => c.saleWeight * noise(r, 0.2));
  const sumWeightsV = weights.reduce((s, x) => s + x, 0);
  team.forEach((c, i) => {
    const fr = weights[i] / sumWeightsV;
    bySeller[c.id] = {
      revenue: Math.round(revenue * fr),
      salesCount: Math.round(salesCount * fr),
      items: Math.round(items * fr),
    };
  });

  return { data: iso, storeId: branch.id, total, byHour, bySeller, byCategory, byMethod, byDivision };
}

export function hourRange(branch: Store): number[] {
  const out: number[] = [];
  for (let h = branch.opening; h < branch.closing; h++) out.push(h);
  return out;
}

const HISTORY_START = "2026-06-01";

/** Indice puro de vendas por filial+data, parametrizavel para testes isolados. */
export class SalesDayStore {
  private readonly index: Map<string, SalesDay>;
  readonly start: string;
  readonly end: string;

  /** Popula do historico deterministicamente gerado. */
  constructor(start: string = HISTORY_START, end: string = TODAY_ISO) {
    this.start = start;
    this.end = end;
    this.index = new Map<string, SalesDay>();
    for (const f of stores) {
      for (const iso of eachDay(start, end)) {
        this.index.set(`${f.id}|${iso}`, buildMockDay(f, iso));
      }
    }
  }

  day(storeId: string, iso: string): SalesDay | undefined {
    return this.index.get(`${storeId}|${iso}`);
  }

  days(storeId: string, start: string, end: string): SalesDay[] {
    return eachDay(start, end)
      .map((iso) => this.index.get(`${storeId}|${iso}`))
      .filter((d): d is SalesDay => Boolean(d));
  }
}

/** Instancia padrao usada pela aplicacao. */
export const store = new SalesDayStore();

export function salesDay(storeId: string, iso: string): SalesDay | undefined {
  return store.day(storeId, iso);
}

export function salesDays(storeId: string, start: string, end: string): SalesDay[] {
  return store.days(storeId, start, end);
}

/** Agregado de um dia, opcionalmente recortado por divisao e por faixa de horas. */
export function dayAggregate(day: SalesDay, division: Division | null, hourMax?: number): Aggregate {
  if (hourMax !== undefined) {
    const out: Aggregate = { revenue: 0, salesCount: 0, items: 0 };
    for (const [h, a] of Object.entries(day.byHour)) {
      if (Number(h) > hourMax) continue;
      out.revenue += a.revenue;
      out.salesCount += a.salesCount;
      out.items += a.items;
    }
    if (division) {
      const r = day.total.revenue > 0 ? day.byDivision[division].revenue / day.total.revenue : 0;
      return { revenue: Math.round(out.revenue * r), salesCount: Math.round(out.salesCount * r), items: Math.round(out.items * r) };
    }
    return out;
  }
  if (division) return { ...day.byDivision[division] };
  return { ...day.total };
}

export function sumAggregates(list: Aggregate[]): Aggregate {
  return list.reduce(
    (acc, a) => ({ revenue: acc.revenue + a.revenue, salesCount: acc.salesCount + a.salesCount, items: acc.items + a.items }),
    { revenue: 0, salesCount: 0, items: 0 },
  );
}
