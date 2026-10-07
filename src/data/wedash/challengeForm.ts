import { paraIso, deIso } from "@/lib/format";
import {
  PRIZE_LABEL_MAX,
  usesScope,
  type ChallengeCategory,
  type ChallengeInput,
  type ChallengeMetric,
  type ChallengeMode,
  type ChallengePrize,
  type ChallengeProduct,
  type ChallengeRecord,
  type ChallengeScope,
} from "./challengesRepo";

export const CHALLENGE_NAME_MAX = 80;
export const DEFAULT_MIN_SALES = "10";
export const MAX_PODIUM = 3;

/** Premio no formulario: R$ (mascara "1.234,50") ou descricao. */
export interface PrizeForm {
  kind: ChallengePrize["kind"];
  amount: string;
  label: string;
}

export interface ChallengeForm {
  name: string;
  startsOn: Date | null;
  endsOn: Date | null;
  storeId: string;
  metric: ChallengeMetric;
  /** O que conta (Quantidade/Valor). */
  scope: ChallengeScope;
  mode: ChallengeMode;
  products: ChallengeProduct[];
  categories: ChallengeCategory[];
  /** Minimo na unidade do tipo: obrigatorio em "Quem chegar ao minimo", opcional em "Quem fizer mais". */
  target: string;
  minSales: string;
  /** Disputa: 1, 2, 3  |  Minimo: so o 1 (por pessoa que atingir). */
  prizes: PrizeForm[];
  managerOn: boolean;
  managerPrize: PrizeForm;
  /** Media da equipe que a gerencia precisa alcancar, na unidade da metrica (Indice: indice da equipe x periodo anterior). */
  managerTarget: string;
}

export interface ChallengeFormErrors {
  name?: string;
  startsOn?: string;
  endsOn?: string;
  storeId?: string;
  products?: string;
  categories?: string;
  target?: string;
  minSales?: string;
  /** Por posicao do premio (0 = 1). */
  prizes?: Record<number, string>;
  managerPrize?: string;
  managerTarget?: string;
}

const REQUIRED = "Campo obrigatório.";

export const emptyPrize = (): PrizeForm => ({ kind: "MONEY", amount: "", label: "" });

export function emptyChallengeForm(storeId: string): ChallengeForm {
  return {
    name: "",
    startsOn: null,
    endsOn: null,
    storeId,
    metric: "QUANTITY",
    scope: "PRODUCTS",
    mode: "CONTEST",
    products: [],
    categories: [],
    target: "",
    minSales: "",
    prizes: [emptyPrize()],
    managerOn: false,
    managerPrize: emptyPrize(),
    managerTarget: "",
  };
}

