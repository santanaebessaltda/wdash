import { brlCent, num, shortDate } from "@/lib/format";

const MONTH = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const BODY_LIMIT = 180;

export type PlanPiece = {
  kind: "goal" | "challenge";
  name: string;
  storeName: string;
  startsOn: string;
  endsOn: string;
  /** Meta da filial, já formatada. Só na meta. */
  targetLabel?: string;
};

export type LevelCut = { name: string; from: number; to: number };

export function isDraft(published: boolean | undefined): boolean {
  return published === false;
}

export function monthTitle(startsOn: string): string {
  const month = Number(startsOn.slice(5, 7));
  return MONTH[month - 1] ?? "Período";
}

function clip(body: string): string {
  if (body.length <= BODY_LIMIT) return body;
  return `${body.slice(0, BODY_LIMIT - 1).trimEnd()}…`;
}

function pieceLine(piece: PlanPiece): string {
  const when = `${shortDate(piece.startsOn)} a ${shortDate(piece.endsOn)}`;
  if (piece.kind === "goal") return `Meta ${piece.name} · ${piece.targetLabel ?? ""} · ${when}`.replace(" ·  · ", " · ");
  return `Desafio ${piece.name} · ${when}`;
}

/** Aviso único ao publicar uma ou várias peças do mesmo período. */
export function publishNotice(pieces: PlanPiece[]): { title: string; body: string; url: string } | null {
  if (pieces.length === 0) return null;
  const only = pieces[0]!;
  if (pieces.length === 1) {
    return {
      title: only.kind === "goal" ? "Nova meta" : "Novo desafio",
      body: clip(`${only.storeName} · ${pieceLine(only)}`),
      url: only.kind === "goal" ? "/performance/goals" : "/performance/challenges",
    };
  }
  const months = new Set(pieces.map((piece) => piece.startsOn.slice(0, 7)));
  const title = months.size === 1 ? `${monthTitle(only.startsOn)} está no ar` : "Metas e desafios no ar";
  let body = only.storeName;
  let shown = 0;
  for (const piece of pieces) {
    const next = `${body}\n${pieceLine(piece)}`;
    if (next.length > BODY_LIMIT && shown > 0) break;
    body = next;
    shown += 1;
  }
  const rest = pieces.length - shown;
  if (rest > 0) body += `\ne mais ${rest}`;
  return { title, body: clip(body), url: "/performance/goals" };
}

/** Aviso quando o valor ou o percentual dos níveis de uma meta publicada muda. */
export function goalChangeNotice(args: {
  storeName: string;
  name: string;
  targetFrom: number | null;
  targetTo: number | null;
  levels: LevelCut[];
  /** A quantidade de níveis mudou. O aviso não tenta parear corte por corte. */
  levelsReshaped?: boolean;
}): { title: string; body: string; url: string } | null {
  const lines: string[] = [];
  if (args.targetFrom != null && args.targetTo != null && args.targetFrom !== args.targetTo) {
    lines.push(`Valor de ${brlCent(args.targetFrom)} para ${brlCent(args.targetTo)}`);
  }
  if (args.levelsReshaped) lines.push("Os percentuais dos níveis mudaram");
  for (const level of args.levels) {
    lines.push(`${level.name} de ${num(level.from, 0)}% para ${num(level.to, 0)}%`);
  }
  if (lines.length === 0) return null;
  return {
    title: "Meta alterada",
    body: clip([`${args.storeName} · ${args.name}`, ...lines].join("\n")),
    url: "/performance/goals",
  };
}

/** Cortes cujo percentual mudou, na mesma posição. `reshaped` = entrou ou saiu nível. */
export function levelCuts(
  before: { name: string; minAttainmentPct: number }[],
  after: { name: string; minAttainmentPct: number }[],
): { cuts: LevelCut[]; reshaped: boolean } {
  if (before.length !== after.length) return { cuts: [], reshaped: before.length !== 0 || after.length !== 0 };
  const cuts: LevelCut[] = [];
  for (let i = 0; i < before.length; i++) {
    const from = before[i]!;
    const to = after[i]!;
    if (from.minAttainmentPct !== to.minAttainmentPct) cuts.push({ name: to.name || from.name, from: from.minAttainmentPct, to: to.minAttainmentPct });
  }
  return { cuts, reshaped: false };
}

