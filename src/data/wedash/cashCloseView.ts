import type { WithdrawalLine } from "./employeeWithdrawal";
import { onlinePixTotal, type OnlinePixLine } from "./onlinePix";

export type CashCloseBucket = "cash" | "credit" | "debit" | "pix" | "other";

export type CashCloseMillLine = {
  paymentMethod: string;
  openingCents: number;
  cashDropCents: number | null;
  closingCents: number;
  typedCents: number;
};

export type CashCloseLine = {
  key: CashCloseBucket;
  label: string;
  systemCents: number;
  typedCents: number;
  /** null = o arquivo da adquirente deste dia ainda não chegou. */
  stoneCents: number | null;
  /** PIX online do extrato, somado à adquirente. */
  manualPixCents?: number;
  /** Retirada de funcionário lançada em dinheiro, somada ao valor digitado. */
  withdrawalCents?: number;
  openingCents: number | null;
  cashDropCents: number | null;
};

const ORDER: CashCloseBucket[] = ["cash", "debit", "credit", "pix", "other"];

const LABEL: Record<CashCloseBucket, string> = {
  cash: "Dinheiro",
  debit: "Cartão de débito",
  credit: "Cartão de crédito",
  pix: "Pix",
  other: "Outros",
};

export function cashCloseBucket(method: string): CashCloseBucket {
  const s = method
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();
  if (s.includes("DINHEIRO")) return "cash";
  if (s.includes("PIX")) return "pix";
  if (s.includes("CREDITO")) return "credit";
  if (s.includes("DEBITO")) return "debit";
  return "other";
}

/** Stone: 2 e 4 são crédito (4 = pré-pago). 1 e 3 são débito (3 = pré-pago). */
export function captureBucket(accountType: number | null | undefined, paymentMethod: string): CashCloseBucket {
  if (accountType === 2 || accountType === 4) return "credit";
  if (accountType === 1 || accountType === 3) return "debit";
  return cashCloseBucket(paymentMethod);
}

export type CloseChip = {
  key: string;
  label: string;
  tone: "bad" | "ok" | "warn";
};

const CHIP_LABEL: Record<CashCloseBucket, string> = {
  cash: "Dinheiro",
  debit: "Débito",
  credit: "Crédito",
  pix: "Pix",
  other: "Outros",
};

