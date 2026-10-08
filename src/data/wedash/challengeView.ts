import { brlCent, collaboratorName, dataCurta, deIso, intervaloDias, num, somarDias } from "@/lib/format";
import {
  managerIndexWindows,
  usesScope,
  type ChallengeAggInput,
  type DayRange,
  type ChallengeInput,
  type ChallengeMetric,
  type ChallengeMode,
  type ChallengePrize,
  type ChallengeRecord,
  type ChallengeScope,
} from "./challengesRepo";
import type { GoalTeamMember } from "./goalsRepo";
import type { SalesSellerDayAgg } from "./salesTypes";
import { goalStatus, prazoRestante, type GoalStatus } from "./goalView";

export type ChallengeStatus = GoalStatus;

export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  active: "Em andamento",
  upcoming: "A começar",
  ended: "Encerrado",
};

export const CHALLENGE_METRIC_LABEL: Record<ChallengeMetric, string> = {
  QUANTITY: "Itens vendidos",
  VALUE: "Faturamento",
  PA: "P.A.",
  TICKET: "Ticket médio",
  INDEX: "Índice de desempenho",
};

/** Pesos do Indice de desempenho (somam 1). */
export const INDEX_WEIGHTS = { faturamento: 0.5, ticket: 0.25, pa: 0.25 } as const;

export interface IndexTeamBase {
  /** Faturamento medio por pessoa (so quem vendeu). */
  faturamentoMedio: number;
  /** Media dos tickets individuais (nao o ticket consolidado: quem vende mais nao pesa mais). */
  ticket: number;
  /** Media dos P.A.s individuais. */
  pa: number;
}

/** Medias simples entre quem vendeu  ->  a media dos indices dessas pessoas e exatamente 100. */
export function indexTeamBase(pessoas: { faturamento: number; vendas: number; itens: number }[]): IndexTeamBase | null {
  const comVenda = pessoas.filter((p) => p.vendas > 0);
  if (comVenda.length === 0) return null;
  const media = (f: (p: (typeof comVenda)[number]) => number) => comVenda.reduce((s, p) => s + f(p), 0) / comVenda.length;
  return {
    faturamentoMedio: media((p) => p.faturamento),
    ticket: media((p) => p.faturamento / p.vendas),
    pa: media((p) => p.itens / p.vendas),
  };
}

/** Faturamento em R$ ou centavos  -  so precisa ser a mesma unidade da base. */
export function performanceIndex(p: { faturamento: number; vendas: number; itens: number }, base: IndexTeamBase): number {
  if (p.vendas <= 0) return 0;
  const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
  const w = INDEX_WEIGHTS;
  return (
    100 *
    (w.faturamento * parte(p.faturamento, base.faturamentoMedio) +
      w.ticket * parte(p.faturamento / p.vendas, base.ticket) +
      w.pa * parte(p.itens / p.vendas, base.pa))
  );
}

export interface IndexPersonTotals {
  faturamento: number;
  vendas: number;
  itens: number;
  semItens: boolean;
}

/**
 * Indice da equipe (gerencia): mesma formula, com as medias da equipe agora x as do periodo anterior.
 * 100 = igual ao periodo anterior. Sem venda em algum lado ou com dia sem itens = null (nada estimado).
 */
export function teamIndex(atual: IndexPersonTotals[], anterior: IndexPersonTotals[]): number | null {
  if ([...atual, ...anterior].some((p) => p.vendas > 0 && p.semItens)) return null;
  const a = indexTeamBase(atual);
  const b = indexTeamBase(anterior);
  if (!a || !b) return null;
  const parte = (v: number, ref: number) => (ref > 0 ? v / ref : 0);
  const w = INDEX_WEIGHTS;
  return (
    100 *
    (w.faturamento * parte(a.faturamentoMedio, b.faturamentoMedio) +
      w.ticket * parte(a.ticket, b.ticket) +
      w.pa * parte(a.pa, b.pa))
  );
}

export const CHALLENGE_SCOPE_LABEL: Record<ChallengeScope, string> = {
  PRODUCTS: "Produtos escolhidos",
  CATEGORIES: "Categorias escolhidas",
  ALL: "Tudo o que vender",
};

export const CHALLENGE_MODE_LABEL: Record<ChallengeMode, string> = {
  CONTEST: "Quem fizer mais",
  MINIMUM: "Quem atingir o mínimo",
};

