/**
 * Gerador deterministico de vendas mockadas, dia a dia e hora a hora, por
 * filial. Faz o papel do sync do ERP: as telas nunca leem daqui diretamente,
 * so atraves da camada de visoes (loja.ts), que devolve numeros prontos.
 */
import { categorias, stores, paymentMethods, type Division, type Store, type PaymentMethod } from "./stores";
import { collaboratorsOfStore } from "./team";
import { TODAY_ISO, CURRENT_HOUR } from "./clock";
import { deIso, intervaloDias } from "@/lib/format";

export interface Aggregate {
  faturamento: number;
  atendimentos: number;
  itens: number;
}

export interface SalesDay {
  data: string;
  filialId: string;
  total: Aggregate;
  porHora: Record<number, Aggregate>;
  porVendedora: Record<string, Aggregate>;
  porCategoria: Record<number, { faturamento: number; itens: number; cmv: number }>;
  porMeio: Record<PaymentMethod, number>;
  porDivisao: Record<Division, Aggregate>;
}

interface ParametrosFilial {
  baseDia: number;
  ticket: number;
  pa: number;
  /** Peso por dia da semana, indice 0 = domingo. */
  pesosSemana: number[];
  /** Peso por hora de funcionamento, indice 0 = hora de abertura. */
  pesosHora: number[];
  /** Fator por mes (chave "AAAA-MM"). */
  tendencia: Record<string, number>;
  /** Participacao de cada categoria no faturamento. */
  categorias: Record<number, number>;
  meios: Record<PaymentMethod, number>;
}

const PARAMETROS: Record<string, ParametrosFilial> = {
  f1: {
    baseDia: 6100,
    ticket: 186,
    pa: 2.35,
    pesosSemana: [0.95, 0.72, 0.8, 0.86, 0.92, 1.18, 1.5],
    pesosHora: [0.03, 0.05, 0.09, 0.11, 0.08, 0.07, 0.07, 0.08, 0.1, 0.12, 0.11, 0.09],
    // set/26: levemente acima de 100% (Hiper / N3); Desafio = 110%.
    tendencia: { "2026-06": 0.93, "2026-07": 0.96, "2026-08": 1.0, "2026-09": 2.1 },
    categorias: { 1: 0.38, 2: 0.22, 3: 0.13, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.07 },
    meios: { Pix: 0.34, "Cartão de crédito": 0.41, "Cartão de débito": 0.19, Dinheiro: 0.06 },
  },
  f2: {
    baseDia: 3450,
    ticket: 158,
    pa: 2.2,
    pesosSemana: [0, 0.85, 0.9, 0.95, 1.0, 1.2, 1.35],
    pesosHora: [0.05, 0.09, 0.11, 0.12, 0.1, 0.07, 0.08, 0.11, 0.13, 0.14],
    tendencia: { "2026-06": 0.95, "2026-07": 0.98, "2026-08": 1.0, "2026-09": 0.9 },
    categorias: { 1: 0.33, 2: 0.2, 3: 0.11, 4: 0.07, 5: 0.05, 6: 0.03, 7: 0.05, 8: 0.16 },
    meios: { Pix: 0.4, "Cartão de crédito": 0.35, "Cartão de débito": 0.17, Dinheiro: 0.08 },
  },
};

/** Indice de preco relativo por categoria, para derivar itens do faturamento. */
const INDICE_PRECO: Record<number, number> = { 1: 1.6, 2: 0.7, 3: 0.8, 4: 0.9, 5: 1.1, 6: 0.75, 7: 1.9, 8: 1.2 };

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
function ruido(r: () => number, amp: number): number {
  return 1 + (r() * 2 - 1) * amp;
}

export function dayWeight(filial: Store, iso: string): number {
  return PARAMETROS[filial.id].pesosSemana[deIso(iso).getDay()];
}

export function storeOpen(filial: Store, iso: string): boolean {
  return !filial.diasFechados.includes(deIso(iso).getDay());
}