export function challengeChangeNotice(args: {
  storeName: string;
  name: string;
  /** Texto já formatado do mínimo. Null = sem mínimo. */
  targetFrom: string | null;
  targetTo: string | null;
}): { title: string; body: string; url: string } | null {
  if (args.targetFrom === args.targetTo) return null;
  return {
    title: "Desafio alterado",
    body: clip(`${args.storeName} · ${args.name}\nMínimo de ${args.targetFrom ?? "sem mínimo"} para ${args.targetTo ?? "sem mínimo"}`),
    url: "/performance/challenges",
  };
}

/** Publica os rascunhos do período e manda um aviso por filial. */
export async function publishDraftsInWindow(args: {
  tenantId: string;
  storeIds: string[];
  from: string;
  to: string;
  storeName: (storeId: string) => string;
}): Promise<{ ok: true; count: number } | { ok: false }> {
  if (args.storeIds.length === 0) return { ok: true, count: 0 };
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: true, count: 0 };
  const now = new Date().toISOString();
  const [goals, challenges] = await Promise.all([
    sb.from("goal").select("id, store_id, name, starts_on, ends_on, target_cents").eq("tenant_id", args.tenantId).in("store_id", args.storeIds).lte("starts_on", args.to).gte("ends_on", args.from).is("published_at", null),
    sb.from("challenge").select("id, store_id, name, starts_on, ends_on").eq("tenant_id", args.tenantId).in("store_id", args.storeIds).lte("starts_on", args.to).gte("ends_on", args.from).is("published_at", null),
  ]);
  if (goals.error || challenges.error) {
    console.warn("publishDrafts:", goals.error?.message ?? challenges.error?.message);
    return { ok: false };
  }
  const goalRows = (goals.data ?? []) as { id: string; store_id: string; name: string; starts_on: string; ends_on: string; target_cents: number }[];
  const challengeRows = (challenges.data ?? []) as { id: string; store_id: string; name: string; starts_on: string; ends_on: string }[];
  if (goalRows.length + challengeRows.length === 0) return { ok: true, count: 0 };
  if (goalRows.length > 0) {
    const saved = await sb.from("goal").update({ published_at: now, updated_at: now }).in("id", goalRows.map((row) => row.id)).is("published_at", null);
    if (saved.error) return { ok: false };
  }
  if (challengeRows.length > 0) {
    const saved = await sb.from("challenge").update({ published_at: now, updated_at: now }).in("id", challengeRows.map((row) => row.id)).is("published_at", null);
    if (saved.error) return { ok: false };
  }
  const byStore = new Map<string, PlanPiece[]>();
  for (const row of goalRows) {
    const list = byStore.get(row.store_id) ?? [];
    list.push({ kind: "goal", name: row.name, storeName: args.storeName(row.store_id), startsOn: row.starts_on, endsOn: row.ends_on, targetLabel: brlCent(Number(row.target_cents) / 100) });
    byStore.set(row.store_id, list);
  }
  for (const row of challengeRows) {
    const list = byStore.get(row.store_id) ?? [];
    list.push({ kind: "challenge", name: row.name, storeName: args.storeName(row.store_id), startsOn: row.starts_on, endsOn: row.ends_on });
    byStore.set(row.store_id, list);
  }
  for (const [storeId, pieces] of byStore) await enqueuePlanNotice(args.tenantId, storeId, publishNotice(pieces));
  return { ok: true, count: goalRows.length + challengeRows.length };
}

export async function enqueuePlanNotice(
  tenantId: string,
  storeId: string,
  notice: { title: string; body: string; url: string } | null,
): Promise<void> {
  if (!notice) return;
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return;
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb.from("push_outbox").insert({
    tenant_id: tenantId,
    store_id: storeId,
    title: notice.title,
    body: notice.body,
    url: notice.url,
    exclude_auth_user_id: auth.user?.id ?? null,
  });
  if (error) console.warn("push_outbox:", error.message);
}