export interface ChallengeParticipant {
  key: string;
  nome: string;
  grupo: string | null;
  /** null = a comecar ou P.A. sem itens gravados (" - "). */
  resultado: number | null;
  vendas: number;
  /** Disputa: posicao entre quem concorre (empate compartilha). */
  posicao: number | null;
  /** Disputa: venceu  |  Minimo: atingiu. */
  vencedor: boolean;
  premio: ChallengePrize | null;
  /** So em andamento. */
  falta: string | null;
}

export interface ChallengeManagerResult {
  /** Media da equipe (Indice: indice da equipe x periodo anterior). */
  resultado: number | null;
  alvo: number;
  /** So no Indice: periodo anterior inteiro usado na comparacao. */
  periodoAnterior: { from: string; to: string } | null;
  atingiu: boolean;
  premio: ChallengePrize;
}

export interface ChallengeView {
  mode: ChallengeMode;
  status: ChallengeStatus;
  prazo: string;
  /** Encerrado ontem: o ultimo dia fecha na madrugada e ainda pode mudar. */
  emFechamento: boolean;
  participantes: ChallengeParticipant[];
  /** Minimo: quantas pessoas atingiram. */
  atingiram: number;
  gerencia: ChallengeManagerResult | null;
  /** Dias com venda da loja e sem itens por pessoa (produtos/categorias escolhidos). */
  diasIncompletos: string[];
}

