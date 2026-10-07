import { weekHoursConfigured } from "./storeHours";
import { fetchStoreSellers, isActiveSalesPerson, type Store, type StoreSeller } from "./stores";

/** Primeiros passos (Visao geral, so Gestor): configuracoes que deixam custos, margens, metas e premiacao corretos. */
export type FirstStepId = "erp" | "sellers" | "hours" | "groups" | "franchise" | "rent" | "taxes" | "goal" | "challenge";

export interface FirstStep {
  id: FirstStepId;
  title: string;
  description: string;
  done: boolean;
  /** O que falta, quando ajuda a agir ("Falta em 2 de 4 lojas", "3 vendedores sem grupo"). */
  detail?: string;
  /** Grupos: loja com equipe e sem nenhum grupo  ->  criar grupos; senao  ->  vincular vendedores. */
  needsGroups?: boolean;
}

export type FirstStepsStore = Pick<Store, "id" | "temWpink" | "pointType" | "horas" | "custos">;

export interface FirstStepsInput {
  stores: FirstStepsStore[];
  sellersByStore: Map<string, Pick<StoreSeller, "active" | "role" | "shiftId">[]>;
  shiftIdsByStore: Map<string, string[]>;
  storesWithGoal: Set<string>;
  storesWithChallenge: Set<string>;
}

/**
 * "Todas as lojas" avalia a rede. Uma loja no StorePicker mostra so o que falta nela
 * (o card so some de vez quando todas as lojas da sessao estao prontas).
 */
export function storesForFirstStepsView<T extends { id: string }>(stores: T[], filialIds: string[]): T[] {
  if (filialIds.length !== 1) return stores;
  const one = stores.filter((s) => s.id === filialIds[0]);
  return one.length === 1 ? one : stores;
}

function lojasFaltando(faltam: number, total: number): string | undefined {
  if (faltam === 0 || total <= 1) return undefined;
  return `Falta em ${faltam} de ${total} lojas`;
}

function franchiseOk(s: FirstStepsStore): boolean {
  const c = s.custos;
  if (!c || c.royaltiesWepinkPct == null || c.marketingWepinkPct == null) return false;
  return !s.temWpink || (c.royaltiesWpinkPct != null && c.marketingWpinkPct != null);
}

/** Loja de rua so tem aluguel mensal; shopping pode ter so o percentual. */
function rentOk(s: FirstStepsStore): boolean {
  const c = s.custos;
  if (!c) return false;
  if (c.rentMin != null) return true;
  return s.pointType === "SHOPPING" && c.rentWepinkPct != null;
}

function taxesOk(s: FirstStepsStore): boolean {
  const c = s.custos;
  if (!c || c.icmsWepinkPct == null || c.icmsStWepinkPct == null) return false;
  return !s.temWpink || (c.icmsWpinkPct != null && c.icmsStWpinkPct != null);
}