function gerarDia(filial: Store, iso: string): SalesDay {
  const p = PARAMETROS[filial.id];
  const r = prng(hash(`${filial.id}|${iso}`));
  const vazio: SalesDay = {
    data: iso,
    filialId: filial.id,
    total: { faturamento: 0, atendimentos: 0, itens: 0 },
    porHora: {},
    porVendedora: {},
    porCategoria: {},
    porMeio: { Pix: 0, "Cartão de crédito": 0, "Cartão de débito": 0, Dinheiro: 0 },
    porDivisao: { WEPINK: { faturamento: 0, atendimentos: 0, itens: 0 }, WPINK: { faturamento: 0, atendimentos: 0, itens: 0 } },
  };
  if (!storeOpen(filial, iso)) return vazio;

  const mes = iso.slice(0, 7);
  const tendencia = p.tendencia[mes] ?? 1;
  const totalDiaCheio = p.baseDia * dayWeight(filial, iso) * tendencia * ruido(r, 0.14);
  const ticketDia = p.ticket * ruido(r, 0.06);
  const paDia = p.pa * ruido(r, 0.05);

  // Distribui por hora e trunca o dia de hoje na hora atual.
  const horas = hourRange(filial);
  const somaPesos = p.pesosHora.reduce((s, x) => s + x, 0);
  const porHora: Record<number, Aggregate> = {};
  let faturamento = 0;
  let atendimentos = 0;
  let itens = 0;
  horas.forEach((h, i) => {
    if (iso === TODAY_ISO && h > CURRENT_HOUR) return;
    let fracao = (p.pesosHora[i] / somaPesos) * ruido(r, 0.25);
    if (iso === TODAY_ISO && h === CURRENT_HOUR) fracao *= 0.55;
    const fat = Math.round(totalDiaCheio * fracao);
    const atend = Math.max(fat > 0 ? 1 : 0, Math.round(fat / (ticketDia * ruido(r, 0.1))));
    const it = Math.max(atend, Math.round(atend * paDia * ruido(r, 0.08)));
    porHora[h] = { faturamento: fat, atendimentos: atend, itens: it };
    faturamento += fat;
    atendimentos += atend;
    itens += it;
  });
  const total: Aggregate = { faturamento, atendimentos, itens };

  // Categorias: faturamento por participacao, itens pelo indice de preco, CMV pela categoria.
  const porCategoria: Record<number, { faturamento: number; itens: number; cmv: number }> = {};
  const entradas = Object.entries(p.categorias).map(([id, share]) => ({ id: Number(id), share: share * ruido(r, 0.12) }));
  const somaShare = entradas.reduce((s, e) => s + e.share, 0);
  const pesosItens = entradas.map((e) => e.share / INDICE_PRECO[e.id]);
  const somaPesosItens = pesosItens.reduce((s, x) => s + x, 0);
  entradas.forEach((e, i) => {
    const cat = categorias.find((c) => c.id === e.id)!;
    const fat = Math.round((faturamento * e.share) / somaShare);
    porCategoria[e.id] = {
      faturamento: fat,
      itens: Math.round((itens * pesosItens[i]) / somaPesosItens),
      cmv: Math.round(fat * cat.cmvPct * ruido(r, 0.03)),
    };
  });

  // Divisao: WPINK = categorias da divisao WPINK; o resto e WEPINK.
  const porDivisao: Record<Division, Aggregate> = {
    WEPINK: { faturamento: 0, atendimentos: 0, itens: 0 },
    WPINK: { faturamento: 0, atendimentos: 0, itens: 0 },
  };
  for (const cat of categorias) {
    const c = porCategoria[cat.id];
    if (!c) continue;
    porDivisao[cat.divisao].faturamento += c.faturamento;
    porDivisao[cat.divisao].itens += c.itens;
  }
  for (const d of ["WEPINK", "WPINK"] as Division[]) {
    const fr = faturamento > 0 ? porDivisao[d].faturamento / faturamento : 0;
    porDivisao[d].atendimentos = Math.round(atendimentos * fr);
  }

  // Meios de pagamento.
  const porMeio = { ...vazio.porMeio };
  const meiosRuido = paymentMethods.map((m) => p.meios[m] * ruido(r, 0.15));
  const somaMeios = meiosRuido.reduce((s, x) => s + x, 0);
  paymentMethods.forEach((m, i) => {
    porMeio[m] = Math.round((faturamento * meiosRuido[i]) / somaMeios);
  });

  // Vendedoras: peso relativo, respeitando admissao e inatividade.
  const porVendedora: Record<string, Aggregate> = {};
  const equipe = collaboratorsOfStore(filial.id).filter((c) => {
    if (c.dataAdmissao > iso) return false;
    if (c.dataInatividade && c.dataInatividade <= iso) return false;
    return true;
  });
  const pesos = equipe.map((c) => c.pesoVenda * ruido(r, 0.2));
  const somaPesosV = pesos.reduce((s, x) => s + x, 0);
  equipe.forEach((c, i) => {
    const fr = pesos[i] / somaPesosV;
    porVendedora[c.id] = {
      faturamento: Math.round(faturamento * fr),
      atendimentos: Math.round(atendimentos * fr),
      itens: Math.round(itens * fr),
    };
  });

  return { data: iso, filialId: filial.id, total, porHora, porVendedora, porCategoria, porMeio, porDivisao };
}