const usesMinSales = (m: ChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

function diasEntre(inicio: string, fim: string): number {
  return Math.round((deIso(fim).getTime() - deIso(inicio).getTime()) / 86_400_000) + 1;
}

/** 12 itens  |  1 item  |  7,5 itens  |  1,85  |  R$ 92,30  |  112,4 (indice) */
export function metricValueLabel(metric: ChallengeMetric, value: number): string {
  if (metric === "PA") return num(value, 2);
  if (metric === "INDEX") return num(value, 1);
  if (metric === "TICKET" || metric === "VALUE") return brlCent(value);
  const inteiro = Number.isInteger(value);
  return `${num(value, inteiro ? 0 : 1)} ${value === 1 ? "item" : "itens"}`;
}

export function prizeLabel(p: ChallengePrize): string {
  return p.kind === "MONEY" ? brlCent(p.amount) : p.label;
}

function faltaLabel(metric: ChallengeMetric, diff: number): string {
  if (metric === "PA") return `Falta ${num(diff, 2)} de P.A.`;
  if (metric === "INDEX") {
    const pontos = Math.max(0.1, Math.ceil(diff * 10 - 1e-9) / 10);
    return pontos === 1 ? "Falta 1,0 ponto" : `Faltam ${num(pontos, 1)} pontos`;
  }
  if (metric === "TICKET") return `Faltam ${brlCent(diff)} de ticket médio`;
  if (metric === "VALUE") return `Faltam ${brlCent(diff)}`;
  const n = Math.ceil(diff - 1e-9);
  return n === 1 ? "Falta 1 item" : `Faltam ${num(n)} itens`;
}

const faltaVendas = (n: number) => (n === 1 ? "Falta 1 venda para participar" : `Faltam ${num(n)} vendas para participar`);

interface Acc {
  key: string;
  nome: string;
  grupo: string | null;
  /** Itens e R$ dos produtos/categorias escolhidos. */
  itens: number;
  valorCents: number;
  vendas: number;
  itensVendas: number;
  faturamentoCents: number;
  semItens: boolean;
}

export function buildChallengeView(args: {
  challenge: ChallengeRecord;
  aggs: ChallengeAggInput;
  today: string;
}): ChallengeView {
  const { challenge: c, aggs, today } = args;
  const status = goalStatus(c, today);
  const ate = c.endsOn < today ? c.endsOn : today;
  const noPeriodo = (r: { storeId: string; day: string }) => r.storeId === c.storeId && r.day >= c.startsOn && r.day <= ate;

  const team = aggs.team.filter((m) => m.storeId === c.storeId);
  const porCodigo = new Map(team.map((m) => [m.employeeId, m]));
  const porGerador = new Map<number, GoalTeamMember>();
  for (const m of team) if (m.geradorId != null) porGerador.set(m.geradorId, m);
  const porNome = new Map<string, GoalTeamMember>();
  for (const m of team) for (const k of m.nameKeys) if (!porNome.has(k)) porNome.set(k, m);

  const accs = new Map<string, Acc>();
  const acc = (membro: GoalTeamMember | undefined, sellerKey: string, sellerName: string): Acc => {
    const key = membro ? `e:${membro.employeeId}` : `n:${sellerKey}`;
    let a = accs.get(key);
    if (!a) {
      a = {
        key,
        nome: collaboratorName(membro?.name ?? (sellerName || sellerKey)),
        grupo: membro?.shiftName ?? null,
        itens: 0,
        valorCents: 0,
        vendas: 0,
        itensVendas: 0,
        faturamentoCents: 0,
        semItens: false,
      };
      accs.set(key, a);
    }
    return a;
  };

  for (const m of team) if (m.salesPerson) acc(m, "", m.name);

  const membroDoDia = (r: SalesSellerDayAgg): GoalTeamMember | undefined =>
    (r.sellerEmployeeId != null ? porCodigo.get(r.sellerEmployeeId) : undefined) ??
    (r.sellerGeradorId != null ? porGerador.get(r.sellerGeradorId) : undefined) ??
    porNome.get(r.sellerKey);

  const porProduto = usesScope(c.metric) && c.scope !== "ALL";
  if (status !== "upcoming") {
    if (porProduto) {
      const codigos = new Set(c.products.map((p) => p.code));
      const tipos = new Set(c.categories.map((t) => t.typeId));
      const conta = (code: string) =>
        c.scope === "PRODUCTS" ? codigos.has(code) : tipos.has(aggs.typeByCode.get(code) ?? Number.NaN);
      for (const r of aggs.sellerProducts) {
        if (!noPeriodo(r)) continue;
        const membro = porGerador.get(r.sellerGeradorId) ?? porNome.get(r.sellerKey);
        const a = acc(membro, r.sellerKey, r.sellerName);
        if (conta(r.productCode)) {
          a.itens += r.itemCount;
          a.valorCents += r.revenueCents;
        }
      }
    }
    for (const r of aggs.sellerDays) {
      if (!noPeriodo(r)) continue;
      const a = acc(membroDoDia(r), r.sellerKey, r.sellerName);
      a.vendas += r.salesCount;
      a.faturamentoCents += r.revenueCents;
      a.itensVendas += r.itemCount ?? 0;
      if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) a.semItens = true;
    }
  }

  const indexBase: IndexTeamBase | null = [...accs.values()].some((a) => a.vendas > 0 && a.semItens)
    ? null
    : indexTeamBase([...accs.values()].map((a) => ({ faturamento: a.faturamentoCents, vendas: a.vendas, itens: a.itensVendas })));

  const resultadoDe = (a: Acc): number | null => {
    if (status === "upcoming") return null;
    if (c.metric === "INDEX") {
      if (a.vendas <= 0) return 0;
      return indexBase
        ? round2(performanceIndex({ faturamento: a.faturamentoCents, vendas: a.vendas, itens: a.itensVendas }, indexBase))
        : null;
    }
    if (c.metric === "QUANTITY") return porProduto ? a.itens : a.semItens ? null : a.itensVendas;
    if (c.metric === "VALUE") return round2((porProduto ? a.valorCents : a.faturamentoCents) / 100);
    if (a.vendas <= 0) return 0;
    if (c.metric === "PA") return a.semItens ? null : round2(a.itensVendas / a.vendas);
    return round2(a.faturamentoCents / 100 / a.vendas);
  };

  const minVendas = usesMinSales(c.metric) && c.minSales != null ? Math.max(1, c.minSales) : 0;
  const base = [...accs.values()].map((a) => ({ a, resultado: resultadoDe(a) }));
  const concorre = (x: { a: Acc; resultado: number | null }) =>
    x.resultado != null && x.resultado > 0 && x.a.vendas >= minVendas;
  const alcancaAlvo = (v: number | null) => v != null && v > 0 && (c.target == null || v >= c.target - 1e-9);

  const posicaoDe = new Map<string, number>();
  if (c.mode === "CONTEST" && status !== "upcoming") {
    const pool = base.filter(concorre).sort((x, y) => (y.resultado ?? 0) - (x.resultado ?? 0));
    pool.forEach((x, i) => {
      const anterior = pool[i - 1];
      posicaoDe.set(x.a.key, anterior && anterior.resultado === x.resultado ? posicaoDe.get(anterior.a.key)! : i + 1);
    });
  }

  const valoresAcima = base
    .filter((x) => concorre(x) && posicaoDe.has(x.a.key))
    .map((x) => ({ valor: x.resultado!, posicao: posicaoDe.get(x.a.key)! }));

  // P.A. oscila ate o ultimo dia: ninguem "atinge" enquanto o desafio esta aberto.
  const paEmAndamento = c.metric === "PA" && status === "active";

  const participantes: ChallengeParticipant[] = base.map(({ a, resultado }) => {
    const posicao = posicaoDe.get(a.key) ?? null;
    let vencedor = false;
    let premio: ChallengePrize | null = null;
    if (status !== "upcoming" && !paEmAndamento) {
      if (c.mode === "CONTEST") {
        vencedor = posicao != null && posicao <= c.prizes.length && alcancaAlvo(resultado);
        premio = vencedor ? (c.prizes[posicao! - 1] ?? null) : null;
      } else {
        vencedor = alcancaAlvo(resultado) && a.vendas >= minVendas && c.target != null;
        premio = vencedor ? (c.prizes[0] ?? null) : null;
      }
    }

    let falta: string | null = null;
    if (status === "active" && resultado != null) {
      if (a.vendas < minVendas) falta = faltaVendas(minVendas - a.vendas);
      else if (paEmAndamento && alcancaAlvo(resultado) && (c.mode === "MINIMUM" || (posicao != null && posicao <= c.prizes.length))) {
        falta = "O P.A. só vale no fim do desafio";
      } else if (c.mode === "MINIMUM") {
        if (!vencedor && c.target != null) falta = `${faltaLabel(c.metric, c.target - resultado)} para o mínimo`;
      } else if (c.target != null && resultado < c.target - 1e-9) {
        falta = `${faltaLabel(c.metric, c.target - resultado)} para o mínimo`;
      } else {
        const acima = valoresAcima
          .filter((v) => v.valor > resultado + 1e-9)
          .sort((x, y) => x.valor - y.valor)[0];
        if (acima) falta = `${faltaLabel(c.metric, acima.valor - resultado)} para o ${acima.posicao}º lugar`;
      }
    }

    return { key: a.key, nome: a.nome, grupo: a.grupo, resultado, vendas: a.vendas, posicao, vencedor, premio, falta };
  });

  participantes.sort((x, y) => {
    if (status !== "upcoming") {
      if (c.mode === "CONTEST") {
        const px = x.posicao ?? Number.POSITIVE_INFINITY;
        const py = y.posicao ?? Number.POSITIVE_INFINITY;
        if (px !== py) return px - py;
      } else if (x.vencedor !== y.vencedor) return x.vencedor ? -1 : 1;
      const rx = x.resultado ?? Number.NEGATIVE_INFINITY;
      const ry = y.resultado ?? Number.NEGATIVE_INFINITY;
      if (rx !== ry) return ry - rx;
    }
    return x.nome.localeCompare(y.nome, "pt-BR");
  });

  let gerencia: ChallengeManagerResult | null = null;
  const metaGerencia = c.managerTarget;
  if (c.managerPrize && metaGerencia != null && c.metric === "INDEX") {
    const janelas = managerIndexWindows(c, today);
    const pessoasNa = (j: DayRange) => {
      const m = new Map<string, IndexPersonTotals>();
      for (const r of aggs.sellerDays) {
        if (r.storeId !== c.storeId || r.day < j.from || r.day > j.to) continue;
        const membro = membroDoDia(r);
        const key = membro ? `e:${membro.employeeId}` : r.sellerKey ? `n:${r.sellerKey}` : null;
        if (!key) continue;
        const p = m.get(key) ?? { faturamento: 0, vendas: 0, itens: 0, semItens: false };
        p.faturamento += r.revenueCents;
        p.vendas += r.salesCount;
        p.itens += r.itemCount ?? 0;
        if (r.salesCount > 0 && !(r.itemCount && r.itemCount > 0)) p.semItens = true;
        m.set(key, p);
      }
      return [...m.values()];
    };
    const indice =
      status === "upcoming" || !janelas.atual || !janelas.comparado
        ? null
        : teamIndex(pessoasNa(janelas.atual), pessoasNa(janelas.comparado));
    const resultado = indice == null ? null : round2(indice);
    gerencia = {
      resultado,
      alvo: metaGerencia,
      periodoAnterior: janelas.anterior,
      atingiu: resultado != null && resultado >= metaGerencia - 1e-9,
      premio: c.managerPrize,
    };
  } else if (c.managerPrize && metaGerencia != null) {
    let resultado: number | null = null;
    if (status !== "upcoming") {
      const todos = [...accs.values()];
      const vendas = todos.reduce((s, a) => s + a.vendas, 0);
      if (usesScope(c.metric)) {
        const porPessoa = todos.map(resultadoDe);
        resultado = porPessoa.some((v) => v == null)
          ? null
          : todos.length > 0
            ? round2(porPessoa.reduce<number>((s, v) => s + (v ?? 0), 0) / todos.length)
            : 0;
      } else if (c.metric === "PA") {
        resultado = todos.some((a) => a.semItens)
          ? null
          : vendas > 0
            ? round2(todos.reduce((s, a) => s + a.itensVendas, 0) / vendas)
            : 0;
      } else {
        resultado = vendas > 0 ? round2(todos.reduce((s, a) => s + a.faturamentoCents, 0) / 100 / vendas) : 0;
      }
    }
    gerencia = {
      resultado,
      alvo: metaGerencia,
      periodoAnterior: null,
      atingiu: (c.metric !== "PA" || status === "ended") && resultado != null && resultado > 0 && resultado >= metaGerencia - 1e-9,
      premio: c.managerPrize,
    };
  }

  const diasIncompletos: string[] = [];
  if (porProduto && status !== "upcoming") {
    const comItens = new Set(aggs.sellerProducts.filter(noPeriodo).map((r) => r.day));
    for (const day of intervaloDias(c.startsOn, ate)) {
      if (aggs.storeSaleDays.has(`${c.storeId}|${day}`) && !comItens.has(day)) diasIncompletos.push(day);
    }
  }

  const prazo =
    status === "active"
      ? prazoRestante(diasEntre(today, c.endsOn))
      : status === "upcoming"
        ? `Começa em ${dataCurta(c.startsOn)}`
        : "Encerrado";

  return {
    mode: c.mode,
    status,
    prazo,
    emFechamento: status === "ended" && today <= somarDias(c.endsOn, 1),
    participantes,
    atingiram: c.mode === "MINIMUM" ? participantes.filter((p) => p.vencedor).length : 0,
    gerencia,
    diasIncompletos,
  };
}

