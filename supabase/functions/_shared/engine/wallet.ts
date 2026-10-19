/** Carteira do mês: premiação, bônus, desafio, retirada e quebra. Valores em centavos. */

export type WalletLineKind = "prize" | "bonus" | "management" | "managementBonus" | "challenge" | "withdrawal" | "shortage";

export type WalletLine = {
  kind: WalletLineKind;
  /** Nome da meta ou do desafio. Vazio na retirada e na quebra. */
  title: string;
  day: string | null;
  cents: number;
  /** Meta ainda aberta ("até agora") ou desafio que ainda não fechou. */
  open: boolean;
  /** Prêmio que não entra no saldo, ou "Em andamento". */
  note: string | null;
};

export type WalletPersonMonth = {
  personId: string;
  name: string;
  prizeCents: number;
  bonusCents: number;
  /** Premiação e bônus da gerência já repartidos para esta pessoa. */
  managementCents: number;
  challengeCents: number;
  withdrawalCents: number;
  shortageCents: number;
  balanceCents: number;
  /** Alguma premiação ou bônus deste mês ainda pode mudar. */
  openPrize: boolean;
  lines: WalletLine[];
};

export type WalletMonth = {
  /** YYYY-MM */
  month: string;
  people: WalletPersonMonth[];
  /** Quebra do mês sem pessoa, grupo ou equipe. Só na visão da filial. */
  unassignedShortageCents: number;
  /** Dias dessa quebra, para abrir sob o aviso. */
  unassignedShortageDays: { day: string; cents: number }[];
};

export type WalletPersonInput = { id: string; name: string };

export type WalletGoalInput = {
  name: string;
  endsOn: string;
  open: boolean;
  people: {
    personId: string;
    prizeCents: number;
    bonusCents: number;
    managementPrizeCents?: number;
    managementBonusCents?: number;
  }[];
};

export type WalletChallengeInput = {
  name: string;
  endsOn: string;
  open: boolean;
  people: { personId: string; moneyCents: number; itemLabel: string | null; management?: boolean }[];
};