export function hourRange(filial: Store): number[] {
  const out: number[] = [];
  for (let h = filial.abertura; h < filial.fechamento; h++) out.push(h);
  return out;
}

const INICIO_HISTORICO = "2026-06-01";

/** Indice puro de vendas por filial+data, parametrizavel para testes isolados. */
export class SalesDayStore {
  private readonly indice: Map<string, SalesDay>;
  readonly inicio: string;
  readonly fim: string;

  /** Popula do historico deterministicamente gerado. */
  constructor(inicio: string = INICIO_HISTORICO, fim: string = TODAY_ISO) {
    this.inicio = inicio;
    this.fim = fim;
    this.indice = new Map<string, SalesDay>();
    for (const f of stores) {
      for (const iso of intervaloDias(inicio, fim)) {
        this.indice.set(`${f.id}|${iso}`, gerarDia(f, iso));
      }
    }
  }

  dia(filialId: string, iso: string): SalesDay | undefined {
    return this.indice.get(`${filialId}|${iso}`);
  }

  dias(filialId: string, inicio: string, fim: string): SalesDay[] {
    return intervaloDias(inicio, fim)
      .map((iso) => this.indice.get(`${filialId}|${iso}`))
      .filter((d): d is SalesDay => Boolean(d));
  }
}

/** Instancia padrao usada pela aplicacao. */
export const store = new SalesDayStore();

export function salesDay(filialId: string, iso: string): SalesDay | undefined {
  return store.dia(filialId, iso);
}

export function salesDays(filialId: string, inicio: string, fim: string): SalesDay[] {
  return store.dias(filialId, inicio, fim);
}

/** Agregado de um dia, opcionalmente recortado por divisao e por faixa de horas. */
export function dayAggregate(dia: SalesDay, divisao: Division | null, horaMax?: number): Aggregate {
  if (horaMax !== undefined) {
    const out: Aggregate = { faturamento: 0, atendimentos: 0, itens: 0 };
    for (const [h, a] of Object.entries(dia.porHora)) {
      if (Number(h) > horaMax) continue;
      out.faturamento += a.faturamento;
      out.atendimentos += a.atendimentos;
      out.itens += a.itens;
    }
    if (divisao) {
      const r = dia.total.faturamento > 0 ? dia.porDivisao[divisao].faturamento / dia.total.faturamento : 0;
      return { faturamento: Math.round(out.faturamento * r), atendimentos: Math.round(out.atendimentos * r), itens: Math.round(out.itens * r) };
    }
    return out;
  }
  if (divisao) return { ...dia.porDivisao[divisao] };
  return { ...dia.total };
}

export function sumAggregates(lista: Aggregate[]): Aggregate {
  return lista.reduce(
    (acc, a) => ({ faturamento: acc.faturamento + a.faturamento, atendimentos: acc.atendimentos + a.atendimentos, itens: acc.itens + a.itens }),
    { faturamento: 0, atendimentos: 0, itens: 0 },
  );
}