export interface ChallengeWinner {
  nome: string;
  grupo: string | null;
  /** "1 lugar"  |  "Atingiu" */
  colocacao: string;
  premio: ChallengePrize;
}

export interface ChallengePayout {
  vencedores: ChallengeWinner[];
  gerencia: ChallengePrize | null;
  /**  premios em R$ (pessoas + gerencia). */
  totalReais: number;
  /** Outros premios (texto livre), um por vencedor (+ gerencia). */
  especie: string[];
}

export function challengePayout(view: ChallengeView): ChallengePayout {
  const vencedores: ChallengeWinner[] = view.participantes
    .filter((p) => p.vencedor && p.premio)
    .map((p) => ({
      nome: p.nome,
      grupo: p.grupo,
      colocacao: p.posicao != null ? `${p.posicao}º lugar` : "Atingiu",
      premio: p.premio!,
    }));
  const gerencia = view.gerencia?.atingiu ? view.gerencia.premio : null;
  const premios = [...vencedores.map((w) => w.premio), ...(gerencia ? [gerencia] : [])];
  return {
    vencedores,
    gerencia,
    totalReais: premios.reduce((s, p) => s + (p.kind === "MONEY" ? p.amount : 0), 0),
    especie: premios.flatMap((p) => (p.kind === "ITEM" ? [p.label] : [])),
  };
}

function juntarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Resumo do card da listagem: lider(es) na Disputa  |  quantas atingiram no Minimo. */
export function challengeCardSummary(view: ChallengeView): { lider: string | null; atingiram: number | null } {
  if (view.mode === "MINIMUM") return { lider: null, atingiram: view.status === "upcoming" ? null : view.atingiram };
  const lideres = view.participantes.filter((p) => p.posicao === 1).map((p) => p.nome);
  return { lider: lideres.length > 0 ? juntarNomes(lideres) : null, atingiram: null };
}

/** Copia para "Duplicar desafio": comeca no dia seguinte ao fim, com a mesma duracao. */
export function copyChallenge(c: ChallengeRecord): ChallengeInput {
  const { id: _id, ...rest } = c;
  const duracao = diasEntre(c.startsOn, c.endsOn);
  const startsOn = somarDias(c.endsOn, 1);
  return {
    ...rest,
    name: `${c.name} (cópia)`,
    startsOn,
    endsOn: somarDias(startsOn, duracao - 1),
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
  };
}

/** Copia para "Duplicar para outra loja": mesmas datas e nome; a loja e escolhida no editor. */
export function copyChallengeToStore(c: ChallengeRecord): ChallengeInput {
  const { id: _id, ...rest } = c;
  return {
    ...rest,
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    prizes: c.prizes.map((p) => ({ ...p })),
    managerPrize: c.managerPrize ? { ...c.managerPrize } : null,
  };
}