/** "1.234,50"  |  "1,9"  |  "15"  ->  numero; vazio = null; invalido = NaN. */
function parseNumber(txt: string): number | null {
  const raw = txt.trim();
  if (!raw) return null;
  const t = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export const usesMinSales = (m: ChallengeMetric) => m === "PA" || m === "TICKET" || m === "INDEX";
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Erro do minimo; undefined = valido (ou vazio quando opcional). */
function targetError(metric: ChallengeMetric, txt: string, required: boolean): string | undefined {
  const v = parseNumber(txt);
  if (v == null) return required ? REQUIRED : undefined;
  if (metric === "QUANTITY") return Number.isInteger(v) && v > 0 ? undefined : "Informe um número inteiro de itens maior que 0.";
  return v > 0 ? undefined : "Informe um valor maior que 0.";
}

function targetValue(metric: ChallengeMetric, txt: string): number | null {
  const v = parseNumber(txt);
  if (v == null || Number.isNaN(v) || v <= 0) return null;
  return metric === "QUANTITY" ? Math.round(v) : round2(v);
}

const scopeOf = (f: { metric: ChallengeMetric; scope: ChallengeScope }): ChallengeScope =>
  usesScope(f.metric) ? f.scope : "ALL";

function prizeError(p: PrizeForm): string | undefined {
  if (p.kind === "MONEY") {
    const v = parseNumber(p.amount);
    if (v == null) return REQUIRED;
    return v > 0 ? undefined : "Informe um valor maior que 0.";
  }
  const label = p.label.trim();
  if (!label) return REQUIRED;
  return label.length > PRIZE_LABEL_MAX ? `Use até ${PRIZE_LABEL_MAX} caracteres.` : undefined;
}

function prizeValue(p: PrizeForm): ChallengePrize {
  return p.kind === "MONEY" ? { kind: "MONEY", amount: round2(parseNumber(p.amount) ?? 0) } : { kind: "ITEM", label: p.label.trim() };
}

const activePrizes = (f: ChallengeForm) => (f.mode === "MINIMUM" ? f.prizes.slice(0, 1) : f.prizes.slice(0, MAX_PODIUM));

/** Erros do formulario; objeto vazio = pode salvar. */
export function validateChallengeForm(f: ChallengeForm): ChallengeFormErrors {
  const e: ChallengeFormErrors = {};
  const name = f.name.trim();
  if (!name) e.name = REQUIRED;
  else if (name.length > CHALLENGE_NAME_MAX) e.name = `Use até ${CHALLENGE_NAME_MAX} caracteres.`;
  if (!f.startsOn) e.startsOn = REQUIRED;
  if (!f.endsOn) e.endsOn = REQUIRED;
  else if (f.startsOn && f.endsOn < f.startsOn) e.endsOn = "A data de fim precisa ser depois da data de início.";
  if (!f.storeId) e.storeId = REQUIRED;

  const scope = scopeOf(f);
  if (scope === "PRODUCTS" && f.products.length === 0) e.products = "Escolha pelo menos 1 produto.";
  if (scope === "CATEGORIES" && f.categories.length === 0) e.categories = "Escolha pelo menos 1 categoria.";
  if (usesMinSales(f.metric) && f.minSales.trim()) {
    const v = parseNumber(f.minSales);
    // 0 / vazio = sem piso. Se preencheu outro valor, so aceita inteiro >= 1.
    if (v !== 0 && (v == null || !Number.isInteger(v) || v < 1)) {
      e.minSales = "Informe um número inteiro a partir de 1 (ou deixe em branco / 0).";
    }
  }

  const target = targetError(f.metric, f.target, f.mode === "MINIMUM");
  if (target) e.target = target;

  const prizes: Record<number, string> = {};
  activePrizes(f).forEach((p, i) => {
    const pe = prizeError(p);
    if (pe) prizes[i] = pe;
  });
  if (Object.keys(prizes).length > 0) e.prizes = prizes;

  if (f.managerOn) {
    const me = prizeError(f.managerPrize);
    if (me) e.managerPrize = me;
    const mt = targetError(f.metric, f.managerTarget, true);
    if (mt) e.managerTarget = mt;
  }
  return e;
}

/** Formulario valido  ->  dados para gravar. */
export function challengeFormToInput(f: ChallengeForm): ChallengeInput {
  const scope = scopeOf(f);
  return {
    storeId: f.storeId,
    name: f.name.trim(),
    startsOn: paraIso(f.startsOn!),
    endsOn: paraIso(f.endsOn!),
    metric: f.metric,
    scope,
    mode: f.mode,
    products: scope === "PRODUCTS" ? f.products : [],
    categories: scope === "CATEGORIES" ? f.categories : [],
    target: targetValue(f.metric, f.target),
    minSales: usesMinSales(f.metric)
      ? (() => {
          const v = parseNumber(f.minSales);
          return v != null && Number.isInteger(v) && v >= 1 ? Math.round(v) : null;
        })()
      : null,
    prizes: activePrizes(f).map(prizeValue),
    managerPrize: f.managerOn ? prizeValue(f.managerPrize) : null,
    managerTarget: f.managerOn ? targetValue(f.metric, f.managerTarget) : null,
  };
}

function prizeToForm(p: ChallengePrize): PrizeForm {
  return p.kind === "MONEY"
    ? { kind: "MONEY", amount: p.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), label: "" }
    : { kind: "ITEM", amount: "", label: p.label };
}

function targetToText(metric: ChallengeMetric, v: number | null): string {
  if (v == null) return "";
  if (metric === "TICKET" || metric === "VALUE") return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v).replace(".", ",");
}

/** Registro (ou copia)  ->  formulario. */
export function challengeToForm(c: ChallengeRecord | ChallengeInput): ChallengeForm {
  return {
    name: c.name,
    startsOn: deIso(c.startsOn),
    endsOn: deIso(c.endsOn),
    storeId: c.storeId,
    metric: c.metric,
    scope: usesScope(c.metric) && c.scope !== "ALL" ? c.scope : "PRODUCTS",
    mode: c.mode,
    products: c.products.map((p) => ({ ...p })),
    categories: c.categories.map((t) => ({ ...t })),
    target: targetToText(c.metric, c.target),
    minSales: c.minSales != null ? String(c.minSales) : usesMinSales(c.metric) ? "" : DEFAULT_MIN_SALES,
    prizes: c.prizes.length > 0 ? c.prizes.map(prizeToForm) : [emptyPrize()],
    managerOn: c.managerPrize != null,
    managerPrize: c.managerPrize ? prizeToForm(c.managerPrize) : emptyPrize(),
    managerTarget: c.managerPrize ? targetToText(c.metric, c.managerTarget) : "",
  };
}
