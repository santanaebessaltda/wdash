export type WithdrawalLine = {
  sellerId: string;
  cents: number;
};

export type WithdrawalDraftRow = {
  id: string;
  sellerId: string;
  amount: string;
};

export type WithdrawalDraft = {
  enabled: boolean;
  rows: WithdrawalDraftRow[];
};

export type WithdrawalPerson = {
  id: string;
  name: string;
  active: boolean;
};

/** Quebra do dia (total real − Millennium). Zero quando o dia não falta. */
export function dayShortageCents(diffCents: number): number {
  return diffCents < 0 ? -diffCents : 0;
}

/** A retirada abate a quebra. O que passa dela fica como sobra. */
export function netCloseDiff(diffCents: number, withdrawalCents: number): number {
  if (withdrawalCents <= 0 || diffCents >= 0) return diffCents;
  return diffCents + withdrawalCents;
}

const personKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");

export type MergedWithdrawalPeople = {
  people: WithdrawalPerson[];
  names: Map<string, string>;
  canonicalId: (id: string) => string;
};

/**
 * Junta os ativos de todas as filiais com gestores e gerentes.
 * O mesmo nome entra uma vez: vale o id já gravado, senão o da loja do fechamento.
 */
export function mergeWithdrawalPeople(
  byStore: { storeId: string; people: WithdrawalPerson[] }[],
  savedIds: string[],
  preferStoreId: string,
): MergedWithdrawalPeople {
  const saved = new Set(savedIds.filter((id) => id.trim().length > 0));
  const groups = new Map<string, { storeId: string; person: WithdrawalPerson }[]>();
  const known = new Set<string>();
  for (const store of byStore) {
    for (const person of store.people) {
      if (!person.id || known.has(person.id)) continue;
      if (!person.active && !saved.has(person.id)) continue;
      known.add(person.id);
      const key = personKey(person.name);
      const list = groups.get(key) ?? [];
      list.push({ storeId: store.storeId, person });
      groups.set(key, list);
    }
  }

  const canonical = new Map<string, string>();
  const names = new Map<string, string>();
  const people: WithdrawalPerson[] = [];
  for (const group of groups.values()) {
    const chosen =
      group.find((row) => saved.has(row.person.id)) ??
      group.find((row) => row.storeId === preferStoreId && row.person.active) ??
      group.find((row) => row.storeId === preferStoreId) ??
      group.find((row) => row.person.active) ??
      group[0];
    if (!chosen) continue;
    people.push({
      id: chosen.person.id,
      name: chosen.person.name,
      active: group.some((row) => row.person.active),
    });
    for (const row of group) {
      canonical.set(row.person.id, chosen.person.id);
      names.set(row.person.id, chosen.person.name);
    }
  }
  for (const id of saved) {
    if (known.has(id)) continue;
    known.add(id);
    const name = "Funcionário fora do cadastro";
    people.push({ id, name, active: false });
    canonical.set(id, id);
    names.set(id, name);
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    people,
    names,
    canonicalId: (id) => canonical.get(id) ?? id,
  };
}

/** Ativos da loja, mais quem já tem retirada gravada mesmo tendo saído. */
export function withdrawalPeople(sellers: WithdrawalPerson[], savedIds: string[]): WithdrawalPerson[] {
  const saved = new Set(savedIds.filter((id) => id.trim().length > 0));
  const seen = new Set<string>();
  const rows: WithdrawalPerson[] = [];
  for (const seller of sellers) {
    if (!seller.active && !saved.has(seller.id)) continue;
    if (seen.has(seller.id)) continue;
    seen.add(seller.id);
    rows.push(seller);
  }
  for (const id of saved) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: "Funcionário fora do cadastro", active: false });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function parseWithdrawalRows(value: unknown): WithdrawalLine[] {
  if (!Array.isArray(value)) return [];
  const out: WithdrawalLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const sellerId = String((item as { sellerId?: unknown }).sellerId ?? "").trim();
    const cents = (item as { cents?: unknown }).cents;
    if (!sellerId || typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) continue;
    out.push({ sellerId, cents: Math.round(cents) });
  }
  return out;
}

export function withdrawalDraftFrom(lines: WithdrawalLine[], formatCents: (cents: number) => string): WithdrawalDraft {
  if (lines.length === 0) return { enabled: false, rows: [] };
  return {
    enabled: true,
    rows: lines.map((line) => ({
      id: line.sellerId,
      sellerId: line.sellerId,
      amount: formatCents(line.cents),
    })),
  };
}

export function blankWithdrawalRow(): WithdrawalDraftRow {
  return { id: crypto.randomUUID(), sellerId: "", amount: "" };
}

export function withdrawalPreview(shortageCents: number, cents: number[]): {
  withdrawalCents: number;
  breakCents: number;
  surplusCents: number;
} {
  const withdrawalCents = cents.reduce((sum, value) => sum + value, 0);
  return {
    withdrawalCents,
    breakCents: Math.max(0, shortageCents - withdrawalCents),
    surplusCents: shortageCents > 0 ? Math.max(0, withdrawalCents - shortageCents) : 0,
  };
}

export function withdrawalSave(input: {
  shortageCents: number;
  enabled: boolean;
  rows: WithdrawalDraftRow[];
  parseCents: (raw: string) => number | null;
  names: Map<string, string>;
}): { ok: true; lines: WithdrawalLine[] } | { ok: false; message: string } {
  if (!input.enabled) return { ok: true, lines: [] };
  const filled = input.rows.filter((row) => row.sellerId.trim() !== "" || row.amount.trim() !== "");
  const lines: WithdrawalLine[] = [];
  const seen = new Set<string>();
  for (const row of filled) {
    const sellerId = row.sellerId.trim();
    if (!sellerId) return { ok: false, message: "Escolha o funcionário da retirada." };
    const name = input.names.get(sellerId) ?? "esse funcionário";
    if (seen.has(sellerId)) return { ok: false, message: `${name} está em mais de uma retirada.` };
    seen.add(sellerId);
    const cents = input.parseCents(row.amount);
    if (cents == null || cents <= 0) return { ok: false, message: `Informe o valor da retirada de ${name}.` };
    lines.push({ sellerId, cents: Math.round(cents) });
  }
  return { ok: true, lines };
}