/** Divide centavos em partes iguais. O resto fica nas primeiras partes. */
export function splitEqualCents(total: number, count: number): number[] {
  const amount = Math.max(0, Math.round(total));
  if (count <= 0) return [];
  if (amount <= 0) return Array.from({ length: count }, () => 0);
  const base = Math.floor(amount / count);
  const extra = amount % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

export type WalletCashDay = {
  day: string;
  withdrawals: { personId: string; cents: number }[];
  shortage: { personId: string; cents: number }[];
  unassignedShortageCents: number;
};

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function cents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

type Bucket = {
  personId: string;
  name: string;
  prizeCents: number;
  bonusCents: number;
  managementCents: number;
  challengeCents: number;
  withdrawalCents: number;
  shortageCents: number;
  openPrize: boolean;
  lines: WalletLine[];
};

/**
 * Monta o mês. Meta e desafio entram no mês em que terminam.
 * Meta aberta conta o que já está garantido. Desafio aberto aparece e fica fora do saldo.
 * Prêmio que não é dinheiro fica na linha e fora do saldo.
 */
export function buildWalletMonth(input: {
  month: string;
  people: WalletPersonInput[];
  goals: WalletGoalInput[];
  challenges: WalletChallengeInput[];
  days: WalletCashDay[];
  /** Uma pessoa só. A quebra sem destino sai do resultado. */
  onlyPersonId?: string | null;
}): WalletMonth {
  const month = input.month.slice(0, 7);
  const names = new Map(input.people.map((person) => [person.id, person.name]));
  const buckets = new Map<string, Bucket>();

  const bucket = (personId: string): Bucket | null => {
    if (!personId) return null;
    if (input.onlyPersonId && personId !== input.onlyPersonId) return null;
    let row = buckets.get(personId);
    if (!row) {
      row = {
        personId,
        name: names.get(personId) ?? "Funcionário fora do cadastro",
        prizeCents: 0,
        bonusCents: 0,
        managementCents: 0,
        challengeCents: 0,
        withdrawalCents: 0,
        shortageCents: 0,
        openPrize: false,
        lines: [],
      };
      buckets.set(personId, row);
    }
    return row;
  };

  for (const goal of input.goals) {
    if (monthOf(goal.endsOn) !== month) continue;
    for (const person of goal.people) {
      const row = bucket(person.personId);
      if (!row) continue;
      const prize = cents(person.prizeCents);
      const bonus = cents(person.bonusCents);
      if (prize > 0 || goal.open) {
        row.prizeCents += prize;
        row.openPrize = row.openPrize || goal.open;
        row.lines.push({ kind: "prize", title: goal.name, day: goal.endsOn, cents: prize, open: goal.open, note: null });
      }
      if (bonus > 0) {
        row.bonusCents += bonus;
        row.openPrize = row.openPrize || goal.open;
        row.lines.push({ kind: "bonus", title: goal.name, day: goal.endsOn, cents: bonus, open: goal.open, note: null });
      }
      const managementPrize = cents(person.managementPrizeCents ?? 0);
      const managementBonus = cents(person.managementBonusCents ?? 0);
      if (managementPrize > 0) {
        row.managementCents += managementPrize;
        row.openPrize = row.openPrize || goal.open;
        row.lines.push({ kind: "management", title: goal.name, day: goal.endsOn, cents: managementPrize, open: goal.open, note: null });
      }
      if (managementBonus > 0) {
        row.managementCents += managementBonus;
        row.openPrize = row.openPrize || goal.open;
        row.lines.push({ kind: "managementBonus", title: goal.name, day: goal.endsOn, cents: managementBonus, open: goal.open, note: null });
      }
    }
  }

  for (const challenge of input.challenges) {
    if (monthOf(challenge.endsOn) !== month) continue;
    for (const person of challenge.people) {
      const row = bucket(person.personId);
      if (!row) continue;
      if (challenge.open) {
        if (!person.management) {
          row.lines.push({ kind: "challenge", title: challenge.name, day: challenge.endsOn, cents: 0, open: true, note: "Em andamento" });
        }
        continue;
      }
      if (person.management) {
        const share = cents(person.moneyCents);
        if (share <= 0) continue;
        row.managementCents += share;
        row.lines.push({ kind: "management", title: challenge.name, day: challenge.endsOn, cents: share, open: false, note: null });
        continue;
      }
      const item = person.itemLabel?.trim() ?? "";
      if (item) {
        row.lines.push({ kind: "challenge", title: challenge.name, day: challenge.endsOn, cents: 0, open: false, note: item });
        continue;
      }
      const money = cents(person.moneyCents);
      if (money <= 0) continue;
      row.challengeCents += money;
      row.lines.push({ kind: "challenge", title: challenge.name, day: challenge.endsOn, cents: money, open: false, note: null });
    }
  }

  let unassigned = 0;
  const unassignedDays: { day: string; cents: number }[] = [];
  for (const day of input.days) {
    if (monthOf(day.day) !== month) continue;
    for (const line of day.withdrawals) {
      const amount = cents(line.cents);
      if (amount <= 0) continue;
      const row = bucket(line.personId);
      if (!row) continue;
      row.withdrawalCents += amount;
      row.lines.push({ kind: "withdrawal", title: "", day: day.day, cents: amount, open: false, note: null });
    }
    for (const line of day.shortage) {
      const amount = cents(line.cents);
      if (amount <= 0) continue;
      const row = bucket(line.personId);
      if (!row) continue;
      row.shortageCents += amount;
      row.lines.push({ kind: "shortage", title: "", day: day.day, cents: amount, open: false, note: null });
    }
    const leftover = cents(day.unassignedShortageCents);
    if (!input.onlyPersonId && leftover > 0) {
      unassigned += leftover;
      unassignedDays.push({ day: day.day, cents: leftover });
    }
  }

  const people = [...buckets.values()]
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      prizeCents: row.prizeCents,
      bonusCents: row.bonusCents,
      managementCents: row.managementCents,
      challengeCents: row.challengeCents,
      withdrawalCents: row.withdrawalCents,
      shortageCents: row.shortageCents,
      balanceCents: row.prizeCents + row.bonusCents + row.managementCents + row.challengeCents - row.withdrawalCents - row.shortageCents,
      openPrize: row.openPrize,
      lines: row.lines,
    }))
    .filter((row) => row.lines.length > 0 || row.personId === input.onlyPersonId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.personId.localeCompare(b.personId));

  if (input.onlyPersonId && !people.some((row) => row.personId === input.onlyPersonId)) {
    people.push({
      personId: input.onlyPersonId,
      name: names.get(input.onlyPersonId) ?? "Funcionário fora do cadastro",
      prizeCents: 0,
      bonusCents: 0,
      managementCents: 0,
      challengeCents: 0,
      withdrawalCents: 0,
      shortageCents: 0,
      balanceCents: 0,
      openPrize: false,
      lines: [],
    });
  }

  return { month, people, unassignedShortageCents: unassigned, unassignedShortageDays: unassignedDays };
}

