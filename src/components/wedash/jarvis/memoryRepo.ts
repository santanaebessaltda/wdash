import { getSupabase } from "@/lib/supabase";

export type JarvisMemoryFact = {
  id: string;
  text: string;
  at: string;
};

const FACTS_MAX = 40;
const FACT_TEXT_MAX = 280;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeFacts(raw: unknown): JarvisMemoryFact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is JarvisMemoryFact =>
        Boolean(f) &&
        typeof f === "object" &&
        typeof (f as JarvisMemoryFact).id === "string" &&
        typeof (f as JarvisMemoryFact).text === "string" &&
        (f as JarvisMemoryFact).text.trim().length > 0,
    )
    .map((f) => ({
      id: f.id,
      text: f.text.trim().slice(0, FACT_TEXT_MAX),
      at: typeof f.at === "string" ? f.at : new Date().toISOString(),
    }))
    .slice(-FACTS_MAX);
}

export async function loadJarvisMemory(
  tenantId: string,
  membershipId: string,
): Promise<JarvisMemoryFact[]> {
  const sb = getSupabase();
  if (!sb || !tenantId || !membershipId) return [];
  const { data, error } = await sb
    .from("jarvis_memory")
    .select("facts")
    .eq("tenant_id", tenantId)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (error) {
    console.warn("jarvis memory load:", error.message);
    return [];
  }
  return normalizeFacts(data?.facts);
}

export async function rememberJarvisFact(
  tenantId: string,
  membershipId: string,
  text: string,
): Promise<{ ok: true; facts: JarvisMemoryFact[] } | { ok: false; reason: string }> {
  const cleaned = text.trim().slice(0, FACT_TEXT_MAX);
  if (!cleaned) return { ok: false, reason: "fato_vazio" };
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };

  const current = await loadJarvisMemory(tenantId, membershipId);
  const folded = cleaned.toLowerCase();
  if (current.some((f) => f.text.toLowerCase() === folded)) {
    return { ok: true, facts: current };
  }
  const next = [
    ...current,
    { id: newId(), text: cleaned, at: new Date().toISOString() },
  ].slice(-FACTS_MAX);

  const { error } = await sb.from("jarvis_memory").upsert(
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      facts: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,membership_id" },
  );
  if (error) {
    console.warn("jarvis memory remember:", error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true, facts: next };
}

export async function forgetJarvisFact(
  tenantId: string,
  membershipId: string,
  match: string,
): Promise<{ ok: true; facts: JarvisMemoryFact[] } | { ok: false; reason: string }> {
  const needle = match.trim().toLowerCase();
  if (!needle) return { ok: false, reason: "match_vazio" };
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };

  const current = await loadJarvisMemory(tenantId, membershipId);
  const next = current.filter(
    (f) => f.id !== match.trim() && !f.text.toLowerCase().includes(needle),
  );
  const { error } = await sb.from("jarvis_memory").upsert(
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      facts: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,membership_id" },
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true, facts: next };
}

export async function clearJarvisMemory(
  tenantId: string,
  membershipId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, reason: "supabase_missing" };
  const { error } = await sb.from("jarvis_memory").upsert(
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      facts: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,membership_id" },
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export function formatMemoryForModel(facts: JarvisMemoryFact[]): string {
  if (!facts.length) return "Nenhuma memória de longo prazo ainda.";
  return facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n");
}