export function buildFirstSteps(input: FirstStepsInput): FirstStep[] {
  const { stores } = input;
  const total = stores.length;
  const porLoja = (ok: (s: FirstStepsStore) => boolean) => {
    const faltam = stores.filter((s) => !ok(s)).length;
    return { done: faltam === 0, detail: lojasFaltando(faltam, total) };
  };

  // Grupos, meta e desafio so nas lojas com equipe de vendas (loja parada nao precisa).
  const equipe = (id: string) => (input.sellersByStore.get(id) ?? []).filter(isActiveSalesPerson);
  const comEquipe = stores.filter((s) => equipe(s.id).length > 0);
  const lojasPessoas = comEquipe.length > 0 ? comEquipe : stores;

  let semGrupo = 0;
  let lojaSemGrupos = false;
  for (const s of comEquipe) {
    const grupos = input.shiftIdsByStore.get(s.id) ?? [];
    if (grupos.length === 0) lojaSemGrupos = true;
    semGrupo += equipe(s.id).filter((p) => !p.shiftId || !grupos.includes(p.shiftId)).length;
  }

  const criados = (set: Set<string>) => {
    const faltam = lojasPessoas.filter((s) => !set.has(s.id)).length;
    return { done: faltam === 0, detail: lojasFaltando(faltam, lojasPessoas.length) };
  };

  return [
    {
      id: "erp",
      title: "Conectar o Millennium",
      description: "Sincroniza vendas, custos, lojas e vendedores com a WDash.",
      done: true,
    },
    {
      id: "sellers",
      title: "Sincronizar os vendedores",
      description: "Busca no Millennium a equipe de vendas de cada loja.",
      done: true,
    },
    {
      id: "hours",
      title: "Configurar o horário de funcionamento",
      description: "Define quando as vendas são atualizadas automaticamente e organiza as vendas por hora.",
      ...porLoja((s) => weekHoursConfigured(s.horas)),
    },
    {
      id: "groups",
      title: "Criar os grupos e vincular os vendedores",
      description: "Organize os vendedores de cada loja em grupos para acompanhar o desempenho e distribuir metas.",
      done: semGrupo === 0,
      detail: semGrupo === 0 ? undefined : semGrupo === 1 ? "1 vendedor sem grupo" : `${semGrupo} vendedores sem grupo`,
      needsGroups: lojaSemGrupos,
    },
    {
      id: "franchise",
      title: "Informar as taxas da franquia",
      description: "Royalties e taxa de marketing entram nos custos da operação e afetam o resultado operacional.",
      ...porLoja(franchiseOk),
    },
    {
      id: "rent",
      title: "Informar o aluguel",
      description: "O aluguel entra nos custos da operação e afeta o resultado operacional.",
      ...porLoja(rentOk),
    },
    {
      id: "taxes",
      title: "Informar os impostos",
      description: "ICMS e ICMS ST de cada marca entram no cálculo do lucro bruto e da margem.",
      ...porLoja(taxesOk),
    },
    {
      id: "goal",
      title: "Criar uma meta",
      description: "Acompanhe o atingimento, a projeção e a premiação da equipe.",
      ...criados(input.storesWithGoal),
    },
    {
      id: "challenge",
      title: "Criar um desafio",
      description: "Engaje a equipe com desafios de curto prazo e prêmios.",
      ...criados(input.storesWithChallenge),
    },
  ];
}

export type FirstStepsData = Omit<FirstStepsInput, "stores">;

async function client() {
  const { getSupabase } = await import("@/lib/supabase");
  return getSupabase();
}

const doneKey = (tenantId: string) => `wedash.firstSteps.done:${tenantId}`;

/** Grupos, metas e desafios das lojas (so o necessario para marcar os passos). */
export async function fetchFirstStepsData(tenantId: string, storeIds: string[]): Promise<FirstStepsData> {
  const out: FirstStepsData = {
    sellersByStore: new Map(),
    shiftIdsByStore: new Map(),
    storesWithGoal: new Set(),
    storesWithChallenge: new Set(),
  };
  if (storeIds.length === 0) return out;
  const sb = await client();
  if (!sb) return out;
  const porLoja = (table: string, cols: string) =>
    sb.from(table).select(cols).eq("tenant_id", tenantId).in("store_id", storeIds).limit(5000);
  const [sellers, shifts, goals, challenges] = await Promise.all([
    fetchStoreSellers(tenantId, storeIds),
    porLoja("store_shift", "id, store_id"),
    porLoja("goal", "store_id"),
    porLoja("challenge", "store_id"),
  ]);
  out.sellersByStore = sellers;
  for (const r of (shifts.data ?? []) as unknown as { id: string; store_id: string }[]) {
    out.shiftIdsByStore.set(r.store_id, [...(out.shiftIdsByStore.get(r.store_id) ?? []), r.id]);
  }
  for (const r of (goals.data ?? []) as unknown as { store_id: string }[]) out.storesWithGoal.add(r.store_id);
  for (const r of (challenges.data ?? []) as unknown as { store_id: string }[]) out.storesWithChallenge.add(r.store_id);
  for (const e of [shifts.error, goals.error, challenges.error]) if (e) console.warn("fetchFirstStepsData:", e.message);
  return out;
}

/** A empresa ja concluiu os primeiros passos (fica salvo: o card nao volta). */
export async function fetchFirstStepsDone(tenantId: string): Promise<boolean> {
  const sb = await client();
  if (!sb) return localStorage.getItem(doneKey(tenantId)) === "1";
  const { data, error } = await sb.from("tenant").select("first_steps_done_at").eq("id", tenantId).maybeSingle();
  if (error) {
    console.warn("fetchFirstStepsDone:", error.message);
    return false;
  }
  return (data as { first_steps_done_at: string | null } | null)?.first_steps_done_at != null;
}

export async function completeFirstSteps(tenantId: string): Promise<boolean> {
  const sb = await client();
  if (!sb) {
    localStorage.setItem(doneKey(tenantId), "1");
    return true;
  }
  const { error } = await sb.rpc("complete_first_steps", { p_tenant: tenantId });
  if (error) {
    console.warn("completeFirstSteps:", error.message);
    return false;
  }
  return true;
}
