import {
  emptyChallengeForm,
  emptyPrize,
  validateChallengeForm,
  type ChallengeForm,
  type ChallengeFormErrors,
  type PrizeForm,
} from "@/data/wedash/challengeForm";
import {
  CHALLENGE_METRIC_LABEL,
  CHALLENGE_MODE_LABEL,
  CHALLENGE_SCOPE_LABEL,
} from "@/data/wedash/challengeView";
import {
  fetchChallengeCatalog,
  type ChallengeCatalog,
  type ChallengeProduct,
} from "@/data/wedash/challengesRepo";
import { addDays, dateToIso, isoToDate } from "@/lib/format";
import { brlCent } from "@/lib/format";
import { matchStoresInText, type JarvisContext } from "./context";
import { pickStalledProducts } from "./stockStalled";
import { fetchSalesProductPeriodAggs } from "@/data/wedash/salesRepo";
import { fetchStockCatalog, fetchStoreStock } from "@/data/wedash/stockRepo";

export type ChallengeDraft = {
  form: ChallengeForm;
  catalog: ChallengeCatalog | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function parseMoney(text: string): number | null {
  const m =
    text.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i) ??
    text.match(/([\d.]+(?:,\d{1,2})?)\s*reais?\b/i) ??
    text.match(/\b([\d]+)\s*(?:no|pro|para o)\s*1[oº]?\b/i);
  if (!m) return null;
  const raw = m[1]!.includes(",") ? m[1]!.replace(/\./g, "").replace(",", ".") : m[1]!.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function moneyPrize(amount: number): PrizeForm {
  return {
    kind: "MONEY",
    amount: amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    label: "",
  };
}

function itemPrize(label: string): PrizeForm {
  return { kind: "ITEM", amount: "", label: label.slice(0, 60) };
}

function shiftIso(iso: string, days: number): string {
  return addDays(iso, days);
}

/** Interpreta datas relativas no texto. */
export function parseChallengeDates(
  text: string,
  today: string,
): { startsOn: string; endsOn: string } | null {
  const p = norm(text);
  const range = p.match(/de\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+a\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (range) {
    const y0 = range[3] ? (range[3].length === 2 ? `20${range[3]}` : range[3]) : today.slice(0, 4);
    const y1 = range[6] ? (range[6].length === 2 ? `20${range[6]}` : range[6]) : y0;
    const from = `${y0}-${range[2]!.padStart(2, "0")}-${range[1]!.padStart(2, "0")}`;
    const to = `${y1}-${range[5]!.padStart(2, "0")}-${range[4]!.padStart(2, "0")}`;
    if (from <= to) return { startsOn: from, endsOn: to };
  }
  const days = p.match(/(?:por|durante|pra|para)\s+(\d{1,2})\s*dias?/) ?? p.match(/(\d{1,2})\s*dias?/);
  if (days) {
    const n = Math.min(31, Math.max(1, Number(days[1])));
    const start = /amanha/.test(p) ? shiftIso(today, 1) : today;
    return { startsOn: start, endsOn: shiftIso(start, n - 1) };
  }
  if (/esta semana|nessa semana/.test(p)) {
    const d = isoToDate(today);
    const dow = d.getDay(); // 0 dom
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const start = shiftIso(today, mondayOffset);
    return { startsOn: start, endsOn: shiftIso(start, 6) };
  }
  if (/proxima semana|semana que vem/.test(p)) {
    const d = isoToDate(today);
    const dow = d.getDay();
    const nextMon = dow === 0 ? 1 : 8 - dow;
    const start = shiftIso(today, nextMon);
    return { startsOn: start, endsOn: shiftIso(start, 6) };
  }
  return null;
}

export function mergeChallengeUtterance(form: ChallengeForm, text: string, ctx: JarvisContext): ChallengeForm {
  const p = norm(text);
  const next: ChallengeForm = {
    ...form,
    products: [...form.products],
    categories: [...form.categories],
    lines: form.lines.map((l) => ({ ...l, kinds: [...l.kinds] })),
    prizes: form.prizes.map((pr) => ({ ...pr })),
    managerPrize: { ...form.managerPrize },
    cashierPrize: { ...form.cashierPrize },
  };

  const stores = matchStoresInText(text, ctx.stores);
  if (stores.length === 1) next.storeId = stores[0]!.id;
  else if (!next.storeId && ctx.stores.length === 1) next.storeId = ctx.stores[0]!.id;

  if (/disputa|quem fizer mais|podio|pódio|ranking/.test(p)) next.mode = "CONTEST";
  else if (/coletiv|equipe junta|filial junta|loja junta/.test(p)) next.mode = "COLLECTIVE";
  else if (/minimo|mínimo|quem chegar|atingir o minimo|atingir o mínimo/.test(p)) next.mode = "MINIMUM";

  if (/\bindice\b|índice|desempenho/.test(p) && !/itens|faturamento|ticket|p\.?\s*a/.test(p)) next.metric = "INDEX";
  else if (/ticket/.test(p)) next.metric = "TICKET";
  else if (/\bp\.?\s*a\.?\b|pecas por|peças por|itens por venda/.test(p)) next.metric = "PA";
  else if (/faturamento|em valor|em reais|metrica valor|métrica valor/.test(p)) next.metric = "VALUE";
  else if (/itens|quantidade|unidades/.test(p)) next.metric = "QUANTITY";

  if (/tudo o que vender|tudo que vender|qualquer produto/.test(p)) next.scope = "ALL";
  else if (/categorias?/.test(p)) next.scope = "CATEGORIES";
  else if (/agregac|agregaç|linhas?/.test(p)) next.scope = "LINES";
  else if (/produtos?/.test(p)) next.scope = "PRODUCTS";

  const dates = parseChallengeDates(text, ctx.today);
  if (dates) {
    next.startsOn = isoToDate(dates.startsOn);
    next.endsOn = isoToDate(dates.endsOn);
  }

  const money = parseMoney(text);
  if (money != null) {
    if (next.mode === "MINIMUM" || next.mode === "COLLECTIVE") {
      next.prizes = [moneyPrize(money)];
    } else {
      const prizes = next.prizes.length > 0 ? [...next.prizes] : [emptyPrize()];
      prizes[0] = moneyPrize(money);
      next.prizes = prizes;
    }
  }

  const item = text.match(/(?:premio|prêmio)\s+(?:em\s+)?(?:item|produto)?\s*[:\-]?\s*([A-Za-zÀ-ú0-9][^.]{1,50})/i);
  if (item?.[1] && !money) {
    const label = item[1].trim();
    if (label && !/^em\s+dinheiro/i.test(label)) {
      next.prizes = [itemPrize(label)];
    }
  }

  const target =
    text.match(/(?:minimo|mínimo|alvo|meta)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/i) ??
    text.match(/chegar\s+(?:a|em)\s+(\d+(?:[.,]\d+)?)/i);
  if (target?.[1] && (next.mode === "MINIMUM" || next.mode === "COLLECTIVE" || /minimo|mínimo|alvo/.test(p))) {
    next.target = target[1].replace(".", ",");
  }

  const name = text.match(/(?:chamar|nome(?:ar)?|titulo|título)\s+(?:de\s+|como\s+)?["“]?([^"”\n]{3,80})["”]?/i);
  if (name?.[1]) next.name = name[1].trim().slice(0, 80);

  if (/gerencia|gerência/.test(p) && /premio|prêmio|tamb[eé]m/.test(p)) {
    next.managerOn = true;
    if (money != null) next.managerPrize = moneyPrize(money);
  }

  return next;
}

export function missingChallengeLabels(errors: ChallengeFormErrors): string[] {
  const labels: string[] = [];
  if (errors.name) labels.push("nome");
  if (errors.storeId) labels.push("filial");
  if (errors.startsOn || errors.endsOn) labels.push("período");
  if (errors.products) labels.push("produtos");
  if (errors.categories) labels.push("categorias");
  if (errors.lines) labels.push("agregações");
  if (errors.target) labels.push("mínimo/alvo");
  if (errors.minSales) labels.push("vendas mínimas");
  if (errors.prizes) labels.push("prêmio");
  if (errors.managerPrize || errors.managerTarget) labels.push("prêmio/alvo da gerência");
  if (errors.cashierPrize || errors.cashierTarget) labels.push("prêmio/alvo do caixa");
  return labels;
}

export function ensureChallengeName(form: ChallengeForm): ChallengeForm {
  if (form.name.trim()) return form;
  const scopeBit =
    form.scope === "PRODUCTS" && form.products[0]
      ? form.products[0].name
      : form.scope === "CATEGORIES" && form.categories[0]
        ? form.categories[0].name
        : CHALLENGE_METRIC_LABEL[form.metric];
  return { ...form, name: `Desafio ${scopeBit}`.slice(0, 80) };
}

export function formatChallengeProposal(form: ChallengeForm, storeName: string): string {
  const ready = Object.keys(validateChallengeForm(form)).length === 0;
  const period =
    form.startsOn && form.endsOn
      ? `${dateToIso(form.startsOn).slice(8, 10)}/${dateToIso(form.startsOn).slice(5, 7)} a ${dateToIso(form.endsOn).slice(8, 10)}/${dateToIso(form.endsOn).slice(5, 7)}`
      : "a definir";
  const prize = form.prizes[0]
    ? form.prizes[0].kind === "MONEY"
      ? brlCent(Number(form.prizes[0].amount.replace(/\./g, "").replace(",", ".")) || 0)
      : form.prizes[0].label
    : "a definir";
  const scopeExtra =
    form.scope === "PRODUCTS" && form.products.length
      ? ` (${form.products.map((p) => p.name).slice(0, 3).join(", ")}${form.products.length > 3 ? "…" : ""})`
      : form.scope === "CATEGORIES" && form.categories.length
        ? ` (${form.categories.map((c) => c.name).slice(0, 3).join(", ")})`
        : "";
  const missing = missingChallengeLabels(validateChallengeForm(form));
  const base =
    `Rascunho: ${form.name || "(sem nome)"} · ${storeName || "filial?"} · ${period} · ` +
    `${CHALLENGE_MODE_LABEL[form.mode]} · ${CHALLENGE_METRIC_LABEL[form.metric]} · ` +
    `${CHALLENGE_SCOPE_LABEL[form.scope]}${scopeExtra}` +
    (form.target ? ` · alvo ${form.target}` : "") +
    ` · prêmio ${prize}.`;
  if (ready) {
    return `${base} Está fechado para mim — diga Autorizo ou toque em Autorizar para eu criar.`;
  }
  return `${base} Ainda falta: ${missing.join(", ")}. Pode falar os detalhes que eu atualizo o rascunho.`;
}

async function seedStalledProducts(
  ctx: JarvisContext,
  storeId: string,
): Promise<ChallengeProduct[]> {
  const storeIds = storeId ? [storeId] : ctx.stores.map((s) => s.id);
  const to = ctx.today;
  const from = shiftIso(to, -29);
  const [stockPack, catalog, sold] = await Promise.all([
    fetchStoreStock(ctx.tenantId, storeIds),
    fetchStockCatalog(),
    fetchSalesProductPeriodAggs({ tenantId: ctx.tenantId, storeIds, from, to }),
  ]);
  const stalled = pickStalledProducts({
    stock: stockPack.rows,
    catalog,
    sold: sold.map((r) => ({
      storeId: r.storeId,
      productCode: r.productCode,
      itemCount: r.itemCount,
      brand: r.brand,
    })),
    storeIds,
    limit: 5,
  });
  return stalled.map((s) => ({ code: s.code, name: s.name }));
}

function matchProductsFromCatalog(text: string, catalog: ChallengeCatalog | null): ChallengeProduct[] {
  if (!catalog) return [];
  const p = norm(text);
  const hits: ChallengeProduct[] = [];
  for (const prod of catalog.products) {
    const code = norm(prod.code);
    const name = norm(prod.name);
    if ((code.length >= 3 && p.includes(code)) || (name.length >= 4 && p.includes(name))) {
      hits.push({ code: prod.code, name: prod.name });
      if (hits.length >= 8) break;
    }
  }
  return hits;
}

function matchCategoriesFromCatalog(text: string, catalog: ChallengeCatalog | null) {
  if (!catalog) return [];
  const p = norm(text);
  return catalog.categories
    .filter((c) => {
      const n = norm(c.name);
      return n.length >= 4 && p.includes(n);
    })
    .slice(0, 5)
    .map((c) => ({ typeId: c.typeId, name: c.name }));
}

/**
 * Um turno de discussão de desafio: atualiza o rascunho e devolve a fala do JARVIS.
 */
export async function discussChallenge(
  question: string,
  ctx: JarvisContext,
  prev: ChallengeDraft | null,
): Promise<{ reply: string; draft: ChallengeDraft }> {
  const catalog = prev?.catalog ?? (await fetchChallengeCatalog().catch(() => null));
  let form = prev?.form ?? emptyChallengeForm(ctx.stores.length === 1 ? ctx.stores[0]!.id : "");
  form = mergeChallengeUtterance(form, question, ctx);

  const p = norm(question);
  if (/parado|encalhe|estoque/.test(p) && form.products.length === 0) {
    const seeded = await seedStalledProducts(ctx, form.storeId).catch(() => []);
    if (seeded.length > 0) {
      form = { ...form, metric: form.metric || "QUANTITY", scope: "PRODUCTS", products: seeded };
    }
  }

  const namedProducts = matchProductsFromCatalog(question, catalog);
  if (namedProducts.length > 0) {
    const codes = new Set(form.products.map((x) => x.code));
    form = {
      ...form,
      scope: "PRODUCTS",
      products: [...form.products, ...namedProducts.filter((x) => !codes.has(x.code))],
    };
  }

  const cats = matchCategoriesFromCatalog(question, catalog);
  if (cats.length > 0) {
    form = { ...form, scope: "CATEGORIES", categories: cats };
  }

  form = ensureChallengeName(form);
  const storeName = ctx.stores.find((s) => s.id === form.storeId)?.tradeName ?? "";
  const draft: ChallengeDraft = { form, catalog };
  return { reply: formatChallengeProposal(form, storeName), draft };
}

export function challengeDraftReady(form: ChallengeForm): boolean {
  return Object.keys(validateChallengeForm(form)).length === 0;
}
