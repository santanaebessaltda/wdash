import { groupComUnit, type GroupComUnit } from "./groupCom";
import { shoppingAccountView, type ShoppingAdministrator } from "./shoppingReport";

export type ShoppingAccount = NonNullable<ReturnType<typeof shoppingAccountView>>;

export type ShoppingLaunchResult = { ok: true; message?: string } | { ok: false; message: string };

const FAIL = "Não foi possível informar as vendas ao shopping. Os valores já informados foram mantidos.";
const SAVE_FAIL = "Não foi possível salvar o acesso do shopping. Tente novamente.";

/** Acesso da filial. A senha não vem nesta leitura. */
export async function fetchShoppingAccount(tenantId: string, storeId: string): Promise<ShoppingAccount | null> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("store_shopping")
    .select("store_id, administrator, base_url, username, last_run_at, last_error, unit")
    .eq("tenant_id", tenantId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return shoppingAccountView(data);
}

/** Dias que o shopping aceitou. A chave é a data. */
export async function fetchLaunchedDays(tenantId: string, storeId: string, from: string, to: string): Promise<Record<string, number>> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return {};
  const { data, error } = await sb
    .from("shopping_day")
    .select("day, launched_cents")
    .eq("tenant_id", tenantId)
    .eq("store_id", storeId)
    .gte("day", from)
    .lte("day", to);
  if (error) throw new Error(error.message);
  const out: Record<string, number> = {};
  for (const row of data ?? []) out[String(row.day).slice(0, 10)] = Number(row.launched_cents) || 0;
  return out;
}

export async function saveShoppingAccount(input: {
  storeId: string;
  administrator: ShoppingAdministrator;
  baseUrl: string;
  username: string;
  password: string;
  unit?: GroupComUnit | null;
}): Promise<ShoppingLaunchResult> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: SAVE_FAIL };
  const { data, error } = await sb.functions.invoke("shopping-credential-persist", { body: input });
  if (error || !data?.ok) return { ok: false, message: typeof data?.message === "string" ? data.message : SAVE_FAIL };
  return { ok: true };
}

const UNITS_FAIL = "Não foi possível entrar no Group COM. Confira o e-mail e a senha.";

/** Entra no Group COM e devolve as unidades. Não grava o acesso. */
export async function listGroupComUnits(input: {
  storeId: string;
  baseUrl: string;
  username: string;
  password: string;
}): Promise<{ ok: true; units: GroupComUnit[] } | { ok: false; message: string }> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: UNITS_FAIL };
  const { data, error } = await sb.functions.invoke("shopping-credential-persist", { body: { ...input, listUnits: true } });
  if (error || !data?.ok || !Array.isArray(data.units)) {
    return { ok: false, message: typeof data?.message === "string" ? data.message : UNITS_FAIL };
  }
  const units = data.units.flatMap((row: unknown) => {
    const unit = groupComUnit(row);
    return unit ? [unit] : [];
  });
  if (units.length === 0) return { ok: false, message: "Nenhuma unidade de lojista encontrada nesse Group COM." };
  return { ok: true, units };
}

const READ_FAIL = "Não foi possível ler os valores informados no shopping. Nada foi alterado.";

/** Lê a linha Informada já salva. Não envia venda. */
export async function requestShoppingRead(storeId: string, span?: { from: string; to: string }): Promise<ShoppingLaunchResult> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: READ_FAIL };
  const { data, error } = await sb.functions.invoke("shopping-report-run", { body: { storeId, read: true, from: span?.from ?? "", to: span?.to ?? "" } });
  if (error || !data) return { ok: false, message: READ_FAIL };
  if (data.ok === true) return { ok: true };
  return { ok: false, message: typeof data.message === "string" ? data.message : READ_FAIL };
}

/** Mesma rotina da madrugada, para a filial aberta. */
export async function requestShoppingLaunch(storeId: string, month: { from: string; to: string; days: string[] }): Promise<ShoppingLaunchResult> {
  const { getSupabase } = await import("@/lib/supabase");
  const sb = getSupabase();
  if (!sb) return { ok: false, message: FAIL };
  const { data, error } = await sb.functions.invoke("shopping-report-run", { body: { storeId, from: month.from, to: month.to, days: month.days } });
  if (error || !data) return { ok: false, message: FAIL };
  if (data.ok === true) return { ok: true, message: typeof data.message === "string" ? data.message : undefined };
  return { ok: false, message: typeof data.message === "string" ? data.message : FAIL };
}