function signedMoney(cents: number): string {
  const abs = (Math.abs(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return cents < 0 ? `−${abs}` : `+${abs}`;
}

export type CloseAmountMap = Partial<Record<CashCloseBucket, number>>;

export type CashReview = {
  cashTypedCents: number | null;
  waive: boolean;
  typedCents?: CloseAmountMap;
  acquirerCents?: CloseAmountMap;
  onlinePix?: OnlinePixLine[];
  withdrawals?: WithdrawalLine[];
};

/** Troca o dinheiro digitado pelo valor que o gestor gravou. */
export function applyCashReview<T extends { millennium: CashCloseMillLine[] }>(snap: T, review: CashReview | null): T {
  if (!review || review.cashTypedCents == null) return snap;
  return {
    ...snap,
    millennium: snap.millennium.map((row) =>
      cashCloseBucket(row.paymentMethod) === "cash" ? { ...row, typedCents: review.cashTypedCents! } : row,
    ),
  };
}

function typedOverride(review: CashReview, key: CashCloseBucket): number | null {
  const fromMap = review.typedCents?.[key];
  if (fromMap != null) return fromMap;
  if (key === "cash" && review.cashTypedCents != null) return review.cashTypedCents;
  return null;
}

/** Coloca o PIX online na linha do Pix. Sem linha, cria uma com a adquirente informada. */
export function withOnlinePix(lines: CashCloseLine[], cents: number, stoneCentsWhenNew: number | null = null): CashCloseLine[] {
  const pix = lines.find((line) => line.key === "pix");
  if (!pix) {
    if (cents <= 0) return lines;
    const created: CashCloseLine = {
      key: "pix",
      label: LABEL.pix,
      systemCents: 0,
      typedCents: 0,
      stoneCents: stoneCentsWhenNew,
      manualPixCents: cents,
      openingCents: null,
      cashDropCents: null,
    };
    const all = [...lines, created];
    return ORDER.filter((key) => all.some((line) => line.key === key)).map((key) => all.find((line) => line.key === key)!);
  }
  if ((pix.manualPixCents ?? 0) === cents) return lines;
  return lines.map((line) => (line.key === "pix" ? { ...line, manualPixCents: cents } : line));
}

/** Coloca a retirada de funcionário na linha do dinheiro. Sem linha, cria uma. */
export function withCashWithdrawal(lines: CashCloseLine[], cents: number): CashCloseLine[] {
  const cash = lines.find((line) => line.key === "cash");
  if (!cash) {
    if (cents <= 0) return lines;
    const created: CashCloseLine = {
      key: "cash",
      label: LABEL.cash,
      systemCents: 0,
      typedCents: 0,
      stoneCents: null,
      withdrawalCents: cents,
      openingCents: null,
      cashDropCents: null,
    };
    const all = [...lines, created];
    return ORDER.filter((key) => all.some((line) => line.key === key)).map((key) => all.find((line) => line.key === key)!);
  }
  if ((cash.withdrawalCents ?? 0) === cents) return lines;
  return lines.map((line) => (line.key === "cash" ? { ...line, withdrawalCents: cents } : line));
}

function blankLine(key: CashCloseBucket): CashCloseLine {
  return {
    key,
    label: LABEL[key],
    systemCents: 0,
    typedCents: 0,
    stoneCents: null,
    openingCents: null,
    cashDropCents: null,
  };
}

/** Aplica o ajuste na linha já somada. O total real gravado pelo gestor substitui o arquivo. O PIX online soma com ele. A retirada soma no dinheiro. Uma forma salva sem linha no Millennium entra do mesmo jeito. */
export function applyCloseReview(
  lines: CashCloseLine[],
  review: CashReview | null,
  _flags: { cardPending?: boolean; pixRequested?: boolean } = {},
): CashCloseLine[] {
  if (!review) return lines;
  const present = new Set(lines.map((line) => line.key));
  const saved: CashCloseLine[] = [];
  for (const key of ORDER) {
    if (present.has(key)) continue;
    const typed = typedOverride(review, key);
    const manual = review.acquirerCents?.[key];
    if (typed == null && manual == null) continue;
    saved.push(blankLine(key));
  }
  const mapped = [...lines, ...saved].map((line) => {
    const next = { ...line };
    const typed = typedOverride(review, line.key);
    if (typed != null) next.typedCents = typed;
    const manual = review.acquirerCents?.[line.key];
    if (manual != null) next.stoneCents = manual;
    return next;
  });
  const online = onlinePixTotal(review.onlinePix ?? []);
  const pix = mapped.find((line) => line.key === "pix");
  const withPix = withOnlinePix(mapped, online, pix ? null : (review.acquirerCents?.pix ?? null));
  const withdrawn = (review.withdrawals ?? []).reduce((sum, row) => sum + row.cents, 0);
  const withCash = withCashWithdrawal(withPix, withdrawn);
  return ORDER.filter((key) => withCash.some((line) => line.key === key)).map((key) => withCash.find((line) => line.key === key)!);
}

/** Barras do calendário: falta, sobra, arquivo a caminho, ou o dia fechado sem diferença. */
export function cashCloseChips(input: {
  millennium: CashCloseMillLine[];
  card: { creditCents: number; debitCents: number; otherCents: number } | null;
  pixCents: number | null;
  pixRequested: boolean;
  cardPending?: boolean;
  review?: CashReview | null;
}): CloseChip[] {
  const view = buildCashCloseView(input);
  const lines = applyCloseReview(view.lines, input.review ?? null, {
    cardPending: input.cardPending,
    pixRequested: input.pixRequested,
  });
  if (lines.length === 0 && !view.pixPending && !input.cardPending) return [];
  const chips: CloseChip[] = [];
  for (const line of lines) {
    const cashBox = (line.key === "cash" ? (realCentsOf(line) ?? line.typedCents) : line.typedCents) - line.systemCents;
    if (cashBox !== 0) {
      chips.push({
        key: `${line.key}-caixa`,
        label: `${CHIP_LABEL[line.key]} · ${signedMoney(cashBox)}`,
        tone: cashBox < 0 ? "bad" : "ok",
      });
    }
    const real = line.key === "cash" ? null : realCentsOf(line);
    if (real != null) {
      const gap = real - line.systemCents;
      if (gap !== 0) {
        chips.push({
          key: `${line.key}-stone`,
          label: `Total real · ${CHIP_LABEL[line.key]}: ${signedMoney(gap)}`,
          tone: gap < 0 ? "bad" : "ok",
        });
      }
    }
  }
  if (input.cardPending) chips.push({ key: "card-pending", label: "Aguardando cartão", tone: "warn" });
  if (view.pixPending) chips.push({ key: "pix-pending", label: "Aguardando Pix", tone: "warn" });
  if (chips.length === 0) chips.push({ key: "ok", label: "Fechado", tone: "ok" });
  const rank = { bad: 0, warn: 1, ok: 2 };
  const ordered = chips.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return ordered;
}

/** Dias com venda no fechamento do Millennium. Cartão = crédito ou débito. */
export function closeSaleDays(
  rows: Array<{ day: string; paymentMethod: string; closingCents: number }>,
): { any: Set<string>; card: Set<string>; pix: Set<string> } {
  const any = new Set<string>();
  const card = new Set<string>();
  const pix = new Set<string>();
  for (const row of rows) {
    if (row.closingCents <= 0) continue;
    const day = row.day.slice(0, 10);
    any.add(day);
    const bucket = cashCloseBucket(row.paymentMethod);
    if (bucket === "credit" || bucket === "debit") card.add(day);
    if (bucket === "pix") pix.add(day);
  }
  return { any, card, pix };
}

/** Soma o Pix pago. Cancelado fica de fora. O inteiro já está em centavos. */
export function paidPixCents(rows: Array<{ status: string; paidCents: number }>): number {
  let total = 0;
  for (const row of rows) {
    const status = row.status.toLowerCase();
    if (status === "canceled" || status === "cancelled") continue;
    total += row.paidCents;
  }
  return total;
}

/** Total real da forma. No dinheiro, o valor digitado mais a retirada de funcionário. No Pix, a adquirente mais o PIX online. Sem adquirente, não há total real. */
export function realCentsOf(line: CashCloseLine): number | null {
  if (line.key === "cash") return line.typedCents + (line.withdrawalCents ?? 0);
  if (line.stoneCents == null) return null;
  if (line.key !== "pix") return line.stoneCents;
  return line.stoneCents + (line.manualPixCents ?? 0);
}

/** Sobra ou quebra do dia: total real − Millennium. Forma sem total real não entra na diferença. */
export function closeDayGap(lines: CashCloseLine[]): {
  systemCents: number;
  comparedSystemCents: number;
  realCents: number;
  diffCents: number;
} {
  let systemCents = 0;
  let comparedSystemCents = 0;
  let realCents = 0;
  let diffCents = 0;
  for (const line of lines) {
    systemCents += line.systemCents;
    const real = realCentsOf(line);
    if (real == null) continue;
    comparedSystemCents += line.systemCents;
    realCents += real;
    diffCents += real - line.systemCents;
  }
  return { systemCents, comparedSystemCents, realCents, diffCents };
}

export function closeDayTotals(lines: CashCloseLine[]): { systemCents: number; typedCents: number; diffCents: number } {
  let systemCents = 0;
  let typedCents = 0;
  for (const line of lines) {
    systemCents += line.systemCents;
    typedCents += line.typedCents;
  }
  return { systemCents, typedCents, diffCents: typedCents - systemCents };
}

/** Forma com venda no Millennium e sem total real. O dinheiro usa o valor digitado. */
export function dayWithoutReal(lines: CashCloseLine[]): boolean {
  return lines.some((line) => line.key !== "cash" && line.systemCents > 0 && realCentsOf(line) == null);
}

/** Ainda falta o caixa do Millennium, ou o cartão/PIX da Stone não chegou. */
export function dayAwaitingClose(input: {
  hasMillennium: boolean;
  cardPending?: boolean;
  pixRequested: boolean;
  pixCents: number | null;
}): boolean {
  if (!input.hasMillennium) return true;
  return Boolean(input.cardPending) || (input.pixRequested && input.pixCents == null);
}

function chipEspera(key: string): boolean {
  return key === "card-pending" || key.endsWith("-card-pending") || key === "pix-pending" || key.endsWith("-pix-pending");
}

function chipClosed(key: string): boolean {
  return key === "ok" || key.endsWith("-ok");
}

/** Falta ou sobra que ainda aparece na célula. Arquivo a caminho e dia fechado não contam. */
export function chipsHaveGap(chips: CloseChip[]): boolean {
  return chips.some((chip) => chip.label !== "Falta assumida" && !chipEspera(chip.key) && !chipClosed(chip.key));
}

export type CloseDayFace = "empty" | "pending" | "difference" | "closed";

/** Diferença ganha da marca Pendente. Sem diferença, o dia a caminho fica Pendente. */
export function closeDayFace(input: { awaiting: boolean; hasLines: boolean; hasGap: boolean }): CloseDayFace {
  if (input.hasGap) return "difference";
  if (input.awaiting) return "pending";
  if (input.hasLines) return "closed";
  return "empty";
}

export type MonthCloseSummary = {
  /** Millennium e total real só dos dias que já têm total real. Pendente fica de fora dos dois. */
  systemCents: number;
  realCents: number;
  diffCents: number;
  surplusCents: number;
  shortageCents: number;
  surplusDays: number;
  shortageDays: number;
  pendingDays: number;
};

/** Diferença dos dias com total real, e dias sem total real. O mesmo dia em várias lojas conta uma vez. */
export function monthCloseSummary(
  rows: Array<{ day: string; systemCents: number; realCents: number; diffCents: number; pending: boolean }>,
): MonthCloseSummary {
  const byDay = new Map<string, { systemCents: number; realCents: number; diffCents: number; pending: boolean }>();
  for (const row of rows) {
    const cur = byDay.get(row.day) ?? { systemCents: 0, realCents: 0, diffCents: 0, pending: false };
    cur.systemCents += row.systemCents;
    cur.realCents += row.realCents;
    cur.diffCents += row.diffCents;
    cur.pending = cur.pending || row.pending;
    byDay.set(row.day, cur);
  }
  const out: MonthCloseSummary = {
    systemCents: 0,
    realCents: 0,
    diffCents: 0,
    surplusCents: 0,
    shortageCents: 0,
    surplusDays: 0,
    shortageDays: 0,
    pendingDays: 0,
  };
  for (const day of byDay.values()) {
    if (day.pending) {
      out.pendingDays += 1;
      continue;
    }
    out.systemCents += day.systemCents;
    out.realCents += day.realCents;
    out.diffCents += day.diffCents;
    if (day.diffCents > 0) {
      out.surplusCents += day.diffCents;
      out.surplusDays += 1;
    } else if (day.diffCents < 0) {
      out.shortageCents += Math.abs(day.diffCents);
      out.shortageDays += 1;
    }
  }
  return out;
}

/** Falta assumida pela loja deixa de aparecer como desconto no calendário. */
export function chipsAfterReview(chips: CloseChip[], review: CashReview | null): CloseChip[] {
  if (!review?.waive) return chips;
  return chips.map((chip) =>
    (chip.key === "cash-caixa" || chip.key.endsWith("-cash-caixa")) && chip.tone === "bad"
      ? { ...chip, label: "Falta assumida", tone: "ok" }
      : chip,
  );
}

export function buildCashCloseView(input: {
  millennium: CashCloseMillLine[];
  /** null = XML do cartão ainda não gravado. */
  card: { creditCents: number; debitCents: number; otherCents: number } | null;
  /** null = CSV do PIX ainda não gravado. */
  pixCents: number | null;
  pixRequested: boolean;
}): { lines: CashCloseLine[]; pixPending: boolean } {
  const acc = new Map<CashCloseBucket, CashCloseLine>();
  const touch = (key: CashCloseBucket): CashCloseLine => {
    const cur = acc.get(key);
    if (cur) return cur;
    const line: CashCloseLine = {
      key,
      label: LABEL[key],
      systemCents: 0,
      typedCents: 0,
      stoneCents: null,
      openingCents: null,
      cashDropCents: null,
    };
    acc.set(key, line);
    return line;
  };
  for (const row of input.millennium) {
    const key = cashCloseBucket(row.paymentMethod);
    const line = touch(key);
    line.systemCents += row.closingCents;
    line.typedCents += row.typedCents;
    if (key === "cash") {
      line.openingCents = row.openingCents;
      line.cashDropCents = row.cashDropCents;
    }
  }
  if (input.card) {
    touch("credit").stoneCents = input.card.creditCents;
    touch("debit").stoneCents = input.card.debitCents;
    if (input.card.otherCents !== 0) touch("other").stoneCents = input.card.otherCents;
  }
  if (input.pixCents != null) touch("pix").stoneCents = input.pixCents;
  // Outros sem captura da adquirente vale R$ 0,00 e entra na soma. Não segura o dia.
  const other = acc.get("other");
  if (other && other.stoneCents == null) other.stoneCents = 0;
  const lines = ORDER.filter((key) => acc.has(key)).map((key) => acc.get(key)!);
  return { lines, pixPending: input.pixRequested && input.pixCents == null };
}

/** "2026-10-09" e "2026-10-09T00:00:00" caem na mesma célula. */
export function closeDayKey(value: string): string {
  return value.slice(0, 10);
}

export type MonthMarkMillRow = {
  storeId: string;
  day: string;
  paymentMethod: string;
  openingCents: number;
  cashDropCents: number | null;
  closingCents: number;
  typedCents: number;
};

export type MonthMarkFileRow = { storeId: string; day: string; kind: string; status: string };

export type MonthMarkCaptureRow = {
  storeId: string;
  day: string;
  accountType: number | null;
  paymentMethod: string;
  capturedCents: number;
};

export type MonthMarkPixRow = { storeId: string; day: string; status: string; paidCents: number };

export type MonthCloseMark = {
  storeId: string;
  day: string;
  millennium: CashCloseMillLine[];
  card: { creditCents: number; debitCents: number; otherCents: number } | null;
  pixCents: number | null;
  pixRequested: boolean;
  cardPending: boolean;
};

/** Filial Cielo não mistura arquivo da Stone. As demais ficam na Stone. */
export function rowsForAcquirer<T extends { storeId: string }>(
  stone: T[],
  cielo: T[],
  cieloStoreIds: ReadonlySet<string>,
): T[] {
  if (cieloStoreIds.size === 0) return stone;
  return [
    ...stone.filter((row) => !cieloStoreIds.has(row.storeId)),
    ...cielo.filter((row) => cieloStoreIds.has(row.storeId)),
  ];
}

/** Um fechamento por loja e dia. Cartão e Pix recebidos entram mesmo quando a soma é zero. */
export function assembleMonthMarks(input: {
  millennium: MonthMarkMillRow[];
  files: MonthMarkFileRow[];
  captures: MonthMarkCaptureRow[];
  pix: MonthMarkPixRow[];
}): MonthCloseMark[] {
  const byKey = new Map<string, MonthCloseMark>();
  const slot = (storeId: string, dayRaw: string): MonthCloseMark => {
    const day = closeDayKey(dayRaw);
    const key = `${storeId}|${day}`;
    const cur = byKey.get(key);
    if (cur) return cur;
    const created: MonthCloseMark = {
      storeId,
      day,
      millennium: [],
      card: null,
      pixCents: null,
      pixRequested: false,
      cardPending: false,
    };
    byKey.set(key, created);
    return created;
  };
  for (const row of input.millennium) {
    slot(row.storeId, row.day).millennium.push({
      paymentMethod: row.paymentMethod,
      openingCents: row.openingCents,
      cashDropCents: row.cashDropCents,
      closingCents: row.closingCents,
      typedCents: row.typedCents,
    });
  }
  const pixReceived = new Set<string>();
  const cardReceived = new Set<string>();
  for (const row of input.files) {
    const mark = slot(row.storeId, row.day);
    const key = `${mark.storeId}|${mark.day}`;
    if (row.kind === "pix" && row.status === "requested") mark.pixRequested = true;
    if (row.kind === "pix" && row.status === "received") pixReceived.add(key);
    if (row.kind === "card" && row.status === "requested") mark.cardPending = true;
    if (row.kind === "card" && row.status === "received") cardReceived.add(key);
  }
  const pixRows = new Map<string, Array<{ status: string; paidCents: number }>>();
  for (const row of input.pix) {
    const mark = slot(row.storeId, row.day);
    const key = `${mark.storeId}|${mark.day}`;
    const list = pixRows.get(key) ?? [];
    list.push({ status: row.status, paidCents: row.paidCents });
    pixRows.set(key, list);
  }
  for (const key of pixReceived) {
    const [storeId, day] = key.split("|");
    if (!storeId || !day) continue;
    slot(storeId, day).pixCents = paidPixCents(pixRows.get(key) ?? []);
  }
  const cards = new Map<string, { creditCents: number; debitCents: number; otherCents: number }>();
  for (const row of input.captures) {
    const mark = slot(row.storeId, row.day);
    const key = `${mark.storeId}|${mark.day}`;
    const card = cards.get(key) ?? { creditCents: 0, debitCents: 0, otherCents: 0 };
    const bucket = captureBucket(row.accountType, row.paymentMethod);
    if (bucket === "credit") card.creditCents += row.capturedCents;
    else if (bucket === "debit") card.debitCents += row.capturedCents;
    else if (bucket !== "pix") card.otherCents += row.capturedCents;
    cards.set(key, card);
  }
  for (const [key, card] of cards) {
    const [storeId, day] = key.split("|");
    if (!storeId || !day) continue;
    slot(storeId, day).card = card;
  }
  for (const key of cardReceived) {
    const [storeId, day] = key.split("|");
    if (!storeId || !day || cards.has(key)) continue;
    slot(storeId, day).card = { creditCents: 0, debitCents: 0, otherCents: 0 };
  }
  return [...byKey.values()];
}