function recount(person: WalletPersonMonth, lines: WalletLine[]): WalletPersonMonth {
  let prizeCents = 0;
  let bonusCents = 0;
  let managementCents = 0;
  let challengeCents = 0;
  let withdrawalCents = 0;
  let shortageCents = 0;
  let openPrize = false;
  for (const line of lines) {
    if (line.kind === "prize") prizeCents += line.cents;
    else if (line.kind === "bonus") bonusCents += line.cents;
    else if (line.kind === "management" || line.kind === "managementBonus") managementCents += line.cents;
    else if (line.kind === "challenge") challengeCents += line.cents;
    else if (line.kind === "withdrawal") withdrawalCents += line.cents;
    else shortageCents += line.cents;
    if (line.open && line.kind !== "challenge") openPrize = true;
  }
  return {
    ...person,
    prizeCents,
    bonusCents,
    managementCents,
    challengeCents,
    withdrawalCents,
    shortageCents,
    balanceCents: prizeCents + bonusCents + managementCents + challengeCents - withdrawalCents - shortageCents,
    openPrize,
    lines,
  };
}

/** Junta os meses do intervalo e fica só com o que cai entre `from` e `to`. */
export function walletInRange(parts: WalletMonth[], from: string, to: string, keepPersonId?: string | null): WalletMonth {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const byId = new Map<string, WalletPersonMonth>();
  for (const part of parts) {
    for (const person of part.people) {
      const current = byId.get(person.personId);
      if (!current) {
        byId.set(person.personId, { ...person, lines: [...person.lines] });
        continue;
      }
      current.lines.push(...person.lines);
    }
  }
  const people = [...byId.values()]
    .map((person) => recount(person, person.lines.filter((line) => line.day != null && line.day >= start && line.day <= end)))
    .filter((person) => person.lines.length > 0 || person.personId === keepPersonId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.personId.localeCompare(b.personId));
  if (keepPersonId && !people.some((person) => person.personId === keepPersonId)) {
    const named = parts.flatMap((part) => part.people).find((person) => person.personId === keepPersonId);
    people.push(recount(
      {
        personId: keepPersonId,
        name: named?.name ?? "Funcionário fora do cadastro",
        prizeCents: 0,
        bonusCents: 0,
        managementCents: 0,
        challengeCents: 0,
        withdrawalCents: 0,
        shortageCents: 0,
        balanceCents: 0,
        openPrize: false,
        lines: [],
      },
      [],
    ));
  }
  const days = new Map<string, number>();
  for (const part of parts) {
    for (const day of part.unassignedShortageDays) {
      if (day.day < start || day.day > end) continue;
      days.set(day.day, (days.get(day.day) ?? 0) + day.cents);
    }
  }
  const unassignedShortageDays = [...days.entries()]
    .map(([day, cents]) => ({ day, cents }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return {
    month: start.slice(0, 7),
    people,
    unassignedShortageCents: unassignedShortageDays.reduce((total, day) => total + day.cents, 0),
    unassignedShortageDays,
  };
}
