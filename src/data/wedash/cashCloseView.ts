export type CashCloseBucket = "cash" | "credit" | "debit" | "pix" | "other";

export type CashCloseMillLine = {
  paymentMethod: string;
  openingCents: number;
  sangriaCents: number | null;
  closingCents: number;
  typedCents: number;
};

export type CashCloseLine = {
  key: CashCloseBucket;
  label: string;
  systemCents: number;
  typedCents: number;
  /** null = o arquivo da Stone deste dia ainda não chegou. */
  stoneCents: number | null;
  openingCents: number | null;
  sangriaCents: number | null;
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

/** Aplica o ajuste na linha já somada. O total real gravado pelo gestor substitui o arquivo. */
export function applyCloseReview(
  lines: CashCloseLine[],
  review: CashReview | null,
  _flags: { cardPending?: boolean; pixRequested?: boolean } = {},
): CashCloseLine[] {
  if (!review) return lines;
  return lines.map((line) => {
    const next = { ...line };
    const typed = typedOverride(review, line.key);
    if (typed != null) next.typedCents = typed;
    const manual = review.acquirerCents?.[line.key];
    if (manual != null) next.stoneCents = manual;
    return next;
  });
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
    const caixa = line.typedCents - line.systemCents;
    if (caixa !== 0) {
      chips.push({
        key: `${line.key}-caixa`,
        label: `${CHIP_LABEL[line.key]} · ${signedMoney(caixa)}`,
        tone: caixa < 0 ? "bad" : "ok",
      });
    }
    if (line.stoneCents != null) {
      const stone = line.stoneCents - line.systemCents;
      if (stone !== 0) {
        chips.push({
          key: `${line.key}-stone`,
          label: `Total real · ${CHIP_LABEL[line.key]}: ${signedMoney(stone)}`,
          tone: stone < 0 ? "bad" : "ok",
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

/** Total real da forma. No dinheiro, é o valor digitado. Sem arquivo, não há total real. */
export function realCentsOf(line: CashCloseLine): number | null {
  if (line.key === "cash") return line.typedCents;
  return line.stoneCents;
}

/** Sobra ou quebra do dia: total real − Millennium. Sem total real, a forma conta como zero. */
export function closeDayGap(lines: CashCloseLine[]): {
  systemCents: number;
  comparedSystemCents: number;
  realCents: number;
  diffCents: number;
} {
  let systemCents = 0;
  let realCents = 0;
  let diffCents = 0;
  for (const line of lines) {
    systemCents += line.systemCents;
    const real = realCentsOf(line) ?? 0;
    realCents += real;
    diffCents += real - line.systemCents;
  }
  return { systemCents, comparedSystemCents: systemCents, realCents, diffCents };
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

function chipFechado(key: string): boolean {
  return key === "ok" || key.endsWith("-ok");
}

/** Falta ou sobra que ainda aparece na célula. Arquivo a caminho e dia fechado não contam. */
export function chipsHaveGap(chips: CloseChip[]): boolean {
  return chips.some((chip) => chip.label !== "Falta assumida" && !chipEspera(chip.key) && !chipFechado(chip.key));
}

export type CloseDayFace = "vazio" | "pendente" | "diferenca" | "fechado";

/** Diferença ganha da marca Pendente. Sem diferença, o dia a caminho fica Pendente. */
export function closeDayFace(input: { awaiting: boolean; hasLines: boolean; hasGap: boolean }): CloseDayFace {
  if (input.hasGap) return "diferenca";
  if (input.awaiting) return "pendente";
  if (input.hasLines) return "fechado";
  return "vazio";
}

/** Diferença dos dias com total real, e dias sem total real. O mesmo dia em várias lojas conta uma vez. */
export function monthCloseSummary(
  rows: Array<{ day: string; diffCents: number; pending: boolean }>,
): { diffCents: number; pendingDays: number } {
  let diffCents = 0;
  const pending = new Set<string>();
  for (const row of rows) {
    if (row.pending) pending.add(row.day);
    else diffCents += row.diffCents;
  }
  return { diffCents, pendingDays: pending.size };
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
      sangriaCents: null,
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
      line.sangriaCents = row.sangriaCents;
    }
  }
  if (input.card) {
    touch("credit").stoneCents = input.card.creditCents;
    touch("debit").stoneCents = input.card.debitCents;
    if (input.card.otherCents !== 0) touch("other").stoneCents = input.card.otherCents;
  }
  if (input.pixCents != null) touch("pix").stoneCents = input.pixCents;
  const lines = ORDER.filter((key) => acc.has(key)).map((key) => acc.get(key)!);
  return { lines, pixPending: input.pixRequested && input.pixCents == null };
}
